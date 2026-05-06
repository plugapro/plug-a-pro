-- Rebuild provider auto-approval reliability with side-effect replay and schema guards.
-- This migration ensures promo award drift is repaired where possible and adds
-- marker storage for idempotent reconciliation.

-- Guarantee the promo award enum and base columns exist before runtime schema
-- preflight checks start asserting against them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProviderPromoAwardType') THEN
    CREATE TYPE "ProviderPromoAwardType" AS ENUM (
      'MOBILE_VERIFIED',
      'PROFILE_COMPLETED',
      'KYC_APPROVED',
      'FIRST_TOPUP',
      'FIRST_COMPLETED_JOB'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderPromoAwardType'
      AND EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'MOBILE_VERIFIED'
      )
  ) THEN
    ALTER TYPE "ProviderPromoAwardType" ADD VALUE 'MOBILE_VERIFIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderPromoAwardType'
      AND EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'PROFILE_COMPLETED'
      )
  ) THEN
    ALTER TYPE "ProviderPromoAwardType" ADD VALUE 'PROFILE_COMPLETED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderPromoAwardType'
      AND EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'KYC_APPROVED'
      )
  ) THEN
    ALTER TYPE "ProviderPromoAwardType" ADD VALUE 'KYC_APPROVED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderPromoAwardType'
      AND EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'FIRST_TOPUP'
      )
  ) THEN
    ALTER TYPE "ProviderPromoAwardType" ADD VALUE 'FIRST_TOPUP';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderPromoAwardType'
      AND EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'FIRST_COMPLETED_JOB'
      )
  ) THEN
    ALTER TYPE "ProviderPromoAwardType" ADD VALUE 'FIRST_COMPLETED_JOB';
  END IF;
END $$;

-- provider_promo_awards drift repair: ensure awardType column + uniqueness + indexes.
ALTER TABLE "provider_promo_awards" ADD COLUMN IF NOT EXISTS "awardType" "ProviderPromoAwardType";
UPDATE "provider_promo_awards"
SET "awardType" = COALESCE("awardType", 'MOBILE_VERIFIED')
WHERE "awardType" IS NULL;
ALTER TABLE "provider_promo_awards"
  ALTER COLUMN "awardType" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "provider_promo_awards_providerId_awardType_key"
  ON "provider_promo_awards"("providerId", "awardType");

CREATE INDEX IF NOT EXISTS "provider_promo_awards_providerId_awardedAt_idx"
  ON "provider_promo_awards"("providerId", "awardedAt");
CREATE INDEX IF NOT EXISTS "provider_promo_awards_referenceType_referenceId_idx"
  ON "provider_promo_awards"("referenceType", "referenceId");

-- Side effect marker storage for replay safety across failed side effect runs.
CREATE TYPE IF NOT EXISTS "ProviderAutoApproveSideEffectKind" AS ENUM (
  'PROMO_AWARD',
  'NOTIFICATION',
  'MATCH_RECHECK'
);

CREATE TYPE IF NOT EXISTS "ProviderAutoApproveSideEffectStatus" AS ENUM (
  'PENDING',
  'DONE',
  'FAILED'
);

CREATE TABLE IF NOT EXISTS "provider_auto_approve_side_effect_markers" (
  "id" TEXT NOT NULL,
  "kind" "ProviderAutoApproveSideEffectKind" NOT NULL,
  "applicationId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sourceRefType" TEXT NOT NULL,
  "sourceRefId" TEXT NOT NULL,
  "status" "ProviderAutoApproveSideEffectStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "runId" TEXT,
  "attemptedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_auto_approve_side_effect_markers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_auto_approve_side_effect_markers_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_auto_approve_side_effect_markers_retryCount_non_negative"
    CHECK ("retryCount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_auto_ae_markers_kind_appid_key"
  ON "provider_auto_approve_side_effect_markers"("kind", "applicationId");

CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_status_retry_idx"
  ON "provider_auto_approve_side_effect_markers"("status", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "provider_auto_approve_side_effect_markers_providerId_kind_idx"
  ON "provider_auto_approve_side_effect_markers"("providerId", "kind");

CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_appId_idx"
  ON "provider_auto_approve_side_effect_markers"("applicationId");

CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_srctype_srcid_idx"
  ON "provider_auto_approve_side_effect_markers"("sourceRefType", "sourceRefId");
