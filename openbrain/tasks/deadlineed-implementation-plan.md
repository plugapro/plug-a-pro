# Deadlineed — Implementation Plan

> **Status:** Draft as of 2026-05-03
> **Parent docs:** [To-Be Journey](../journeys/deadlineed-to-be-journey.md) · [PWA Specs](../design/deadlineed-pwa-screen-specs.md) · [WhatsApp Specs](../design/deadlineed-whatsapp-flow-specs.md)
>
> **Build sequence:** M1 → M3 → M2 → M4 → M5 → M6 → M7
> Blockers (C1, C9, C10, C11, W3, P1) drive M1 + M3 first.
>
> **Conventions:**
> - Every mutation goes through `crudAction()` unless noted
> - Server actions live in co-located `actions.ts` files (see `app/(admin)/admin/customers/actions.ts` pattern)
> - New admin mutations ship behind a feature flag flipped separately
> - All feature flags seeded via `scripts/seed-flags.ts`
> - Schema changes: additive migrations only — no drops, no renames
> - Test plan: Vitest unit tests for lib functions; Playwright smoke for critical happy paths

---

## M1 — Business Identity & Multi-Site

**Closes:** C1, C2, C9, C11, W7, X1

### Tasks

#### M1-T1 — Prisma migration: `CustomerAddress` table + `Customer` business fields

**Files to touch:**
- `field-service/prisma/schema.prisma` — add:
  ```prisma
  model CustomerAddress {
    id         String   @id @default(cuid())
    customerId String
    label      String              // "Head Office", "Warehouse"
    street     String
    suburb     String
    city       String
    province   String
    postalCode String?
    lat        Float?
    lng        Float?
    locationNodeId String?
    isDefault  Boolean  @default(false)
    createdAt  DateTime @default(now())
    updatedAt  DateTime @updatedAt

    customer   Customer @relation(fields: [customerId], references: [id])
    locationNode LocationNode? @relation(fields: [locationNodeId], references: [id])
  }
  ```
  On `Customer` model: add `isBusinessAccount Boolean @default(false)`, `businessName String?`, `addresses CustomerAddress[]`
  On `JobRequest` model: add `customerAddressId String?` (FK to `CustomerAddress`)
- Run `prisma migrate dev --name add_customer_address_business_fields`

**Acceptance criteria:**
- Migration runs without errors on dev and staging
- `CustomerAddress` rows can be created, updated, deleted via Prisma client
- Existing `Customer` rows default `isBusinessAccount = false`

**Test:** Vitest migration snapshot test

---

#### M1-T2 — `CustomerMember` model (operator access)

**Files to touch:**
- `field-service/prisma/schema.prisma` — add:
  ```prisma
  model CustomerMember {
    id                String   @id @default(cuid())
    principalCustomerId String
    memberUserId      String
    memberName        String
    memberPhone       String
    role              String   @default("BOOKER")  // BOOKER | VIEWER
    active            Boolean  @default(true)
    addedAt           DateTime @default(now())

    principal Customer @relation(fields: [principalCustomerId], references: [id])
  }
  ```
  On `Customer`: add `members CustomerMember[] @relation("PrincipalCustomerMembers")`

**Acceptance criteria:** Migration runs; `CustomerMember` CRUD works

**Note:** Auth resolution for operators (mapping `memberUserId` → `principalCustomerId` in `resolveCustomerForSession()`) is part of M1-T4.

---

#### M1-T3 — Feature flag

**Files to touch:**
- `field-service/scripts/seed-flags.ts` — add `feature.customer.address_book` and `feature.deadlineed.b2b_landing`

**Acceptance criteria:** `pnpm tsx scripts/seed-flags.ts` creates both flags in `FeatureFlag` table

---

#### M1-T4 — `/account/sites` route + server actions

**Files to create:**
- `field-service/app/(customer)/account/sites/page.tsx`
- `field-service/app/(customer)/account/sites/actions.ts` — `createCustomerSiteAction`, `updateCustomerSiteAction`, `deleteCustomerSiteAction`, `setDefaultCustomerSiteAction`

