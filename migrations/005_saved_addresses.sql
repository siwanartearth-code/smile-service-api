-- Migration 005: ที่อยู่ที่บันทึก (saved addresses)
-- รันใน Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS saved_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'บ้าน',   -- ชื่อที่อยู่ เช่น บ้าน / โรงพยาบาล / แม่
  house_no     TEXT,
  moo          TEXT,
  soi          TEXT,
  road         TEXT,
  detail       TEXT,
  province     TEXT,
  district     TEXT,
  subdistrict  TEXT,
  lat          DECIMAL(10,7),
  lng          DECIMAL(11,7),
  is_default   BOOLEAN NOT NULL DEFAULT false,
  use_count    INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Max 3 addresses per user (enforced in API)
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_addresses_user_label
  ON saved_addresses (user_id, label);

CREATE INDEX IF NOT EXISTS idx_saved_addresses_user
  ON saved_addresses (user_id, use_count DESC);

-- Auto-update updated_at
CREATE TRIGGER trg_saved_addresses_updated
  BEFORE UPDATE ON saved_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
