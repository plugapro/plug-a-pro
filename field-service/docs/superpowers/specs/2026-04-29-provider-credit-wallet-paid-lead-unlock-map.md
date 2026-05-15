# Provider Credit Wallet and Paid Lead Unlock Implementation Map

**Date:** 2026-04-29
**Project:** Plug A Pro — field-service
**Status:** Implemented pilot with post-implementation addenda
**Scope:** Provider credit wallet, manual EFT top-up flow, paid lead unlocks, promo credits, refunds/disputes, WhatsApp notifications, and provider/admin UI sequencing.

This note began as an OpenBrain implementation map and now also contains post-implementation addenda. Sections 1-13 preserve the original planning context; where they conflict with shipped code, the implementation snapshot and addenda are canonical.

Canonical implementation references:

- Plan: `docs/superpowers/plans/2026-04-29-provider-credit-wallet-paid-lead-unlock.md`
- Snapshot: `docs/superpowers/specs/2026-04-29-provider-credit-wallet-paid-lead-unlock-implementation-snapshot.md`
- Accurate addenda in this file: sections 17-22.

Reader note: sections 7-10 are pre-implementation proposals and are intentionally retained for history. They are not the final Prisma schema, service map, route map, or PR sequence.

---

## 1. Current Technical Baseline

### 2026-04-29 wallet ledger foundation addendum

The provider credit wallet foundation has been added without UI or lead-unlock integration:

- `prisma/schema.prisma` adds `ProviderWallet`, `WalletLedgerEntry`, and wallet enums.
- `prisma/migrations/20260429120000_provider_credit_wallet_ledger/migration.sql` creates the wallet tables, enum types, foreign keys, indexes, and non-negative balance checks.
- `lib/provider-wallet.ts` centralizes wallet mutations behind transactional service methods.
- `__tests__/lib/provider-wallet.test.ts` covers wallet creation, balance reads, paid credits, promo credits, promo-first debits, split debits, insufficient funds, and refunds.

Reserved balances remain intentionally out of scope until unlocks need hold-and-capture behavior.

### 2026-04-29 manual EFT payment intent addendum

Provider credit top-up intents now exist as a separate finance record from booking payments:

- `PaymentIntent` tracks provider top-up requests, credits to issue, method/status, unique EFT reference, proof/payment reconciliation fields, and gateway placeholders.
- Manual EFT top-up creation validates R100 minimums and R50-per-credit divisibility.
- Intent creation returns bank instruction data and starts in `PENDING_PAYMENT`.
- Intent creation does not call wallet mutation functions; wallet credits remain reserved for admin/system reconciliation after funds are confirmed.
- Provider entry points are `app/api/provider/wallet/top-up-intents/route.ts` and `app/(provider)/provider/credits/actions.ts`.

### 2026-04-29 provider wallet UI addendum

The provider-facing wallet surface now exists at `/provider/credits`:

- Providers can view total, paid, promo, and estimated unlockable credits.
- Providers can start R100, R200, or R500 manual EFT top-up intents.
- The post-selection screen shows amount, credits, unique reference, expiry, and bank instruction config.
- Recent ledger activity is mapped into provider-safe labels and omits raw ledger metadata, createdBy, and admin-facing notes.
- All wallet reads and top-up intent creation resolve `Provider.id` from the authenticated provider session; the client never supplies `providerId`.

### 2026-04-29 admin manual EFT reconciliation addendum

Admin reconciliation for provider credit top-ups now exists at `/admin/provider-credit-payments`:

- Admin users can search payment intents by payment reference, provider cellphone, provider name, bank reference, amount, and status.
- The detail screen shows provider, amount, credits, payment reference, proof link, status timeline, notes, and wallet ledger references.
- Admin actions can mark an intent as matched on the bank statement, credit the wallet, mark failed, or add an admin note.
- Crediting is idempotent: `PaymentIntent.status` must still be creditable, `creditedAt` must be null, and the status update plus paid credit ledger entry share one database transaction.
- Crediting creates `WalletLedgerEntry` rows with `entryType=TOPUP_CREDIT`, `creditType=PAID`, and `referenceType=payment_intent`.
- Direct crediting requires either a bank statement reference or an admin note so every credit has a reconciliation trail.

### App structure

The active product app is `field-service`.

Key stack:

- Next.js App Router with route groups for admin, provider, customer, technician, public quote/lead pages, and API routes.
- Prisma/Postgres as the application database layer.
- Supabase Auth for user sessions and phone OTP.
- Server Components plus Server Actions for admin/provider workflows.
- WhatsApp Cloud API helpers for template, text, button, list, and CTA URL messages.
- Vitest for unit/integration-style tests and Playwright for smoke/E2E.

### Database source of truth

Primary schema file:

- `field-service/prisma/schema.prisma`

Existing migrations live in:

- `field-service/prisma/migrations/`

Supabase also has an older SQL migration path:

- `field-service/supabase/migrations/`

New application data model changes should follow the Prisma migration path used by the current `field-service` app.

---

## 2. Provider Identity and KYC

### Provider source of truth

Provider identity is the `Provider` model in `prisma/schema.prisma`.

Important fields:

- `Provider.id`: internal provider identity and FK target for leads, matches, jobs, payouts, availability, notes, certifications, equipment, etc.
- `Provider.userId`: nullable unique Supabase Auth user ID. Used by authenticated provider PWA routes.
- `Provider.phone`: unique E.164 phone, used heavily by WhatsApp provider flows.
- `Provider.active`, `Provider.verified`, `Provider.availableNow`, `Provider.status`: matching and operational eligibility flags.
- `Provider.whatsappMarketingOptIn`: provider-facing marketing/template eligibility signal.

Provider auth resolution pattern:

- Provider routes call `requireProvider()` from `lib/auth.ts`.
- Provider pages then resolve the row with `db.provider.findUnique({ where: { userId: session.id } })`.
- Signed WhatsApp lead links use `leadId + providerId` HMAC tokens via `lib/provider-lead-access.ts`.

### KYC status

KYC already exists:

- `Provider.kycStatus KycStatus @default(NOT_STARTED)`

Enum values:

- `NOT_STARTED`
- `IN_PROGRESS`
- `SUBMITTED`
- `VERIFIED`
- `REJECTED`
- `EXPIRED`

Recommendation:

- Reuse `Provider.kycStatus` for wallet gating.
- Do not add a second KYC field.
- Add policy in wallet/unlock services such as: paid unlocks require `Provider.status === ACTIVE`, `active === true`, `verified === true`, and optionally `kycStatus === VERIFIED` once finance requires it.

