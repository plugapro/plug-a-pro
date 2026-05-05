# Provider Credit Wallet and Paid Lead Unlock — Implementation Snapshot

**Date:** 2026-04-29
**Project:** Plug A Pro — field-service
**Status:** Implemented pilot and hardening snapshot
**Related plan:** `../plans/2026-04-29-provider-credit-wallet-paid-lead-unlock.md`
**Related historical map:** `2026-04-29-provider-credit-wallet-paid-lead-unlock-map.md`

This snapshot records what shipped. It is the concise OpenBrain-compatible source for current model names, routes, role choices, and safety boundaries.

---

## Shipped Surface

Provider routes:

- `/provider/credits`
- `/provider/leads/[leadId]`
- `/leads/access/[token]`

Admin routes:

- `/admin/provider-wallets`
- `/admin/provider-wallets/[providerId]`
- `/admin/provider-credit-payments`
- `/admin/provider-credit-payments/[id]`
- `/admin/lead-unlock-disputes`

API routes:

- `POST /api/provider/wallet/top-up-intents`
- `PATCH /api/provider/wallet/top-up-intents/[id]/proof`
- `GET /api/admin/provider-credit-payments/[id]/proof`

---

## Canonical Modules

- `lib/provider-wallet.ts`: wallet mutation/read seam.
- `lib/provider-credit-payment-intents.ts`: manual EFT top-up intent creation.
- `lib/provider-credit-reconciliation.ts`: admin EFT match/credit flow.
- `lib/lead-unlocks.ts`: paid lead unlock and wallet debit flow.
- `lib/lead-unlock-disputes.ts`: provider dispute and admin refund flow.
- `lib/provider-promo-awards.ts`: promo milestone award flow.
- `lib/provider-lead-detail.ts`: authenticated provider lead detail query seam.
- `lib/provider-lead-access.ts`: signed WhatsApp lead token query seam.
- `lib/provider-wallet-notifications.ts`: provider wallet/lead notification delivery.
- `lib/storage.ts`: private proof-of-payment Blob upload and retrieval.

---

## Schema Snapshot

Core models:

- `ProviderWallet`
- `WalletLedgerEntry`
- `PaymentIntent`
- `LeadUnlock`
- `LeadUnlockDispute`
- `ProviderPromoAward`

Core enum values:

```text
WalletLedgerEntryType:
TOPUP_CREDIT
PROMO_CREDIT
LEAD_UNLOCK_DEBIT
LEAD_REFUND_CREDIT
ADMIN_ADJUSTMENT
WALLET_SUSPENDED
WALLET_REACTIVATED
PROMO_EXPIRY
PAYMENT_REVERSAL

PaymentIntentStatus:
CREATED
PENDING_PAYMENT
PROOF_UPLOADED
MATCHED_ON_STATEMENT
CREDITED
FAILED
EXPIRED
REVERSED

ProviderPromoAwardStatus:
AWARDED
REVOKED
```

Notable implementation choices:

- Wallet balances are integer credits.
- `paidCreditBalance` and `promoCreditBalance` are separate cached balances.
- `WalletLedgerEntry` rows carry `amountCredits`, balance snapshots, `referenceType`, `referenceId`, metadata, and optional `createdBy`.
- `PaymentIntent` is shared for provider credit top-ups rather than using a separate wallet intent model.
- `LeadUnlock` is unique by `leadId`.

---

## Business Rules

- 1 credit = R20.
- Minimum manual EFT top-up = R100.
- Lead unlock cost = 1 credit.
- Provider top-up intents do not mutate wallets.
- Admin payment crediting mutates wallets only after reconciliation.
- Promo credits are spent before paid credits on lead unlock.
- KYC must be `VERIFIED` before unlock.
- Duplicate crediting and duplicate lead unlocks are idempotent.
- Refunds restore original paid/promo debit split where ledger evidence exists.

Promo rewards:

- `MOBILE_VERIFIED`: 3 credits.
- `PROFILE_COMPLETED`: 2 credits.
- `KYC_APPROVED`: 5 credits.
- `FIRST_TOPUP`: 2 credits.
- `FIRST_COMPLETED_JOB`: 3 credits.
- Pre-payment promo cap: 10 credits across mobile, profile, and KYC milestones.

---

## Access Control

- Admin mutations run through `crudAction()`.
- `crudAction()` checks DB-backed `AdminUser`, feature flags where configured, Zod input, and writes both audit tables atomically.
- Manual EFT reconciliation allows `OPS`, `FINANCE`, `ADMIN`, and `OWNER`, with `TRUST` explicitly excluded.
- Wallet management uses `OPS` as the hierarchy floor, so every active admin role can manage wallets under the current model.
- Lead unlock dispute review includes `TRUST`.

---

## Data Safety

- Provider lead preview is gated at the data access layer.
- Locked PWA and token lead details do not fetch or return customer name, phone, exact address, or attachments.
- Full customer details are queried only after an unlock exists.
- Provider proof uploads are stored as private Blob objects.
- Admin proof access goes through an authenticated proxy route.
- Manual EFT bank details must be configured through `PROVIDER_CREDIT_EFT_*`; placeholder strings are not sent.

---

## Accounting and Audit

- All wallet balance mutations go through `lib/provider-wallet.ts`.
- Wallet top-ups, promo awards, lead unlock debits, dispute refunds, admin adjustments, wallet suspension, and wallet reactivation write ledger rows.
- Suspension/reactivation ledger rows are zero-credit status events.
- `AuditLog` and `AdminAuditEvent` are written atomically for admin mutations.
- `ProviderPromoAward` and `LeadUnlockDispute` provide event-specific operational records.

---

## Notification Snapshot

- Provider wallet/lead notifications use WhatsApp templates through `sendTemplate()`.
- Provider templates are defined in `lib/messaging-templates.ts`.
- Notification idempotency uses `MessageEvent.metadata.idempotencyKey`.
- Dispatch sends use `MessageEvent` preflight checks to avoid duplicate provider messages on retry.
- WhatsApp delivery failures are caught post-commit and do not roll back wallet/payment/unlock transactions.

---

## Verification Snapshot

Commands:

```bash
pnpm test
npx tsc --noEmit --pretty false
pnpm lint
npx prisma validate
git diff --check
```

Latest result from the validation series:

- 90 Vitest files passed, 1 skipped.
- 757 tests passed, 4 todo.
- TypeScript passed.
- Prisma schema validation passed.
- ESLint passed with the existing React Hook Form warning in `components/admin/crud/form.tsx`.
- Diff whitespace check passed.

---

## Known Follow-Ups

- Automated bank reconciliation.
- Gateway top-ups beyond manual EFT.
- Dynamic lead pricing.
- Promo expiry cron.
- Wallet status WhatsApp notifications.
- Provider operational WhatsApp opt-out policy/schema.
- Ledger-vs-cache reconciliation job.
