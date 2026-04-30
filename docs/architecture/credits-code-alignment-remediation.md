# Credits Code Alignment and Remediation Report

Date: 2026-04-30  
Branch: `fix/credits-flow-alignment`

## 1. Executive Summary

The credits implementation now aligns more closely with the approved credits lifecycle diagrams. The core approved behaviours were already present for onboarding grants, top-up crediting, ledger-backed lead unlock deductions, duplicate unlock idempotency, and post-commit notifications. This remediation closed concrete gaps found during the code alignment pass:

- wallet ledger test-cohort metadata is now written consistently;
- wallet status-change ledger entries are now compatible with database constraints;
- a reusable reconciliation report module now detects wallet/ledger/payment/promo/unlock mismatches;
- ledger metadata now records balance-before and balance-after snapshots for support and finance troubleshooting;
- docs and Mermaid diagrams were updated to describe the remediated current state.

No P0 credits issue remains in the audited core path.

## 2. Audit Findings

| Area | Finding | Status after remediation |
|---|---|---|
| Onboarding grant | Mobile-verified onboarding credits are granted only after approval and are idempotent through `ProviderPromoAward(providerId, awardType)`. | Aligned. |
| Test cohort credits | `WalletLedgerEntry.isTestTransaction` and `cohortName` existed but were not populated by wallet mutations. | Fixed. |
| Ledger status events | `WALLET_SUSPENDED` and `WALLET_REACTIVATED` wrote `amountCredits = 0`, conflicting with the original positive-amount DB check. Negative admin adjustments also needed explicit DB allowance. | Fixed by migration. |
| Top-up crediting | Manual EFT and PayFast crediting were ledger-backed and idempotent. Test top-up ledger metadata was missing. | Fixed metadata propagation. |
| Lead unlock debit | Unlock charged exactly 1 credit, created `LeadUnlock`, wrote ledger debit, and was idempotent. Test unlock ledger metadata was missing. | Fixed metadata propagation. |
| Reconciliation | Admin pages exposed records, but no reusable reconciliation utility existed. | Fixed with report module. |
| Reversal/expiry | `PAYMENT_REVERSAL` and `PROMO_EXPIRY` remain placeholders. | Remaining gap. |
| Scheduled reconciliation | No scheduled reconciliation job or admin exception dashboard exists. | Remaining gap. |

## 3. Remediations Implemented

### Test Cohort Ledger Metadata

Problem: test provider grants, top-ups, and unlocks could appear as live ledger activity because wallet mutations did not set `isTestTransaction` or `cohortName`.

Files changed:

- `field-service/lib/provider-wallet.ts`
- `field-service/lib/provider-promo-awards.ts`
- `field-service/lib/lead-unlocks.ts`
- `field-service/lib/provider-credit-reconciliation.ts`
- `field-service/lib/provider-credit-gateway-itn.ts`
- `field-service/__tests__/lib/provider-wallet.test.ts`
- `field-service/__tests__/lib/provider-promo-awards.test.ts`
- `field-service/__tests__/lib/lead-unlocks.test.ts`
- `field-service/__tests__/lib/provider-credit-gateway-itn.test.ts`

Before: wallet ledger rows defaulted to live activity even when the provider/lead was test cohort.

After: wallet mutation references can carry `isTestTransaction` and `cohortName`; promo awards, lead unlocks, manual top-up crediting, and PayFast ITN crediting pass those values through.

Tests added/updated:

- paid credit ledger entry includes test metadata when supplied;
- internal test onboarding grant writes test metadata;
- test lead unlock debit writes test metadata;
- PayFast gateway intent mock includes provider cohort context.

### Ledger Balance-Before Metadata

Problem: ledger rows stored balance-after columns but did not include balance-before context for support screenshots and finance troubleshooting.

Files changed:

- `field-service/lib/provider-wallet.ts`
- `field-service/__tests__/lib/provider-wallet.test.ts`

Before: ledger entries had `balanceAfterPaidCredits` and `balanceAfterPromoCredits`.

After: ledger metadata also includes `balanceBeforePaidCredits`, `balanceBeforePromoCredits`, `balanceAfterPaidCredits`, and `balanceAfterPromoCredits`.

Tests added/updated:

- paid top-up ledger test asserts before/after metadata.

### Conditional Ledger Amount Constraint

Problem: implemented wallet status events use zero-credit ledger entries, and admin adjustments may be negative; the original DB check only allowed `amountCredits > 0`.

Files changed:

- `field-service/prisma/migrations/20260430213000_wallet_ledger_status_and_adjustment_amounts/migration.sql`

Before: production DB could reject wallet suspend/reactivate ledger entries and negative admin adjustments.

After: business credit movements must remain positive, `ADMIN_ADJUSTMENT` must be non-zero, and wallet status events must be exactly zero.

Tests added/updated:

- existing provider wallet tests already cover suspend/reactivate zero-credit entries and negative adjustment behaviour.

### Reconciliation Report Utility

