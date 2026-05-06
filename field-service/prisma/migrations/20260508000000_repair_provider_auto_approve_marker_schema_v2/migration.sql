-- Idempotent follow-up repair for provider auto-approve side-effect replay.
-- This migration safely handles environments where the prior repair migration was
-- applied only partially or with a different enum/index baseline.

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectKind'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'PROMO_AWARD'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectKind" ADD VALUE 'PROMO_AWARD';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectKind'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'NOTIFICATION'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectKind" ADD VALUE 'NOTIFICATION';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectKind'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'MATCH_RECHECK'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectKind" ADD VALUE 'MATCH_RECHECK';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectStatus'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'PENDING'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectStatus" ADD VALUE 'PENDING';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectStatus'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'DONE'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectStatus" ADD VALUE 'DONE';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'ProviderAutoApproveSideEffectStatus'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
          AND e.enumlabel = 'FAILED'
      )
  ) THEN
    ALTER TYPE "ProviderAutoApproveSideEffectStatus" ADD VALUE 'FAILED';
  END IF;
END $$;

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
  ON "provider_auto_approve_side_effect_markers" ("kind", "applicationId");
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_status_retry_idx"
  ON "provider_auto_approve_side_effect_markers" ("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "provider_auto_approve_side_effect_markers_providerId_kind_idx"
  ON "provider_auto_approve_side_effect_markers" ("providerId", "kind");
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_appid_idx"
  ON "provider_auto_approve_side_effect_markers" ("applicationId");
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_srctype_srcid_idx"
  ON "provider_auto_approve_side_effect_markers" ("sourceRefType", "sourceRefId");
CREATE INDEX IF NOT EXISTS "provider_auto_approve_side_effect_markers_attemptedAt_idx"
  ON "provider_auto_approve_side_effect_markers" ("attemptedAt");
