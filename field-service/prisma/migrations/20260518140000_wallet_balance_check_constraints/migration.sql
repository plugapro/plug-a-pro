-- Add non-negative balance constraints to ProviderWallet
-- These are the last-resort guard against wallet balance going negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'wallet_paid_balance_nonneg'
  ) THEN
    ALTER TABLE "provider_wallets"
      ADD CONSTRAINT "wallet_paid_balance_nonneg" CHECK ("paidCreditBalance" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'wallet_promo_balance_nonneg'
  ) THEN
    ALTER TABLE "provider_wallets"
      ADD CONSTRAINT "wallet_promo_balance_nonneg" CHECK ("promoCreditBalance" >= 0);
  END IF;
END $$;
