const express = require('express');
const line = require('@line/bot-sdk');
const router = express.Router();
const { query } = require('../config/database');
const lineService    = require('../services/lineService');
const matchingService = require('../services/matchingService');
const paymentService = require('../services/paymentService');

const lineMiddleware = line.middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// ── Webhook endpoint ──────────────────────────────────────────────────────────
router.post('/', lineMiddleware, async (req, res) => {
  console.log('[Webhook] ✅ Received:', JSON.stringify(req.body?.events?.map(e => ({ type: e.type, source: e.source }))));
  const events = req.body.events;
  const results = await Promise.allSettled(events.map(handleEvent));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[Webhook] ❌ Event[${i}] error:`, r.reason?.message || r.reason);
  });
  res.status(200).json({ status: 'ok' });
});

async function handleEvent(event) {
  if (event.type === 'follow')   return handleFollow(event);
  if (event.type === 'postback') return handlePostback(event);
  if (event.type === 'message' && event.message.type === 'text')  return handleTextMessage(event);
  if (event.type === 'message' && event.message.type === 'image') return handleImageMessage(event);
}

// ── Postback (ปุ่มรับ/ปฏิเสธงาน) ─────────────────────────────────────────────
async function handlePostback(event) {
  const lineUserId = event.source.userId;
  const params     = new URLSearchParams(event.postback.data);
  const action     = params.get('action');
  const bookingId  = params.get('booking_id');
  const fromOffline = params.get('from_offline') === 'true';

  if (action === 'accept_job' && bookingId) {
    return handleAcceptJobPostback(lineUserId, bookingId, fromOffline, event.replyToken);
  }

  if (action === 'reject_job' && bookingId) {
    return lineService.client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'รับทราบ ขอบคุณครับ 👍\nระบบจะหาคนขับท่านอื่นให้ลูกค้า' }],
    });
  }

  if (action === 'toggle_online') {
    const isOnline = params.get('value') === 'true';
    return handleDriverOnline(lineUserId, isOnline, event.replyToken);
  }

  // ── Admin อนุมัติ/ปฏิเสธคนขับ ─────────────────────────────────────────────
  if (action === 'approve_driver') {
    const driverId = params.get('driver_id');
    return handleApproveDriver(lineUserId, driverId, event.replyToken);
  }
  if (action === 'reject_driver') {
    const driverId = params.get('driver_id');
    return handleRejectDriver(lineUserId, driverId, event.replyToken);
  }
  if (action === 'confirm_payout') {
    const payoutId = params.get('payout_id');
    return handleConfirmPayout(lineUserId, payoutId, event.replyToken);
  }

  // ── Admin อนุมัติ/ปฏิเสธสลิป ──────────────────────────────────────────
  if (action === 'approve_payment') {
    const paymentId = params.get('payment_id');
    return handleApprovePayment(lineUserId, paymentId, event.replyToken);
  }
  if (action === 'reject_payment') {
    const paymentId = params.get('payment_id');
    return handleRejectPayment(lineUserId, paymentId, event.replyToken);
  }
}

async function handleAcceptJobPostback(driverLineUserId, bookingId, fromOffline, replyToken) {
  const userRes = await query(`SELECT id FROM users WHERE line_user_id = $1`, [driverLineUserId]);
  if (!userRes.rows[0]) return;

  const driverRes = await query(`SELECT id FROM drivers WHERE user_id = $1`, [userRes.rows[0].id]);
  if (!driverRes.rows[0]) return;

  const result = await matchingService.acceptBooking(bookingId, driverRes.rows[0].id);

  if (!result.success) {
    return lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `❌ ${result.reason}` }],
    });
  }

  // ถ้าคนขับรับงานจากสถานะออฟไลน์ → เปิดออนไลน์เฉพาะงานนี้โดยไม่เปลี่ยน is_online
  if (fromOffline) {
    console.log(`[Webhook] Driver went online for job ${bookingId} (was offline)`);
  }

  // แจ้งคนขับ
  await lineService.client.replyMessage({
    replyToken,
    messages: [{
      type: 'flex',
      altText: `✅ รับงาน #${result.booking.booking_number} สำเร็จ!`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#1D9E75', paddingAll: '16px',
          contents: [{ type: 'text', text: '✅ รับงานสำเร็จ!', color: '#ffffff', size: 'xl', weight: 'bold' }],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            { type: 'text', text: 'กรุณาไปรับผู้โดยสารที่:', size: 'sm', color: '#6B7280' },
            { type: 'text', text: result.booking.pickup_address, size: 'md', weight: 'bold', wrap: true },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: `🕐 ${formatThaiDate(result.booking.scheduled_at)}`, size: 'sm' },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical',
          contents: [{
            type: 'button', style: 'primary', color: '#1D9E75',
            action: {
              type: 'uri',
              label: '🗺️ นำทางไปรับผู้โดยสาร',
              uri: result.booking.pickup_lat
                ? `https://maps.google.com/?q=${result.booking.pickup_lat},${result.booking.pickup_lng}`
                : `https://maps.google.com/?q=${encodeURIComponent(result.booking.pickup_address)}`,
            },
          }],
        },
      },
    }],
  });

  // แจ้งลูกค้า
  const custRes = await query(
    `SELECT u.line_user_id FROM users u WHERE u.id = $1`,
    [result.booking.customer_id]
  );
  if (custRes.rows[0]) {
    // ดึงข้อมูลคนขับ
    const drvInfo = await query(
      `SELECT d.*, u.display_name FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id = $1`,
      [driverRes.rows[0].id]
    );
    const drv = drvInfo.rows[0];
    await lineService.client.pushMessage({
      to: custRes.rows[0].line_user_id,
      messages: [{
        type: 'flex',
        altText: `🚗 คนขับรับงานแล้ว! #${result.booking.booking_number}`,
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical', backgroundColor: '#1D9E75', paddingAll: '16px',
            contents: [{ type: 'text', text: '🚗 คนขับรับงานแล้ว!', color: '#ffffff', size: 'xl', weight: 'bold' }],
          },
          body: {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              { type: 'text', text: `👤 ${drv?.display_name || 'คนขับ'}`, size: 'lg', weight: 'bold' },
              drv?.car_brand ? { type: 'text', text: `🚗 ${drv.car_brand} ${drv.car_model} — ${drv.car_plate}`, size: 'sm', color: '#374151' } : null,
              drv?.car_color ? { type: 'text', text: `🎨 สี${drv.car_color}`, size: 'sm', color: '#6B7280' } : null,
              { type: 'separator', margin: 'md' },
              { type: 'text', text: `📍 มารับที่: ${result.booking.pickup_address}`, size: 'sm', wrap: true },
              { type: 'text', text: `🕐 ${formatThaiDate(result.booking.scheduled_at)}`, size: 'sm' },
            ].filter(Boolean),
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{
              type: 'button', style: 'secondary',
              action: { type: 'message', label: '❌ ยกเลิก', text: `ยกเลิกการจอง ${result.booking.booking_number}` },
            }],
          },
        },
      }],
    });
  }
}

