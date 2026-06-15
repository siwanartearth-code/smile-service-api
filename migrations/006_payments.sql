-- Migration 006: ระบบชำระเงิน PromptPay
-- รันใน Supabase Dashboard → SQL Editor

-- เพิ่ม estimated_total และ payment_status ใน bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS estimated_total   DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS payment_status    TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (payment_status IN ('pending_payment','paid','failed','not_required'));

-- ตาราง payments
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount          DECIMAL(10,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','manual_review')),
  slip_image_url  TEXT,
  easyslip_ref    TEXT,
  easyslip_data   JSONB,
  verified_at     TIMESTAMPTZ,
  verified_by     TEXT,       -- 'auto' | 'admin:<userId>'
  admin_note      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payments_booking UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_status   ON payments (status) WHERE status IN ('pending','manual_review');
CREATE INDEX IF NOT EXISTS idx_bookings_pay_stat ON bookings (payment_status) WHERE payment_status = 'pending_payment';

-- Auto-update updated_at
CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
