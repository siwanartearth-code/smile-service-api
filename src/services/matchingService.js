const { query } = require('../config/database');
const lineService = require('./lineService');

/**
 * หาคนขับที่พร้อมรับงาน แล้วส่ง notification
 * Priority: Verified → Trusted → New, และ has_camera ขึ้นก่อน
 */
async function findAndNotifyDrivers(booking) {
  const scheduled = new Date(booking.scheduled_at);
  const dayOfWeek = scheduled.getDay();
  const timeStr   = scheduled.toTimeString().slice(0, 8); // HH:MM:SS

  const res = await query(
    `SELECT d.*, u.line_user_id, u.display_name
     FROM drivers d
     JOIN users u ON u.id = d.user_id
     JOIN driver_availability da ON da.driver_id = d.id
     WHERE d.status = 'active'
       AND d.is_online = true
       AND da.day_of_week = $1
       AND da.start_time <= $2::time
       AND da.end_time   >= $2::time
       AND da.is_active  = true
     ORDER BY
       CASE d.tier WHEN 'verified' THEN 1 WHEN 'trusted' THEN 2 ELSE 3 END,
       d.has_camera DESC,
       d.average_rating DESC
     LIMIT 5`,
    [dayOfWeek, timeStr]
  );

  const drivers = res.rows;
  if (drivers.length === 0) return { found: false, notified: 0 };

  // ส่ง notification ให้คนขับทุกคนพร้อมกัน (first accept wins)
  const notifications = drivers.map(driver =>
    lineService.sendNewJobToDriver(driver.line_user_id, {
      ...booking,
      driver_name: driver.display_name,
    }).catch(err => console.error(`Failed to notify driver ${driver.id}:`, err))
  );
  await Promise.allSettled(notifications);

  return { found: true, notified: drivers.length, driverIds: drivers.map(d => d.id) };
}

/**
 * คนขับรับงาน — ยืนยัน booking กับ driver_id
 */
async function acceptBooking(bookingId, driverId) {
  // ใช้ transaction ป้องกันการ race condition
  await query('BEGIN');
  try {
    const res = await query(
      `UPDATE bookings SET driver_id = $1, status = 'confirmed', updated_at = NOW()
       WHERE id = $2 AND status = 'searching'
       RETURNING *`,
      [driverId, bookingId]
    );
    if (res.rows.length === 0) {
      await query('ROLLBACK');
      return { success: false, reason: 'งานนี้ถูกรับไปแล้ว' };
    }
    await query('COMMIT');
    return { success: true, booking: res.rows[0] };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

module.exports = { findAndNotifyDrivers, acceptBooking };