// ── ผู้ใช้ add LINE OA ──────────────────────────────────────────────────────
async function handleFollow(event) {
  const lineUserId = event.source.userId;

  // ดึงโปรไฟล์จาก LINE
  const profile = await lineService.client.getProfile(lineUserId);

  // บันทึก user ถ้ายังไม่มี
  await query(
    `INSERT INTO users (line_user_id, display_name, picture_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (line_user_id) DO UPDATE
     SET display_name = $2, picture_url = $3`,
    [lineUserId, profile.displayName, profile.pictureUrl]
  );

  // ส่ง welcome message
  await lineService.client.pushMessage({
    to: lineUserId,
    messages: [{
      type: 'flex',
      altText: 'ยินดีต้อนรับสู่ Smile Service 🚗',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1D9E75',
          paddingAll: '24px',
          contents: [
            { type: 'text', text: '🚗 SMILE SERVICE', color: '#ffffff', size: 'xxl', weight: 'bold', align: 'center' },
            { type: 'text', text: 'บริการรถรับส่งผู้สูงอายุ', color: '#d1fae5', size: 'md', align: 'center', margin: 'sm' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: `สวัสดีคุณ ${profile.displayName} 👋`, size: 'lg', weight: 'bold' },
            { type: 'text', text: 'คุณต้องการใช้บริการในฐานะ:', wrap: true, color: '#555555' },
            {
              type: 'button', style: 'primary', color: '#1D9E75',
              action: { type: 'message', label: '👴 ฉันต้องการใช้บริการรถ', text: 'สมัครลูกค้า' },
            },
            {
              type: 'button', style: 'secondary',
              action: {
                type: 'uri',
                label: '🚗 ฉันต้องการเป็นคนขับ',
                uri: `https://liff.line.me/${process.env.LIFF_ID_DRIVER_REGISTER}`,
              },
            },
          ],
        },
      },
    }],
  });
}

