const { query }  = require('../config/database');
const axios      = require('axios');

// ── ตรวจว่า package มีหรือยัง (safe require) ────────────────────────────────
let generatePayload, QRCode, FormData;
try { generatePayload = require('promptpay-qr'); } catch { generatePayload = null; }
try { QRCode          = require('qrcode');        } catch { QRCode = null; }
try { FormData        = require('form-data');     } catch { FormData = null; }

const PROMPTPAY_ID  = process.env.PROMPTPAY_ID;             // เบอร์มือถือ หรือ เลขนิติบุคคล
const EASYSLIP_KEY  = process.env.EASYSLIP_API_KEY;
const ADMIN_LINE_ID = process.env.ADMIN_LINE_USER_ID;       // LINE userId ของ Admin

// ─── สร้าง PromptPay QR (base64 PNG) ────────────────────────────────────────
async function generatePromptPayQR(amount) {
  if (!generatePayload || !QRCode) {
    console.warn('promptpay-qr / qrcode ยังไม่ได้ install — run: npm install promptpay-qr qrcode');
    return null;
  }
  if (!PROMPTPAY_ID) {
    console.warn('PROMPTPAY_ID not set in .env');
    return null;
  }
  const payload    = generatePayload(PROMPTPAY_ID, { amount });
  const qrDataURL  = await QRCode.toDataURL(payload, {
    width: 320, margin: 2,
    color: { dark: '#1a3a2a', light: '#ffffff' },
  });
  return qrDataURL; // data:image/png;base64,...
}

// ─── สร้าง payment record ───────────────────────────────────────────────────
async function createPayment(bookingId, amount) {
  await query(
    `UPDATE bookings SET payment_status = 'pending_payment', estimated_total = $2 WHERE id = $1`,
    [bookingId, amount]
  );
  const { rows } = await query(
    `INSERT INTO payments (booking_id, amount)
     VALUES ($1, $2)
     ON CONFLICT (booking_id) DO UPDATE
       SET amount = $2, status = 'pending', updated_at = NOW()
     RETURNING *`,
    [bookingId, amount]
  );
  return rows[0];
}

// ─── ดึงภาพสลิปจาก LINE (binary Buffer) ──────────────────────────────────
async function getLineImageBuffer(messageId) {
  const { data } = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
      timeout: 12000,
    }
  );
  return Buffer.from(data);
}

