-- Provider onboarding promo awards.
-- Awards are milestone records; promo wallet ledger entries remain the
-- accounting source of truth for credit movement.

CREATE TYPE "ProviderPromoAwardType" AS ENUM (
  'MOBILE_VERIFIED',
  'PROFILE_COMPLETED',
  'KYC_APPROVED',
  'FIRST_TOPUP',
  'FIRST_COMPLETED_JOB'
);

CREATE TYPE "ProviderPromoAwardStatus" AS ENUM (
  'AWARDED',
  'REVOKED'
);

CREATE TABLE "provider_promo_awards" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "awardType" "ProviderPromoAwardType" NOT NULL,
  "creditsAwarded" INTEGER NOT NULL,
  "status" "ProviderPromoAwardStatus" NOT NULL DEFAULT 'AWARDED',
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "provider_promo_awards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_promo_awards_credits_positive" CHECK ("creditsAwarded" > 0)
);

CREATE UNIQUE INDEX "provider_promo_awards_providerId_awardType_key"
  ON "provider_promo_awards"("providerId", "awardType");

CREATE INDEX "provider_promo_awards_providerId_awardedAt_idx"
  ON "provider_promo_awards"("providerId", "awardedAt");

CREATE INDEX "provider_promo_awards_referenceType_referenceId_idx"
  ON "provider_promo_awards"("referenceType", "referenceId");

ALTER TABLE "provider_promo_awards"
  ADD CONSTRAINT "provider_promo_awards_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
