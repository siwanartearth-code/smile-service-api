const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const MAX_ADDRESSES = 3;

// ── GET /addresses  — รายการที่อยู่ที่บันทึก ────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM saved_addresses WHERE user_id = $1 ORDER BY is_default DESC, use_count DESC, created_at ASC`,
    [req.user.id]
  );
  res.json(rows);
});

// ── POST /addresses  — บันทึกที่อยู่ใหม่ ─────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  // ตรวจจำนวนสูงสุด
  const countRes = await query(
    `SELECT COUNT(*) FROM saved_addresses WHERE user_id = $1`,
    [req.user.id]
  );
  if (parseInt(countRes.rows[0].count) >= MAX_ADDRESSES) {
    return res.status(400).json({ error: `บันทึกได้สูงสุด ${MAX_ADDRESSES} ที่อยู่` });
  }

  const {
    label = 'บ้าน',
    house_no, moo, soi, road, detail,
    province, district, subdistrict,
    lat, lng,
    is_default = false,
  } = req.body;

  // ถ้า set เป็น default → เคลียร์ default เดิมก่อน
  if (is_default) {
    await query(`UPDATE saved_addresses SET is_default = false WHERE user_id = $1`, [req.user.id]);
  }

  // ถ้าเป็นที่อยู่แรก → set เป็น default อัตโนมัติ
  const isFirst = parseInt(countRes.rows[0].count) === 0;

  const { rows } = await query(
    `INSERT INTO saved_addresses
       (user_id, label, house_no, moo, soi, road, detail, province, district, subdistrict, lat, lng, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (user_id, label) DO UPDATE SET
       house_no=$3, moo=$4, soi=$5, road=$6, detail=$7,
       province=$8, district=$9, subdistrict=$10, lat=$11, lng=$12,
       is_default=$13, updated_at=NOW()
     RETURNING *`,
    [req.user.id, label, house_no, moo, soi, road, detail,
     province, district, subdistrict, lat, lng, is_default || isFirst]
  );
  res.status(201).json(rows[0]);
});

// ── PUT /addresses/:id  — แก้ไขที่อยู่ ───────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  const {
    label, house_no, moo, soi, road, detail,
    province, district, subdistrict, lat, lng, is_default,
  } = req.body;

  // ถ้า set เป็น default → เคลียร์เดิม
  if (is_default) {
    await query(`UPDATE saved_addresses SET is_default = false WHERE user_id = $1`, [req.user.id]);
  }

  const { rows } = await query(
    `UPDATE saved_addresses SET
       label=$1, house_no=$2, moo=$3, soi=$4, road=$5, detail=$6,
       province=$7, district=$8, subdistrict=$9, lat=$10, lng=$11,
       is_default=COALESCE($12, is_default), updated_at=NOW()
     WHERE id=$13 AND user_id=$14
     RETURNING *`,
    [label, house_no, moo, soi, road, detail,
     province, district, subdistrict, lat, lng, is_default,
     req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบที่อยู่' });
  res.json(rows[0]);
});

// ── DELETE /addresses/:id ─────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const { rows } = await query(
    `DELETE FROM saved_addresses WHERE id=$1 AND user_id=$2 RETURNING id, is_default`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบที่อยู่' });

  // ถ้าลบ default → ตั้งที่อยู่แรกเป็น default แทน
  if (rows[0].is_default) {
    await query(
      `UPDATE saved_addresses SET is_default = true WHERE user_id=$1 ORDER BY use_count DESC, created_at ASC LIMIT 1`,
      [req.user.id]
    );
  }
  res.json({ deleted: rows[0].id });
});

// ── PATCH /addresses/:id/use  — นับการใช้งาน (เรียกเมื่อเลือกที่อยู่นี้ตอนจอง) ──
router.patch('/:id/use', authenticate, async (req, res) => {
  await query(
    `UPDATE saved_addresses SET use_count = use_count + 1, last_used_at = NOW() WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
