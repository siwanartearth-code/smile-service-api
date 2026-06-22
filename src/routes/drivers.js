const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ── POST /drivers/register  — คนขับสมัครผ่าน LIFF ────────────────────────────
router.post('/register', authenticate, async (req, res) => {
  const {
    first_name, last_name, id_card_number,
    id_card_image_url, license_number, license_type,
    license_expiry, license_image_url,
    car_brand, car_model, car_year, car_color, car_plate, car_type,
    car_image_url, car_insurance_url,
  } = req.body;

  // แปลง empty string → null สำหรับ date fields และ optional fields
  const safeDate = (v) => (v && v !== '' ? v : null);
  const safeStr  = (v) => (v && v !== '' ? v : null);

  // อัปเดต role เป็น driver
  await query(`UPDATE users SET role = 'driver', phone = $1 WHERE id = $2`, [req.body.phone || null, req.user.id]);

  // สร้าง driver record
  const { rows } = await query(
    `INSERT INTO drivers (
       id, user_id, first_name, last_name, id_card_number, id_card_image_url,
       license_number, license_type, license_expiry, license_image_url,
       car_brand, car_model, car_year, car_color, car_plate, car_type,
       car_image_url, car_insurance_url, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending')
     ON CONFLICT (user_id) DO UPDATE SET
       first_name=$3, last_name=$4, id_card_number=$5, id_card_image_url=$6,
       license_number=$7, license_type=$8, license_expiry=$9, license_image_url=$10,
       car_brand=$11, car_model=$12, car_year=$13, car_color=$14, car_plate=$15, car_type=$16,
       car_image_url=$17, car_insurance_url=$18, updated_at=NOW()
     RETURNING *`,
    [
      uuidv4(), req.user.id,
      safeStr(first_name), safeStr(last_name), safeStr(id_card_number), safeStr(id_card_image_url),
      safeStr(license_number), safeStr(license_type), safeDate(license_expiry), safeStr(license_image_url),
      safeStr(car_brand), safeStr(car_model), safeStr(car_year), safeStr(car_color), safeStr(car_plate), safeStr(car_type),
      safeStr(car_image_url), safeStr(car_insurance_url),
    ]
  );

  const driver = rows[0];

  // ── แจ้ง Admin ผ่าน LINE ──────────────────────────────────────────────────
  if (process.env.ADMIN_LINE_USER_ID) {
    try {
      const lineService = require('../services/lineService');
      const carTypeLabel = { sedan: '🚗 เก๋ง', van: '🚐 ตู้', wheelchair_van: '♿ วีลแชร์', ev_sedan: '⚡ EV' };
      const expDate = license_expiry ? new Date(license_expiry).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

      await lineService.client.pushMessage({
        to: process.env.ADMIN_LINE_USER_ID,
        messages: [{
          type: 'flex',
          altText: `🆕 คนขับสมัครใหม่: ${first_name} ${last_name}`,
          contents: {
            type: 'bubble', size: 'mega',
            header: {
              type: 'box', layout: 'vertical', backgroundColor: '#1D9E75', paddingAll: '16px',
              contents: [
                { type: 'text', text: '🆕 คนขับสมัครใหม่', color: '#ffffff', weight: 'bold', size: 'lg' },
                { type: 'text', text: 'กรุณาตรวจสอบข้อมูลและอนุมัติ', color: '#ffffffaa', size: 'xs' },
              ],
            },
            body: {
              type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
              contents: [
                { type: 'text', text: `👤 ${first_name} ${last_name}`, weight: 'bold', size: 'lg' },
                { type: 'separator', margin: 'sm' },
                info('🚗 รถ', `${car_brand} ${car_model} ${car_year} (${car_color})`),
                info('🔖 ทะเบียน', car_plate),
                info('📦 ประเภท', carTypeLabel[car_type] || car_type),
                info('📋 ใบขับขี่', `${license_type} — หมดอายุ ${expDate}`),
                info('🪪 บัตรประชาชน', id_card_number ? `****${id_card_number.slice(-4)}` : '—'),
              ],
            },
            footer: {
              type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
              contents: [
                {
                  type: 'button', style: 'primary', color: '#1D9E75', flex: 1,
                  action: { type: 'postback', label: '✅ อนุมัติ', data: `action=approve_driver&driver_id=${driver.id}` },
                },
                {
                  type: 'button', style: 'primary', color: '#EF4444', flex: 1,
                  action: { type: 'postback', label: '❌ ปฏิเสธ', data: `action=reject_driver&driver_id=${driver.id}` },
                },
              ],
            },
          },
        }],
      });
    } catch (err) {
      console.error('[notifyAdmin driver]', err.message);
    }
  }

  res.status(201).json({ driver, message: 'ส่งข้อมูลสำเร็จ รอการตรวจสอบ 1-2 วันทำการ' });
});

