-- Repair provider onboarding enrichment tables after production schema drift.
-- Root cause: production still had an older provider_categories/provider_rates
-- shape while Prisma and the WhatsApp submit flow write the qualified-shortlist
-- schema. Provider application submit failed at providerCategory.createMany with
-- Prisma P2022 because provider_categories.id did not exist.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- provider_categories: move from old composite primary key shape to current
-- Prisma shape with an id primary key plus provider/category uniqueness.
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "id" TEXT;
UPDATE "provider_categories"
SET "id" = gen_random_uuid()::text
WHERE "id" IS NULL;
ALTER TABLE "provider_categories" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "subServices" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "yearsExperience" DOUBLE PRECISION;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "skillLevel" TEXT;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT DEFAULT 'PENDING_REVIEW';
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "certificationRequired" BOOLEAN DEFAULT false;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "certificationStatus" TEXT;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_categories" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "provider_categories"
SET
  "subServices" = COALESCE("subServices", ARRAY[]::TEXT[]),
  "approvalStatus" = COALESCE("approvalStatus", 'PENDING_REVIEW'),
  "certificationRequired" = COALESCE("certificationRequired", false),
  "createdAt" = COALESCE("createdAt", COALESCE("addedAt", CURRENT_TIMESTAMP)),
  "updatedAt" = COALESCE("updatedAt", COALESCE("addedAt", CURRENT_TIMESTAMP));

ALTER TABLE "provider_categories" ALTER COLUMN "subServices" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "provider_categories" ALTER COLUMN "subServices" SET NOT NULL;
ALTER TABLE "provider_categories" ALTER COLUMN "approvalStatus" SET DEFAULT 'PENDING_REVIEW';
ALTER TABLE "provider_categories" ALTER COLUMN "approvalStatus" SET NOT NULL;
ALTER TABLE "provider_categories" ALTER COLUMN "certificationRequired" SET DEFAULT false;
ALTER TABLE "provider_categories" ALTER COLUMN "certificationRequired" SET NOT NULL;
ALTER TABLE "provider_categories" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_categories" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "provider_categories" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_categories" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "provider_categories" DROP CONSTRAINT IF EXISTS "provider_categories_pkey";
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_categories_providerId_categorySlug_key"
  ON "provider_categories"("providerId", "categorySlug");
CREATE INDEX IF NOT EXISTS "provider_categories_categorySlug_approvalStatus_idx"
  ON "provider_categories"("categorySlug", "approvalStatus");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_categories_categoryId_fkey'
  ) THEN
    ALTER TABLE "provider_categories"
      ADD CONSTRAINT "provider_categories_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- provider_rates: support the current call-out/hourly-rate schema while
-- preserving old rateCents/unit data for compatibility and backfilling callOutFee.
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "callOutFee" DECIMAL(10,2);
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(10,2);
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "dayRate" DECIMAL(10,2);
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "rateNegotiable" BOOLEAN DEFAULT true;
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "quoteAfterInspection" BOOLEAN DEFAULT false;
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "emergencySurcharge" DECIMAL(10,2);
ALTER TABLE "provider_rates" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "provider_rates"
SET
  "callOutFee" = COALESCE("callOutFee", CASE WHEN "rateCents" IS NOT NULL THEN ("rateCents"::DECIMAL / 100) ELSE NULL END),
  "rateNegotiable" = COALESCE("rateNegotiable", true),
  "quoteAfterInspection" = COALESCE("quoteAfterInspection", false),
  "createdAt" = COALESCE("createdAt", "updatedAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

ALTER TABLE "provider_rates" ALTER COLUMN "rateNegotiable" SET DEFAULT true;
ALTER TABLE "provider_rates" ALTER COLUMN "rateNegotiable" SET NOT NULL;
ALTER TABLE "provider_rates" ALTER COLUMN "quoteAfterInspection" SET DEFAULT false;
ALTER TABLE "provider_rates" ALTER COLUMN "quoteAfterInspection" SET NOT NULL;
ALTER TABLE "provider_rates" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_rates" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "provider_rates" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_rates" ALTER COLUMN "updatedAt" SET NOT NULL;

DELETE FROM "provider_rates" a
USING "provider_rates" b
WHERE a."providerId" = b."providerId"
  AND a."categorySlug" = b."categorySlug"
  AND a."id" > b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "provider_rates_providerId_categorySlug_key"
  ON "provider_rates"("providerId", "categorySlug");
CREATE INDEX IF NOT EXISTS "provider_rates_categorySlug_idx"
  ON "provider_rates"("categorySlug");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_rates_categoryId_fkey'
  ) THEN
    ALTER TABLE "provider_rates"
      ADD CONSTRAINT "provider_rates_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
