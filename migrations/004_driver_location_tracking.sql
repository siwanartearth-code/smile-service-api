-- Migration 004: เพิ่ม real-time location tracking columns
-- รันใน Supabase Dashboard → SQL Editor

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Index สำหรับ query location ได้เร็ว
CREATE INDEX IF NOT EXISTS idx_drivers_location
  ON drivers (id, current_lat, current_lng, location_updated_at)
  WHERE current_lat IS NOT NULL;

COMMENT ON COLUMN drivers.current_lat IS 'พิกัดล่าสุดของคนขับ (real-time)';
COMMENT ON COLUMN drivers.current_lng IS 'พิกัดล่าสุดของคนขับ (real-time)';
COMMENT ON COLUMN drivers.location_updated_at IS 'เวลาที่ได้รับพิกัดล่าสุด';
