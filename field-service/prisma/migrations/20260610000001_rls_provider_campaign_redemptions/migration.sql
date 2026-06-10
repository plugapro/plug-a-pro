-- Security fix (8807f26): Enable Row Level Security on provider_campaign_redemptions.
-- The table was created without ENABLE ROW LEVEL SECURITY, leaving all rows
-- accessible to any authenticated Supabase role that can reach the table.
--
-- BACKFILL NOTE: Providers who redeemed a campaign voucher before this migration
-- was applied do not have guard rows in this table. Their redemption rows are present
-- but were never protected by RLS. A separate backfill should be run to verify that
-- existing redemption rows are correct and that no duplicate redemptions occurred
-- during the unprotected window.
--
-- The deny_all RESTRICTIVE policy blocks all PUBLIC access. Application code must
-- use the service_role (or a named role granted below) to read/write this table.
-- Only the service_role bypass is granted; no anon/authenticated reads are allowed.

ALTER TABLE "provider_campaign_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_campaign_redemptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "deny_all" ON "provider_campaign_redemptions"
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false);

GRANT ALL ON "provider_campaign_redemptions" TO service_role;