---

## 3. Lead and Match Source of Truth

### Lead matching source of truth

The source of truth for lead matching is:

- `lib/matching/service.ts`

Compatibility entry points are exposed through:

- `lib/matching-engine.ts`

Core flow:

1. A `JobRequest` is validated/opened for matching.
2. `runAssignmentForJobRequest()` ranks candidates and creates a `DispatchDecision`.
3. `createOfferForAttempt()` creates or updates:
   - `AssignmentHold`
   - `Lead`
   - `MatchAttempt`
   - `TechnicianScheduleItem`
4. Provider receives WhatsApp CTA via `notifyProviderNewJob()`.
5. Provider accepts through PWA or signed lead link.
6. `acceptAssignmentOffer()` atomically:
   - validates lead ownership and active hold,
   - handles expiry/taken conditions,
   - marks lead accepted,
   - marks hold accepted,
   - creates `Match`,
   - updates `JobRequest` to `MATCHED`,
   - expires competing leads/holds.

### Existing lead models

Relevant models:

- `JobRequest`
- `Lead`
- `Match`
- `DispatchDecision`
- `MatchAttempt`
- `AssignmentHold`
- `TechnicianScheduleItem`

`Lead` has a uniqueness constraint:

- `@@unique([jobRequestId, providerId])`

This is the right anchor for a paid lead unlock record:

- one provider can unlock one lead once,
- repeated unlock attempts must be idempotent,
- unlock must not create duplicate debit entries.

---

## 4. Existing Payments and Why Wallet Needs Separate Models

Existing payment models:

- `Payment`
- `ProviderPayout`

`Payment` is booking/customer-payment oriented:

- unique `bookingId`
- `PaymentStatus`
- `PaymentCollectionMode`
- PSP checkout fields
- refund fields
- metadata JSON

Existing payment service:

- `lib/payments.ts`

Current behavior:

- `initializeBookingPayment()` creates either an offline trace record or PSP checkout payment.
- `PAYMENT_COLLECTION_MODE=bypass` keeps an offline-recorded pending payment for launch mode.
- `handlePaymentSuccess()` marks a booking payment as paid.
- `issueRefund()` calls PSP refund by `pspReference`.

Important constraint:

- Provider wallet credits must not be implemented as a loose `Provider.balance` field.
- Provider wallet credits must not reuse `Payment`, because `Payment` is tied to a `Booking` by unique `bookingId`.
- Wallet balance should be derived from immutable ledger entries, with an optional cached balance for display/performance.

---

## 5. Admin and Server Action Conventions

Admin routes live under:

- `field-service/app/(admin)/admin/`

Admin layout and sidebar are in:

- `field-service/app/(admin)/layout.tsx`

Admin auth and roles:

- `requireAdmin()`
- `requireRole()`
- DB-backed `AdminUser`
- role hierarchy: `OPS < FINANCE < TRUST < ADMIN < OWNER`

Admin mutation convention:

- use `crudAction()` from `lib/crud-action.ts`
- include a Zod schema
- include `requiredRole`
- include a feature flag for rollout
- write both `AuditLog` and `AdminAuditEvent`
- include a human-readable `reason` for finance operations

Existing payment admin patterns:

- `app/(admin)/admin/payments/page.tsx`
- `app/(admin)/admin/payments/actions.ts`

Original recommendation:

- Wallet admin actions should be implemented in a dedicated action file and use `crudAction()`.
- Finance-sensitive actions should require `FINANCE`, `ADMIN`, or `OWNER`.
- Operational claim/release flows can reuse `OpsQueueAssignment` and `Case` later if needed.

Implemented policy:

- Manual EFT reconciliation actions use `RECONCILE_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER']` with `excludedRole: ['TRUST']` in `app/(admin)/admin/provider-credit-payments/actions.ts`.
- Wallet management actions use `MANAGE_WALLET_ROLES = ['OPS']`, which acts as an all-admin floor under the current hierarchy model.
- Lead unlock dispute actions use `DISPUTE_ROLES = ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER']`.
- `crudAction()` remains the atomic audit wrapper for admin wallet/payment/dispute mutations and writes both `AuditLog` and `AdminAuditEvent`.

---

## 6. WhatsApp Notification Conventions

Current outbound helpers:

- `lib/whatsapp-interactive.ts`
  - `sendText`
  - `sendButtons`
  - `sendList`
  - `sendCtaUrl`
- `lib/whatsapp.ts`
  - approved template sends
  - booking/payment/provider lifecycle sends
- `lib/message-events.ts`
  - `logOutboundMessage()`
  - `hasSuccessfulMessageForBooking()`

Inbound webhook:

- `app/api/webhooks/whatsapp/route.ts`

Inbound idempotency:

- `InboundWhatsAppMessage.externalId` unique WAMID

Outbound audit:

- all wallet/top-up/unlock messages should create `MessageEvent` rows through existing helpers.
- use `metadata` for `providerId`, `walletPaymentIntentId`, `walletLedgerEntryId`, `leadId`, `unlockId`, and `amount`.

Original recommendation:

- Emit WhatsApp notifications after DB transactions commit.
- Notification failure must not roll back wallet credit/debit state.
- Use free-form interactive messages only inside the 24-hour window; otherwise add templates later if production delivery requires them.

Implemented policy:

- Wallet and lead lifecycle notifications use registered template sends through `sendTemplate()` in `lib/provider-wallet-notifications.ts`.
- Template inventory lives in `lib/messaging-templates.ts` with provider wallet and lead unlock templates.
- Notification delivery remains post-commit/fire-and-forget and idempotent through `MessageEvent.metadata.idempotencyKey`.

---

## 7. Proposed Data Model

> Superseded proposal. This section records the original design sketch and does not match the final Prisma schema. Use section 21 and `docs/superpowers/specs/2026-04-29-provider-credit-wallet-paid-lead-unlock-implementation-snapshot.md` for implementation-grade model names, fields, enum values, and constraints.

### ProviderWallet

Purpose: cached wallet summary for display and fast gating.

