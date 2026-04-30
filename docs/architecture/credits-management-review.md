# Credits Management Review

Date: 2026-04-30  
Scope: Plug A Pro / ServiceMen provider credit wallet, promo grants, top-ups, lead unlock debits, refunds, adjustments, reconciliation, and diagrams  
Mode: Source-code audit and architecture review, updated after focused lifecycle alignment remediation.

## 1. Executive Summary

The credits implementation is materially present and stronger than a shallow balance counter. The code has a dedicated wallet module, immutable ledger rows, paid versus promo credit separation, transaction-scoped payment crediting, transaction-scoped lead unlock debits, idempotency guards for duplicate grants/top-ups/unlocks, and provider/admin views over wallet history.

Current design is **robust in the core debit and top-up transaction paths**, and now has a lightweight code-level reconciliation utility. It remains **partial for automated/scheduled reconciliation, reversals, promo expiry, and operational recovery**.

Top risks:

- P1: A lightweight reconciliation utility exists, but no scheduled finance reconciliation job or admin exception dashboard was found.
- P1: Test activity is now flagged on wallet ledger entries, but test and live balances still share the same provider wallet buckets.
- P1: Payment reversal and promo expiry are schema/UI placeholders only. `PAYMENT_REVERSAL` and `PROMO_EXPIRY` are not wired to business flows.
- P2: Wallet suspend/reactivate are now allowed as zero-credit ledger events by migration, but those operational events still share the main wallet ledger table.
- P1: Provider wallet balances are cached and trusted for gating; ledger entries contain balance snapshots, but there is no repair/recompute command if cached balances drift.

No P0 production-money issue was found in the audited core top-up and lead-unlock path. The pilot-critical invariant, "one lead unlock costs exactly 1 credit and duplicate unlocks do not double-deduct," is enforced by `LeadUnlock.leadId @unique`, transaction boundaries, and wallet optimistic updates.

## 2. Scope and Method

Documentation reviewed:

- `README.md`
- `field-service/README.md`
- `docs/provider-whatsapp-pwa-journey.mmd`
- `docs/architecture/provider-flow-codebase-alignment-audit.md`
- `field-service/docs/superpowers/specs/2026-04-29-provider-wallet-ledger.md`
- `field-service/docs/superpowers/specs/2026-04-29-provider-wallet-topup-flow.md`
- `field-service/docs/superpowers/specs/2026-04-29-provider-credit-wallet-paid-lead-unlock-implementation-snapshot.md`
- `field-service/docs/superpowers/specs/2026-04-29-provider-credit-wallet-paid-lead-unlock-map.md`

Code reviewed:

- Schema and migrations: `field-service/prisma/schema.prisma`, `field-service/prisma/migrations/20260429120000_provider_credit_wallet_ledger/migration.sql`, `20260429123000_provider_credit_payment_intents`, `20260429130000_paid_lead_unlocks`, `20260429133000_provider_promo_awards`, `20260429140000_lead_unlock_disputes`, `20260429143000_wallet_status_ledger_entries`, `20260429150000_payfast_gateway_payment_intents`
- Wallet module: `field-service/lib/provider-wallet.ts`
- Promo awards: `field-service/lib/provider-promo-awards.ts`, `field-service/lib/internal-test-cohort.ts`
- Top-up intent creation: `field-service/lib/provider-credit-payment-intents.ts`
- Manual reconciliation: `field-service/lib/provider-credit-reconciliation.ts`
- PayFast adapter and ITN crediting: `field-service/lib/payfast.ts`, `field-service/lib/provider-credit-gateway-itn.ts`, `field-service/app/api/webhooks/payfast/route.ts`
- Lead unlocks and assignment: `field-service/lib/lead-unlocks.ts`, `field-service/lib/matching/service.ts`, `field-service/lib/matching-engine.ts`
- Disputes/refunds: `field-service/lib/lead-unlock-disputes.ts`, `field-service/app/(admin)/admin/lead-unlock-disputes/actions.ts`
- Provider and admin UI/actions: `field-service/app/(provider)/provider/credits/actions.ts`, `field-service/app/(provider)/provider/credits/page.tsx`, `field-service/app/(admin)/admin/provider-credit-payments/actions.ts`, `field-service/app/(admin)/admin/provider-wallets/actions.ts`, admin wallet/payment pages
- API routes: `field-service/app/api/provider/wallet/top-up-intents/route.ts`, `field-service/app/api/provider/wallet/top-up-intents/[id]/proof/route.ts`
- Notifications: `field-service/lib/provider-wallet-notifications.ts`, `field-service/lib/post-match-communications.ts`
- Tests: wallet, promo awards, payment intents, reconciliation, PayFast, lead unlocks, disputes, admin actions, provider actions, integration monetisation tests