// ── Text message handler ──────────────────────────────────────────────────────
async function handleTextMessage(event) {
  const { text } = event.message;
  const lineUserId = event.source.userId;

  // หา user จาก DB
  const userRes = await query(
    `SELECT * FROM users WHERE line_user_id = $1`,
    [lineUserId]
  );
  const user = userRes.rows[0];

  // ── Commands ───────────────────────────────────────────
  if (text === 'สมัครลูกค้า') {
    return handleCustomerRegistration(event, user);
  }

  if (text === 'ดูประวัติการจอง') {
    return sendBookingHistory(lineUserId, user);
  }

  if (text === 'บัญชีของฉัน') {
    return sendAccountInfo(lineUserId, user);
  }

  if (text === 'เปิดรับงาน') {
    return handleDriverOnline(lineUserId, true);
  }

  if (text === 'ปิดรับงาน') {
    return handleDriverOnline(lineUserId, false);
  }

  if (text === 'รายได้ของฉัน') {
    return sendDriverEarnings(lineUserId, user);
  }

  // รับงาน / ปฏิเสธงาน (fallback text ถ้า postback ไม่ทำงาน)
  if (text.startsWith('รับงาน ')) {
    const bookingId = text.replace('รับงาน ', '').trim();
    return handleAcceptJob(lineUserId, bookingId);
  }

  if (text.startsWith('ปฏิเสธงาน ')) {
    return lineService.client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'รับทราบ ขอบคุณครับ 👍\nระบบจะหาคนขับท่านอื่นต่อไป' }],
    });
  }

  if (text === 'เปิดรับงาน') return handleDriverOnline(lineUserId, true, null);
  if (text === 'ปิดรับงาน')  return handleDriverOnline(lineUserId, false, null);

  // ยกเลิกการจอง
  if (text.startsWith('ยกเลิกการจอง ')) {
    const bookingNum = text.replace('ยกเลิกการจอง ', '').trim();
    return handleCancelBooking(lineUserId, bookingNum);
  }

  // Default
  await lineService.client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: 'กดปุ่มเมนูด้านล่างเพื่อใช้งานได้เลยครับ 😊' }],
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleCustomerRegistration(event, user) {
  if (!user) return;

  // ตั้งค่า role เป็น customer ถ้ายังไม่ได้กำหนด
  await query(`UPDATE users SET role = 'customer' WHERE id = $1`, [user.id]);

  await lineService.client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: `ยินดีต้อนรับ! ตอนนี้คุณสามารถใช้งานได้แล้วครับ 🎉\n\nกด "จองรถ" ที่เมนูด้านล่างเพื่อเริ่มจองได้เลยครับ`,
    }],
  });
}

