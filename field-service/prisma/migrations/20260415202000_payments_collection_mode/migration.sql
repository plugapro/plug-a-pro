-- Add missing collectionMode enum and column to payments table.
-- Column exists in schema but was never migrated to production.

CREATE TYPE "PaymentCollectionMode" AS ENUM ('OFFLINE_RECORDED', 'PLATFORM_CHECKOUT');

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "collectionMode" "PaymentCollectionMode" NOT NULL DEFAULT 'OFFLINE_RECORDED';