Method:

1. Read existing architecture and wallet notes.
2. Searched source for `credit`, `wallet`, `ledger`, `balance`, `unlock`, `topup`, `payment`, `payfast`, `transaction`, `grant`, `adjustment`, `refund`, and `reversal`.
3. Traced each lifecycle from UI/channel to service module to Prisma transaction and schema records.
4. Compared actual implementation to the business questions in the prompt.

## 3. Architecture Map

Current modules and responsibilities:

| Layer | Module / route | Responsibility |
|---|---|---|
| Domain wallet module | `lib/provider-wallet.ts` | Owns `ProviderWallet` balance mutations and `WalletLedgerEntry` creation. Provides paid credit, promo credit, debit, refund, admin adjustment, suspend, and reactivate functions. |
| Promo grant module | `lib/provider-promo-awards.ts` | Owns milestone promo awards and `ProviderPromoAward` idempotency. Calls wallet promo-credit mutation. |
| Top-up intent module | `lib/provider-credit-payment-intents.ts` | Creates manual EFT and PayFast `PaymentIntent` rows. Does not credit wallets. |
| Manual reconciliation module | `lib/provider-credit-reconciliation.ts` | Matches bank references and credits manual EFT or PayFast recovery intents. |
| PayFast adapter | `lib/payfast.ts` | Gateway-specific checkout and ITN verification. No wallet knowledge. |
| PayFast ITN wallet bridge | `lib/provider-credit-gateway-itn.ts` | Credits provider wallet after verified ITN. |
| PayFast webhook route | `app/api/webhooks/payfast/route.ts` | Parses/verifies ITN, stores gateway fields, delegates crediting. |
| Lead unlock module | `lib/lead-unlocks.ts` | Charges credits and creates `LeadUnlock`. |
| Matching accept module | `lib/matching/service.ts:acceptAssignmentOffer` | Calls lead unlock inside assignment transaction, then creates match and updates lead/request state. |
| Dispute/refund module | `lib/lead-unlock-disputes.ts` | Opens lead unlock disputes and refunds credits on approval. |
| Provider UI adapter | `app/(provider)/provider/credits/*` | Displays balance/ledger and creates top-up intents. |
| Admin adapters | `admin/provider-credit-payments`, `admin/provider-wallets`, `admin/lead-unlock-disputes` | Manual reconciliation, wallet adjustments, status changes, dispute approval/rejection. |

The deepest seam is `lib/provider-wallet.ts`: most balance mutation code is centralized there. The top-up and lead-unlock modules mostly act as business adapters around that seam.

## 4. Credits Domain Model

Core models:

- `ProviderWallet`: one wallet per provider, cached `paidCreditBalance`, cached `promoCreditBalance`, and `status`. Balances are materialized, not derived on every read.
- `WalletLedgerEntry`: immutable history row with `entryType`, `creditType`, `amountCredits`, balance-after snapshots, reference fields, metadata, and creator. This is the audit trail.
- `ProviderPromoAward`: milestone source of truth for promo awards. Unique on `(providerId, awardType)`.
- `PaymentIntent`: provider top-up intent. Represents expected or confirmed money for credits. Distinct from booking `Payment`.
- `LeadUnlock`: records that a provider unlocked a specific lead. Unique on `leadId`.
- `LeadUnlockDispute`: dispute and refund workflow for a lead unlock.

Important enums:

- `WalletLedgerEntryType`: `TOPUP_CREDIT`, `PROMO_CREDIT`, `LEAD_UNLOCK_DEBIT`, `LEAD_REFUND_CREDIT`, `ADMIN_ADJUSTMENT`, `WALLET_SUSPENDED`, `WALLET_REACTIVATED`, `PROMO_EXPIRY`, `PAYMENT_REVERSAL`
- `WalletCreditType`: `PAID`, `PROMO`
- `PaymentIntentStatus`: `CREATED`, `PENDING_PAYMENT`, `PROOF_UPLOADED`, `MATCHED_ON_STATEMENT`, `ITN_RECEIVED`, `CREDITED`, `CANCELLED`, `FAILED`, `EXPIRED`, `REVERSED`
- `LeadUnlockStatus`: `UNLOCKED`, `REFUNDED`, `DISPUTED`, `REVERSED`

