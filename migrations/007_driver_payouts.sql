-- Migration 007: ระบบจ่ายเงินให้คนขับ

CREATE TABLE IF NOT EXISTS driver_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount          DECIMAL(10,2) NOT NULL,
  promptpay_id    TEXT,                    -- เบอร์ / เลขบัตร PromptPay ของคนขับ
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','cancelled')),
  note            TEXT,
  paid_at         TIMESTAMPTZ,
  paid_by         TEXT,                    -- admin LINE userId
  period_start    DATE,
  period_end      DATE,
  trips_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_driver  ON driver_payouts (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON driver_payouts (status) WHERE status = 'pending';

-- เพิ่ม promptpay_id ในตาราง drivers (เบอร์รับเงิน)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS promptpay_id      TEXT,
  ADD COLUMN IF NOT EXISTS bank_name         TEXT,
  ADD COLUMN IF NOT EXISTS bank_account      TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;

-- Auto-update updated_at
CREATE TRIGGER trg_payouts_updated
  BEFORE UPDATE ON driver_payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
