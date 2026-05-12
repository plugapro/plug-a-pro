-- Repair live environments that were created from the interim
-- provider_shortlists shape using "jobRequestId". The current Prisma schema
-- and review-first code use "requestId", so shortlist actions fail until the
-- database column is aligned.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlists'
      AND column_name = 'jobRequestId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlists'
      AND column_name = 'requestId'
  ) THEN
    ALTER TABLE "provider_shortlists"
      RENAME COLUMN "jobRequestId" TO "requestId";
  END IF;
END $$;

ALTER TABLE "provider_shortlists"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

ALTER TABLE "provider_shortlists"
  DROP CONSTRAINT IF EXISTS "provider_shortlists_jobRequestId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_shortlists_requestId_fkey'
      AND conrelid = 'provider_shortlists'::regclass
  ) THEN
    ALTER TABLE "provider_shortlists"
      ADD CONSTRAINT "provider_shortlists_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "job_requests"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_lead_responses'
      AND column_name = 'leadId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_lead_responses'
      AND column_name = 'leadInviteId'
  ) THEN
    ALTER TABLE "provider_lead_responses"
      RENAME COLUMN "leadId" TO "leadInviteId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_lead_responses'
      AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_lead_responses'
      AND column_name = 'response'
  ) THEN
    ALTER TABLE "provider_lead_responses"
      RENAME COLUMN "status" TO "response";
  END IF;
END $$;

ALTER TABLE "provider_lead_responses"
  ADD COLUMN IF NOT EXISTS "callOutFee" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "estimatedArrivalAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rateType" TEXT,
  ADD COLUMN IF NOT EXISTS "rateAmount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "negotiable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "providerNote" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

ALTER TABLE "provider_lead_responses"
  DROP CONSTRAINT IF EXISTS "provider_lead_responses_leadId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_lead_responses_leadInviteId_fkey'
      AND conrelid = 'provider_lead_responses'::regclass
  ) THEN
    ALTER TABLE "provider_lead_responses"
      ADD CONSTRAINT "provider_lead_responses_leadInviteId_fkey"
      FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "provider_lead_responses_lead_provider_key";
DROP INDEX IF EXISTS "provider_lead_responses_leadInviteId_createdAt_idx";
DROP INDEX IF EXISTS "provider_lead_responses_providerId_createdAt_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "provider_lead_responses_idempotencyKey_key"
  ON "provider_lead_responses"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "provider_lead_responses_leadInviteId_createdAt_idx"
  ON "provider_lead_responses"("leadInviteId", "createdAt");

CREATE INDEX IF NOT EXISTS "provider_lead_responses_providerId_createdAt_idx"
  ON "provider_lead_responses"("providerId", "createdAt");

DROP INDEX IF EXISTS "provider_shortlists_jobRequestId_key";
DROP INDEX IF EXISTS "provider_shortlists_jobRequestId_status_key";
DROP INDEX IF EXISTS "provider_shortlists_jobRequestId_status_idx";
DROP INDEX IF EXISTS "provider_shortlists_requestId_status_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlists_requestId_status_key"
  ON "provider_shortlists"("requestId", "status");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlist_items'
      AND column_name = 'score'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlist_items'
      AND column_name = 'matchScore'
  ) THEN
    ALTER TABLE "provider_shortlist_items"
      RENAME COLUMN "score" TO "matchScore";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlist_items'
      AND column_name = 'addedAt'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlist_items'
      AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "provider_shortlist_items"
      RENAME COLUMN "addedAt" TO "createdAt";
  END IF;
END $$;

ALTER TABLE "provider_shortlist_items"
  ADD COLUMN IF NOT EXISTS "leadInviteId" TEXT,
  ADD COLUMN IF NOT EXISTS "matchScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "displayCallOutFee" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "displayArrivalTime" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerSelectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "provider_shortlist_items" item
SET "leadInviteId" = lead."id"
FROM "provider_shortlists" shortlist, "leads" lead
WHERE item."shortlistId" = shortlist."id"
  AND lead."jobRequestId" = shortlist."requestId"
  AND lead."providerId" = item."providerId"
  AND item."leadInviteId" IS NULL;

-- Rows without a lead cannot be used by the current customer shortlist flow and
-- would fail the required FK. This should only affect orphaned interim rows.
DELETE FROM "provider_shortlist_items"
WHERE "leadInviteId" IS NULL;

ALTER TABLE "provider_shortlist_items"
  ALTER COLUMN "leadInviteId" SET NOT NULL;

DROP INDEX IF EXISTS "provider_shortlist_items_sl_provider_key";
DROP INDEX IF EXISTS "provider_shortlist_items_shortlistId_leadInviteId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlist_items_shortlistId_leadInviteId_key"
  ON "provider_shortlist_items"("shortlistId", "leadInviteId");

CREATE INDEX IF NOT EXISTS "provider_shortlist_items_providerId_idx"
  ON "provider_shortlist_items"("providerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_shortlist_items_leadInviteId_fkey'
      AND conrelid = 'provider_shortlist_items'::regclass
  ) THEN
    ALTER TABLE "provider_shortlist_items"
      ADD CONSTRAINT "provider_shortlist_items_leadInviteId_fkey"
      FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