**Reuse:**
- `components/customer/SuburbPicker.tsx` — suburb picker
- `components/ui/dialog.tsx` — add/edit site modal
- `components/ui/button.tsx`, `input.tsx`, `label.tsx`
- `lib/auth.ts:getSession()` + `lib/customer-session.ts:resolveCustomerForSession()`
- `lib/audit.ts:recordAuditLog()`

**Acceptance criteria:**
- Authenticated customer can add a named site with street + suburb
- Customer can set a default site
- Customer can delete a site (with confirmation dialog)
- Server action validates all required fields and returns typed errors
- `AuditLog` written for create / delete

**Playwright smoke:** Add `sites page creates and deletes a site` spec to `e2e/smoke.spec.ts`

---

#### M1-T5 — BookingFlow address step: saved site picker

**Files to touch:**
- `field-service/components/customer/BookingFlow.tsx` — `address` step: check `Customer.addresses` prop; if > 0 and flag enabled, show site picker above manual entry form

**Reuse:** `components/ui/select.tsx` or `components/ui/button.tsx` for site list

**Acceptance criteria:**
- When flag off or no saved addresses: unchanged behaviour
- When flag on and addresses exist: site picker shown; selecting a site pre-fills form fields and skips manual entry
- "Enter a new address" fallback always available

---

#### M1-T6 — Business onboarding prompt (post-OTP)

**Files to create:**
- `field-service/components/customer/BusinessTypePrompt.tsx` — modal

**Files to touch:**
- `field-service/app/(customer)/layout.tsx` — render `BusinessTypePrompt` when `Customer.isBusinessAccount === null` (first visit)

**Server action:** `setCustomerAccountTypeAction` in `field-service/app/(customer)/account/actions.ts`

**Acceptance criteria:**
- First-login customer sees prompt once
- Personal choice: `isBusinessAccount = false`, prompt not shown again
- Business choice: `isBusinessAccount = true`, optional `businessName` input, prompt not shown again

---

#### M1-T7 — WA booking multi-site picker

**Files to touch:**
- `field-service/lib/whatsapp-flows/job-request.ts` — add `collect_site` step after `collect_name`; check `Customer.addresses`
- `field-service/lib/whatsapp-bot.ts` — handle `site:<addressId>` list selection in `isStatelessNotificationReply()`

**Acceptance criteria:**
- Customer with 0 saved addresses: unchanged flow
- Customer with 1+ saved addresses: site picker shown
- Selecting a site skips the address collection steps and pre-fills conversation data
- `site_new` option enters standard address collection

---

## M2 — Repeat / Scheduled Bookings

**Closes:** C3, C4, C5

### Tasks

#### M2-T1 — "Book again" CTA on completed booking rows

**Files to touch:**
- `field-service/app/(customer)/bookings/page.tsx` — add "Book again" CTA to completed booking rows; link: `/book/{{category}}?template={{jobRequestId}}`

#### M2-T2 — BookingFlow `?template` pre-fill

**Files to touch:**
- `field-service/app/(customer)/book/[serviceId]/page.tsx` — read `?template` search param; if present, load `JobRequest` and pass `initialDraft` to `BookingFlow`
- `field-service/components/customer/BookingFlow.tsx` — `initialDraft` prop already supported; wire `title`, `description`, `urgency` from template

**Acceptance criteria:**
- Navigating to `/book/plumbing?template=<id>` pre-fills description fields
- Invalid template ID: silently ignored; blank form shown
- Playwright smoke: `book again pre-fills description`

#### M2-T3 — WA rebook keyword handler

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — add `rebook`, `book again`, `same job`, `repeat`, `book same` to a new `REBOOK_KEYWORDS` array and route to `handleRebookFlow()`
- `field-service/lib/whatsapp-flows/job-request.ts` — add `handleRebookFlow()` per WA spec Flow CW1

**Acceptance criteria:**
- Customer with completed job: receives rebook confirmation buttons
- Customer with no completed jobs: receives "start fresh" redirect
- `rebook_confirm:<id>` skips address entry and jumps to availability

---

## M3 — Quote Parity (PWA + WA)

**Closes:** W3, C13, C14, C15

### Tasks

#### M3-T1 — `Quote.approvalWhatsappSentAt` migration

