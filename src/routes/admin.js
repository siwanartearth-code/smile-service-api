const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── GET /admin/stats  — สถิติ Dashboard ──────────────────────────────────────
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  const [bookings, drivers, revenue, pending] = await Promise.all([
    query(`SELECT COUNT(*) FROM bookings`),
    query(`SELECT COUNT(*) FROM drivers WHERE status = 'active'`),
    query(`SELECT COALESCE(SUM(final_price),0) AS total FROM bookings WHERE status = 'completed'`),
    query(`SELECT COUNT(*) FROM bookings WHERE status IN ('searching','confirmed','driver_arrived','in_progress')`),
  ]);
  res.json({
    total_bookings:   parseInt(bookings.rows[0].count),
    active_drivers:   parseInt(drivers.rows[0].count),
    total_revenue:    parseFloat(revenue.rows[0].total),
    pending_bookings: parseInt(pending.rows[0].count),
  });
});

// ── GET /admin/payouts  — รายการขอรับเงินทั้งหมด ─────────────────────────────
router.get('/payouts', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT pr.*, d.first_name || ' ' || d.last_name AS driver_name, d.car_plate
       FROM payout_requests pr
       JOIN drivers d ON d.id = pr.driver_id
       ORDER BY pr.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/payouts]', err.message);
    res.json([]);
  }
});

module.exports = router;
