const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { calculatePrice, getPackages, updateFuelAdjustRate } = require('../services/pricingService');

// ── GET /pricing  — ราคาปัจจุบันทุกประเภทรถ ─────────────────────────────────
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM pricing_config WHERE is_active = true ORDER BY base_fare`
  );
  res.json(rows);
});

// ── GET /pricing/packages  — แพ็กเกจ Fix Cost ────────────────────────────────
router.get('/packages', async (req, res) => {
  const packages = await getPackages();
  res.json(packages);
});

// ── POST /pricing/estimate  — คำนวณราคาก่อนจอง ───────────────────────────────
router.post('/estimate', async (req, res) => {
  const { car_type, distance_km, duration_min } = req.body;
  if (!car_type || !distance_km) return res.status(400).json({ error: 'Missing car_type or distance_km' });
  try {
    const price = await calculatePrice(
      car_type,
      parseFloat(distance_km),
      parseFloat(duration_min || 30)
    );
    res.json(price);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /pricing/fuel-adjust  — Admin ปรับราคาน้ำมัน/ไฟฟ้า ────────────────
router.patch('/fuel-adjust', authenticate, requireAdmin, async (req, res) => {
  const { car_type, adjust_rate, note } = req.body;
  // adjust_rate: เช่น 1.05 = แพงขึ้น 5%, 0.95 = ถูกลง 5%
  await updateFuelAdjustRate(car_type, adjust_rate, note);
  res.json({ message: `ปรับราคา ${car_type} เป็น ×${adjust_rate} แล้ว` });
});

module.exports = router;
