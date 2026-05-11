-- Promote the existing non-unique provider_shortlists request/status index to
-- a unique constraint. Some live environments were created from an interim
-- schema that named the FK column "jobRequestId" instead of "requestId"; keep
-- this migration idempotent across both shapes so prisma migrate deploy can
-- recover without rewriting existing shortlist data.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlists'
      AND column_name = 'requestId'
  ) THEN
    DROP INDEX IF EXISTS "provider_shortlists_requestId_status_idx";
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlists_requestId_status_key"
      ON "provider_shortlists"("requestId", "status");
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_shortlists'
      AND column_name = 'jobRequestId'
  ) THEN
    DROP INDEX IF EXISTS "provider_shortlists_jobRequestId_status_idx";
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlists_jobRequestId_status_key"
      ON "provider_shortlists"("jobRequestId", "status");
  END IF;
END $$;
