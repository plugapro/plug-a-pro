-- Repair production schema drift from the legacy lead-unlock pricing model.
-- Current code records the charged unit count in "creditsCharged" and stores
-- rand pricing centrally in provider-wallet constants; it does not write the
-- removed legacy "priceCents" column. If that NOT NULL column remains in a
-- drifted database, LeadUnlock creation fails with P2011 and the provider
-- acceptance transaction rolls back before any credit is deducted.

ALTER TABLE "lead_unlocks"
  DROP COLUMN IF EXISTS "priceCents";