Balance source of truth:

- Operational gating uses `ProviderWallet.paidCreditBalance + ProviderWallet.promoCreditBalance`.
- Ledger truth is `WalletLedgerEntry`, especially the balance-after snapshots.
- There is no recompute/repair module that replays ledger entries into wallet balances.

## 5. Credits Lifecycle Findings

### 5.1 Onboarding Credit Grant

Current flow:

1. Admin approves a provider application in `field-service/app/(admin)/admin/applications/page.tsx:approveApplication`, or system approval path runs in `field-service/app/api/cron/match-leads/route.ts`.
2. Provider record is synced as active/verified.
3. Application status is updated from `PENDING` to `APPROVED` with `updateMany`.
4. Only if the approval status update succeeds, code calls `awardMobileVerifiedPromoCreditsInTransaction`.
5. `field-service/lib/provider-promo-awards.ts` checks whether `(providerId, MOBILE_VERIFIED)` already exists.
6. It applies pre-payment promo cap rules.
7. It creates `ProviderPromoAward`.
8. It calls `creditPromoCreditsInTransaction` in `field-service/lib/provider-wallet.ts`.
9. Wallet promo balance increments and a `PROMO_CREDIT` ledger entry is created.

Files/modules involved:

- `field-service/app/(admin)/admin/applications/page.tsx:approveApplication`
- `field-service/app/api/cron/match-leads/route.ts`
- `field-service/lib/provider-promo-awards.ts:awardMobileVerifiedPromoCreditsInTransaction`
- `field-service/lib/provider-wallet.ts:creditPromoCreditsInTransaction`
- `field-service/lib/internal-test-cohort.ts`

Answers from code:

- Event that grants onboarding credits: provider application approval.
- Owner module: `provider-promo-awards.ts`, with balance mutation delegated to `provider-wallet.ts`.
- Idempotent: yes. `ProviderPromoAward` is unique on `(providerId, awardType)` and create uses `createMany(... skipDuplicates: true)`.
- Audit record: approval is wrapped by `crudAction`; wallet ledger entry is also created. `ProviderPromoAward` stores milestone reference.
- Approval dependency: yes. Grant is after successful pending-to-approved transition.
- Duplicate grant risk: low for the main approval path. Duplicate approval does not re-award because the application update guard fails and the promo award unique key blocks duplicates.

Gaps/risks:

- Existing implementation notes say first top-up grants 5 promo credits in one place, but code defines `FIRST_TOPUP: 2`. Docs are stale.
- `MOBILE_VERIFIED` is 3 credits by default, but internal test onboarding phones receive `INTERNAL_TEST_ONBOARDING_CREDITS = 10`. That is configurable only in code.
- Test grants are now marked with `WalletLedgerEntry.isTestTransaction` and `cohortName` when the provider belongs to the internal test cohort.

### 5.2 Purchase / Top-up Flow

Current flow:

Manual EFT:

1. Provider opens Worker Portal Credits page and chooses amount.
2. `app/(provider)/provider/credits/actions.ts:createProviderTopUpIntent` calls `createManualEftTopUpIntent`.
3. API alternative: `app/api/provider/wallet/top-up-intents/route.ts`.
4. `PaymentIntent` is created with `PENDING_PAYMENT`, method `MANUAL_EFT`, amount, credits, generated `PAP-*` reference, and expiry.
5. Provider uploads proof through `app/api/provider/wallet/top-up-intents/[id]/proof/route.ts`, moving status to `PROOF_UPLOADED`.
6. Admin matches bank statement in `admin/provider-credit-payments/actions.ts:reconcileTopUpIntentAction`, moving status to `MATCHED_ON_STATEMENT`.
7. Admin credits wallet via `creditTopUpIntentAction`, which calls `creditPaymentIntentInTransaction`.
8. The service marks the intent `CREDITED`, increments paid balance, creates `TOPUP_CREDIT`, and optionally creates first-top-up promo award.

PayFast:

1. Provider selects a supported PayFast package.
2. `createPayfastTopUpIntent` creates `PaymentIntent` with `PENDING_PAYMENT` and a `PF-*` reference.
3. PayFast checkout payload is built by `lib/payfast.ts`.
4. PayFast ITN arrives at `app/api/webhooks/payfast/route.ts`.
5. ITN route verifies IP, signature, `payment_status === COMPLETE`, intent existence, and amount.
6. Valid amount stores ITN fields and sets `ITN_RECEIVED`.
7. `creditProviderWalletFromGatewayItn` marks intent `CREDITED`, increments paid balance, creates `TOPUP_CREDIT`, stores `creditedLedgerEntryId`, and awards first-top-up promo if eligible.

Data changes:

- `PaymentIntent` created.
- `PaymentIntent` status progresses by rail.
- `ProviderWallet.paidCreditBalance` increments only after admin/manual reconciliation or verified PayFast ITN.
- `WalletLedgerEntry.TOPUP_CREDIT` is created with `referenceType = payment_intent`.
- First top-up can create `ProviderPromoAward` and `WalletLedgerEntry.PROMO_CREDIT`.

Gaps/risks:

- No automated expiry cleanup for old `PaymentIntent` rows.
- No payment reversal implementation. `PaymentIntentStatus.REVERSED` and `WalletLedgerEntryType.PAYMENT_REVERSAL` are placeholders.
- PayFast route catches unhandled crediting errors and returns HTTP 200. This is deliberate to prevent retry storms, but it requires ops monitoring for `ITN_RECEIVED` intents not credited.
- Manual proof upload returns clear JSON errors but does not include trace IDs.
- There is no rate limit found on top-up intent creation.

### 5.3 Balance Management

Current flow:

- `ProviderWallet` stores cached balances.
- `WalletLedgerEntry` stores every mutation with post-balance snapshots.
- `getProviderWalletBalance` reads cached balances.
- Provider statement uses `getProviderWalletLedgerEntries`.
- Admin wallet detail also reads wallet plus latest ledger rows.

Transaction types implemented:

- `PROMO_CREDIT`: implemented.
- `TOPUP_CREDIT`: implemented.
- `LEAD_UNLOCK_DEBIT`: implemented.
- `LEAD_REFUND_CREDIT`: implemented.
- `ADMIN_ADJUSTMENT`: implemented.
- `WALLET_SUSPENDED` / `WALLET_REACTIVATED`: attempted, but likely broken by positive amount DB check.
- `PROMO_EXPIRY`: enum/display only.
- `PAYMENT_REVERSAL`: enum/display only.

Concurrency:

- Lead debits and negative admin adjustments use optimistic `updateMany` balance guards.
- Payment crediting uses optimistic status locks on `PaymentIntent`.
- Promo awards use unique award rows.
- Lead unlocks use unique `LeadUnlock.leadId`.

Gaps/risks:

- Cached balance drift is possible if a future direct DB write or partial migration updates wallet without ledger. No recompute/repair command was found.
- The wallet module does not expose a `reconcileWalletBalance(providerId)` function.
- `WalletLedgerEntry` has indexed `referenceType/referenceId`, but no unique reference constraint. Idempotency depends on parent records, not ledger uniqueness.
- `amountCredits` positive check conflicts with zero-credit status-change ledger rows.

### 5.4 Deduction / Lead Unlock

Current flow:

1. WhatsApp quick accept calls `matching-engine.acceptLead`.
2. Signed PWA accept also calls `matching-engine.acceptLead`; signed PWA unlock-only calls `unlockLeadForProvider`.
3. `matching-engine.acceptLead` delegates to `matching/service.ts:acceptAssignmentOffer`.
4. `acceptAssignmentOffer` opens a Prisma transaction.
5. It validates lead ownership, active hold, expiry, provider approval, active status, and existing match.
6. It calls `unlockLeadForProviderInTransaction`.
7. `unlockLeadForProviderInTransaction` checks existing unlock, lead availability, provider active/verified/status, wallet balance, and wallet status.
8. It creates `LeadUnlock` before debit.
9. It calls `debitCreditsForLeadUnlockInTransaction`.
10. Wallet debit consumes promo first, then paid.
11. One or two `LEAD_UNLOCK_DEBIT` rows are created depending on credit split.
12. `LeadUnlock.creditTypeBreakdown` is updated.
13. The same transaction updates lead/hold/match/job request state.
14. Customer/provider notifications are sent after commit through `notifyPostMatchAcceptance`.

