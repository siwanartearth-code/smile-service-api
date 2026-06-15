const { query } = require('../config/database');
const lineService = require('./lineService');

const PHASE2_DELAY_MS = 3 * 60 * 1000; // 3 นาที รอก่อนยิง offline drivers

/**
 * Phase 1: หาคนขับที่ "สะดวกรับ" (online + ตรงตาราง)
 * Phase 2: หลัง 3 นาที ถ้ายังไม่มีคนรับ → ยิง offline drivers ที่เปิด notify_when_offline
 */
async function findAndNotifyDrivers(booking) {
  const phase1 = await notifyAvailableDrivers(booking);

  // Schedule Phase 2 — ยิงคนที่ปิดรับงานแต่เปิด notify_when_offline
  setTimeout(async () => {
    try {
      const { rows } = await query(
        `SELECT status FROM bookings WHERE id = $1`,
        [booking.id]
      );
      if (rows[0]?.status === 'searching') {
        console.log(`[Dispatch] Phase 2: booking ${booking.id} still searching, notifying offline drivers`);
        await notifyOfflineDrivers(booking);
      }
    } catch (err) {
      console.error('[Dispatch] Phase 2 error:', err.message);
    }
  }, PHASE2_DELAY_MS);

  return phase1;
}

/**
 * Phase 1 — ยิงคนขับที่ online + ตรงตาราง
 */
async function notifyAvailableDrivers(booking) {
  const scheduled  = new Date(booking.scheduled_at);
  const dayOfWeek  = scheduled.getDay();
  const timeStr    = scheduled.toTimeString().slice(0, 8);

  const res = await query(
    `SELECT d.*, u.line_user_id, u.display_name
     FROM drivers d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN driver_availability da ON da.driver_id = d.id
       AND da.day_of_week = $1
       AND da.start_time <= $2::time
       AND da.end_time   >= $2::time
       AND da.is_active  = true
     WHERE d.status = 'active'
       AND d.is_online = true
     ORDER BY
       CASE WHEN da.driver_id IS NOT NULL THEN 0 ELSE 1 END,  -- ตรงตารางก่อน
       CASE d.tier WHEN 'verified' THEN 1 WHEN 'trusted' THEN 2 ELSE 3 END,
       d.has_camera DESC,
       d.average_rating DESC
     LIMIT 5`,
    [dayOfWeek, timeStr]
  );

  const drivers = res.rows;
  if (drivers.length === 0) {
    console.log(`[Dispatch] Phase 1: no available drivers for booking ${booking.id}`);
    return { found: false, notified: 0, phase: 1 };
  }

  await Promise.allSettled(
    drivers.map(d =>
      lineService.sendNewJobToDriver(d.line_user_id, {
        ...booking,
        driver_earnings: lineService.estimateDriverEarningsPublic
          ? lineService.estimateDriverEarningsPublic(booking.estimated_distance, booking.car_type)
          : undefined,
      }).catch(err => console.error(`[Dispatch] Failed to notify driver ${d.id}:`, err.message))
    )
  );

  console.log(`[Dispatch] Phase 1: notified ${drivers.length} drivers for booking ${booking.id}`);
  return { found: true, notified: drivers.length, phase: 1 };
}

/**
 * Phase 2 — ยิง offline drivers ที่เปิด notify_when_offline
 */
async function notifyOfflineDrivers(booking) {
  const res = await query(
    `SELECT d.*, u.line_user_id, u.display_name
     FROM drivers d
     JOIN users u ON u.id = d.user_id
     WHERE d.status = 'active'
       AND d.is_online = false
       AND d.notify_when_offline = true
     ORDER BY
       CASE d.tier WHEN 'verified' THEN 1 WHEN 'trusted' THEN 2 ELSE 3 END,
       d.has_camera DESC,
       d.average_rating DESC
     LIMIT 10`,
    []
  );

  const drivers = res.rows;
  if (drivers.length === 0) {
    console.log(`[Dispatch] Phase 2: no offline+notify drivers for booking ${booking.id}`);
    return { found: false, notified: 0, phase: 2 };
  }

  await Promise.allSettled(
    drivers.map(d =>
      lineService.sendJobToOfflineDriver(d.line_user_id, booking)
        .catch(err => console.error(`[Dispatch] Phase 2 failed to notify driver ${d.id}:`, err.message))
    )
  );

  console.log(`[Dispatch] Phase 2: notified ${drivers.length} offline drivers for booking ${booking.id}`);
  return { found: true, notified: drivers.length, phase: 2 };
}

/**
 * คนขับรับงาน — transaction ป้องกัน race condition
 */
async function acceptBooking(bookingId, driverId) {
  await query('BEGIN');
  try {
    const res = await query(
      `UPDATE bookings SET driver_id = $1, status = 'confirmed', updated_at = NOW()
       WHERE id = $2 AND status IN ('searching', 'pending')
       RETURNING *`,
      [driverId, bookingId]
    );
    if (res.rows.length === 0) {
      await query('ROLLBACK');
      return { success: false, reason: 'งานนี้ถูกรับไปแล้วหรือถูกยกเลิก' };
    }
    await query('COMMIT');
    return { success: true, booking: res.rows[0] };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

module.exports = { findAndNotifyDrivers, notifyAvailableDrivers, notifyOfflineDrivers, acceptBooking };