async function sendBookingHistory(lineUserId, user) {
  if (!user) return;

  const res = await query(
    `SELECT b.booking_number, b.status, b.scheduled_at, b.pickup_address, b.dropoff_address, b.final_price
     FROM bookings b WHERE b.customer_id = $1 ORDER BY b.created_at DESC LIMIT 5`,
    [user.id]
  );

  if (res.rows.length === 0) {
    return lineService.client.pushMessage({
      to: lineUserId,
      messages: [{ type: 'text', text: 'ยังไม่มีประวัติการจองครับ\nกด "จองรถ" เพื่อเริ่มจองได้เลย 🚗' }],
    });
  }

  const bubbles = res.rows.map(b => ({
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `#${b.booking_number}`, weight: 'bold', size: 'sm', color: '#1D9E75' },
        { type: 'text', text: b.pickup_address, size: 'xs', color: '#555', wrap: true },
        { type: 'text', text: `→ ${b.dropoff_address}`, size: 'xs', color: '#555', wrap: true },
        { type: 'text', text: statusLabel(b.status), size: 'xs', color: statusColor(b.status) },
        b.final_price ? { type: 'text', text: `฿${b.final_price}`, size: 'sm', weight: 'bold' } : null,
      ].filter(Boolean),
    },
  }));

  await lineService.client.pushMessage({
    to: lineUserId,
    messages: [{
      type: 'flex',
      altText: 'ประวัติการจอง 5 รายการล่าสุด',
      contents: { type: 'carousel', contents: bubbles },
    }],
  });
}

async function sendAccountInfo(lineUserId, user) {
  if (!user) return;
  const text = `👤 บัญชีของคุณ\n\nชื่อ: ${user.display_name}\nสถานะ: ${user.role === 'driver' ? 'คนขับ' : 'ลูกค้า'}\nสมาชิกตั้งแต่: ${new Date(user.created_at).toLocaleDateString('th-TH')}`;
  await lineService.client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
}

async function handleDriverOnline(lineUserId, isOnline, replyToken) {
  const userRes = await query(`SELECT id FROM users WHERE line_user_id = $1`, [lineUserId]);
  if (!userRes.rows[0]) return;
  await query(
    `UPDATE drivers SET is_online = $1 WHERE user_id = $2`,
    [isOnline, userRes.rows[0].id]
  );
  const msg = { type: 'text', text: isOnline
    ? '🟢 เปิดรับงานแล้ว!\nระบบจะส่งงานให้คุณทันทีเมื่อมีลูกค้าจอง'
    : '🔴 ปิดรับงานแล้ว\nคุณจะไม่ได้รับแจ้งเตือนงานใหม่' };

  if (replyToken) {
    return lineService.client.replyMessage({ replyToken, messages: [msg] });
  }
  return lineService.client.pushMessage({ to: lineUserId, messages: [msg] });
}