```prisma
model ProviderWallet {
  id              String   @id @default(cuid())
  providerId      String   @unique
  currency        String   @default("ZAR")
  balance         Decimal  @db.Decimal(10, 2) @default(0)
  promoBalance    Decimal  @db.Decimal(10, 2) @default(0)
  paidBalance     Decimal  @db.Decimal(10, 2) @default(0)
  status          ProviderWalletStatus @default(ACTIVE)
  lastLedgerSeq   Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  ledgerEntries ProviderWalletLedgerEntry[]
  paymentIntents ProviderWalletPaymentIntent[]
  promoAwards ProviderPromoCreditAward[]

  @@map("provider_wallets")
}
```

Notes:

- `balance = paidBalance + promoBalance`.
- Ledger remains authoritative.
- Cached balances are updated transactionally only by wallet service functions.

### ProviderWalletLedgerEntry

Purpose: immutable source of truth for credits/debits/reversals.

```prisma
model ProviderWalletLedgerEntry {
  id                String   @id @default(cuid())
  walletId          String
  providerId        String
  seq               Int
  direction         WalletLedgerDirection
  entryType         WalletLedgerEntryType
  amount            Decimal  @db.Decimal(10, 2)
  currency          String   @default("ZAR")
  paidAmountPortion Decimal  @db.Decimal(10, 2) @default(0)
  promoAmountPortion Decimal @db.Decimal(10, 2) @default(0)
  balanceAfter      Decimal  @db.Decimal(10, 2)
  paidBalanceAfter  Decimal  @db.Decimal(10, 2)
  promoBalanceAfter Decimal  @db.Decimal(10, 2)
  idempotencyKey    String   @unique
  relatedEntityType String?
  relatedEntityId   String?
  description       String?
  metadata          Json     @default("{}")
  createdById       String?
  createdByRole     String?
  createdAt         DateTime @default(now())

  wallet ProviderWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@unique([walletId, seq])
  @@index([providerId, createdAt])
  @@index([relatedEntityType, relatedEntityId])
  @@map("provider_wallet_ledger_entries")
}
```

Entry types:

- `MANUAL_EFT_CREDIT`
- `PROMO_CREDIT`
- `LEAD_UNLOCK_DEBIT`
- `ADMIN_ADJUSTMENT_CREDIT`
- `ADMIN_ADJUSTMENT_DEBIT`
- `REFUND_CREDIT`
- `DISPUTE_HOLD_DEBIT`
- `DISPUTE_RELEASE_CREDIT`
- `EXPIRY_DEBIT`

Directions:

- `CREDIT`
- `DEBIT`

### ProviderWalletPaymentIntent

Purpose: manual EFT top-up request and finance reconciliation.

```prisma
model ProviderWalletPaymentIntent {
  id                 String   @id @default(cuid())
  walletId           String
  providerId         String
  method             ProviderWalletPaymentMethod @default(MANUAL_EFT)
  status             ProviderWalletPaymentIntentStatus @default(PENDING)
  amount             Decimal  @db.Decimal(10, 2)
  currency           String   @default("ZAR")
  reference          String   @unique
  bankAccountLabel   String?
  proofUrl           String?
  proofBlobKey       String?
  proofUploadedAt    DateTime?
  submittedAt        DateTime?
  reconciledAt       DateTime?
  reconciledById     String?
  rejectionReason    String?
  ledgerEntryId      String?
  metadata           Json     @default("{}")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  wallet ProviderWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([providerId, status, createdAt])
  @@map("provider_wallet_payment_intents")
}
```

Statuses:

- `PENDING`
- `PROOF_SUBMITTED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`
- `EXPIRED`

### LeadUnlock

Purpose: records that a provider paid to unlock a lead.

```prisma
model LeadUnlock {
  id             String   @id @default(cuid())
  leadId         String
  jobRequestId   String
  providerId     String
  walletId       String
  ledgerEntryId  String
  amount         Decimal  @db.Decimal(10, 2)
  currency       String   @default("ZAR")
  priceRuleKey   String?
  status         LeadUnlockStatus @default(UNLOCKED)
  unlockedAt     DateTime @default(now())
  refundedAt     DateTime?
  refundLedgerEntryId String?
  disputeId      String?
  metadata       Json     @default("{}")

  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)
  provider Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  wallet ProviderWallet @relation(fields: [walletId], references: [id])

  @@unique([leadId, providerId])
  @@index([providerId, unlockedAt])
  @@index([jobRequestId])
  @@map("lead_unlocks")
}
```

Statuses:

- `UNLOCKED`
- `REFUNDED`
- `DISPUTED`
- `VOIDED`

### ProviderPromoCreditAward

Purpose: auditable admin/campaign promo credit grant.

```prisma
model ProviderPromoCreditAward {
  id             String   @id @default(cuid())
  walletId       String
  providerId     String
  ledgerEntryId  String?
  campaignKey    String
  amount         Decimal  @db.Decimal(10, 2)
  currency       String   @default("ZAR")
  status         PromoCreditAwardStatus @default(AWARDED)
  reason         String
  awardedById    String?
  expiresAt      DateTime?
  metadata       Json     @default("{}")
  createdAt      DateTime @default(now())

  wallet ProviderWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([providerId, campaignKey])
  @@map("provider_promo_credit_awards")
}
```

Statuses:

- `AWARDED`
- `REVERSED`
- `EXPIRED`

---

## 8. Service Layer Map

> Superseded proposal. Final service names differ from this section. Current core files are `lib/provider-wallet.ts`, `lib/provider-credit-payment-intents.ts`, `lib/provider-credit-reconciliation.ts`, `lib/lead-unlocks.ts`, `lib/lead-unlock-disputes.ts`, `lib/provider-promo-awards.ts`, `lib/provider-wallet-notifications.ts`, `lib/provider-lead-detail.ts`, and `lib/provider-lead-access.ts`.

New service files:

- `lib/provider-wallet.ts`
  - `getOrCreateProviderWallet(providerId)`
  - `creditWallet()`
  - `debitWallet()`
  - `reverseLedgerEntry()`
  - `getWalletBalance()`
  - `assertWalletCanUnlockLead()`
- `lib/provider-wallet-payment-intents.ts`
  - `createManualEftIntent()`
  - `submitManualEftProof()`
  - `approveManualEftIntent()`
  - `rejectManualEftIntent()`
- `lib/lead-unlocks.ts`
  - `quoteLeadUnlockPrice()`
  - `unlockLeadForProvider()`
  - `getLeadUnlockState()`
  - `refundLeadUnlock()`
- `lib/provider-wallet-notifications.ts`
  - `notifyWalletTopUpCreated()`
  - `notifyWalletTopUpApproved()`
  - `notifyLeadUnlocked()`
  - `notifyLowBalance()`
  - `notifyUnlockRefunded()`

