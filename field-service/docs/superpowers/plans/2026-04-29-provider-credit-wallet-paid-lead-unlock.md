# Provider Credit Wallet and Paid Lead Unlock — Implementation Plan

> **For agentic workers:** This plan is the implementation-grade reference for the shipped provider credit wallet pilot. The earlier spec in `../specs/2026-04-29-provider-credit-wallet-paid-lead-unlock-map.md` preserves planning history; its sections 7-10 are superseded by this plan and the implementation snapshot.

**Goal:** Operate Plug-A-Pro Credits as the provider-facing paid-lead currency, with manual EFT top-ups, admin reconciliation, promo rewards, paid lead unlocks, refunds/disputes, notification hooks, and preview-safe lead access.

**Architecture:** Wallet balance changes are centralized in `lib/provider-wallet.ts`. Money-moving admin actions use `crudAction()` for DB-backed role checks and atomic dual audit rows. Provider lead unlocks debit credits and create `LeadUnlock` records in one transaction. Manual EFT provider top-ups are represented by `PaymentIntent` rows and only credit wallets after admin reconciliation. Lead preview data is gated at the query layer before unlock.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Supabase Auth, Vercel Blob for proof uploads, WhatsApp Cloud API templates, Vitest.

---

## File Map

| File | Role |
|---|---|
| `prisma/schema.prisma` | Canonical models/enums for `ProviderWallet`, `WalletLedgerEntry`, `PaymentIntent`, `LeadUnlock`, `LeadUnlockDispute`, `ProviderPromoAward` |
| `lib/provider-wallet.ts` | Wallet creation, balance reads, ledger reads, credit/debit/refund/admin adjustment/status mutations |
| `lib/provider-credit-payment-intents.ts` | Manual EFT top-up intent creation, reference generation, EFT bank instruction validation |
| `lib/provider-credit-reconciliation.ts` | Admin statement matching and paid wallet crediting |
| `lib/lead-unlocks.ts` | KYC gate, lead unlock idempotency, wallet debit transaction |
| `lib/lead-unlock-disputes.ts` | Provider dispute creation and admin approve/reject refund handling |
| `lib/provider-promo-awards.ts` | Promo milestone award rules and idempotent wallet promo credits |
| `lib/provider-lead-detail.ts` | Authenticated provider PWA lead preview/full-detail data seam |
| `lib/provider-lead-access.ts` | Signed WhatsApp lead token data seam and attachment scope checks |
| `lib/provider-wallet-notifications.ts` | Provider wallet and lead WhatsApp template notifications |
| `lib/messaging-templates.ts` | Customer and provider WhatsApp template inventory |
| `app/(provider)/provider/credits/*` | Provider wallet summary, ledger, and top-up entry point |
| `app/(provider)/provider/leads/[leadId]/page.tsx` | Authenticated lead preview/unlock/detail UI |
| `app/leads/access/[token]/page.tsx` | Signed WhatsApp lead preview/unlock/detail UI |
| `app/(admin)/admin/provider-credit-payments/*` | Admin manual EFT reconciliation UI/actions |
| `app/(admin)/admin/provider-wallets/*` | Admin provider wallet management UI/actions |
| `app/(admin)/admin/lead-unlock-disputes/*` | Admin lead unlock dispute review UI/actions |
| `app/api/provider/wallet/top-up-intents/[id]/proof/route.ts` | Provider proof upload route |
| `app/api/admin/provider-credit-payments/[id]/proof/route.ts` | Authenticated admin private-proof proxy |

---

## Canonical Business Rules

- 1 Plug-A-Pro Credit = R50 via `PLUG_A_PRO_CREDIT_VALUE_CENTS = 5_000`.
- Minimum manual EFT top-up is R100 via `MIN_PROVIDER_CREDIT_TOPUP_CENTS = 10_000`.
- Lead unlock cost is fixed at 1 credit via `LEAD_UNLOCK_COST_CREDITS = 1`.
- Manual EFT intent creation never credits the wallet.
- Wallet paid and promo balances are integer credit counts, not Rand values.
- Wallet ledger rows are the accounting source of truth; cached balances exist for fast reads/gating.
- Promo credits are consumed before paid credits during lead unlock debits.
- Providers must have `Provider.kycStatus === 'VERIFIED'` before unlocking full customer details.
- Lead preview must not expose customer name, customer phone, exact address, or attachments before unlock.
- Duplicate unlock attempts reuse the existing `LeadUnlock` without a second debit.
- Approved unlock disputes restore the original paid/promo debit split where possible.