function formatThaiDate(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function sendDriverEarnings(lineUserId, user) {
  const userRes = await query(`SELECT id FROM users WHERE line_user_id = $1`, [lineUserId]);
  if (!userRes.rows[0]) return;

  const res = await query(
    `SELECT
       SUM(gross_amount) as gross, SUM(platform_fee) as fee,
       SUM(tip_amount) as tips, SUM(net_amount) as net,
       SUM(camera_fund) as cam_fund
     FROM driver_earnings de
     JOIN drivers d ON d.id = de.driver_id
     WHERE d.user_id = $1 AND de.created_at >= NOW() - INTERVAL '30 days'`,
    [userRes.rows[0].id]
  );
  const e = res.rows[0];
  const camRes = await query(
    `SELECT camera_fund FROM drivers WHERE user_id = $1`,
    [userRes.rows[0].id]
  );
  const camTotal = camRes.rows[0]?.camera_fund || 0;

  const text = `💰 รายได้ 30 วันที่ผ่านมา\n\n` +
    `รายได้รวม: ฿${Math.round(e.gross || 0).toLocaleString()}\n` +
    `ค่า commission: ฿${Math.round(e.fee || 0).toLocaleString()}\n` +
    `Tip จากลูกค้า: ฿${Math.round(e.tips || 0).toLocaleString()}\n` +
    `──────────────────\n` +
    `รับจริง: ฿${Math.round(e.net || 0).toLocaleString()}\n\n` +
    (camTotal < 4000
      ? `📷 กองทุนกล้อง: ฿${Math.round(camTotal).toLocaleString()} / 4,000 (${Math.round(camTotal/40)}%)`
      : `📷 ✅ ครบ 4,000 แล้ว! กล้องกำลังส่งให้คุณ 🎉`);

  await lineService.client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
}

// Fallback text-based accept (ไว้รองรับกรณีเก่า — ใช้ push แทน reply)
async function handleAcceptJob(driverLineUserId, bookingId) {
  const userRes = await query(`SELECT id FROM users WHERE line_user_id = $1`, [driverLineUserId]);
  if (!userRes.rows[0]) return;
  const driverRes = await query(`SELECT id FROM drivers WHERE user_id = $1`, [userRes.rows[0].id]);
  if (!driverRes.rows[0]) return;
  const result = await matchingService.acceptBooking(bookingId, driverRes.rows[0].id);
  if (!result.success) {
    return lineService.client.pushMessage({ to: driverLineUserId, messages: [{ type: 'text', text: `❌ ${result.reason}` }] });
  }
  await lineService.client.pushMessage({
    to: driverLineUserId,
    messages: [{ type: 'text', text: `✅ รับงานสำเร็จ!\n\nรับที่: ${result.booking.pickup_address}\nเวลา: ${formatThaiDate(result.booking.scheduled_at)}` }],
  });
  const custRes = await query(`SELECT u.line_user_id FROM users u WHERE u.id = $1`, [result.booking.customer_id]);
  if (custRes.rows[0]) await lineService.sendBookingConfirmation(custRes.rows[0].line_user_id, result.booking);
}

async function handleCancelBooking(lineUserId, bookingNumber) {
  const userRes = await query(`SELECT id FROM users WHERE line_user_id = $1`, [lineUserId]);
  if (!userRes.rows[0]) return;

  const res = await query(
    `UPDATE bookings SET status = 'cancelled', cancelled_by = 'customer', cancel_reason = 'ลูกค้ายกเลิก'
     WHERE booking_number = $1 AND customer_id = $2 AND status IN ('pending','searching','confirmed')
     RETURNING *`,
    [bookingNumber, userRes.rows[0].id]
  );

  const msg = res.rows.length > 0
    ? `✅ ยกเลิกการจอง #${bookingNumber} แล้วครับ`
    : `❌ ไม่สามารถยกเลิกได้ (อาจเริ่มเดินทางแล้ว หรือไม่พบการจองนี้)`;

  await lineService.client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text: msg }] });
}