Files/modules involved:

- `field-service/lib/matching-engine.ts:acceptLead`
- `field-service/lib/matching/service.ts:acceptAssignmentOffer`
- `field-service/lib/lead-unlocks.ts:unlockLeadForProviderInTransaction`
- `field-service/lib/provider-wallet.ts:debitCreditsForLeadUnlockInTransaction`
- `field-service/lib/post-match-communications.ts`
- `field-service/app/leads/access/[token]/page.tsx`
- `field-service/lib/provider-lead-access.ts`

Answers from code:

- One deep backend module for wallet debit: yes, `provider-wallet.ts`.
- Unlock + assignment path: WhatsApp and PWA accept both use `matching-engine.acceptLead`. PWA also has an unlock-only action.
- Atomicity: credit debit, `LeadUnlock`, lead status, hold, match, audit, and request status are in one transaction for accept. If assignment fails, the transaction rolls back the debit.
- Ledger succeeds but assignment fails: transaction rollback should undo both.
- Assignment succeeds but notification fails: accept remains committed; error is logged, no durable retry outbox found.
- Decline: `matching-engine.declineLead` calls `rejectAssignmentOffer`; it does not call wallet code and does not debit credits.

Gaps/risks:

- PWA signed lead supports paid unlock-only inspection. That may be product-intentional, but differs from the approved "unlock and accept" language.
- Post-commit notifications are fire-and-forget/logged; no durable retry queue.
- Provider WhatsApp acceptance notification shows credit used, but not balance remaining. Signed PWA unlock success does show balance remaining.

### 5.5 Reversal / Refund / Adjustment

Implemented:

- Admin manual adjustment through `admin/provider-wallets/actions.ts:adjustProviderCreditsAction`.
- Adjustment requires reason and confirmation.
- Positive or negative paid/promo adjustments create `ADMIN_ADJUSTMENT` ledger rows.
- Negative adjustment cannot make a balance negative.
- Lead unlock dispute flow through `lead-unlock-disputes.ts`.
- Provider/admin can dispute a lead unlock.
- Admin approval marks `LeadUnlock` as `REFUNDED` and creates `LEAD_REFUND_CREDIT` rows.
- Refund attempts are guarded by status and `refundedAt`.
- Refund attempts restore original paid/promo split from debit ledger entries where available, otherwise fallback to promo.

Not implemented:

- Payment reversal after PayFast/bank refund.
- Promo credit expiry job.
- General reversal transaction for erroneous non-dispute deductions.
- Cash refund integration for provider credit purchases.

Gaps/risks:

- Payment reversal enum exists but no service writes `PAYMENT_REVERSAL`.
- `ProviderPromoAward.status = REVOKED` exists, but revocation flow was not found.
- Admin adjustments are powerful but generic; they can correct mistakes, but finance cannot distinguish a formal reversal from an arbitrary adjustment unless reason text is consistent.

### 5.6 Reconciliation

Current reconciliation is mostly manual and UI-driven:

- `admin/provider-credit-payments` supports matching manual EFT intents to bank statement references and crediting them.
- `admin/provider-wallets` shows wallet balances, ledger rows, payment intents, and lead unlocks for a provider.
- `admin/lead-unlock-disputes` supports refund decisions.
- Provider Credits page displays recent ledger entries.
- PayFast ITN stores gateway reference, ITN status, ITN amount, and PayFast credited ledger ID.

Missing:

- Automated report to reconcile `ProviderWallet` cached balances against ledger replay/latest snapshot.
- Automated report to reconcile all `CREDITED` payment intents against `TOPUP_CREDIT` ledger rows.
- Automated report to reconcile all `LeadUnlock` rows against `LEAD_UNLOCK_DEBIT` rows.
- Automated report to reconcile all `ProviderPromoAward` rows against `PROMO_CREDIT` rows.
- Orphan detection for ledger rows with missing reference records.
- Test/live balance isolation report.

## 6. Mermaid Journey Diagrams

Diagram source files:

- `docs/architecture/diagrams/credits-overview-flow.mmd`
- `docs/architecture/diagrams/credits-onboarding-grant-flow.mmd`
- `docs/architecture/diagrams/credits-topup-purchase-flow.mmd`
- `docs/architecture/diagrams/credits-deduction-unlock-flow.mmd`
- `docs/architecture/diagrams/credits-reconciliation-flow.mmd`

