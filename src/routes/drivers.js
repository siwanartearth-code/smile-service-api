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

  // อัปเดต role เป็น driver
  await query(`UPDATE users SET role = 'driver', phone = $1 WHERE id = $2`, [req.body.phone, req.user.id]);

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
      uuidv4(), req.user.id, first_name, last_name, id_card_number, id_card_image_url,
      license_number, license_type, license_expiry, license_image_url,
      car_brand, car_model, car_year, car_color, car_plate, car_type,
      car_image_url, car_insurance_url,
    ]
  );

  res.status(201).json({ driver: rows[0], message: 'ส่งข้อมูลสำเร็จ รอการตรวจสอบ 1-2 วันทำการ' });
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

  const { period = '30' } = req.query;
  const { rows } = await query(
    `SELECT
       COUNT(*)::int as trips,
       SUM(gross_amount) as gross, SUM(platform_fee) as fee,
       SUM(tip_amount) as tips, SUM(camera_fund) as cam_fund,
       SUM(net_amount) as net
     FROM driver_earnings
     WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '${parseInt(period)} days'`,
    [driverRes.rows[0].id]
  );
  res.json({
    ...rows[0],
    camera_fund_total: driverRes.rows[0].camera_fund,
    has_camera: driverRes.rows[0].has_camera,
    camera_threshold: 4000,
  });
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
  const { rows } = await query(
    `SELECT d.*, u.display_name, u.line_user_id
     FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.status = $1
     ORDER BY d.created_at DESC`,
    [status]
  );
  res.json(rows);
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

module.exports = router;
