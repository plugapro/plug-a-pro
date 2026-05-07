-- Tier-1 data model gaps — CODEX Step 03
-- All changes are purely additive (nullable or with defaults). No drops, no renames.

-- ── providers ──────────────────────────────────────────────────────────────────

-- Name split (optional; display `name` remains the primary field)
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "firstName" TEXT,
  ADD COLUMN IF NOT EXISTS "lastName" TEXT;

-- Provider type for compliance/UI segmentation (optional)
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "providerType" TEXT;

-- Approval timestamp required for 30-min SLA reporting
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

-- Payout banking verification timestamp (was listed in CLAUDE.md inventory but absent)
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "payoutVerifiedAt" TIMESTAMP(3);

-- Admin queue and KYC reporting indexes
CREATE INDEX IF NOT EXISTS "providers_status_createdAt_idx"  ON "providers" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "providers_kycStatus_status_idx"  ON "providers" ("kycStatus", "status");

-- ── technician_availability ────────────────────────────────────────────────────

-- Weekend availability flag (matching filter completeness)
ALTER TABLE "technician_availability"
  ADD COLUMN IF NOT EXISTS "weekendAvailable" BOOLEAN NOT NULL DEFAULT false;

-- ── wallet_ledger_entries ──────────────────────────────────────────────────────

-- Idempotency key prevents duplicate credit writes under payment retries
ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_entries_idempotencyKey_key"
  ON "wallet_ledger_entries" ("idempotencyKey");

-- Trace ID for distributed tracing across payment and credit operations
ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN IF NOT EXISTS "traceId" TEXT;

-- Source identifies the system component that created the entry
ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN IF NOT EXISTS "source" TEXT;

-- ── provider_applications ──────────────────────────────────────────────────────

-- Admin review queue ordering index
CREATE INDEX IF NOT EXISTS "provider_applications_status_submittedAt_idx"
  ON "provider_applications" ("status", "submittedAt");