**Files to touch:**
- `field-service/prisma/schema.prisma` — add `approvalWhatsappSentAt DateTime?` to `Quote`
- `field-service/prisma/schema.prisma` — add `matchFoundWhatsappSentAt DateTime?` to `JobRequest`

#### M3-T2 — `sendCustomerQuoteReadyNotification()`

**Files to touch:**
- `field-service/lib/whatsapp.ts` — new function `sendCustomerQuoteReadyNotification(params)` per WA spec Flow CW3
- Register `customer_quote_ready` template with Meta (manual step — ops task)

**Trigger point:** wherever `Quote` is created by the provider flow (typically `app/api/provider/quotes/route.ts` or equivalent quote creation action)

**Acceptance criteria:**
- Sends once per quote (idempotency via `approvalWhatsappSentAt`)
- Cohort safety: `assertCohortSendAllowed()` called
- `MessageEvent` logged

#### M3-T3 — WA quote accept/decline handler

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — `isStatelessNotificationReply()` already matches `quote_accept_*` / `quote_decline_*`; add handler function calls `handleQuoteAcceptReply()` / `handleQuoteDeclineReply()`
- New functions in `field-service/lib/whatsapp-flows/` or inline in bot (small enough)

**Acceptance criteria:**
- `quote_accept_<id>`: updates `Quote.status = 'APPROVED'`, creates `Booking`, notifies provider
- `quote_decline_<id>`: updates `Quote.status = 'DECLINED'`, notifies provider
- Double-tap: idempotent (already-approved/declined quote returns confirmation without re-processing)
- `AuditLog` written

#### M3-T4 — `sendCustomerMatchFoundNotification()`

**Files to touch:**
- `field-service/lib/whatsapp.ts` — new function `sendCustomerMatchFoundNotification(params)` per WA spec Flow CW4
- Trigger in `lib/matching/orchestrator.ts` after `Lead` dispatched (step where `notifyProviderNewJob()` is called)

**Acceptance criteria:**
- Sends once per `JobRequest` (idempotency via `matchFoundWhatsappSentAt`)
- Template: `customer_match_found` (register with Meta)

#### M3-T5 — Inline quote approve/decline on PWA (`QuoteHistoryTimeline`)

**Files to touch:**
- `field-service/components/quotes/QuoteHistoryTimeline.tsx` — when `quote.status = 'PENDING'` and `audience = 'customer'`: show inline Approve / Decline buttons (currently only shows the external `/approve/[token]` link)

**Acceptance criteria:**
- Buttons call existing server action (reuse current `app/(customer)/requests/[id]/page.tsx` approve logic)
- Optimistic UI: button disabled + spinner on click

---

## M4 — Provider PWA Inbox

**Closes:** P1, P2, P3, P4, P5

### Tasks

#### M4-T1 — Provider auth guard + route group

**Files to create:**
- `field-service/app/(provider)/layout.tsx` — `requireProvider()` guard from `lib/auth.ts`

**Feature flag:** `feature.provider.pwa_inbox` — seed in `scripts/seed-flags.ts`

#### M4-T2 — Lead inbox (`/provider/leads`)

**Files to create:**
- `field-service/app/(provider)/leads/page.tsx` — per PWA spec P1
- `field-service/app/(provider)/leads/actions.ts` — `acceptLeadAction()`, `declineLeadAction()`
- `field-service/app/(provider)/leads/[leadId]/page.tsx` — per PWA spec P2

**Reuse:**
- `lib/provider-wallet.ts:getProviderWalletBalanceReadOnly()`
- `lib/provider-lead-access.ts:getProviderSignedJobHandoverUrlByLeadId()`
- Existing `Lead` accept/decline logic from `lib/whatsapp-bot.ts` refactored into shared service function
- `components/shared/StatusBadge.tsx`, `components/shared/EmptyState.tsx`

**Acceptance criteria:**
- Provider sees `SENT` / `VIEWED` leads in inbox
- Accept: deducts 1 credit, creates `Match`, sends customer match-found notification (M3-T4)
- Decline: marks lead `DECLINED`, triggers re-dispatch
- Insufficient credits: inline callout; no crash

