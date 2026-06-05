const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { calculatePrice } = require('../services/pricingService');
const { findAndNotifyDrivers } = require('../services/matchingService');
const lineService = require('../services/lineService');
const { v4: uuidv4 } = require('uuid');

// ── GET /bookings  — รายการจองของ user ──────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, d.first_name || ' ' || d.last_name AS driver_name, d.car_plate, d.car_brand, d.car_model
     FROM bookings b
     LEFT JOIN drivers d ON d.id = b.driver_id
     WHERE b.customer_id = $1
     ORDER BY b.created_at DESC
     LIMIT 20`,
    [req.user.id]
  );
  res.json(rows);
});

// ── GET /bookings/:id ─────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, d.first_name || ' ' || d.last_name AS driver_name, d.car_plate, d.car_brand, d.car_model, d.car_color, d.current_lat, d.current_lng
     FROM bookings b
     LEFT JOIN drivers d ON d.id = b.driver_id
     WHERE b.id = $1 AND (b.customer_id = $2 OR $3 = 'admin')`,
    [req.params.id, req.user.id, req.user.role]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// ── POST /bookings  — สร้างการจองใหม่ ────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const {
    passenger_name, passenger_phone, passenger_note,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    scheduled_at, car_type, booking_type,
    estimated_distance, estimated_duration,
    subscription_id,
  } = req.body;

  // คำนวณราคา
  const price = await calculatePrice(car_type, estimated_distance, estimated_duration);

  // สร้าง booking number (SYYYYMMDD-XXXX)
  const d = new Date();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const bookingNumber = `S${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${rand}`;

  const { rows } = await query(
    `INSERT INTO bookings (
       id, booking_number, customer_id, subscription_id,
       booking_type, passenger_name, passenger_phone, passenger_note,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       scheduled_at, car_type,
       estimated_distance, estimated_duration,
       base_price, final_price, driver_earnings, platform_fee,
       status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'searching'
     ) RETURNING *`,
    [
      uuidv4(), bookingNumber, req.user.id, subscription_id || null,
      booking_type || 'available', passenger_name, passenger_phone, passenger_note,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      scheduled_at, car_type,
      estimated_distance, estimated_duration,
      price.total, price.total, price.driverEarnings, price.platformFee,
    ]
  );

  const booking = rows[0];

  // หาคนขับและส่ง notification
  const matchResult = await findAndNotifyDrivers(booking);
  console.log(`Booking ${bookingNumber}: notified ${matchResult.notified} drivers`);

  res.status(201).json({ booking, price, driversNotified: matchResult.notified });
});

// ── PATCH /bookings/:id/status  — อัปเดตสถานะ (คนขับ) ─────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  const { status, lat, lng } = req.body;
  const validStatuses = ['driver_arrived', 'in_progress', 'completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const { rows } = await query(
    `UPDATE bookings SET status = $1, updated_at = NOW(),
       picked_up_at   = CASE WHEN $1 = 'in_progress' THEN NOW() ELSE picked_up_at END,
       dropped_off_at = CASE WHEN $1 = 'completed'   THEN NOW() ELSE dropped_off_at END
     WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  // อัปเดต GPS คนขับ
  if (lat && lng) {
    await query(`UPDATE drivers SET current_lat = $1, current_lng = $2 WHERE id = $3`, [lat, lng, rows[0].driver_id]);
  }

  // ส่ง checkpoint notification ถ้า completed → ส่ง receipt
  if (status === 'completed') {
    const custRes = await query(`SELECT u.line_user_id FROM users u WHERE u.id = $1`, [rows[0].customer_id]);
    if (custRes.rows[0]) await lineService.sendReceiptAndReview(custRes.rows[0].line_user_id, rows[0]);
  }

  res.json(rows[0]);
});

// ── POST /bookings/:id/review ─────────────────────────────────────────────────
router.post('/:id/review', authenticate, async (req, res) => {
  const { stars, tags, comment, tip_amount } = req.body;

  const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [req.params.id]);
  const booking = bookingRes.rows[0];
  if (!booking || booking.status !== 'completed') return res.status(400).json({ error: 'Booking not completed' });

  await query(
    `INSERT INTO reviews (booking_id, reviewer_id, driver_id, stars, tags, comment, tip_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (booking_id, reviewer_id) DO NOTHING`,
    [booking.id, req.user.id, booking.driver_id, stars, JSON.stringify(tags || []), comment, tip_amount || 0]
  );

  // อัปเดต average_rating ของคนขับ
  await query(
    `UPDATE drivers SET average_rating = (
       SELECT ROUND(AVG(stars)::numeric, 2) FROM reviews WHERE driver_id = $1
     ) WHERE id = $1`,
    [booking.driver_id]
  );

  // บันทึก tip เข้า driver_earnings
  if (tip_amount > 0) {
    await query(
      `UPDATE driver_earnings SET tip_amount = tip_amount + $1, net_amount = net_amount + $1 WHERE booking_id = $2`,
      [tip_amount, booking.id]
    );
  }

  res.status(201).json({ message: 'ขอบคุณสำหรับรีวิวครับ! ⭐' });
});

// ── GET /bookings/price-estimate ─────────────────────────────────────────────
router.post('/price-estimate', async (req, res) => {
  const { car_type, distance_km, duration_min } = req.body;
  const price = await calculatePrice(car_type, distance_km, duration_min);
  res.json(price);
});

module.exports = router;
