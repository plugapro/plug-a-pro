-- Provider credit wallet ledger foundation.
-- Wallet balances are integer Plug-A-Pro Credits, not Rand amounts.
-- Current product pricing is 1 Plug-A-Pro Credit = R20 and is enforced in app code.

CREATE TYPE "ProviderWalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

CREATE TYPE "WalletLedgerEntryType" AS ENUM (
  'TOPUP_CREDIT',
  'PROMO_CREDIT',
  'LEAD_UNLOCK_DEBIT',
  'LEAD_REFUND_CREDIT',
  'ADMIN_ADJUSTMENT',
  'PROMO_EXPIRY',
  'PAYMENT_REVERSAL'
);

CREATE TYPE "WalletCreditType" AS ENUM ('PAID', 'PROMO');

CREATE TABLE "provider_wallets" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "paidCreditBalance" INTEGER NOT NULL DEFAULT 0,
  "promoCreditBalance" INTEGER NOT NULL DEFAULT 0,
  "status" "ProviderWalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_ledger_entries" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "entryType" "WalletLedgerEntryType" NOT NULL,
  "creditType" "WalletCreditType" NOT NULL,
  "amountCredits" INTEGER NOT NULL,
  "balanceAfterPaidCredits" INTEGER NOT NULL,
  "balanceAfterPromoCredits" INTEGER NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,

  CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "provider_wallets"
  ADD CONSTRAINT "provider_wallets_paidCreditBalance_nonnegative"
  CHECK ("paidCreditBalance" >= 0);

ALTER TABLE "provider_wallets"
  ADD CONSTRAINT "provider_wallets_promoCreditBalance_nonnegative"
  CHECK ("promoCreditBalance" >= 0);

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_amountCredits_positive"
  CHECK ("amountCredits" > 0);

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_balanceAfterPaidCredits_nonnegative"
  CHECK ("balanceAfterPaidCredits" >= 0);

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_balanceAfterPromoCredits_nonnegative"
  CHECK ("balanceAfterPromoCredits" >= 0);

CREATE UNIQUE INDEX "provider_wallets_providerId_key" ON "provider_wallets"("providerId");
CREATE INDEX "wallet_ledger_entries_walletId_createdAt_idx" ON "wallet_ledger_entries"("walletId", "createdAt");
CREATE INDEX "wallet_ledger_entries_providerId_createdAt_idx" ON "wallet_ledger_entries"("providerId", "createdAt");
CREATE INDEX "wallet_ledger_entries_referenceType_referenceId_idx" ON "wallet_ledger_entries"("referenceType", "referenceId");

ALTER TABLE "provider_wallets"
  ADD CONSTRAINT "provider_wallets_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "provider_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_ledger_entries"
  ADD CONSTRAINT "wallet_ledger_entries_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