// ── GET /drivers/me  — ข้อมูลคนขับตัวเอง ─────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.display_name, u.line_user_id
     FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.user_id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูลคนขับ' });
  res.json(rows[0]);
});

// ── PUT /drivers/me/availability  — ตั้งเวลาที่สะดวกรับงาน ──────────────────
router.put('/me/availability', authenticate, async (req, res) => {
  const { availability } = req.body;
  // availability = [{ day_of_week, start_time, end_time, max_trips }]

  const driverRes = await query(`SELECT id FROM drivers WHERE user_id = $1`, [req.user.id]);
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });
  const driverId = driverRes.rows[0].id;

  // ลบของเก่า
  await query(`DELETE FROM driver_availability WHERE driver_id = $1`, [driverId]);

  // เพิ่มของใหม่
  for (const slot of availability) {
    await query(
      `INSERT INTO driver_availability (id, driver_id, day_of_week, start_time, end_time, max_trips)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), driverId, slot.day_of_week, slot.start_time, slot.end_time, slot.max_trips || 5]
    );
  }

  res.json({ message: 'บันทึกตารางเวลาแล้ว', slots: availability.length });
});

// ── GET /drivers/me/availability ─────────────────────────────────────────────
router.get('/me/availability', authenticate, async (req, res) => {
  const driverRes = await query(`SELECT id FROM drivers WHERE user_id = $1`, [req.user.id]);
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });

  const { rows } = await query(
    `SELECT * FROM driver_availability WHERE driver_id = $1 AND is_active = true ORDER BY day_of_week, start_time`,
    [driverRes.rows[0].id]
  );
  res.json(rows);
});

// ── GET /drivers/me/jobs  — งานของคนขับ ──────────────────────────────────────
router.get('/me/jobs', authenticate, async (req, res) => {
  const driverRes = await query(`SELECT id FROM drivers WHERE user_id = $1`, [req.user.id]);
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });

  const { status = 'upcoming' } = req.query;
  let statusFilter;
  if (status === 'upcoming') statusFilter = `b.status IN ('confirmed') AND b.scheduled_at > NOW()`;
  else if (status === 'active') statusFilter = `b.status IN ('driver_arrived','in_progress')`;
  else statusFilter = `b.status = 'completed'`;

  const { rows } = await query(
    `SELECT b.*, u.display_name as customer_name
     FROM bookings b
     JOIN users u ON u.id = b.customer_id
     WHERE b.driver_id = $1 AND ${statusFilter}
     ORDER BY b.scheduled_at DESC LIMIT 20`,
    [driverRes.rows[0].id]
  );
  res.json(rows);
});

// ── GET /drivers/me/earnings ──────────────────────────────────────────────────
router.get('/me/earnings', authenticate, async (req, res) => {
  const driverRes = await query(`SELECT id, camera_fund, has_camera FROM drivers WHERE user_id = $1`, [req.user.id]);
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });
  const driverId = driverRes.rows[0].id;

  const { period = '30' } = req.query;
  const days = parseInt(period);

  // Summary
  const { rows: [summary] } = await query(
    `SELECT
       COUNT(*)::int as trips,
       SUM(gross_amount) as gross, SUM(platform_fee) as fee,
       SUM(tip_amount) as tips, SUM(camera_fund) as cam_fund,
       SUM(net_amount) as net
     FROM driver_earnings
     WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'`,
    [driverId]
  );

  // Per-trip breakdown (ล่าสุด 20 รายการ)
  const { rows: trips } = await query(
    `SELECT de.*, b.pickup_address, b.dropoff_address, b.scheduled_at,
            b.booking_number, b.passenger_name
     FROM driver_earnings de
     JOIN bookings b ON b.id = de.booking_id
     WHERE de.driver_id = $1 AND de.created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY de.created_at DESC LIMIT 20`,
    [driverId]
  );

  // Daily breakdown
  const { rows: daily } = await query(
    `SELECT DATE(created_at AT TIME ZONE 'Asia/Bangkok') as date,
            COUNT(*)::int as trips,
            SUM(net_amount) as net
     FROM driver_earnings
     WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
     GROUP BY 1 ORDER BY 1 DESC`,
    [driverId]
  );

  // Payout history
  const { rows: payouts } = await query(
    `SELECT * FROM driver_payouts WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [driverId]
  );

  // Pending payout amount (earned but not yet paid)
  const { rows: [pending] } = await query(
    `SELECT COALESCE(SUM(de.net_amount),0) as earned,
            COALESCE((SELECT SUM(amount) FROM driver_payouts WHERE driver_id=$1 AND status='paid'),0) as paid_out
     FROM driver_earnings de WHERE de.driver_id = $1`,
    [driverId]
  );

  res.json({
    summary,
    trips,
    daily,
    payouts,
    pending_payout: Math.max(0, parseFloat(pending.earned) - parseFloat(pending.paid_out)),
    camera_fund_total: driverRes.rows[0].camera_fund,
    has_camera: driverRes.rows[0].has_camera,
    camera_threshold: 4000,
  });
});

// ── POST /drivers/me/request-payout  — คนขับขอรับเงิน ───────────────────────
router.post('/me/request-payout', authenticate, async (req, res) => {
  const { promptpay_id, period_start, period_end } = req.body;
  const driverRes = await query(
    `SELECT id, first_name, last_name FROM drivers WHERE user_id = $1`, [req.user.id]
  );
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });
  const driver = driverRes.rows[0];

  // คำนวณยอดค้างจ่าย
  const { rows: [pending] } = await query(
    `SELECT COALESCE(SUM(de.net_amount),0) as earned,
            COALESCE((SELECT SUM(amount) FROM driver_payouts WHERE driver_id=$1 AND status='paid'),0) as paid_out
     FROM driver_earnings de WHERE de.driver_id = $1`,
    [driver.id]
  );
  const amount = Math.max(0, parseFloat(pending.earned) - parseFloat(pending.paid_out));
  if (amount < 100) return res.status(400).json({ error: 'ยอดขั้นต่ำ ฿100' });

  // update promptpay_id ถ้าส่งมา
  if (promptpay_id) {
    await query(`UPDATE drivers SET promptpay_id=$1 WHERE id=$2`, [promptpay_id, driver.id]);
  }

  const { rows: [payout] } = await query(
    `INSERT INTO driver_payouts (driver_id, amount, promptpay_id, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [driver.id, amount, promptpay_id, period_start, period_end]
  );

  // แจ้ง Admin
  if (process.env.ADMIN_LINE_USER_ID) {
    const lineService = require('../services/lineService');
    await lineService.client.pushMessage({
      to: process.env.ADMIN_LINE_USER_ID,
      messages: [{
        type: 'flex',
        altText: `💸 คนขับขอรับเงิน ฿${amount.toLocaleString()}`,
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical', backgroundColor: '#7C3AED', paddingAll: '14px',
            contents: [{ type: 'text', text: '💸 คนขับขอรับเงิน', color: '#fff', weight: 'bold', size: 'lg' }],
          },
          body: {
            type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
            contents: [
              { type: 'text', text: `${driver.first_name} ${driver.last_name}`, weight: 'bold', size: 'lg' },
              info('💰 ยอด', `฿${Number(amount).toLocaleString()}`),
              info('📱 PromptPay', promptpay_id || '—'),
            ],
          },
          footer: {
            type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
            contents: [{
              type: 'button', style: 'primary', color: '#7C3AED',
              action: { type: 'postback', label: '✅ โอนแล้ว', data: `action=confirm_payout&payout_id=${payout.id}` },
            }],
          },
        },
      }],
    }).catch(e => console.error('[payout notify]', e.message));
  }

  res.json({ payout, amount });
});

