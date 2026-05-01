-- AddColumns customers: moderation / lifecycle fields
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "isBlocked"            BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "blockedReason"         TEXT,
  ADD COLUMN IF NOT EXISTS "blockedAt"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedUntil"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason"       TEXT,
  ADD COLUMN IF NOT EXISTS "archivedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archiveReason"         TEXT,
  ADD COLUMN IF NOT EXISTS "purgeAfter"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mergedIntoCustomerId"  TEXT,
  ADD COLUMN IF NOT EXISTS "channel"               TEXT;