Problem: support/finance had no reusable module to answer whether wallet balances, payment intents, promo awards, and lead unlocks reconcile.

Files changed:

- `field-service/lib/provider-credit-reconciliation-report.ts`
- `field-service/__tests__/lib/provider-credit-reconciliation-report.test.ts`
- `docs/architecture/credits-management-review.md`
- `docs/architecture/credits-management-summary.md`
- `docs/architecture/diagrams/credits-overview-flow.mmd`
- `docs/architecture/diagrams/credits-reconciliation-flow.mmd`

Before: reconciliation was manual through admin pages and direct queries.

After: `buildProviderCreditReconciliationReport(providerId)` returns structured issues for:

- missing provider;
- wallet balance drift;
- ledger balance snapshot mismatch;
- credited payment without top-up ledger;
- PayFast intent with missing credited ledger link;
- promo award without promo ledger;
- lead unlock without debit ledger;
- lead unlock debit amount mismatch;
- test ledger flag mismatch;
- missing test cohort name.

Tests added:

- aligned wallet/payment/award/unlock report returns ok;
- stored wallet drift is detected;
- missing payment/promo/unlock ledger links are detected;
- test cohort flag mismatch is detected;
- missing provider returns a structured issue.

## 4. Remaining Gaps

- No scheduled reconciliation job or admin exception dashboard consumes the new reconciliation report yet.
- No wallet balance repair command exists yet; this should follow after reconciliation exceptions are visible.
- Payment reversal and promo expiry remain unimplemented placeholders.
- PWA signed lead still supports unlock-only inspection; this appears intentionally documented but should be confirmed as commercial policy.
- Top-up intent creation still has no explicit rate limit.
- PayFast ITN/proof upload/admin redirects still need more consistent trace IDs.

## 5. Reconciliation Status

Reconciliation is now supported at the backend utility level by `field-service/lib/provider-credit-reconciliation-report.ts`.

The report can explain:

- whether stored `ProviderWallet` balances match ledger replay;
- whether credited `PaymentIntent` rows have `TOPUP_CREDIT` ledger rows;
- whether `ProviderPromoAward` rows have `PROMO_CREDIT` ledger rows;
- whether `LeadUnlock` rows have matching `LEAD_UNLOCK_DEBIT` ledger rows;
- whether test cohort ledger rows are correctly flagged.

It is not yet scheduled, exported, or surfaced in an admin page.

## 6. Error Handling and Logging Improvements

New structured reconciliation issue codes:

- `PROVIDER_NOT_FOUND`
- `WALLET_MISSING`
- `WALLET_BALANCE_MISMATCH`
- `LEDGER_SNAPSHOT_MISMATCH`
- `CREDITED_PAYMENT_WITHOUT_LEDGER`
- `PAYFAST_PAYMENT_WITHOUT_LEDGER_LINK`
- `PROMO_AWARD_WITHOUT_LEDGER`
- `LEAD_UNLOCK_WITHOUT_DEBIT`
- `LEAD_UNLOCK_DEBIT_AMOUNT_MISMATCH`
- `TEST_LEDGER_FLAG_MISMATCH`
- `TEST_LEDGER_COHORT_MISSING`

Ledger observability improvement:

- ledger metadata now includes balance-before and balance-after values for each wallet movement.

No secrets, OTPs, raw signed tokens, or payment credentials are logged by the new reconciliation utility.

## 7. Test Results

Validation run before commit:

```text
npm test -- __tests__/lib/provider-wallet.test.ts __tests__/lib/provider-promo-awards.test.ts __tests__/lib/provider-credit-payment-intents.test.ts __tests__/lib/provider-credit-reconciliation.test.ts __tests__/lib/provider-credit-gateway-itn.test.ts __tests__/lib/provider-credit-reconciliation-report.test.ts __tests__/lib/payfast.test.ts __tests__/lib/lead-unlocks.test.ts __tests__/lib/lead-unlock-disputes.test.ts __tests__/admin/provider-wallets-actions.test.ts __tests__/admin/provider-credit-payments-actions.test.ts __tests__/admin/lead-unlock-disputes-actions.test.ts __tests__/api/payfast-webhook.test.ts __tests__/api/provider-credit-top-up-intents.test.ts __tests__/api/provider-credit-payment-proof.test.ts __tests__/provider/provider-credits-actions.test.ts __tests__/integration/provider-credit-wallet-lead-monetisation.test.ts
Test Files 17 passed (17)
Tests 153 passed (153)

npm run lint
Passed with 0 errors and 1 existing warning in components/admin/crud/form.tsx.

npm run build
Passed, including TypeScript.
```

## 8. OpenBrain Update

OpenBrain was updated with the prior credits lifecycle audit. A final implementation log will be added after commit with:

- gaps found;
- fixes implemented;
- files changed;
- validation results;
- remaining risks;
- commit hash.

## 9. GitHub Commit

Branch: `fix/credits-flow-alignment`

Commit hash: final hash is reported in the chat response after the commit is created. A Git commit cannot contain its own final hash without changing that hash.