// ── PATCH /drivers/me/online  — เปิด/ปิดรับงาน ───────────────────────────────
router.patch('/me/online', authenticate, async (req, res) => {
  const { is_online } = req.body;
  await query(
    `UPDATE drivers SET is_online = $1 WHERE user_id = $2`,
    [is_online, req.user.id]
  );
  res.json({ is_online });
});

// ── PATCH /drivers/me/notify-offline  — รับแจ้งงานแม้ปิดรับ ──────────────────
router.patch('/me/notify-offline', authenticate, async (req, res) => {
  const { notify_when_offline } = req.body;
  await query(
    `UPDATE drivers SET notify_when_offline = $1 WHERE user_id = $2`,
    [notify_when_offline, req.user.id]
  );
  res.json({ notify_when_offline });
});

// ─── Admin routes ──────────────────────────────────────────────────────────────

// ── GET /drivers  — Admin ดูรายชื่อคนขับทั้งหมด ──────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(
      `SELECT d.*, u.display_name, u.line_user_id
       FROM drivers d JOIN users u ON u.id = d.user_id
       WHERE d.status = $1
       ORDER BY d.created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error('[drivers/]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /drivers/:id/verify  — Admin อนุมัติ/ปฏิเสธ ────────────────────────
router.patch('/:id/verify', authenticate, requireAdmin, async (req, res) => {
  const { action, rejection_reason } = req.body;  // action: 'approve' | 'reject'

  const newStatus = action === 'approve' ? 'active' : 'suspended';
  const { rows } = await query(
    `UPDATE drivers SET status = $1, verified_at = $2, rejection_reason = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *, (SELECT line_user_id FROM users WHERE id = user_id) as line_user_id`,
    [newStatus, action === 'approve' ? new Date() : null, rejection_reason || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  // แจ้งคนขับ
  const msg = action === 'approve'
    ? '🎉 ยินดีด้วย! บัญชีคนขับของคุณได้รับการอนุมัติแล้ว\n\nคุณสามารถเริ่มรับงานได้เลยครับ กด "เปิดรับงาน" ที่เมนูด้านล่าง'
    : `❌ ขออภัย บัญชีของคุณยังไม่ผ่านการอนุมัติ\n\nเหตุผล: ${rejection_reason || 'ข้อมูลไม่ครบถ้วน'}\n\nกรุณาส่งข้อมูลมาใหม่ครับ`;

  const lineService = require('../services/lineService');
  await lineService.client.pushMessage({ to: rows[0].line_user_id, messages: [{ type: 'text', text: msg }] });

  res.json(rows[0]);
});

// ── POST /drivers/:id/payout  — Admin บันทึกการโอนเงิน ───────────────────────
router.post('/:id/payout', authenticate, requireAdmin, async (req, res) => {
  const { amount, note, promptpay_id } = req.body;
  const driverRes = await query(`SELECT * FROM drivers WHERE id = $1`, [req.params.id]);
  if (!driverRes.rows[0]) return res.status(404).json({ error: 'ไม่พบคนขับ' });

  const { rows: [payout] } = await query(
    `INSERT INTO driver_payouts (driver_id, amount, promptpay_id, status, note, paid_at, paid_by)
     VALUES ($1,$2,$3,'paid',$4,NOW(),$5) RETURNING *`,
    [req.params.id, amount, promptpay_id || driverRes.rows[0].promptpay_id, note, req.user.id]
  );

  // แจ้งคนขับ
  const userRes = await query(`SELECT u.line_user_id FROM users u JOIN drivers d ON d.user_id=u.id WHERE d.id=$1`, [req.params.id]);
  if (userRes.rows[0]?.line_user_id) {
    const lineService = require('../services/lineService');
    await lineService.client.pushMessage({
      to: userRes.rows[0].line_user_id,
      messages: [{ type: 'text', text: `💸 โอนเงินให้คุณแล้ว ฿${Number(amount).toLocaleString()}\n${note ? `หมายเหตุ: ${note}` : ''}` }],
    }).catch(() => {});
  }

  res.json({ payout });
});

// ── PATCH /drivers/:id/payout/confirm  — Admin ยืนยัน payout request ─────────
router.patch('/payouts/:payoutId/confirm', authenticate, requireAdmin, async (req, res) => {
  const { rows: [payout] } = await query(
    `UPDATE driver_payouts SET status='paid', paid_at=NOW(), paid_by=$2 WHERE id=$1 RETURNING *, driver_id`,
    [req.params.payoutId, req.user.id]
  );
  if (!payout) return res.status(404).json({ error: 'ไม่พบรายการ' });

  // แจ้งคนขับ
  const userRes = await query(
    `SELECT u.line_user_id FROM users u JOIN drivers d ON d.user_id=u.id WHERE d.id=$1`,
    [payout.driver_id]
  );
  if (userRes.rows[0]?.line_user_id) {
    const lineService = require('../services/lineService');
    await lineService.client.pushMessage({
      to: userRes.rows[0].line_user_id,
      messages: [{ type: 'text', text: `✅ โอนเงินให้คุณแล้ว ฿${Number(payout.amount).toLocaleString()}\nตรวจสอบบัญชีได้เลยค่ะ 💚` }],
    }).catch(() => {});
  }
  res.json({ payout });
});

// ── Helper ───────────