Rendered SVG files:

- `docs/architecture/diagrams/credits-overview-flow.svg`
- `docs/architecture/diagrams/credits-onboarding-grant-flow.svg`
- `docs/architecture/diagrams/credits-topup-purchase-flow.svg`
- `docs/architecture/diagrams/credits-deduction-unlock-flow.svg`
- `docs/architecture/diagrams/credits-reconciliation-flow.svg`

The diagrams model current-state behavior, including known placeholders and failure paths.

## 7. Reconciliation Review

Onboarding grants:

- Reconcile `ProviderApplication.status = APPROVED` with `ProviderPromoAward(MOBILE_VERIFIED)` and `WalletLedgerEntry(PROMO_CREDIT, referenceType=provider_promo_award)`.
- Current state supports this through `field-service/lib/provider-credit-reconciliation-report.ts`, plus manual querying/admin pages. It is not yet scheduled or surfaced as an admin exception dashboard.

Top-up purchases:

- Reconcile `PaymentIntent.status = CREDITED`, `creditedAt`, `creditedLedgerEntryId` where present, and `WalletLedgerEntry(TOPUP_CREDIT, referenceType=payment_intent, referenceId=intent.id)`.
- Manual EFT also reconciles `bankStatementReference`; PayFast reconciles `gatewayReference`, `itnAmountCents`, and `itnPaymentStatus`.

Credit deductions:

- Reconcile `LeadUnlock` to `WalletLedgerEntry(LEAD_UNLOCK_DEBIT, referenceId=leadUnlock.id)`.
- Reconcile `LeadUnlock.creditTypeBreakdown` to debit ledger split.
- Current code creates both in the same transaction.

Refunds:

- Reconcile `LeadUnlock.status = REFUNDED`, `LeadUnlockDispute.status = APPROVED`, and `WalletLedgerEntry(LEAD_REFUND_CREDIT, referenceType=lead_unlock_dispute)`.

Final balances:

- Reconcile `ProviderWallet.paidCreditBalance/promoCreditBalance` to latest ledger snapshot or replay.
- Current system displays balances and ledger, but no repair job or automated exception report was found.

Could finance/ops prove why a provider has a given balance? Yes with direct queries and admin wallet pages for most cases.  
Could support explain every movement? Mostly yes for implemented entry types.  
Could the system identify orphan/duplicate records automatically? Not currently.  
Could it produce a provider credit statement? Yes for recent ledger entries through existing provider/admin UI, but not a full export/report found.

## 8. Error Handling and Observability Review

Strong areas:

- Wallet domain errors have stable codes: `INVALID_AMOUNT`, `INVALID_REFERENCE`, `INVALID_REASON`, `INSUFFICIENT_FUNDS`, `WALLET_NOT_ACTIVE`, `CONCURRENT_MUTATION`.
- Lead unlock errors have stable codes: `INSUFFICIENT_CREDITS`, `WALLET_SUSPENDED`, `CONCURRENT_UNLOCK`, `PROVIDER_NOT_APPROVED`, and others.
- `lead-unlocks.ts` logs unlock attempt and commit with provider ID, lead ID, source, balance, result, and trace ID.
- PayFast ITN logs invalid signatures, unknown intents, duplicate ITNs, terminal statuses, amount mismatch, and successful wallet credit.
- Admin actions use `crudAction`, `AUDIT_ENTITY`, reason fields, and role/flag checks.
- PWA signed lead page maps unlock/accept errors to structured user-facing states.

Weak areas:

- PayFast ITN logs do not use a generated request trace ID.
- Provider top-up intent API returns structured `code` for service errors, but generic failures have no trace ID.
- Manual proof upload failures have no trace ID.
- Reconciliation mismatches are not proactively logged because no reconciliation job exists.
- Notification failures are logged but not durable/retryable.
- Wallet suspend/reactivate may fail at DB constraint level; error surface would be generic admin failure unless captured.

Known failure handling:

| Failure | Current handling | Gap |
|---|---|---|
| Insufficient credits | Blocks unlock with `INSUFFICIENT_CREDITS`; PWA/WhatsApp show top-up guidance. | WhatsApp trace/code consistency remains weaker than PWA. |
| Duplicate unlock | `LeadUnlock.leadId` unique and P2002 recovery return already unlocked. | Good. |
| Duplicate payment callback | PayFast ignores already credited intents and uses transaction lock. | Good. |
| Duplicate approval grant | Promo award unique key and approval status guard. | Good. |
| Ledger write failure during accept | Transaction rollback prevents assignment commit. | Good. |
| Assignment notification failure | Logged after commit. | No durable retry. |
| Payment confirmation mismatch | PayFast amount mismatch marks intent `FAILED`; manual amount mismatch throws `AMOUNT_MISMATCH`. | Good, but no trace ID. |
| Balance drift | No active detector. | Needs reconciliation job. |
| Manual adjustment failure | Admin action maps wallet errors to conflict/validation. | Good, but form redirect loses detail. |

## 9. Test Coverage Review

Existing relevant tests:

- `field-service/__tests__/lib/provider-wallet.test.ts`
- `field-service/__tests__/lib/provider-promo-awards.test.ts`
- `field-service/__tests__/lib/provider-credit-payment-intents.test.ts`
- `field-service/__tests__/lib/provider-credit-reconciliation.test.ts`
- `field-service/__tests__/lib/provider-credit-gateway-itn.test.ts`
- `field-service/__tests__/lib/payfast.test.ts`
- `field-service/__tests__/lib/lead-unlocks.test.ts`
- `field-service/__tests__/lib/lead-unlock-disputes.test.ts`
- `field-service/__tests__/admin/provider-wallets-actions.test.ts`
- `field-service/__tests__/admin/provider-credit-payments-actions.test.ts`
- `field-service/__tests__/admin/lead-unlock-disputes-actions.test.ts`
- `field-service/__tests__/api/payfast-webhook.test.ts`
- `field-service/__tests__/api/provider-credit-top-up-intents.test.ts`
- `field-service/__tests__/api/provider-credit-payment-proof.test.ts`
- `field-service/__tests__/provider/provider-credits-actions.test.ts`
- `field-service/__tests__/integration/provider-credit-wallet-lead-monetisation.test.ts`

Coverage appears strong for:

- Paid and promo credit writes.
- Promo-first debit behavior.
- Duplicate unlock no double charge.
- Insufficient credits.
- PayFast duplicate ITN idempotency.
- Manual reconciliation idempotency.
- Promo award uniqueness and pre-payment cap.
- Lead unlock dispute refunds.
- Provider/admin wallet actions.

Missing or weak tests:

- Full database migration smoke test for `WALLET_SUSPENDED`, `WALLET_REACTIVATED`, and negative `ADMIN_ADJUSTMENT` entries against the conditional ledger amount check.
- Payment reversal / `PAYMENT_REVERSAL` behavior.
- Promo expiry / `PROMO_EXPIRY` behavior.
- Provider credit statement export from full ledger history.
- PayFast ITN unhandled crediting error leaves recoverable `ITN_RECEIVED` and admin credit path succeeds.
- Duplicate application approval plus promo award under actual DB uniqueness constraints.
- Top-up intent creation rate limit or duplicate spam controls.

## 10. Architecture Gaps and Risks

P0 production/data/money risks:

- No confirmed P0 in the core audited path.

P1 business-flow risks:

- No scheduled reconciliation job, admin exception dashboard, or repair command.
- Test cohort wallet activity is flagged in ledger rows, but not separated into different balance buckets.
- Payment reversal and promo expiry are placeholders, not implemented flows.
- Wallet status-change ledger entries are supported by a conditional amount constraint.
- PWA signed lead has an unlock-only path that can spend credit without accepting.

P2 observability/support risks:

- Trace IDs are inconsistent across PayFast ITN, top-up API, proof upload, admin redirects, and notification failures.
- Notification failures are not durable/retryable.
- Existing implementation docs are stale in places, especially first-top-up promo quantity.
- Admin form redirects hide specific failure details.

P3 cleanup opportunities:

- Consolidate current and legacy docs around one credits source of truth.
- Add full-statement export for providers/admins.
- Add typed reference constants for ledger `referenceType`.
- Add admin/finance filters around `isTestTransaction` and `cohortName`.

## 11. Deepening Opportunities

### Credit Reconciliation Service