All wallet writes must go through service functions. Do not mutate wallet balances directly from pages or route handlers.

---

## 9. Files That Need to Change

> Superseded proposal. This section is retained as planning history. Current route paths use `/provider/credits`, `/provider/leads/[leadId]`, `/leads/access/[token]`, `/admin/provider-wallets`, `/admin/provider-credit-payments`, and `/admin/lead-unlock-disputes`.

### Schema and migrations

- `field-service/prisma/schema.prisma`
- `field-service/prisma/migrations/<timestamp>_provider_wallet_ledger/`
- `field-service/prisma/migrations/<timestamp>_wallet_payment_intents/`
- `field-service/prisma/migrations/<timestamp>_lead_unlocks/`
- `field-service/prisma/migrations/<timestamp>_promo_credit_awards/`

### Libraries

- `field-service/lib/audit-entities.ts`
- `field-service/lib/flags.ts`
- `field-service/lib/provider-wallet.ts`
- `field-service/lib/provider-wallet-payment-intents.ts`
- `field-service/lib/lead-unlocks.ts`
- `field-service/lib/provider-wallet-notifications.ts`
- `field-service/lib/provider-lead-access.ts`
- `field-service/lib/matching/service.ts`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/whatsapp.ts`
- `field-service/lib/whatsapp-interactive.ts` only if new helper ergonomics are needed.
- `field-service/lib/messaging-templates.ts` only if template-based wallet notifications are required.

### Provider UI

- `field-service/app/(provider)/layout.tsx`
- `field-service/app/(provider)/provider/page.tsx`
- `field-service/app/(provider)/provider/leads/page.tsx`
- `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`
- `field-service/app/leads/access/[token]/page.tsx`
- new: `field-service/app/(provider)/provider/wallet/page.tsx`
- new: `field-service/app/(provider)/provider/wallet/actions.ts`
- new: `field-service/app/(provider)/provider/wallet/top-up/page.tsx`

### Admin UI

- `field-service/app/(admin)/layout.tsx`
- new: `field-service/app/(admin)/admin/wallets/page.tsx`
- new: `field-service/app/(admin)/admin/wallets/actions.ts`
- new: `field-service/app/(admin)/admin/wallets/[providerId]/page.tsx`
- optional: extend `field-service/app/(admin)/admin/providers/[id]/page.tsx` via the canonical technician profile export.

### API routes

Use Server Actions for same-app form submissions where possible.

Potential API routes:

- `field-service/app/api/provider/wallet/route.ts`
- `field-service/app/api/provider/wallet/payment-intents/route.ts`
- `field-service/app/api/admin/wallets/export/route.ts`

Do not add public wallet mutation APIs unless needed.

### Tests

- `field-service/__tests__/lib/provider-wallet.test.ts`
- `field-service/__tests__/lib/provider-wallet-payment-intents.test.ts`
- `field-service/__tests__/lib/lead-unlocks.test.ts`
- `field-service/__tests__/lib/provider-wallet-notifications.test.ts`
- `field-service/__tests__/api/provider-lead-access.test.ts` or existing lead access tests if gating changes.
- `field-service/e2e/smoke.spec.ts` after UI routes are added.

---

## 10. PR-Sized Implementation Sequence

> Superseded proposal. The implementation was delivered as an integrated pilot with later hardening passes. See the implementation plan and snapshot linked at the top of this file for current state.

### PR 1 — Wallet ledger foundations

Scope:

- Add wallet and ledger schema.
- Add enums.
- Add `lib/provider-wallet.ts`.
- Add feature flag key, audit entity constants, and tests.
- No UI beyond optional dev-only queries.

Acceptance:

- Wallet can be created idempotently for provider.
- Credit/debit entries are immutable.
- Balance cache updates transactionally.
- Insufficient balance fails without ledger write.
- Idempotency key prevents duplicate credits/debits.

### PR 2 — Manual EFT payment intents

Scope:

- Add payment intent schema.
- Add provider action to create EFT top-up intent.
- Generate stable human-readable reference.
- Add optional proof upload metadata fields, but proof upload UI can wait if needed.
- Add tests.

Acceptance:

- Provider can create pending manual EFT intent.
- Intent does not credit wallet until admin approval.
- Duplicate form submits do not create multiple active intents for same idempotency key.

### PR 3 — Admin reconciliation

Scope:

- Add admin wallet/payment-intent list.
- Add approve/reject actions through `crudAction()`.
- Approval creates one `MANUAL_EFT_CREDIT` ledger entry and links it to the intent.
- Rejection records reason.

Acceptance:

- Only `FINANCE`, `ADMIN`, `OWNER` can approve/reject.
- Approval is idempotent.
- Audit rows are written to `AuditLog` and `AdminAuditEvent`.
- Approved amount appears in provider wallet balance.

### PR 4 — Lead unlock charging

Scope:

- Add `LeadUnlock` schema.
- Add price quote service.
- Add unlock service that debits wallet and creates unlock atomically.
- Gate full lead detail/contact/acceptance behind unlock.
- Keep lead notification unchanged except for optional "credits required" copy.

Acceptance:

- Provider can view locked lead teaser.
- Unlock button charges exactly once.
- Existing unlock is reused on refresh.
- Insufficient balance routes to wallet top-up.
- Unlock cannot happen after lead expiry, taken match, wrong provider, or closed hold.

### PR 5 — Promo credits

Scope:

- Add promo award schema and admin action.
- Promo credits become ledger credits with promo balance portion.
- Unlock debits promo balance before paid balance, unless product decides otherwise.

Acceptance:

- Admin can grant promo credits with reason/campaign.
- Promo award is auditable and linked to ledger entry.
- Balance display distinguishes paid and promo credit.

### PR 6 — Refunds and disputes

Scope:

- Add refund/reversal service for lead unlocks.
- Admin refund action creates linked credit ledger entry.
- Mark `LeadUnlock` as `REFUNDED` or `DISPUTED`.
- Optionally open/attach `Case` with `DISPUTE` queue when dispute flow needs ops queue handling.

Acceptance:

- Refund cannot exceed original unlock debit.
- Refund is idempotent per unlock/reason key.
- Audit reason is required.
- Refunded unlock cannot be refunded again.

### PR 7 — WhatsApp notifications

Scope:

- Add notification helpers for wallet lifecycle.
- Emit after top-up intent creation, reconciliation approval/rejection, lead unlock, low balance, refund.
- Log all outbound messages in `MessageEvent.metadata`.

Acceptance:

- Notification failures do not roll back wallet transactions.
- Message metadata links to provider, wallet, intent, unlock, or ledger entry.
- Tests verify helper calls and metadata shape.

### PR 8 — Provider and admin UI polish

Scope:

- Provider wallet screen.
- Provider top-up flow.
- Provider transaction history.
- Admin provider wallet detail.
- Admin wallet nav/sidebar entry.
- Smoke tests.

Acceptance:

- Provider can see balance and top-up instructions.
- Admin can reconcile and inspect ledger.
- UI uses existing components and app shell patterns.
- E2E smoke includes wallet pages behind auth-compatible test strategy.

---

## 11. Risks and Missing Context

### Product/pricing decisions needed

- Lead unlock price source: fixed, category-based, area-based, or lead-quality based.
- Whether all leads require unlock or only access to customer contact/full details.
- Whether accepting a lead should require unlock first or unlock can happen after accept.
- Whether failed/no-contact leads are refundable automatically or only by admin.
- Whether promo credits expire.
- Whether KYC `VERIFIED` is mandatory for paid top-ups or only for lead acceptance.

### Technical risks

- Existing `Payment` terminology may confuse wallet top-ups. Keep wallet models separate and provider-specific.
- Signed WhatsApp lead links currently expose full lead details. Lead access page must be refactored carefully so locked leads show only safe teaser details before unlock.
- Matching flow has both authenticated provider PWA and signed token entry points. Unlock gating must cover both.
- Admin payment page already handles customer booking payments. Provider wallet reconciliation should be a distinct admin area to avoid mixing domains.
- WhatsApp interactive messages work inside session windows; production wallet notifications may need approved templates.

### Data integrity risks

- Never update wallet balance without a ledger entry.
- Never create a ledger entry without an idempotency key.
- Never allow a lead unlock debit outside a transaction that also creates the unlock row.
- Never make `Provider.balance` the source of truth.
- Avoid using JSON metadata as the only relationship for money movement; keep FK/id fields on wallet, intent, unlock, and ledger rows.

---

## 12. Test Commands

From `field-service`:

```bash
pnpm test
pnpm lint
pnpm build
```

E2E smoke:

```bash
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test
```

If using npm instead of pnpm in this workspace:

```bash
npm run test
npm run lint
npm run build
```

---

## 13. OpenBrain Logging Payload

Historical OpenBrain entry from the original analysis, retained only to show what was logged during planning. Do not run this entry for the shipped implementation; use the current payload below.

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle\ Holdings/Solutions/Projects/MobileApps/OpenBrain/backend
pnpm brain -- knowledge add \
  --project "Plug A Pro" \
  --domain "engineering" \
  --title "implementation map — provider credit wallet and paid lead unlock (2026-04-29)" \
  --tags "wallet,ledger,provider,lead-unlock,payments,whatsapp,admin" \
  --content "Historical planning payload superseded by the implementation snapshot entry below."
```

