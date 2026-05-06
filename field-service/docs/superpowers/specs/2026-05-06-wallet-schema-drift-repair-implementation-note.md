# Wallet Schema Drift Repair — Implementation Note

**Date:** 2026-05-06  
**Project:** Plug A Pro — field-service  
**Status:** implemented  
**Related migration family:** `field-service/prisma/migrations/20260429120000_provider_credit_wallet_ledger` through `20260430213000_wallet_ledger_status_and_adjustment_amounts`

## Scope

The repair targets a migration-state mismatch where wallet migrations were force-marked as applied with `applied_steps_count = 0` while production wallet tables remained on legacy shape. The implementation adds explicit preflight checks, controlled backup/rebuild, and deterministic migration-state resolution commands.

## Changes made

1. Corrected migration probe checks in `scripts/probe-migration-state.ts`:
   - `20260429143000_wallet_status_ledger_entries` now validates `WalletLedgerEntryType` contains `WALLET_SUSPENDED` and `WALLET_REACTIVATED` enum values.
   - `20260430213000_wallet_ledger_status_and_adjustment_amounts` now validates the `wallet_ledger_entries_amountCredits_valid_for_type` CHECK constraint exists.

2. Hardened `scripts/wallet-schema-drift-repair.ts`:
   - Added safe dependency table snapshots for `payment_intents`, `lead_unlocks`, and `provider_promo_awards` during dry-run/apply preflight.
   - Added `safeTableCount` helper to avoid hard failures when optional tables are absent in a partially migrated environment.
   - Added explicit `--force-resolve` handling to reset wallet migrations marked `ZERO_STEPS` before re-resolving as applied.
   - Kept write execution guarded by `--apply` + `--confirm` and preserved backup table approach (`provider_wallets__legacy`, `wallet_ledger_entries__legacy`).

3. Added maintenance script entry points in `field-service/package.json`:
   - `db:probe-migrations` → `tsx scripts/probe-migration-state.ts`
   - `db:wallet-schema-drift` → `tsx scripts/wallet-schema-drift-repair.ts`

## Data and behavior notes

- Legacy balances continue to map as follows:
  - `paidCreditBalance` prefers `paidCreditBalance`, then `balanceCents`.
  - `promoCreditBalance` prefers `promoCreditBalance`, then `starterCreditBalance`.
- Active providers are guaranteed wallet rows after repair with `status = 'ACTIVE'` and `paid/promo balances = 0` when no legacy mapping exists.
- The script remains conservative by reconstructing only wallet tables and preserving legacy snapshots for forensic/replay use.

## OpenBrain-compatible logging command

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend
pnpm brain -- knowledge add \
  --project "Plug A Pro" \
  --domain "engineering" \
  --title "wallet migration drift repair — schema reconstruction and migration-state repair (2026-05-06)" \
  --tags "wallet,migration,database,engineering,release" \
  --content "Implemented controlled wallet schema repair: corrected migration object probes, added safe dependency row snapshots, and wired controlled migration-state resolve path for zero-step wallet migration rows. Canonical migration set covered: 20260429120000, 20260429123000, 20260429130000, 20260429133000, 20260429143000, 20260430213000."
```