**Playwright smoke:** `provider lead inbox accept lead`

#### M4-T3 — Profile editor (`/provider/profile`)

**Files to create:**
- `field-service/app/(provider)/profile/page.tsx` — per PWA spec P3
- `field-service/app/(provider)/profile/actions.ts` — `updateProviderProfileAction()`, `reuploadProviderDocumentsAction()`

**Reuse:**
- `lib/service-categories.ts:SERVICE_CATEGORY_OPTIONS` for skill multi-select
- `components/customer/SuburbPicker.tsx` for service area editing
- `lib/storage.ts` (Vercel Blob) for document re-upload

**Acceptance criteria:**
- Provider can update name, bio, experience, skills, service areas, portfolio URLs
- Re-upload triggers a new `ProviderApplication` row with amendment flag (does not remove active status)
- `AuditLog` written on save

#### M4-T4 — Availability toggle (`/provider/availability`)

**Files to create:**
- `field-service/app/(provider)/availability/page.tsx` — per PWA spec P4
- `field-service/app/(provider)/availability/actions.ts` — `pauseProviderAction()`, `resumeProviderAction()`

**Reuse:**
- `lib/matching/customer-recontact.ts:checkJobsForNewProviderAvailability()` — call on resume

**Acceptance criteria:**
- Pause with duration: sets `TechnicianAvailability.availabilityState = 'PAUSED'` + `breakUntil`
- Resume: clears `breakUntil`, sets `availableNow = true`, triggers `checkJobsForNewProviderAvailability()`
- Mirrors existing WA `offline`/`available` keyword logic exactly

#### M4-T5 — Earnings dashboard (`/provider/earnings`)

**Files to create:**
- `field-service/app/(provider)/earnings/page.tsx` — per PWA spec P5

**Reuse:**
- `lib/provider-wallet.ts:getProviderWalletBalanceReadOnly()`

**Acceptance criteria:**
- Shows credit balance (total, promo, paid)
- Shows last 10 completed jobs with amounts
- Zero credits: warning callout
- Top up CTA links to existing credit purchase flow

---

## M5 — Provider WhatsApp Enhancements

**Closes:** Q1, Q2, Q3, Q4, Q5

### Tasks

#### M5-T1 — Pause / resume with duration (PW1)

**Files to touch:**
- `field-service/lib/whatsapp-flows/provider-journey.ts` — add `pause`, `break`, `back later`, `back in 1 hour`, `back in 2 hours`, `back tomorrow` to `PROVIDER_JOURNEY_TRIGGERS`; add `handlePauseFlow()` function per WA spec PW1

**Acceptance criteria:**
- Pause keywords trigger duration picker
- Duration buttons write `TechnicianAvailability.breakUntil`
- Confirmation message with resume time sent
- Auto-resume cron already in place (match-leads step 1j)

#### M5-T2 — Location share on accept (PW2)

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — after accept confirmation, set conversation step `post_accept_location_prompt`; handle `message.type === 'location'` for this step
- New `Job` fields: `providerCurrentLat Float?`, `providerCurrentLng Float?`, `providerLocationSharedAt DateTime?` — migration
- `field-service/lib/whatsapp.ts` — add `sendCustomerEnRouteNotification()` called from location handler

**Acceptance criteria:**
- Provider prompted for location after accept
- WA location message: coordinates stored on `Job`; customer notified
- `skip` reply: skips gracefully

#### M5-T3 — Running late comms (PW3)

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — add `running late`, `delayed`, `late`, `stuck in traffic` keywords; route to `handleRunningLateFlow()`
- `field-service/lib/whatsapp.ts` — add `sendCustomerRunningLateNotification()`
- Register `customer_provider_running_late` template with Meta

#### M5-T4 — Provider dispute trigger (PW4)

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — add `dispute`, `issue with job`, `raise issue` keywords; route to `handleProviderDisputeFlow()`
- `field-service/lib/whatsapp-flows/provider-journey.ts` — `handleProviderDisputeFlow()` per WA spec PW4

**Acceptance criteria:**
- Creates `Dispute` row with `raisedByRole: 'provider'`
- `AuditLog` written
- Confirmation with dispute reference sent

