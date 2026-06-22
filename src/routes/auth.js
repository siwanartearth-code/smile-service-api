const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const line = require('@line/bot-sdk');
const { query } = require('../config/database');

/**
 * POST /auth/line
 * LIFF ส่ง access_token มาแล้ว verify กับ LINE API เพื่อรับ JWT ของเรา
 */
router.post('/line', async (req, res) => {
  const { access_token, profile: clientProfile } = req.body;
  if (!access_token && !clientProfile) return res.status(400).json({ error: 'access_token required' });

  let profile = clientProfile; // ใช้ profile จาก LIFF client ก่อน (เร็วกว่า ไม่หมดอายุ)

  if (!profile?.userId) {
    // fallback: ดึงจาก LINE API
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) return res.status(401).json({ error: 'Cannot fetch LINE profile' });
    profile = await profileRes.json();
  }

  // Upsert user ใน DB
  const { rows } = await query(
    `INSERT INTO users (line_user_id, display_name, picture_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (line_user_id) DO UPDATE
     SET display_name = $2, picture_url = $3, updated_at = NOW()
     RETURNING *`,
    [profile.userId, profile.displayName, profile.pictureUrl]
  );
  const user = rows[0];

  // ออก JWT
  const token = jwt.sign(
    { userId: user.id, lineUserId: user.line_user_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({ token, user });
});

/**
 * POST /auth/admin
 * Admin login ด้วย password (สำหรับ Web Dashboard)
 */
router.post('/admin', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  if (password !== adminPassword) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

  // หา user ที่เป็น admin
  const { rows } = await query(`SELECT * FROM users WHERE role = 'admin' LIMIT 1`);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบบัญชี admin' });

  const token = jwt.sign(
    { userId: rows[0].id, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: rows[0] });
});

/**
 * POST /auth/driver-web
 * คนขับ login ผ่าน Web Portal ด้วยเบอร์โทร
 */
router.post('/driver-web', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  // หา user ที่มีเบอร์นี้และเป็น driver ที่ approved
  const { rows } = await query(
    `SELECT u.*, d.id as driver_id, d.first_name, d.last_name, d.car_type, d.car_plate,
            d.is_online, d.average_rating, d.total_trips
     FROM users u
     JOIN drivers d ON d.user_id = u.id
     WHERE u.phone = $1 AND d.status = 'active'
     LIMIT 1`,
    [phone]
  );
  if (!rows[0]) return res.status(401).json({ error: 'ไม่พบบัญชีคนขับ กรุณาตรวจสอบเบอร์โทร' });

  const token = jwt.sign(
    { userId: rows[0].id, role: 'driver' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: rows[0] });
});

module.exports = router;
