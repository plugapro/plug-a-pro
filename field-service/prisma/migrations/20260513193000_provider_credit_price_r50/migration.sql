-- Align provider-credit purchase validation with the product rule:
-- 1 Plug-A-Pro provider credit = R50.
--
-- Existing approved packages (R100, R200, R500) remain valid because each is
-- divisible by R50. This replaces the old R20 divisibility guard for future
-- payment intents without mutating historic ledger rows.

ALTER TABLE "payment_intents"
  DROP CONSTRAINT IF EXISTS "payment_intents_amountCents_credit_multiple";

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amountCents_credit_multiple"
  CHECK (MOD("amountCents", 5000) = 0);
