-- Free leads mode (flag: provider.leads.free).
--
-- When the flag is ON, a LeadUnlock is written with "creditsCharged" = 0 (no
-- wallet debit) so contact release still has its marker row. Relax the
-- lead_unlocks CHECK from > 0 to >= 0. The constraint name is kept so existing
-- tooling that references it keeps working.
--
-- Additive in effect: every existing row (creditsCharged >= 1) satisfies the
-- relaxed check, no data is rewritten, and flipping the flag OFF needs no
-- repair. The wallet_ledger_entries checks are intentionally NOT touched -
-- free unlocks never write a ledger row.
--
-- Must be applied with `prisma migrate deploy` BEFORE provider.leads.free is
-- flipped ON, otherwise free unlock inserts fail the old > 0 check.

ALTER TABLE "lead_unlocks"
  DROP CONSTRAINT IF EXISTS "lead_unlocks_creditsCharged_positive";

ALTER TABLE "lead_unlocks"
  ADD CONSTRAINT "lead_unlocks_creditsCharged_positive"
  CHECK ("creditsCharged" >= 0);