// ─── ตรวจสลิปกับ EasySlip API ────────────────────────────────────────────
async function verifySlipEasySlip(imageBuffer) {
  if (!EASYSLIP_KEY || !FormData) return null;
  try {
    const form = new FormData();
    form.append('file', imageBuffer, { filename: 'slip.jpg', contentType: 'image/jpeg' });
    const { data } = await axios.post(
      'https://developer.easyslip.com/api/v1/verify',
      form,
      {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${EASYSLIP_KEY}` },
        timeout: 15000,
      }
    );
    return data; // { status: 200, data: { amount: { amount: 100 }, receiver: {...}, ... } }
  } catch (err) {
    console.error('[EasySlip]', err.response?.data || err.message);
    return null;
  }
}

// ─── อนุมัติ payment + trigger dispatch ──────────────────────────────────
async function approvePayment(paymentId, verifiedBy, easyslipData = null) {
  const { rows } = await query(
    `UPDATE payments SET
       status = 'paid', verified_at = NOW(), verified_by = $2,
       easyslip_data = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING *, booking_id`,
    [paymentId, verifiedBy, easyslipData ? JSON.stringify(easyslipData) : null]
  );
  if (!rows[0]) return null;

  await query(
    `UPDATE bookings SET payment_status = 'paid' WHERE id = $1`,
    [rows[0].booking_id]
  );
  return { payment: rows[0], bookingId: rows[0].booking_id };
}

// ─── ปฏิเสธ payment ──────────────────────────────────────────────────────
async function rejectPayment(paymentId, by, note = '') {
  const { rows } = await query(
    `UPDATE payments SET status = 'failed', verified_by = $2, admin_note = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *, booking_id`,
    [paymentId, by, note]
  );
  if (rows[0]) {
    await query(
      `UPDATE bookings SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
      [rows[0].booking_id]
    );
  }
  return rows[0];
}

// ─── แจ้ง Admin ตรวจสลิป manual ────────────────────────────────────────────
async function notifyAdminForReview(booking, payment) {
  if (!ADMIN_LINE_ID) {
    console.warn('ADMIN_LINE_USER_ID not set — cannot notify admin');
    return;
  }
  const lineClient = getLineClient();
  const flex = {
    type: 'flex',
    altText: `📋 ตรวจสลิป: ${booking.booking_number}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#F59E0B', paddingAll: '16px',
        contents: [
          { type: 'text', text: '📋 ตรวจสลิปด้วยตนเอง', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'EasySlip ตรวจไม่ผ่าน — กรุณาตรวจสอบ', color: '#ffffffaa', size: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          { type: 'text', text: `🔖 ${booking.booking_number}`, weight: 'bold', size: 'md' },
          { type: 'text', text: `👤 ${booking.passenger_name}`, size: 'sm', color: '#666' },
          { type: 'text', text: `📍 ${booking.pickup_address || '—'}`, size: 'xs', color: '#888', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: `💰 ยอดที่ต้องชำระ`, size: 'sm', color: '#555' },
          { type: 'text', text: `฿${Number(payment.amount).toLocaleString()}`, size: 'xxl', weight: 'bold', color: '#059669' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
        contents: [
          {
            type: 'button', style: 'primary', color: '#059669', flex: 1,
            action: { type: 'postback', label: '✅ อนุมัติ', data: `action=approve_payment&payment_id=${payment.id}` },
          },
          {
            type: 'button', style: 'primary', color: '#EF4444', flex: 1,
            action: { type: 'postback', label: '❌ ปฏิเสธ', data: `action=reject_payment&payment_id=${payment.id}` },
          },
        ],
      },
    },
  };

  try {
    await lineClient.pushMessage(ADMIN_LINE_ID, flex);
  } catch (err) {
    console.error('[notifyAdmin]', err.message);
  }
}

// ─── Main: ประมวลสลิปภาพจาก LINE ────────────────────────────────────────────
async function processSlipFromLine(event, lineUserId) {
  try {
    // หา booking รอชำระของ user นี้
    const { rows } = await query(
      `SELECT b.*, p.id AS payment_id, p.amount AS pay_amount, p.status AS pay_status
       FROM bookings b
       JOIN payments  p ON p.booking_id = b.id
       JOIN users     u ON u.id = b.user_id
       WHERE u.line_user_id = $1
         AND b.payment_status = 'pending_payment'
         AND p.status IN ('pending','manual_review')
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [lineUserId]
    );

    const lineClient = getLineClient();

    if (!rows[0]) {
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '❓ ไม่พบการจองที่รอชำระเงินค่ะ\nหากมีปัญหา กรุณาติดต่อเจ้าหน้าที่',
      });
      return;
    }

    const booking = rows[0];
    const paymentId = booking.payment_id;
    const expectedAmount = parseFloat(booking.pay_amount);

    // ตอบ "กำลังตรวจ"
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏳ กำลังตรวจสอบสลิปอัตโนมัติ...\nกรุณารอสักครู่ค่ะ',
    });

    // ดึงรูปจาก LINE
    const imageBuffer = await getLineImageBuffer(event.message.id);

    // ── Phase 1: EasySlip Auto ──────────────────────────────────────────────
    let approved = false;
    let easyslipData = null;

    if (EASYSLIP_KEY) {
      const result = await verifySlipEasySlip(imageBuffer);
      if (result?.status === 200 && result?.data) {
        const slipAmount = result.data.amount?.amount;
        if (slipAmount && Math.abs(slipAmount - expectedAmount) <= 1) {
          approved    = true;
          easyslipData = result.data;
        } else {
          console.log(`[Slip] amount mismatch: expected ${expectedAmount}, got ${slipAmount}`);
        }
      }
    }

    if (approved) {
      // ✅ Auto approve → dispatch driver
      const { bookingId } = await approvePayment(paymentId, 'auto', easyslipData);
      const { rows: [fullBooking] } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
      if (fullBooking) {
        const matchingService = require('./matchingService');
        await matchingService.findAndNotifyDrivers(fullBooking);
      }

      await lineClient.pushMessage(lineUserId, {
        type: 'flex',
        altText: '✅ ชำระเงินสำเร็จ!',
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', paddingAll: '24px', spacing: 'md',
            contents: [
              { type: 'text', text: '✅', size: '3xl', align: 'center' },
              { type: 'text', text: 'ชำระเงินสำเร็จ!', weight: 'bold', size: 'xl', align: 'center', color: '#059669' },
              { type: 'text', text: `฿${expectedAmount.toLocaleString()}`, size: 'lg', align: 'center', color: '#059669' },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: 'กำลังหาคนขับให้คุณ 🚗\nจะแจ้งเตือนเมื่อคนขับรับงานค่ะ', wrap: true, size: 'sm', color: '#555', align: 'center' },
            ],
          },
        },
      });

    } else {
      // ❌ Auto fail → Manual review
      await query(
        `UPDATE payments SET status = 'manual_review', updated_at = NOW() WHERE id = $1`,
        [paymentId]
      );
      await notifyAdminForReview(booking, { id: paymentId, amount: expectedAmount });
      await lineClient.pushMessage(lineUserId, {
        type: 'text',
        text: '📋 ระบบตรวจสลิปอัตโนมัติไม่สำเร็จ\nเจ้าหน้าที่จะตรวจสอบและยืนยันให้ภายใน 5-10 นาทีค่ะ',
      });
    }
  } catch (err) {
    console.error('[processSlipFromLine]', err);
  }
}

// ─── Helper: LINE client ─────────────────────────────────────────────────────
function getLineClient() {
  const { Client } = require('@line/bot-sdk');
  return new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
}

module.exports = {
  generatePromptPayQR,
  createPayment,
  approvePayment,
  rejectPayment,
  processSlipFromLine,
  notifyAdminForReview,
};
