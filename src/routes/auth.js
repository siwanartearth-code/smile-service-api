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
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token required' });

  // Verify กับ LINE
  const verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${access_token}`);
  if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid LINE token' });

  // ดึง LINE profile
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) return res.status(401).json({ error: 'Cannot fetch LINE profile' });

  const profile = await profileRes.json();

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

module.exports = router;
