-- Lead unlock dispute and refund workflow.
-- Refund accounting still flows through wallet_ledger_entries.

CREATE TYPE "LeadUnlockDisputeReason" AS ENUM (
  'INVALID_CUSTOMER_NUMBER',
  'DUPLICATE_LEAD',
  'WRONG_CATEGORY',
  'WRONG_LOCATION',
  'CUSTOMER_DID_NOT_REQUEST',
  'CANCELLED_BEFORE_UNLOCK'
);

CREATE TYPE "LeadUnlockDisputeStatus" AS ENUM (
  'OPEN',
  'APPROVED',
  'REJECTED'
);

ALTER TABLE "lead_unlocks"
  ADD COLUMN "disputeReason" "LeadUnlockDisputeReason",
  ADD COLUMN "disputeNotes" TEXT,
  ADD COLUMN "disputedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedBy" TEXT;

CREATE TABLE "lead_unlock_disputes" (
  "id" TEXT NOT NULL,
  "leadUnlockId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "reason" "LeadUnlockDisputeReason" NOT NULL,
  "notes" TEXT,
  "status" "LeadUnlockDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "adminNotes" TEXT,

  CONSTRAINT "lead_unlock_disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_unlock_disputes_leadUnlockId_key"
  ON "lead_unlock_disputes"("leadUnlockId");

CREATE INDEX "lead_unlock_disputes_providerId_createdAt_idx"
  ON "lead_unlock_disputes"("providerId", "createdAt");

CREATE INDEX "lead_unlock_disputes_status_createdAt_idx"
  ON "lead_unlock_disputes"("status", "createdAt");

ALTER TABLE "lead_unlock_disputes"
  ADD CONSTRAINT "lead_unlock_disputes_leadUnlockId_fkey"
  FOREIGN KEY ("leadUnlockId") REFERENCES "lead_unlocks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_unlock_disputes"
  ADD CONSTRAINT "lead_unlock_disputes_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