---

## Canonical Schema Decisions

Actual model names:

- `ProviderWallet`
- `WalletLedgerEntry`
- `PaymentIntent`
- `LeadUnlock`
- `LeadUnlockDispute`
- `ProviderPromoAward`

Actual wallet ledger entry types:

- `TOPUP_CREDIT`
- `PROMO_CREDIT`
- `LEAD_UNLOCK_DEBIT`
- `LEAD_REFUND_CREDIT`
- `ADMIN_ADJUSTMENT`
- `WALLET_SUSPENDED`
- `WALLET_REACTIVATED`
- `PROMO_EXPIRY`
- `PAYMENT_REVERSAL`

Actual payment intent statuses:

- `CREATED`
- `PENDING_PAYMENT`
- `PROOF_UPLOADED`
- `MATCHED_ON_STATEMENT`
- `CREDITED`
- `FAILED`
- `EXPIRED`
- `REVERSED`

Actual promo award statuses:

- `AWARDED`
- `REVOKED`

Intentional divergences from the original proposal:

- `PaymentIntent` is reused for provider wallet top-up requests rather than creating `ProviderWalletPaymentIntent`.
- Wallet balances use `paidCreditBalance` and `promoCreditBalance` integer credit counts.
- Ledger rows use `referenceType`/`referenceId` rather than `relatedEntityType`/`relatedEntityId`.
- `LeadUnlock` is unique by `leadId`, preventing multiple providers from unlocking the same lead after assignment.
- Admin adjustment credit and debit share `ADMIN_ADJUSTMENT`; sign is represented by `amountCredits`.

---

## Role and Audit Decisions

- `crudAction()` is the admin mutation wrapper for wallet, payment, and dispute mutations.
- `crudAction()` writes `AuditLog` and `AdminAuditEvent` inside the same transaction as the mutation.
- Manual EFT reconciliation uses `RECONCILE_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER']` with `excludedRole: ['TRUST']`.
- Wallet management uses `MANAGE_WALLET_ROLES = ['OPS']`, which currently means every active admin role qualifies under the hierarchy model.
- Lead unlock dispute review uses `DISPUTE_ROLES = ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER']`.
- Suspension/reactivation create zero-credit wallet ledger entries and are also audited by `crudAction()`.

---

## Security and Data Safety

- Provider wallet reads resolve `Provider.id` server-side from the authenticated provider session.
- Signed lead token access is bound to `leadId + providerId` and checked with HMAC.
- Both provider lead access seams use two-stage data loading:
  - pre-unlock: preview-safe fields only, truncated description, suburb/city, no customer, no attachments;
  - post-unlock: customer name/phone, full address, and attachments.
- Attachment access through lead tokens is blocked until the lead is unlocked.
- Proof-of-payment uploads use private Vercel Blob storage.
- Admin proof access is proxied through an authenticated route; raw private Blob URLs are not rendered to admins/providers.
- WhatsApp sends are post-commit/fire-and-forget and must not roll back wallet/payment/unlock transactions.

---

## Notification Decisions

- Provider wallet/lead lifecycle notifications use approved-template sends through `sendTemplate()`.
- Provider template entries live in `lib/messaging-templates.ts`.
- Wallet/lead sends use event-level idempotency keys in `MessageEvent.metadata.idempotencyKey`.
- Dispatch CTA/action sends preflight successful `MessageEvent` rows by recipient/template/jobRequestId before sending.
- Manual EFT bank details are required configuration; missing `PROVIDER_CREDIT_EFT_*` values fail before intent creation or notification rendering.

---

## Verification

Last full verification in this remediation series:

```bash
pnpm test
npx tsc --noEmit --pretty false
pnpm lint
npx prisma validate
git diff --check
```

Observed result:

- Vitest: 90 passed, 1 skipped; 757 tests passed, 4 todo.
- TypeScript: passed.
- ESLint: passed with the existing React Hook Form compiler warning in `components/admin/crud/form.tsx`.
- Prisma schema validation: passed.
- Diff whitespace check: passed.

---

## Follow-Up Backlog

- Automated bank statement ingestion and reference/amount matching.
- Payment gateway integration for non-manual top-ups.
- Dynamic lead pricing by category, area, urgency, quality, or subscription tier.
- Scheduled promo credit expiry job using `PROMO_EXPIRY`.
- Wallet suspension/reactivation provider notifications.
- Ledger reconciliation job comparing cached balances with ledger totals.
- Optional provider service opt-out model for operational WhatsApp sends.