#### M5-T5 — Post-job invoice (PW5)

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — add `invoice`, `send invoice`, `receipt` keywords; route to `handleInvoiceFlow()`
- New function `sendProviderJobInvoice()` in `lib/whatsapp.ts`

**Acceptance criteria:**
- Formatted invoice text sent to customer phone
- Only fires for completed jobs
- Confirmation sent to provider

---

## M6 — Provider Browse on Customer PWA

**Closes:** C7, P7

### Tasks

#### M6-T1 — Remove match gate from provider profile

**Files to touch:**
- `field-service/app/(customer)/providers/[id]/page.tsx` — remove `hasRelationship` guard (lines 34–44)

**Feature flag:** `feature.customer.provider_browse`

#### M6-T2 — Provider catalogue page (`/providers`)

**Files to create:**
- `field-service/app/(customer)/providers/page.tsx` — per PWA spec C6

**Reuse:**
- `components/shared/ProviderCard.tsx` (activate — currently unused)
- `lib/service-categories.ts:SERVICE_CATEGORY_OPTIONS` for category filter
- `lib/location-nodes.ts` for area filter

**Acceptance criteria:**
- Lists active, verified providers filtered by category and/or area
- `ProviderCard` shows name, skills, service areas, rating, verified badge
- Each card links to `/providers/[id]`
- Pagination (take: 20)

---

## M7 — Instrumentation & Audit

**Closes:** C16, X2, X4, X5

### Tasks

#### M7-T1 — B2B feature flag cohort

**Files to touch:**
- `field-service/scripts/seed-flags.ts` — add `feature.deadlineed.b2b_landing`, `feature.customer.address_book`, `feature.provider.pwa_inbox`, `feature.customer.provider_browse` if not already added in earlier milestones

#### M7-T2 — Customer activity log page

**Files to create:**
- `field-service/app/(customer)/account/activity/page.tsx`

Reads `AuditLog` rows where `actorId = session.id` OR `entityId IN (customer.jobRequestIds)`, paginated, most recent first.

**Acceptance criteria:**
- Shows last 50 events with action, entity type, and timestamp
- No ops-only fields (no `before`/`after` raw JSON exposed)

#### M7-T3 — Booking SLA visibility on request detail

**Files to touch:**
- `field-service/app/(customer)/requests/[id]/page.tsx` — when no match yet: add callout "We're looking for a provider — typically matched within 5–30 minutes."

**Copy variants:**
- Day hours: "typically within 5–15 minutes"
- Off-hours: "typically within 30–60 minutes (off-peak)"
- Night: "we'll pick this up first thing in the morning"

Hour-of-day derived from `new Date()` server-side; no extra DB query.

---

## Meta Template Registration (ops task, parallel with M3)

These templates must be submitted to Meta for approval before M3 / M5 can go live:

| Template | Priority |
|----------|---------|
| `customer_quote_ready` | M3 — blocker |
| `customer_match_found` | M3 |
| `customer_provider_en_route` | M5 |
| `customer_provider_running_late` | M5 |
| `provider_invoice_send` | M5 |

Meta review typically takes 24–72 h. Submit as soon as M3 dev starts.

---

## Testing Checklist

| Scope | Test type | File |
|-------|----------|------|
| `CustomerAddress` CRUD | Vitest | `__tests__/lib/customer-address.test.ts` (new) |
| WA rebook flow | Vitest | `__tests__/lib/whatsapp-flows/rebook.test.ts` (new) |
| WA quote accept/decline | Vitest | `__tests__/lib/whatsapp-flows/quote-approval.test.ts` (new) |
| WA pause/resume | Vitest | extend `__tests__/lib/provider-availability.test.ts` |
| Lead inbox accept | Vitest | extend `__tests__/lib/lead-unlocks.test.ts` |
| Sites page | Playwright | `e2e/smoke.spec.ts` — add `sites page` spec |
| Lead inbox | Playwright | `e2e/smoke.spec.ts` — add `provider lead inbox` spec |
| Booking dashboard filters | Playwright | `e2e/smoke.spec.ts` — add `bookings filter by site` spec |
