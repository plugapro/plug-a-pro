-- Add an explicit attempt-cap marker so the fail-safe can ignore all legacy
-- identity rows and only count failed attempts created after this migration.
ALTER TABLE "provider_identity_verifications"
  ADD COLUMN "countsTowardAttemptCap" BOOLEAN NOT NULL DEFAULT true;

UPDATE "provider_identity_verifications"
SET "countsTowardAttemptCap" = false
WHERE "createdAt" < now();

CREATE INDEX "provider_identity_verifications_providerId_status_countsTowardAttemptCap_idx"
  ON "provider_identity_verifications"("providerId", "status", "countsTowardAttemptCap");
