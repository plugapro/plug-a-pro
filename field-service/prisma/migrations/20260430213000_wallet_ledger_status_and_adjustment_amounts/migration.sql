-- Align wallet ledger constraints with implemented lifecycle events.
-- Credit/debit business movements still require non-zero amounts. Wallet status
-- audit entries are allowed to carry amountCredits = 0, and admin adjustments
-- may be positive or negative while service-layer guards prevent negative
-- wallet balances.

ALTER TABLE "wallet_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_ledger_entries_amountCredits_positive";

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_amountCredits_valid_for_type"
  CHECK (
    (
      "entryType" IN (
        'TOPUP_CREDIT',
        'PROMO_CREDIT',
        'LEAD_UNLOCK_DEBIT',
        'LEAD_REFUND_CREDIT',
        'PROMO_EXPIRY',
        'PAYMENT_REVERSAL'
      )
      AND "amountCredits" > 0
    )
    OR (
      "entryType" = 'ADMIN_ADJUSTMENT'
      AND "amountCredits" <> 0
    )
    OR (
      "entryType" IN ('WALLET_SUSPENDED', 'WALLET_REACTIVATED')
      AND "amountCredits" = 0
    )
  );
