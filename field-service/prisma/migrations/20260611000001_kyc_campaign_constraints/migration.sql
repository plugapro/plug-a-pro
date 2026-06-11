-- CreateIndex
CREATE INDEX "kyc_campaigns_locationNodeId_idx" ON "kyc_campaigns"("locationNodeId");

-- CreateIndex
CREATE INDEX "kyc_fee_ledger_entries_referenceType_referenceId_idx" ON "kyc_fee_ledger_entries"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "kyc_sponsorships" ADD CONSTRAINT "kyc_sponsorships_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_fee_ledger_entries" ADD CONSTRAINT "kyc_fee_ledger_entries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "kyc_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Belt-and-braces guards for the cached allocation counter (mirrors
-- 20260518140000_wallet_balance_check_constraints).
ALTER TABLE "kyc_campaigns" ADD CONSTRAINT "kyc_campaigns_sponsored_count_nonneg"
  CHECK ("sponsoredCount" >= 0);
ALTER TABLE "kyc_campaigns" ADD CONSTRAINT "kyc_campaigns_sponsored_count_cap"
  CHECK ("sponsoredCount" <= "maxSponsoredCount");

-- RLS: financial + identity-hash tables must have row level security enabled
-- (mirrors 20260610010000_assert_rls_critical_tables).
ALTER TABLE "kyc_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_sponsorships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_fee_ledger_entries" ENABLE ROW LEVEL SECURITY;
