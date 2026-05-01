-- AddColumns customers: free-text address field
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "address" TEXT;

-- AddColumns providers: moderation / lifecycle fields
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "status"          TEXT    NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "kycStatus"       TEXT    NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "suspendedUntil"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "strikes"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "archivedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archiveReason"   TEXT;