Current post-implementation OpenBrain entry should use the shipped model and service names:

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle\ Holdings/Solutions/Projects/MobileApps/OpenBrain/backend
pnpm brain -- knowledge add \
  --project "Plug A Pro" \
  --domain "engineering" \
  --title "implementation snapshot - provider credit wallet and paid lead unlock (2026-04-29)" \
  --tags "wallet,ledger,provider,lead-unlock,payments,whatsapp,admin,docs" \
  --content "Shipped provider credit wallet pilot uses ProviderWallet, WalletLedgerEntry, PaymentIntent, LeadUnlock, LeadUnlockDispute, and ProviderPromoAward. Wallet mutations are centralized in lib/provider-wallet.ts. Manual EFT top-ups use lib/provider-credit-payment-intents.ts and lib/provider-credit-reconciliation.ts, with admin actions under /admin/provider-credit-payments. Provider wallet admin lives under /admin/provider-wallets. Provider lead previews are query-gated through lib/provider-lead-detail.ts and lib/provider-lead-access.ts. WhatsApp wallet and lead notifications use registered provider templates through sendTemplate and MessageEvent idempotency metadata."
```

---

## 17. Paid Lead Unlock Implementation Addendum - 2026-04-29

### Scope Implemented

- Added `LeadUnlock` as the auditable source of truth for paid provider access to a lead's full customer and job details.
- Added `LeadUnlockStatus` with `UNLOCKED`, `REFUNDED`, `DISPUTED`, and `REVERSED`.
- Added `unlockLeadForProvider(leadId, providerId)` in `lib/lead-unlocks.ts`.
- Added a wallet transaction helper so lead unlock debit and unlock creation happen inside one database transaction.
- Updated authenticated provider lead details and signed WhatsApp lead access screens to show a safe preview before unlock and full contact/job details only after unlock.
- Updated signed lead attachment access so customer job request attachments are unavailable through a lead token until the lead is unlocked.

### Current Unlock Rules

- Unlock cost is fixed at 1 Plug A Pro Credit through `LEAD_UNLOCK_COST_CREDITS`.
- KYC approval maps to `Provider.kycStatus === "VERIFIED"`.
- A provider may unlock only a lead assigned to that provider.
- If a `Match` already exists for the lead's job request, the unlock must belong to the matched provider.
- Cancelled and expired job requests cannot be unlocked.
- Expired leads that were not already accepted cannot be unlocked.
- Duplicate unlock attempts by the same provider return the existing unlock without another wallet debit.
- Duplicate unlock attempts by another provider are blocked by the unique `LeadUnlock.leadId` constraint.

### Transaction Boundary

`unlockLeadForProvider` wraps these operations in a single Prisma transaction:

- Create the `LeadUnlock` row.
- Debit 1 credit through the wallet ledger, consuming promo credits before paid credits.
- Store the resulting paid/promo split in `LeadUnlock.creditTypeBreakdown`.
- Mark a `SENT` lead as `VIEWED` so the preview/unlock interaction is visible in existing lead status history.

The wallet ledger remains the source of truth for credit movement. `LeadUnlock` stores the business event and the credit split used for later refund/dispute flows.

### UI and Access Points

- Authenticated provider route: `app/(provider)/provider/leads/[leadId]/page.tsx`.
- Signed WhatsApp access route: `app/leads/access/[token]/page.tsx`.
- Attachment token guard: `lib/provider-lead-access.ts`.

Pre-unlock provider preview includes service category, suburb/city, preferred time, short description, and estimated value when available. Full street address, customer name, phone, photos, and accept/inspection actions remain hidden until unlock.

### Verification

- Focused lead unlock tests cover successful debit, promo-first debit, duplicate unlock idempotency, KYC blocking, insufficient credits, and provider ownership.
- `npm run test` passed after implementation.
- `npm run lint` passed with one existing React Hook Form warning in `components/admin/crud/form.tsx`.
- Repo-wide `npx tsc --noEmit --pretty false` remains blocked by existing unrelated test fixture/global typing issues and older implicit-any errors outside the wallet/unlock files.

### Follow-On Notes

- Refund/dispute work should use `LeadUnlock.status`, `refundedAt`, `refundReason`, and linked wallet refund ledger entries.
- A later pricing PR should replace `LEAD_UNLOCK_COST_CREDITS` with a configured or category-based pricing source if product rules change.
- WhatsApp notification work should emit post-commit events for unlock success, insufficient balance/top-up nudges, refund approval, and low balance.

---

## 18. Provider Promo Credit Awards Addendum - 2026-04-29

### Scope Implemented

- Added `ProviderPromoAward` as the milestone source of truth for onboarding promo incentives.
- Added `ProviderPromoAwardType` for `MOBILE_VERIFIED`, `PROFILE_COMPLETED`, `KYC_APPROVED`, `FIRST_TOPUP`, and `FIRST_COMPLETED_JOB`.
- Added `ProviderPromoAwardStatus` for `AWARDED` and `REVOKED`.
- Added `lib/provider-promo-awards.ts` with `awardPromoCreditsForMilestone(providerId, awardType, reference)` and transaction-safe hook helpers.
- Promo credits are issued through `ProviderWallet` ledger entries with `WalletLedgerEntryType.PROMO_CREDIT` and `WalletCreditType.PROMO`.

### Reward Configuration

- Mobile/WhatsApp verified: 3 promo credits.
- Profile 80% complete with profile photo/selfie: 2 promo credits.
- KYC approved: 5 promo credits.
- First confirmed top-up: 2 promo credits.
- First completed job with customer rating: 3 promo credits.
- Pre-payment awards are capped at 10 credits across `MOBILE_VERIFIED`, `PROFILE_COMPLETED`, and `KYC_APPROVED`.

### Hook Points

- Manual application approval: `app/(admin)/admin/applications/page.tsx`.
- Auto application approval cron: `app/api/cron/match-leads/route.ts`.
- Provider/admin profile update evaluation: `app/(provider)/provider/profile/page.tsx` and `app/(admin)/admin/providers/actions.ts`.
- KYC approval: `setProviderKycAction` in `app/(admin)/admin/providers/actions.ts`.
- First credited top-up: `creditPaymentIntentInTransaction` in `lib/provider-credit-reconciliation.ts`.
- First completed job with customer rating: customer booking rating submission in `app/(customer)/bookings/[id]/rate/page.tsx`.

### Idempotency and Accounting

- `ProviderPromoAward` has a unique constraint on `(providerId, awardType)` so each milestone can be awarded once per provider.
- Award creation and wallet promo crediting run in the same transaction.
- `createMany(..., skipDuplicates: true)` is used inside transaction helpers so duplicate milestone events become no-ops instead of aborting a larger business transaction.
- The wallet ledger remains the accounting source of truth; `ProviderPromoAward` records milestone eligibility and references the triggering event.

### Verification

- Added focused tests for configured award amounts, duplicate prevention, pre-payment cap enforcement, profile completion gating, first top-up gating, and first completed job with rating.
- Updated payment reconciliation tests so first confirmed top-up issues the paid top-up credits plus the first-top-up promo award.
- `npm run test` passed after promo award implementation.
- `npm run lint` passed with the existing React Hook Form warning in `components/admin/crud/form.tsx`.
- Repo-wide `npx tsc --noEmit --pretty false` remains blocked by existing unrelated test global/fixture typing issues and older implicit-any errors outside the promo wallet files.

---

## 19. Lead Unlock Refund and Dispute Handling Addendum - 2026-04-29

### Scope Implemented

- Extended `LeadUnlock` with dispute and resolution fields: `disputeReason`, `disputeNotes`, `disputedAt`, `resolvedAt`, `resolvedBy`, and existing `refundReason`/`refundedAt`.
- Added `LeadUnlockDispute` as the admin review record for refund requests.
- Added `LeadUnlockDisputeReason` with only refundable pilot reasons:
  - invalid customer number
  - duplicate lead for the same provider
  - materially wrong category
  - materially wrong location
  - customer says they never requested the service
  - lead cancelled or closed before unlock
- Added `LeadUnlockDisputeStatus` with `OPEN`, `APPROVED`, and `REJECTED`.
- Added `lib/lead-unlock-disputes.ts` with provider dispute creation plus admin approve/reject services.

### Provider Flow

- Authenticated provider lead detail now shows a refund dispute panel after unlock.
- Providers can submit one dispute per unlocked lead.
- Providers can dispute only their own `LeadUnlock`.
- Non-refundable policy examples are shown in the provider UI, but not offered as selectable reasons.

### Admin Flow

- Added `/admin/lead-unlock-disputes` for reviewing open, approved, and rejected lead unlock disputes.
- Added admin actions for approve and reject.
- Admin route requires the existing admin auth guard and actions use the existing `crudAction` audit/role/feature-flag convention.
- Added `AUDIT_ENTITY.LEAD_UNLOCK_DISPUTE`.

### Refund Accounting

- Approved disputes update `LeadUnlock.status` to `REFUNDED`, stamp `refundedAt`, `resolvedAt`, and `resolvedBy`, and update the dispute to `APPROVED`.
- Refunds use `WalletLedgerEntryType.LEAD_REFUND_CREDIT`.
- Refund credit type is restored from the original `LEAD_UNLOCK_DEBIT` ledger entries where available.
- If original debit ledger entries are unavailable, the service falls back to `LeadUnlock.creditTypeBreakdown`.
- Legacy fallback when no debit split exists is promo credit, to avoid creating paid/cash-convertible value without evidence.
- Duplicate refunds are blocked with an atomic `LeadUnlock.updateMany` predicate on `status: DISPUTED` and `refundedAt: null`.

### Verification

- Added focused tests for provider ownership, approved refund ledger/balance updates, rejection without wallet mutation, duplicate refund prevention, and non-admin admin-action access.
- Focused dispute tests, schema validation, and focused lint passed.

---

## 20. Wallet and Lead WhatsApp Notification Events Addendum - 2026-04-29

### Scope Implemented

- Added `lib/provider-wallet-notifications.ts` as the clean wallet/lead notification layer.
- Added message builders for:
  - low balance warning
  - zero balance lead available
  - manual EFT top-up instructions
  - payment credited receipt
  - provider lead unlock confirmation
  - customer intro after provider unlock
- Notification delivery uses registered WhatsApp templates through `sendTemplate()` and records `MessageEvent` rows directly.
- Provider wallet and lead unlock templates are registered in `lib/messaging-templates.ts`.
- Core wallet and lead transactions do not depend on WhatsApp delivery success.

### Hook Points

- Manual EFT intent creation: `createManualEftTopUpIntent` triggers `wallet:payment_intent_created`.
- Admin payment crediting: `creditPaymentIntent` and admin credit action trigger `wallet:payment_credited`.
- Lead unlock: `unlockLeadForProvider` triggers:
  - `lead_unlock:provider_confirmation`
  - `lead_unlock:customer_intro`
  - `wallet:low_balance` when the post-unlock balance is 1 credit
- Lead unlock post-commit hooks trigger `wallet:low_balance` when total available credits are 1. Provider wallet summary reads do not send WhatsApp messages.
- Lead dispatch triggers `wallet:zero_balance_lead_available` when a matched lead is created for a provider with 0 credits.

### Idempotency and Failure Handling

- `MessageEvent.metadata.idempotencyKey` is used as the event-level idempotency key.
- Delivery checks for existing `SENT`, `DELIVERED`, or `READ` messages with the same `templateName`, `to`, and `metadata.idempotencyKey`.
- Send failures are logged as `FAILED` `MessageEvent` rows and do not throw back into wallet ledger, payment reconciliation, dispatch, or unlock transactions.
- Payment credited and top-up actions may be retried safely because the notification layer dedupes already-sent messages.
- Dispatch CTA/action sends now preflight successful `MessageEvent` rows by recipient, template, and `jobRequestId` to avoid duplicate provider messages on redispatch.

### Data Safety

- Lead preview dispatch still uses preview-safe job details.
- Full customer contact and address are included only in the post-unlock provider confirmation.
- Customer intro includes provider name only and does not expose provider wallet or internal payment details.
- Payment proof uploads use private Vercel Blob storage and admin access is proxied through an authenticated proof route.

### Verification

- Added focused tests for all notification message builders.
- Added delivery tests covering payment credited send/log behavior, idempotency skip, and failed-send logging.
- Focused lint and focused notification/top-up/unlock/dispatch tests passed.

---

## 21. Provider Credit Wallet and Lead Monetisation Implementation Note - 2026-04-29

### Product and Accounting Summary

Plug A Pro now uses provider-facing **Plug A Pro Credits** for paid lead monetisation. The product term is credits, not tokens, because the unit represents a business-priced lead access credit rather than a transferable or speculative token. The current pricing rule is fixed in code as `PLUG_A_PRO_CREDIT_VALUE_CENTS = 5000`, so 1 credit equals R50.

Wallet balances are stored as credits, not Rand values. `ProviderWallet` caches separate `paidCreditBalance` and `promoCreditBalance` values, while immutable `WalletLedgerEntry` rows remain the accounting source of truth. Wallet status supports `ACTIVE`, `SUSPENDED`, and `CLOSED`; suspension blocks lead unlock debits without erasing balances.

Implemented model and service references:

- `prisma/schema.prisma`: `ProviderWallet`, `WalletLedgerEntry`, `PaymentIntent`, `LeadUnlock`, `LeadUnlockDispute`, and `ProviderPromoAward`.
- `lib/provider-wallet.ts`: wallet creation, balance reads, paid/promo crediting, promo-first lead unlock debits, refunds, admin adjustments, suspension, and reactivation.
- `lib/lead-unlocks.ts`: 1-credit lead unlock flow, KYC gate, duplicate unlock idempotency, and wallet debit transaction.
- `lib/provider-credit-payment-intents.ts`: manual EFT top-up intent creation and payment instructions.
- `lib/provider-credit-reconciliation.ts`: admin/manual EFT reconciliation and paid credit issuance.
- `lib/provider-promo-awards.ts`: onboarding milestone promo credit awards.
- `lib/lead-unlock-disputes.ts`: provider refund disputes and admin approve/reject handling.
- `lib/provider-wallet-notifications.ts`: WhatsApp message builders and idempotent delivery for wallet and lead events.

### Current Business Rules

- Minimum manual EFT top-up is R100.
- R100 issues 2 credits, R200 issues 4 credits, and R500 issues 10 credits.
- Manual EFT intent creation never credits a wallet automatically.
- Admin reconciliation credits only after funds are confirmed and the `PaymentIntent` is valid.
- Active lead unlock costs 1 Plug A Pro Credit through `LEAD_UNLOCK_COST_CREDITS`.
- Providers must have `Provider.kycStatus === "VERIFIED"` before unlocking full customer details.
- Lead previews do not charge credits and must not expose customer full name, phone, exact address, or attachments.
- Duplicate unlock attempts by the same provider return the existing unlock without another debit.
- Promo credits are consumed before paid credits during unlock.
- Paid credits and promo credits remain separate in both cached balances and ledger rows.

### Promo Credit Rules

Promo credits are non-cash product credits. They cannot be withdrawn, transferred, or converted to cash. They are issued only through wallet ledger entries and tracked by `ProviderPromoAward` milestone records.

Pilot milestone rewards:

- Mobile/WhatsApp verified: 3 promo credits.
- Profile 80% complete with profile photo/selfie: 2 promo credits.
- KYC approved: 5 promo credits.
- First confirmed top-up: 2 promo credits.
- First completed job with customer rating: 3 promo credits.

Pre-payment promo awards are capped at 10 credits across mobile verified, profile completed, and KYC approved. Each milestone can be awarded once per provider through the unique provider/award-type constraint.

### Manual EFT Reconciliation

Provider top-ups create `PaymentIntent` rows using `MANUAL_EFT` and generated references like `PAP-7842-9F3K`. The provider sees amount, credits, bank details, and the exact payment reference. Proof upload may update status but does not issue credits.

Ops/admin reconciliation happens in:

- `app/(admin)/admin/provider-credit-payments/page.tsx`
- `app/(admin)/admin/provider-credit-payments/[id]/page.tsx`
- `app/(admin)/admin/provider-credit-payments/actions.ts`

Crediting a payment intent is idempotent. The status update, `creditedAt`, wallet paid credit increment, top-up ledger entry, and first-top-up promo award run inside one database transaction.

### Refund and Dispute Policy

Providers can dispute unlocked leads only after unlock. Refundable pilot reasons are invalid customer number, duplicate lead for the same provider, materially wrong category, materially wrong location, customer says they never requested the service, or lead cancelled/closed before unlock.

Refunds are not automatic for customer choosing another provider, quote rejection, slow provider response, high quote, or customer changing their mind after a valid introduction.

Approved disputes create `LEAD_REFUND_CREDIT` ledger entries and restore the original paid/promo debit split where possible. Duplicate refunds are blocked by status and `refundedAt` guards.

### Admin Wallet Management

Ops can inspect and manage provider wallets at:

- `app/(admin)/admin/provider-wallets/page.tsx`
- `app/(admin)/admin/provider-wallets/[providerId]/page.tsx`
- `app/(admin)/admin/provider-wallets/actions.ts`

Admin adjustments require a reason and confirmation. Positive and negative adjustments create `ADMIN_ADJUSTMENT` ledger entries; negative adjustments cannot make paid or promo balances negative. Suspension and reactivation are audited through the existing `crudAction` path.

Current status changes also write zero-credit wallet ledger rows:

- `WALLET_SUSPENDED`
- `WALLET_REACTIVATED`

These rows preserve the provider-scoped wallet timeline without changing balances. They include the reason and admin actor in ledger metadata.

Manual EFT reconciliation uses `RECONCILE_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER']` with `TRUST` explicitly excluded through `crudAction.excludedRole`. This preserves the existing hierarchy model while preventing Trust & Safety admins from crediting or failing provider EFT intents.

