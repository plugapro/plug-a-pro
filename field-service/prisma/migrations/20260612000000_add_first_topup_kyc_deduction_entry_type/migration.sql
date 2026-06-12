-- Additive enum value: wallet ledger entry type for the 1-credit deduction
-- that settles the once-off KYC fee at first top-up.
ALTER TYPE "WalletLedgerEntryType" ADD VALUE IF NOT EXISTS 'FIRST_TOPUP_KYC_DEDUCTION';
