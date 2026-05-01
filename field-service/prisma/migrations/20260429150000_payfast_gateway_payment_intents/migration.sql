-- ─── Payfast gateway payment intent support ───────────────────────────────────
-- Extends PaymentIntent to carry Payfast ITN data received after a gateway
-- checkout. No existing columns are modified. Adds three Payfast-specific
-- payment method enum values and one status enum value.

-- New PaymentIntentMethod values for Payfast checkout options.
ALTER TYPE "PaymentIntentMethod" ADD VALUE IF NOT EXISTS 'PAYFAST_CARD';
ALTER TYPE "PaymentIntentMethod" ADD VALUE IF NOT EXISTS 'PAYFAST_EFT';
ALTER TYPE "PaymentIntentMethod" ADD VALUE IF NOT EXISTS 'PAYFAST_SCODE';

-- ITN_RECEIVED: intent has received a verified Payfast notification but has
-- not yet been credited (crediting transaction in-flight or pending retry).
ALTER TYPE "PaymentIntentStatus" ADD VALUE IF NOT EXISTS 'ITN_RECEIVED';

-- CANCELLED: provider cancelled on the Payfast checkout page.
ALTER TYPE "PaymentIntentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ITN data columns on payment_intents.
ALTER TABLE "payment_intents"
  ADD COLUMN IF NOT EXISTS "itnReceivedAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "itnPaymentStatus"   TEXT,
  ADD COLUMN IF NOT EXISTS "itnAmountCents"     INTEGER,
  ADD COLUMN IF NOT EXISTS "creditedLedgerEntryId" TEXT;

-- Index: fast lookup of Payfast gateway intents by status for admin tooling.
CREATE INDEX IF NOT EXISTS "payment_intents_payfast_status_idx"
  ON "payment_intents" ("paymentMethod", "status")
  WHERE "paymentMethod" IN ('PAYFAST_CARD', 'PAYFAST_EFT', 'PAYFAST_SCODE');
