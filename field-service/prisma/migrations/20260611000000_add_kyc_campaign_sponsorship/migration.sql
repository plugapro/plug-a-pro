-- CreateEnum
CREATE TYPE "KycCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "KycSponsorshipStatus" AS ENUM ('CONSUMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "KycFeeLedgerReason" AS ENUM ('KYC_FEE_ACCRUED', 'KYC_FEE_SPONSORED', 'KYC_FEE_RECOVERED', 'KYC_FEE_WAIVED', 'KYC_FEE_REVERSED');

-- CreateTable
CREATE TABLE "kyc_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignCode" TEXT NOT NULL,
    "status" "KycCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "locationNodeId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "maxSponsoredCount" INTEGER NOT NULL,
    "sponsoredCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_sponsorships" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationId" TEXT,
    "identifierHash" TEXT,
    "status" "KycSponsorshipStatus" NOT NULL DEFAULT 'CONSUMED',
    "source" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "kyc_sponsorships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_fee_ledger_entries" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "reason" "KycFeeLedgerReason" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "source" TEXT,
    "createdBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_fee_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_campaigns_campaignCode_key" ON "kyc_campaigns"("campaignCode");

-- CreateIndex
CREATE INDEX "kyc_campaigns_status_startsAt_idx" ON "kyc_campaigns"("status", "startsAt");

-- CreateIndex
CREATE INDEX "kyc_sponsorships_providerId_idx" ON "kyc_sponsorships"("providerId");

-- CreateIndex
CREATE INDEX "kyc_sponsorships_identifierHash_idx" ON "kyc_sponsorships"("identifierHash");

-- CreateIndex
CREATE INDEX "kyc_sponsorships_campaignId_status_idx" ON "kyc_sponsorships"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_sponsorships_campaignId_providerId_key" ON "kyc_sponsorships"("campaignId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_fee_ledger_entries_idempotencyKey_key" ON "kyc_fee_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "kyc_fee_ledger_entries_providerId_createdAt_idx" ON "kyc_fee_ledger_entries"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "kyc_fee_ledger_entries_reason_createdAt_idx" ON "kyc_fee_ledger_entries"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "kyc_fee_ledger_entries_campaignId_createdAt_idx" ON "kyc_fee_ledger_entries"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "kyc_campaigns" ADD CONSTRAINT "kyc_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_campaigns" ADD CONSTRAINT "kyc_campaigns_locationNodeId_fkey" FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_sponsorships" ADD CONSTRAINT "kyc_sponsorships_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "kyc_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_sponsorships" ADD CONSTRAINT "kyc_sponsorships_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_fee_ledger_entries" ADD CONSTRAINT "kyc_fee_ledger_entries_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
