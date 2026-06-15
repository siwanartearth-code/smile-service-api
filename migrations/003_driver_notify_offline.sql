-- Migration 003: เพิ่ม notify_when_offline ให้ drivers table
-- รันใน Supabase Dashboard → SQL Editor

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS notify_when_offline BOOLEAN NOT NULL DEFAULT false;

-- Index เพื่อ query Phase 2 dispatch ได้เร็ว
CREATE INDEX IF NOT EXISTS idx_drivers_notify_offline
  ON drivers (status, is_online, notify_when_offline)
  WHERE status = 'active' AND is_online = false AND notify_when_offline = true;

-- Comment
COMMENT ON COLUMN drivers.notify_when_offline IS
  'true = ส่งงานให้แม้คนขับปิดรับ (หลัง 3 นาที phase 2 dispatch)';