### Provider Lead Preview Safety

Provider lead preview data is safe by default:

- `lib/provider-lead-detail.ts` uses a two-stage query for authenticated PWA lead details.
- `lib/provider-lead-access.ts` uses the same two-stage model for signed WhatsApp token links.
- Locked leads return only preview-safe fields, suburb/city, empty attachments, `customer: null`, and a truncated description.
- Customer name, customer phone, exact address fields, and attachments are fetched only after a `LeadUnlock` exists.

### Known Limitations

- Credit pricing is fixed in code and not yet category-, suburb-, urgency-, or demand-based.
- Wallet balances are cached for reads; ledger rows remain the source of truth, but no background reconciliation job currently verifies cached balances against ledger totals.
- Manual EFT reconciliation is human-operated; bank statement ingestion and matching are not automated.
- Payment references can still be mistyped by providers and require admin review.
- Promo expiry exists as a ledger type but does not yet have a scheduled expiry job.
- Wallet suspension blocks new debits and is recorded in wallet ledger status rows, but does not yet trigger provider WhatsApp or in-app notifications.
- TypeScript passes with `npx tsc --noEmit --pretty false` as of the final hardening pass.

### Future Enhancements

- Payment gateway integration for card, payment-link, and gateway EFT methods using the existing `PaymentIntent` model.
- PayShap or instant EFT support with faster confirmation and automated payment status updates.
- Dynamic lead pricing by category, area, urgency, lead quality, or provider subscription tier.
- Provider subscriptions or bundled monthly credit plans.
- Automated bank statement import and reconciliation using payment reference and amount matching.
- Scheduled promo credit expiry with clear provider notifications.
- Ledger reconciliation job that reports cached wallet balance drift.
- Additional WhatsApp templates for wallet suspension, reactivation, dispute outcome, and low-balance top-up deep links.

