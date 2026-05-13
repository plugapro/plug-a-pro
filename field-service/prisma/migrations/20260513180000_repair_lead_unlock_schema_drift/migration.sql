-- Repair production drift where the paid lead unlock migrations are recorded
-- as applied but the live lead_unlocks table still has the legacy column set.
-- This migration is additive/idempotent so deploy pipelines can safely run it
-- against both already-correct and drifted databases.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadUnlockStatus') THEN
    CREATE TYPE "LeadUnlockStatus" AS ENUM ('UNLOCKED', 'REFUNDED', 'DISPUTED', 'REVERSED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadUnlockDisputeReason') THEN
    CREATE TYPE "LeadUnlockDisputeReason" AS ENUM (
      'INVALID_CUSTOMER_NUMBER',
      'DUPLICATE_LEAD',
      'WRONG_CATEGORY',
      'WRONG_LOCATION',
      'CUSTOMER_DID_NOT_REQUEST',
      'CANCELLED_BEFORE_UNLOCK'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadUnlockDisputeStatus') THEN
    CREATE TYPE "LeadUnlockDisputeStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');
  END IF;
END $$;

ALTER TABLE "lead_unlocks"
  ADD COLUMN IF NOT EXISTS "matchId" TEXT,
  ADD COLUMN IF NOT EXISTS "creditsCharged" INTEGER,
  ADD COLUMN IF NOT EXISTS "creditTypeBreakdown" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "status" "LeadUnlockStatus" NOT NULL DEFAULT 'UNLOCKED',
  ADD COLUMN IF NOT EXISTS "isTestUnlock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
  ADD COLUMN IF NOT EXISTS "disputeReason" "LeadUnlockDisputeReason",
  ADD COLUMN IF NOT EXISTS "disputeNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "disputedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refundReason" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "lead_unlocks"
SET "creditsCharged" = 1
WHERE "creditsCharged" IS NULL;

ALTER TABLE "lead_unlocks"
  ALTER COLUMN "creditsCharged" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_unlocks_creditsCharged_positive'
  ) THEN
    ALTER TABLE "lead_unlocks"
      ADD CONSTRAINT "lead_unlocks_creditsCharged_positive"
      CHECK ("creditsCharged" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_unlocks_matchId_fkey'
  ) THEN
    ALTER TABLE "lead_unlocks"
      ADD CONSTRAINT "lead_unlocks_matchId_fkey"
      FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "lead_unlocks_matchId_idx" ON "lead_unlocks"("matchId");
CREATE INDEX IF NOT EXISTS "lead_unlocks_isTestUnlock_idx" ON "lead_unlocks"("isTestUnlock");
