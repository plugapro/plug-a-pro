-- Pay@ gateway support for provider credit top-ups.
-- PaymentIntent remains the single payment intent table. Pay@ webhook
-- references use payment_intents.id, while paymentReference stays the internal
-- unique reconciliation label.

ALTER TYPE "PaymentIntentMethod" ADD VALUE IF NOT EXISTS 'PAYAT';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_intents'
      AND column_name = 'paymentMethod'
  ) THEN
    CREATE INDEX IF NOT EXISTS "payment_intents_payat_status_idx"
      ON "payment_intents" ("status", "createdAt")
      WHERE "paymentMethod" = 'PAYAT';
  END IF;
END $$;
