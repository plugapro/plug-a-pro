-- RestoreColumns: customers.marketingOptIn + customers.serviceOptIn
-- These columns existed in production but were lost from schema.prisma during a
-- DB restore. They are actively used in customer merge logic in customer-lifecycle.ts.
-- IF NOT EXISTS guards make this safe to run even if the columns already exist.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "serviceOptIn" BOOLEAN NOT NULL DEFAULT true;