// ── Admin อนุมัติคนขับ ────────────────────────────────────────────────────────
async function handleApproveDriver(adminLineUserId, driverId, replyToken) {
  try {
    const { rows: [driver] } = await query(
      `UPDATE drivers SET status='active', verified_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *, (SELECT line_user_id FROM users WHERE id=user_id) as line_user_id,
       (SELECT display_name FROM users WHERE id=user_id) as display_name`,
      [driverId]
    );
    if (!driver) {
      return lineService.client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'ไม่พบคนขับ' }] });
    }
    // แจ้งคนขับ
    if (driver.line_user_id) {
      await lineService.client.pushMessage({
        to: driver.line_user_id,
        messages: [{
          type: 'flex',
          altText: '🎉 บัญชีคนขับได้รับการอนุมัติแล้ว!',
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical', paddingAll: '24px', spacing: 'md',
              contents: [
                { type: 'text', text: '🎉', size: '3xl', align: 'center' },
                { type: 'text', text: 'ยินดีด้วย!', weight: 'bold', size: 'xl', align: 'center', color: '#1D9E75' },
                { type: 'text', text: `สวัสดีคุณ ${driver.first_name}`, size: 'sm', align: 'center', color: '#555' },
                { type: 'separator', margin: 'md' },
                { type: 'text', text: 'บัญชีคนขับของคุณได้รับการอนุมัติแล้ว ✅\nกดปุ่ม "เปิดรับงาน" ได้เลยค่ะ', wrap: true, size: 'sm', color: '#444', align: 'center' },
              ],
            },
            footer: {
              type: 'box', layout: 'vertical', paddingAll: '12px',
              contents: [{
                type: 'button', style: 'primary', color: '#1D9E75',
                action: { type: 'uri', label: '🚗 เริ่มรับงาน', uri: `https://liff.line.me/${process.env.LIFF_ID_DRIVER}` },
              }],
            },
          },
        }],
      });
    }
    await lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `✅ อนุมัติ ${driver.first_name} ${driver.last_name} แล้ว\nแจ้งเตือนคนขับเรียบร้อย` }],
    });
  } catch (err) {
    console.error('[handleApproveDriver]', err);
  }
}

// ── Admin ปฏิเสธคนขับ ─────────────────────────────────────────────────────────
async function handleRejectDriver(adminLineUserId, driverId, replyToken) {
  try {
    const { rows: [driver] } = await query(
      `UPDATE drivers SET status='rejected', rejection_reason='ข้อมูลไม่ครบถ้วน / ไม่ผ่านเกณฑ์', updated_at=NOW()
       WHERE id=$1 RETURNING *, (SELECT line_user_id FROM users WHERE id=user_id) as line_user_id`,
      [driverId]
    );
    if (!driver) return;
    if (driver.line_user_id) {
      await lineService.client.pushMessage({
        to: driver.line_user_id,
        messages: [{ type: 'text', text: `❌ ขออภัย ยังไม่สามารถอนุมัติบัญชีคนขับได้\n\nเหตุผล: ข้อมูลไม่ครบถ้วน / ไม่ผ่านเกณฑ์\n\nกรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามเพิ่มเติมค่ะ` }],
      });
    }
    await lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `❌ ปฏิเสธ ${driver.first_name} ${driver.last_name} แล้ว\nแจ้งคนขับเรียบร้อย` }],
    });
  } catch (err) {
    console.error('[handleRejectDriver]', err);
  }
}

// ── Admin ยืนยันโอนเงิน ──────────────────────────────────────────────────────
async function handleConfirmPayout(adminLineUserId, payoutId, replyToken) {
  try {
    const { rows: [payout] } = await query(
      `UPDATE driver_payouts SET status='paid', paid_at=NOW(), paid_by=$2 WHERE id=$1 RETURNING *, driver_id`,
      [payoutId, adminLineUserId]
    );
    if (!payout) return;

    const userRes = await query(
      `SELECT u.line_user_id, d.first_name FROM users u JOIN drivers d ON d.user_id=u.id WHERE d.id=$1`,
      [payout.driver_id]
    );
    if (userRes.rows[0]?.line_user_id) {
      await lineService.client.pushMessage({
        to: userRes.rows[0].line_user_id,
        messages: [{ type: 'text', text: `✅ โอนเงินให้คุณ ${userRes.rows[0].first_name} แล้วค่ะ\n💰 ฿${Number(payout.amount).toLocaleString()}\nกรุณาตรวจสอบบัญชีได้เลย` }],
      });
    }
    await lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `✅ บันทึกการโอนเงิน ฿${Number(payout.amount).toLocaleString()} แล้ว\nแจ้งคนขับเรียบร้อย` }],
    });
  } catch (err) {
    console.error('[handleConfirmPayout]', err);
  }
}

