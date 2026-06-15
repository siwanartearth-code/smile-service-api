const express  = require('express');
const router   = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const paymentService   = require('../services/paymentService');
const matchingService  = require('../services/matchingService');

// ── POST /payments/initiate  — สร้าง payment + คืน QR ─────────────────────
router.post('/initiate', authenticate, async (req, res) => {
  try {
    const { booking_id, amount } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    // ตรวจ booking เป็นของ user นี้
    const { rows } = await query(
      `SELECT b.* FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE b.id = $1 AND u.id = $2`,
      [booking_id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบการจอง' });

    const booking = rows[0];
    // ใช้ amount ที่ส่งมา หรือ estimated_total เดิม
    const payAmount = parseFloat(amount) || parseFloat(booking.estimated_total) || 0;
    if (payAmount <= 0) return res.status(400).json({ error: 'ระบุยอดชำระไม่ได้' });

    const payment  = await paymentService.createPayment(booking_id, payAmount);
    const qr       = await paymentService.generatePromptPayQR(payAmount);

    res.json({
      payment,
      qr,
      amount:         payAmount,
      booking_number: booking.booking_number,
    });
  } catch (err) {
    console.error('[POST /payments/initiate]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /payments/booking/:bookingId  — ดู status ─────────────────────────
router.get('/booking/:bookingId', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.* FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users    u ON u.id = b.user_id
       WHERE p.booking_id = $1 AND u.id = $2`,
      [req.params.bookingId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูลการชำระเงิน' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /payments/:id/approve  — Admin อนุมัติ manual ────────────────────
router.post('/:id/approve', authenticate, async (req, res) => {
  try {
    // TODO: เพิ่ม is_admin check เมื่อมี role ใน users
    const result = await paymentService.approvePayment(
      req.params.id,
      `admin:${req.user.id}`
    );
    if (!result) return res.status(404).json({ error: 'ไม่พบ payment' });

    // dispatch driver
    const { rows: [booking] } = await query(
      `SELECT * FROM bookings WHERE id = $1`, [result.bookingId]
    );
    if (booking) await matchingService.findAndNotifyDrivers(booking);

    res.json({ ok: true, payment: result.payment });
  } catch (err) {
    console.error('[POST /payments/approve]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /payments/:id/reject  — Admin ปฏิเสธ ─────────────────────────────
router.post('/:id/reject', authenticate, async (req, res) => {
  try {
    const { note } = req.body;
    const payment = await paymentService.rejectPayment(
      req.params.id,
      `admin:${req.user.id}`,
      note
    );
    if (!payment) return res.status(404).json({ error: 'ไม่พบ payment' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