---

## 22. Final Integration Hardening Summary - 2026-04-29

### Scope Hardened

Final pilot hardening added regression coverage across the provider credit wallet and paid lead unlock flow:

- Added `__tests__/integration/provider-credit-wallet-lead-monetisation.test.ts` to exercise a practical end-to-end path across wallet creation, promo awards, preview-safe lead access, promo debit unlock, manual EFT intent creation, admin reconciliation, paid credit issuance, paid debit after promo exhaustion, dispute approval, refund ledgering, and low-balance notification hooks.
- Extended `__tests__/lib/lead-unlocks.test.ts` for low-balance notification triggering, WhatsApp failure isolation, and concurrent duplicate unlock handling via Prisma `P2002`.
- Extended `__tests__/lib/provider-credit-reconciliation.test.ts` so a failed WhatsApp payment receipt does not roll back a confirmed wallet credit.
- Restored repo-wide TypeScript checking by adding Vitest global types and fixing stale test fixtures/type annotations in matching and CRUD tests.

### Security and Reliability Checks Covered

- Provider lead preview remains customer-data safe before unlock through `lib/provider-lead-detail.ts` and `lib/provider-lead-access.ts`.
- Provider wallet reads and top-up intents continue to resolve provider identity server-side from the authenticated provider context.
- Duplicate lead unlock attempts do not double charge.
- Duplicate payment crediting remains blocked by `PaymentIntent.status` and `creditedAt` guards.
- Wallet negative-balance attempts remain blocked by optimistic `ProviderWallet.updateMany` predicates.
- Wallet mutations for top-ups, lead unlocks, refunds, promo awards, admin adjustments, suspension, and reactivation run inside Prisma transactions.
- WhatsApp delivery failures are caught after committed wallet/payment/unlock operations and do not corrupt ledger state.

### Verification Status

Final verification commands from `field-service`:

```bash
npm run test
npm run lint
npx tsc --noEmit --pretty false
npx prisma validate
git diff --check
```

Results:

- Vitest: 90 passed, 1 skipped; 757 passed tests, 4 todo.
- ESLint: passed with the existing React Hook Form compiler warning in `components/admin/crud/form.tsx`.
- TypeScript: passed.
- Prisma schema validation: passed.
- Diff whitespace check: passed.

### Remaining Pilot Notes

- The integration test explicitly documents the product rule that promo credits are consumed before paid credits. A paid-credit lead debit only happens after promo credits are exhausted.
- Manual EFT reconciliation remains human-operated; automated bank matching remains a future enhancement.
- Wallet suspension blocks lead unlock debits and writes a wallet status ledger row, but does not yet emit a provider notification.
- The wallet ledger is append-only by service convention and schema usage, but there is not yet a dedicated database trigger preventing direct row edits by privileged database users.
