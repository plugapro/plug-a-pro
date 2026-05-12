-- Pay@ gateway support for provider credit top-ups.
-- PaymentIntent remains the single payment intent table. Pay@ webhook
-- references use payment_intents.id, while paymentReference stays the internal
-- unique reconciliation label.

ALTER TYPE "PaymentIntentMethod" ADD VALUE IF NOT EXISTS 'PAYAT';

CREATE INDEX IF NOT EXISTS "payment_intents_payat_status_idx"
  ON "payment_intents" ("status", "createdAt")
  WHERE "paymentMethod" = 'PAYAT';
