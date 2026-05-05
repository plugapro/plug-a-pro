-- Provider rates previously used legacy rateCents/unit fields. The current
-- Prisma model writes callOutFee/hourlyRate instead, so legacy-only columns
-- must not block provider application submit.

ALTER TABLE "provider_rates" ALTER COLUMN "rateCents" DROP NOT NULL;
ALTER TABLE "provider_rates" ALTER COLUMN "unit" SET DEFAULT 'hour';
