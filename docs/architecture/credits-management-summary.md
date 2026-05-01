# Credits Management Summary

Date: 2026-04-30

Credits are implemented through a provider wallet and ledger model. `ProviderWallet` stores cached paid and promo balances for fast display and unlock gating. `WalletLedgerEntry` stores the movement history and balance-after snapshots. Core mutations are centralized in `field-service/lib/provider-wallet.ts`.

Current lifecycle:

1. Onboarding/mobile-verified promo credits are granted when a provider application is approved. The grant is idempotent through `ProviderPromoAward(providerId, awardType)`.
2. Providers buy credits through manual EFT or PayFast. A `PaymentIntent` is created first; wallet credits are issued only after admin reconciliation or verified PayFast ITN.
3. Lead unlock/accept deducts exactly 1 credit through `LeadUnlock` plus `LEAD_UNLOCK_DEBIT` ledger entries. Promo credits are consumed before paid credits.
4. Duplicate unlocks are guarded by `LeadUnlock.leadId @unique` and transaction recovery.
5. Lead unlock disputes can refund credits through `LEAD_REFUND_CREDIT`.
6. Admins can apply paid or promo adjustments with a required reason.

Top findings:

- The core top-up and lead-unlock paths are transactionally sound and ledger-backed.
- A lightweight reconciliation utility now checks wallet balance drift and missing ledger links, but it is not yet scheduled or surfaced in an admin exception dashboard.
- `WalletLedgerEntry.isTestTransaction` and `cohortName` are populated by wallet mutations for test grants, top-ups, and lead unlocks.
- `PAYMENT_REVERSAL` and `PROMO_EXPIRY` exist as schema/UI placeholders but are not implemented.
- Wallet suspend/reactivate ledger entries use `amountCredits = 0` and are supported by a conditional ledger amount constraint.

Recommendation: safe for controlled pilot with manual ops oversight and code-level reconciliation checks, not yet ready for unattended production finance operations until reconciliation is scheduled/surfaced and reversal/expiry policy is implemented.

Related files:

- `docs/architecture/credits-management-review.md`
- `docs/architecture/diagrams/credits-overview-flow.mmd`
- `docs/architecture/diagrams/credits-onboarding-grant-flow.mmd`
- `docs/architecture/diagrams/credits-topup-purchase-flow.mmd`
- `docs/architecture/diagrams/credits-deduction-unlock-flow.mmd`
- `docs/architecture/diagrams/credits-reconciliation-flow.mmd`