// ── รับภาพสลิปจากลูกค้า ──────────────────────────────────────────────────────
async function handleImageMessage(event) {
  const lineUserId = event.source.userId;
  // ตรวจว่า user มี pending_payment booking ก่อน (เร็ว ไม่ดึงภาพถ้าไม่จำเป็น)
  const { rows } = await query(
    `SELECT b.id FROM bookings b
     JOIN users u ON u.id = b.user_id
     JOIN payments p ON p.booking_id = b.id
     WHERE u.line_user_id = $1
       AND b.payment_status = 'pending_payment'
       AND p.status IN ('pending','manual_review')
     LIMIT 1`,
    [lineUserId]
  );
  if (!rows[0]) return; // ไม่ใช่สลิป — ไม่ต้องทำอะไร

  // ส่งให้ paymentService จัดการ
  await paymentService.processSlipFromLine(event, lineUserId);
}

// ── Admin อนุมัติสลิป ─────────────────────────────────────────────────────────
async function handleApprovePayment(adminLineUserId, paymentId, replyToken) {
  try {
    const { rows: [payment] } = await query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
    if (!payment || payment.status === 'paid') {
      return lineService.client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'ชำระเงินสำเร็จแล้ว หรือไม่พบรายการ' }] });
    }

    const result = await paymentService.approvePayment(paymentId, `admin:${adminLineUserId}`);
    if (!result) return;

    // dispatch driver
    const { rows: [booking] } = await query(`SELECT * FROM bookings WHERE id = $1`, [result.bookingId]);
    if (booking) await matchingService.findAndNotifyDrivers(booking);

    await lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `✅ อนุมัติสลิปแล้ว\n🔖 ${booking?.booking_number}\n💰 ฿${Number(payment.amount).toLocaleString()}\nกำลังส่งงานหาคนขับ...` }],
    });
  } catch (err) {
    console.error('[handleApprovePayment]', err);
  }
}

// ── Admin ปฏิเสธสลิป ─────────────────────────────────────────────────────────
async function handleRejectPayment(adminLineUserId, paymentId, replyToken) {
  try {
    const payment = await paymentService.rejectPayment(paymentId, `admin:${adminLineUserId}`, 'Admin ปฏิเสธ');
    if (!payment) {
      return lineService.client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'ไม่พบรายการหรือดำเนินการแล้ว' }] });
    }

    // แจ้งลูกค้า
    const { rows: [user] } = await query(
      `SELECT u.line_user_id FROM users u JOIN bookings b ON b.user_id = u.id WHERE b.id = $1`,
      [payment.booking_id]
    );
    if (user?.line_user_id) {
      await lineService.client.pushMessage({
        to: user.line_user_id,
        messages: [{ type: 'text', text: '❌ สลิปไม่ผ่านการตรวจสอบ\nกรุณาติดต่อเจ้าหน้าที่หากเกิดข้อผิดพลาด' }],
      });
    }

    await lineService.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '❌ ปฏิเสธสลิปแล้ว และแจ้งลูกค้าเรียบร้อย' }],
    });
  } catch (err) {
    console.error('[handleRejectPayment]', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusLabel(s) {
  const m = { pending:'⏳ รอคนขับ', searching:'🔍 กำลังหาคนขับ', confirmed:'✅ ยืนยันแล้ว', in_progress:'🚗 กำลังเดินทาง', completed:'🎉 เสร็จสิ้น', cancelled:'❌ ยกเลิก' };
  return m[s] || s;
}
function statusColor(s) {
  const m = { completed:'#1D9E75', cancelled:'#EF4444', in_progress:'#F97316' };
  return m[s] || '#555555';
}

// ── Webhook error handler (signature ผิด → 400 ไม่ใช่ 500) ──────────────────
router.use((err, req, res, next) => {
  if (err.statusCode === 401 || err.name === 'SignatureValidationFailed') {
    return res.status(400).json({ error: 'Invalid LINE signature' });
  }
  next(err);
});

module.exports = router;
