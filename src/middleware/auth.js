const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // ใช้ข้อมูลจาก JWT โดยตรง ไม่ดึง DB ทุก request (เร็วกว่า + ไม่ hang)
    req.user = {
      id:           payload.userId,
      role:         payload.role   || 'user',
      line_user_id: payload.lineUserId,
      driver_id:    payload.driverId,
    };
    next();
  } catch (err) {
    console.error('[auth]', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { authenticate, requireAdmin };
