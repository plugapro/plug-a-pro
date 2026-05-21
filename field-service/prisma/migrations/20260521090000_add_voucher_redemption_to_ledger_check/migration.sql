-- VOUCHER_REDEMPTION was added to the WalletLedgerEntryType enum in migration
-- 20260520120000_add_promo_vouchers, but the amountCredits_valid_for_type check
-- constraint (created in 20260430213000) was not updated to include it.
-- Any walletLedgerEntry.create with entryType='VOUCHER_REDEMPTION' violates
-- the constraint, rolls back the transaction, and prevents voucher redemption.

ALTER TABLE "wallet_ledger_entries"
  DROP CONSTRAINT IF EXISTS "wallet_ledger_entries_amountCredits_valid_for_type";

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_amountCredits_valid_for_type"
  CHECK (
    (
      "entryType" IN (
        'TOPUP_CREDIT',
        'PROMO_CREDIT',
        'VOUCHER_REDEMPTION',
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
