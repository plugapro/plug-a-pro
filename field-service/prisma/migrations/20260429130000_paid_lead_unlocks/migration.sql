-- Paid provider lead unlocks.
-- Lead previews remain free. A provider pays credits only when unlocking full
-- customer/job details for an assigned lead.

CREATE TYPE "LeadUnlockStatus" AS ENUM (
  'UNLOCKED',
  'REFUNDED',
  'DISPUTED',
  'REVERSED'
);

CREATE TABLE "lead_unlocks" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "matchId" TEXT,
  "creditsCharged" INTEGER NOT NULL,
  "creditTypeBreakdown" JSONB NOT NULL DEFAULT '{}',
  "status" "LeadUnlockStatus" NOT NULL DEFAULT 'UNLOCKED',
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refundedAt" TIMESTAMP(3),
  "refundReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lead_unlocks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lead_unlocks"
  ADD CONSTRAINT "lead_unlocks_creditsCharged_positive"
  CHECK ("creditsCharged" > 0);

CREATE UNIQUE INDEX "lead_unlocks_leadId_key" ON "lead_unlocks"("leadId");
CREATE INDEX "lead_unlocks_providerId_unlockedAt_idx" ON "lead_unlocks"("providerId", "unlockedAt");
CREATE INDEX "lead_unlocks_matchId_idx" ON "lead_unlocks"("matchId");

ALTER TABLE "lead_unlocks"
  ADD CONSTRAINT "lead_unlocks_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_unlocks"
  ADD CONSTRAINT "lead_unlocks_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_unlocks"
  ADD CONSTRAINT "lead_unlocks_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