- Problem: Reconciliation is manual and scattered across pages.
- Modules involved: `provider-wallet.ts`, `provider-credit-reconciliation.ts`, `lead-unlocks.ts`, `lead-unlock-disputes.ts`, admin reports.
- Current shape: `lib/provider-credit-reconciliation-report.ts` provides a reusable report module, but it is not yet scheduled or surfaced in an admin exception dashboard.
- Suggested direction: wire the report into admin/ops and scheduled checks, then add repair tooling only after recurring mismatch classes are understood.
- Expected leverage: finance and support can prove balances quickly.
- Locality improvement: reconciliation logic moves from ad hoc queries to one module.
- Effort: medium.
- Priority: P1.

### Wallet Balance Replay / Repair

- Problem: cached balance is trusted but not repairable.
- Modules involved: `provider-wallet.ts`, admin wallet page.
- Suggested direction: implement read-only replay first, then guarded admin repair action.
- Expected leverage: fast drift detection and safe recovery.
- Effort: medium.
- Priority: P1.

### Test Cohort Credit Isolation

- Problem: wallet mutations now set test fields, but reporting still needs to exclude or segment test activity.
- Modules involved: `provider-wallet.ts`, `provider-promo-awards.ts`, `lead-unlocks.ts`, `provider-credit-reconciliation.ts`.
- Suggested direction: add finance reports that filter by `isTestTransaction` and `cohortName`, and consider separate balance buckets only if finance requires hard separation.
- Expected leverage: cleaner live/test finance reporting.
- Effort: small to medium.
- Priority: P1.

### Payment Reversal Module

- Problem: reversal is an enum/display placeholder.
- Modules involved: `provider-credit-reconciliation.ts`, PayFast/admin payments, `provider-wallet.ts`.
- Suggested direction: explicit `reverseCreditedPaymentIntentInTransaction` that writes `PAYMENT_REVERSAL`, never goes negative, and records admin/payment reference.
- Expected leverage: safe correction of chargebacks/refunds.
- Effort: medium.
- Priority: P1.

### Ledger Reference Contract

- Problem: ledger references are free-form strings.
- Modules involved: all wallet callers.
- Suggested direction: typed reference constants and optional unique idempotency keys per business source.
- Expected leverage: fewer orphan-reference bugs and easier reconciliation queries.
- Effort: small.
- Priority: P2.

### Durable Credit Notification Outbox

- Problem: credit and acceptance notifications are fire-and-forget.
- Modules involved: `provider-wallet-notifications.ts`, `message-events.ts`, top-up and unlock services.
- Suggested direction: durable pending notification records with idempotent send workers.
- Expected leverage: fewer support escalations after payment/unlock commits.
- Effort: medium.
- Priority: P2.

## 12. Recommended Next Actions

1. Wire the read-only provider credit reconciliation report into an admin exception dashboard or scheduled ops job.
2. Add a guarded wallet balance repair path after reconciliation exceptions are visible.
3. Add finance reporting filters for test cohort ledger activity.
4. Implement payment reversal and promo expiry explicitly, or remove them from provider-facing labels until available.
5. Add full database migration smoke tests for wallet ledger amount constraints.
6. Add trace IDs to top-up APIs, PayFast ITN handling, proof upload, and admin error redirects.
7. Decide whether PWA unlock-only is commercial policy or whether PWA must be unlock-and-accept only.
8. Update stale wallet implementation notes to match current code values, especially `FIRST_TOPUP: 2`.

## 13. Open Questions

- Should onboarding/mobile-verified credits remain 3 by default and 10 for specific test phones?
- Should test cohort credits be completely separate from live wallet balances, or only flagged in ledger/reporting?
- Should providers be able to spend a credit to unlock details without accepting the lead?
- What is the formal finance policy for PayFast refunds or bank reversals after credits have been spent?
- Should promo credits expire? If yes, after what period and with what notification?
- Should admin adjustments be enough for all correction cases, or should formal reversal/refund flows be mandatory?
- Should PayFast ITN failures return HTTP 200 forever, or should critical failures enqueue retry work internally?
- Which role should own wallet reconciliation: Ops, Finance, Admin, or Owner?

## 14. Final Recommendation

The current credits implementation is safe enough for a controlled pilot of paid lead unlocks, provided operations monitors top-up intents, wallet balances, and lead unlock disputes manually.

It is not yet complete enough for unattended production finance operations. Before broader production rollout, implement automated reconciliation, fix the wallet status ledger constraint mismatch, wire test transaction metadata, and decide/implement the reversal and promo expiry policies.
