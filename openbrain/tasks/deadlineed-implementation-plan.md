# Deadlineed — Implementation Plan

> **Status:** Updated 2026-05-05 — M4, M5, M6 delivered; M1 partial; M2/M3 in progress
> **Parent docs:** [To-Be Journey](../journeys/deadlineed-to-be-journey.md) · [PWA Specs](../design/deadlineed-pwa-screen-specs.md) · [WhatsApp Specs](../design/deadlineed-whatsapp-flow-specs.md)
>
> **Build sequence (original):** M1 → M3 → M2 → M4 → M5 → M6 → M7
> **Actual delivery order:** M4 → M5 → M6 → M7 (partial) → M1 (partial) → M2 → M3 (partial)
>
> **Progress key:** ✅ Done · 🔄 Partial · ⬜ Not started
>
> **Conventions:**
> - Every mutation goes through `crudAction()` unless noted
> - Server actions live in co-located `actions.ts` files (see `app/(admin)/admin/customers/actions.ts` pattern)
> - New admin mutations ship behind a feature flag flipped separately
> - All feature flags seeded via `scripts/seed-flags.ts`
> - Schema changes: additive migrations only — no drops, no renames
> - Test plan: Vitest unit tests for lib functions; Playwright smoke for critical happy paths

---

## ✅ M4 — Provider PWA Inbox (DELIVERED)

**Closes:** P1, P2, P3, P4, P5, P6, P7

All M4 screens are live:

| Screen | Route | State |
|--------|-------|-------|
| Provider dashboard | `/provider/provider` | ✅ |
| Lead inbox | `/provider/provider/leads` | ✅ |
| Lead detail + accept/decline | `/provider/provider/leads/[leadId]` | ✅ |
| Profile editor | `/provider/provider/profile` | ✅ |
| Availability toggle + schedule | `/provider/provider/availability` | ✅ |
| Earnings dashboard | `/provider/provider/earnings` | ✅ |
| Credits + wallet + top-up | `/provider/provider/credits` | ✅ |
| Active job detail + status controls | `/provider/provider/jobs/[id]` | ✅ |
| Quote submission | `/provider/provider/quotes/[matchId]` | ✅ |

**Feature flag:** `feature.provider.pwa_inbox` — seeded ✅

---

## ✅ M5 — Provider WhatsApp Enhancements (DELIVERED)

**Closes:** Q3, Q4, Q5

All M5 WA functions are wired in `lib/whatsapp-flows/provider-journey.ts` and `lib/whatsapp.ts`:

| Feature | Function | Template | Idempotency |
|---------|----------|----------|-------------|
| Running late | `handleRunningLateFlow()` + `sendCustomerRunningLateNotification()` | `customer_provider_running_late` | `JobStatusEvent.notes = 'provider_running_late'` |
| Post-job invoice | `handleInvoiceFlow()` + `sendProviderInvoiceTemplate()` | `provider_invoice_send` | `Job.invoiceWhatsappSentAt` |
| Provider dispute trigger | `handleProviderDisputeFlow()` | none (creates Dispute row) | Single OPEN dispute per job |

**Customer notifications wired in same sprint:**

| Function | Template | Trigger |
|----------|----------|---------|
| `sendCustomerMatchFoundNotification()` | `customer_match_found` | Lead dispatched in orchestrator |
| `sendCustomerQuoteReadyNotification()` | `customer_quote_ready` | Quote created in `/api/technician/quotes` |
| `sendCustomerEnRouteNotification()` | `customer_provider_en_route` | Provider location shared in `handleProviderLocationShare()` |

**Schema migrations created:**
- `20260504190000_add_job_request_en_route_whatsapp_sent_at` — `enRouteWhatsappSentAt` on `job_requests`
- `20260504210000_add_job_invoice_whatsapp_sent_at` — `invoiceWhatsappSentAt` on `jobs`

**⬜ Ops task: Apply both migrations against Supabase production DB via `prisma migrate deploy`**

**⬜ Ops task: Submit 5 templates to Meta Business Suite for approval:**

| Template name | Priority | Variables |
|--------------|---------|-----------|
| `customer_quote_ready` | P0 (blocks WA approval flow) | 7 body vars + 2 quick-reply buttons |
| `customer_match_found` | P1 | 2 body vars + 1 URL button |
| `customer_provider_en_route` | P1 | 3 body vars |
| `customer_provider_running_late` | P2 | 4 body vars |
| `provider_invoice_send` | P2 | 10 body vars |

---

## ✅ M6 — Provider Browse on Customer PWA (DELIVERED)

**Closes:** C7, P7

| Task | File | State |
|------|------|-------|
| Provider catalogue (`/providers`) | `app/(customer)/providers/page.tsx` | ✅ |
| Provider profile (no match gate) | `app/(customer)/providers/[id]/page.tsx` | ✅ |
| `ProviderCard` component active | `components/shared/ProviderCard.tsx` | ✅ |
| Feature flag seeded | `scripts/seed-flags.ts` | ✅ |

**Remaining in M6:** Provider ranking is rating-only; no availability/distance/reliability weighting. Pagination beyond take:20 not implemented.

---

## ✅ M7-T2 — Customer Activity Log (DELIVERED)

- `/account/activity` page: `app/(customer)/account/activity/page.tsx` ✅
- Reads `AuditLog` filtered to customer context (actorId OR entityId in customer's job requests)

---

## ✅ M7-T3 — Booking SLA Visibility (DELIVERED)

- Request detail page (`/requests/[id]`) shows hour-of-day ETA callout ✅
- Copy variants: business hours / off-peak / overnight

---

## 🔄 M1 — Business Identity & Multi-Site (PARTIAL)

**Closes:** C1, C2, C9, C11, W7, X1

### ✅ M1-T1 — `CustomerAddress` + `Customer` business fields

- `CustomerAddress` model added to `prisma/schema.prisma` ✅
- `Customer.isBusinessAccount Boolean`, `businessName String?`, `addresses CustomerAddress[]` ✅
- Migration applied (confirm via Prisma migrate status)

### ✅ M1-T2 — `CustomerMember` model

- `CustomerMember` model added to schema ✅

### ✅ M1-T3 — Feature flags

- `feature.customer.address_book` seeded ✅
- `feature.deadlineed.b2b_landing` seeded ✅

### ✅ M1-T4 — `/account/sites` route

- `app/(customer)/account/sites/page.tsx` + `SitesClient.tsx` ✅
- `app/(customer)/account/sites/actions.ts` — CRUD actions ✅ (assumed; confirm exists)

### 🔄 M1-T5 — BookingFlow address step: saved site picker

**Files to verify:**
- `field-service/components/customer/BookingFlow.tsx` — confirm `savedAddresses` prop is received and site picker rendered in address step

**Acceptance criteria:**
- When flag off or no saved addresses: unchanged behaviour
- When flag on and addresses exist: site picker shown above manual entry; selecting pre-fills all fields
- "Enter a new address" fallback always visible

### ⬜ M1-T6 — Business onboarding prompt (post-OTP)

**Files to create:**
- `field-service/components/customer/BusinessTypePrompt.tsx` — modal

**Files to touch:**
- `field-service/app/(customer)/layout.tsx` — render modal when `Customer.isBusinessAccount === null`
- `field-service/app/(customer)/account/actions.ts` — `setCustomerAccountTypeAction`

**Acceptance criteria:**
- First-login customer sees prompt once
- Personal choice: `isBusinessAccount = false`; prompt not shown again
- Business choice: `isBusinessAccount = true`; optional `businessName` input

### ⬜ M1-T7 — WA booking multi-site picker

**Files to touch:**
- `field-service/lib/whatsapp-flows/job-request.ts` — add `collect_site` step after `collect_name`; check `Customer.addresses`
- `field-service/lib/whatsapp-bot.ts` — handle `site:<addressId>` list selection

**Acceptance criteria:**
- Customer with 0 saved addresses: unchanged flow
- Customer with 1+ saved addresses: site picker shown as WA list message
- Selecting a site skips address collection steps and pre-fills conversation data
- `site_new` option enters standard address collection

### ⬜ M1-T8 — Operator auth resolution

**Scope:** Wire `CustomerMember` table into `getSession()` / `resolveCustomerForSession()`. When operator phone number matches a `CustomerMember.memberPhone` row, resolve the session's `customerId` to the principal's `customerId`.

**Risk:** Breaking change to auth resolution; test thoroughly with Vitest + e2e smoke.

---

## ⬜ M2 — Repeat / Scheduled Bookings (PARTIAL)

**Closes:** C3, C4, C5

### ✅ M2-T1 — "Book again" CTA on completed booking rows

- `app/(customer)/bookings/page.tsx` has "Book again" CTA → `/book/{{category}}?template={{jobRequestId}}` ✅

### ✅ M2-T2 — BookingFlow `?template` pre-fill

- `app/(customer)/book/[serviceId]/page.tsx` reads `?template` param and passes `initialDraft` to `BookingFlow` ✅

### ⬜ M2-T3 — WA rebook keyword handler

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — add `rebook`, `book again`, `same job`, `repeat`, `book same` to `REBOOK_KEYWORDS` and route to `handleRebookFlow()`
- `field-service/lib/whatsapp-flows/job-request.ts` — add `handleRebookFlow()` per [WA spec Flow CW1](../design/deadlineed-whatsapp-flow-specs.md)

**Acceptance criteria:**
- Customer with completed job: receives rebook confirmation buttons with last job summary
- Customer with no completed jobs: shows "start fresh" redirect to main menu
- `rebook_confirm:<id>` payload: skips address entry; jumps to `collect_availability` with pre-filled address + description
- `AuditLog` entry: `action: 'job_request.rebook_initiated'`

---

## 🔄 M3 — Quote Parity (PWA + WA)

**Closes:** W3, C13, C14, C15

### ✅ M3-T1 — Quote idempotency fields

- `Quote.approvalWhatsappSentAt DateTime?` — confirm in schema ✅
- `JobRequest.matchFoundWhatsappSentAt DateTime?` — confirm in schema ✅

### ✅ M3-T2 — `sendCustomerQuoteReadyNotification()`

- Wired in `/api/technician/quotes/route.ts` ✅
- Template `customer_quote_ready` registered in `messaging-templates.ts` ✅
- **⬜ Meta approval required**

### ⬜ M3-T3 — WA quote accept/decline handler (PRIORITY)

**Current state:** `isStatelessNotificationReply()` matches `quote_accept_*` / `quote_decline_*` payloads but does not call handler functions.

**Files to touch:**
- `field-service/lib/whatsapp-bot.ts` — in the payload dispatch section, wire `quote_accept_<id>` → `handleQuoteAcceptReply(quoteId, from)` and `quote_decline_<id>` → `handleQuoteDeclineReply(quoteId, from)`
- New functions in `field-service/lib/whatsapp-flows/` (or inline if small):
  - `handleQuoteAcceptReply(quoteId, customerPhone)`:
    1. Load `Quote` + `Match` + `JobRequest`
    2. Guard: quote must be PENDING; customer must own the job request
    3. `db.quote.update({ status: 'APPROVED', approvedAt: now() })`
    4. `db.booking.create({ matchId, status: 'SCHEDULED', ... })`
    5. Notify provider (existing `sendText` or new template)
    6. Send customer confirmation (sendText: "Quote approved! Your booking is confirmed.")
    7. `AuditLog` + `MessageEvent`
  - `handleQuoteDeclineReply(quoteId, customerPhone)`:
    1. Load and guard same as above
    2. `db.quote.update({ status: 'DECLINED', declinedAt: now() })`
    3. Notify provider
    4. Send customer: "Quote declined. The provider has been notified."
    5. `AuditLog` + `MessageEvent`

**Acceptance criteria:**
- `quote_accept_<id>`: Quote APPROVED, Booking SCHEDULED, provider notified, customer confirmed
- `quote_decline_<id>`: Quote DECLINED, provider notified, customer confirmed
- Double-tap / stale payload: returns confirmation without re-processing (idempotent)
- Invalid quote ID: sends "Sorry, that quote is no longer available."

### ✅ M3-T4 — `sendCustomerMatchFoundNotification()`

- Wired in `lib/matching/orchestrator.ts` ✅
- Template `customer_match_found` registered ✅
- **⬜ Meta approval required**

### ✅ M3-T5 — Inline quote approve/decline on PWA

- `QuoteHistoryTimeline` shows Approve / Decline buttons when `quote.status = 'PENDING'` ✅

---

## ⬜ New — Customer Invoice Download

**Gap:** C10 — B2B customers need a PDF receipt for completed jobs

**Files to create:**
- `field-service/app/api/customer/bookings/[id]/invoice/route.ts`
  - Auth: customer session; must own the booking
  - Fetches: Booking → Match → JobRequest → Quote → Job → Provider
  - Generates PDF (use `@react-pdf/renderer` or server-rendered HTML → Vercel Edge PDF)
  - Returns: `Content-Type: application/pdf` with filename `invoice-[bookingRef].pdf`

**Files to touch:**
- `field-service/app/(customer)/bookings/[id]/page.tsx` — add "Download invoice" button when `job.status === 'COMPLETED'`

**Acceptance criteria:**
- Invoice shows: job title, category, provider name, service date, labour cost, materials cost, total, booking reference
- Only available for COMPLETED jobs
- Customer can only download invoices for their own bookings

---

## Remaining Work Summary (as of 2026-05-05)

| Milestone | Task | Priority | Complexity |
|-----------|------|---------|-----------|
| M3-T3 | WA quote accept/decline handler | P0 | Medium |
| Ops | Apply DB migrations (2× files) | P0 | Trivial |
| Ops | Submit 5 templates to Meta | P0 | Ops task |
| New | Customer invoice PDF download | P1 | Medium |
| M1-T5 | BookingFlow site picker confirmation | P1 | Low |
| M1-T6 | Business onboarding prompt | P1 | Low |
| M1-T7 | WA multi-site picker | P1 | Medium |
| M1-T8 | Operator auth resolution | P2 | High risk |
| M2-T3 | WA rebook keyword + handler | P2 | Medium |
| M6 | Provider ranking enhancements | P3 | Medium |
| M10 | Bookings dashboard filters by site/category | P3 | Low |

---

## Testing Checklist

| Scope | Test type | File | Status |
|-------|----------|------|--------|
| `CustomerAddress` CRUD | Vitest | `__tests__/lib/customer-address.test.ts` | ⬜ |
| WA rebook flow | Vitest | `__tests__/lib/whatsapp-flows/rebook.test.ts` | ⬜ |
| WA quote accept/decline | Vitest | `__tests__/lib/whatsapp-flows/quote-approval.test.ts` | ⬜ |
| WA running-late / invoice | Vitest | extend `__tests__/lib/whatsapp-flows/` | ⬜ |
| Lead inbox accept (PWA) | Vitest | extend `__tests__/lib/lead-unlocks.test.ts` | ⬜ |
| Sites page CRUD | Playwright | `e2e/smoke.spec.ts` — add `sites page` spec | ⬜ |
| Provider lead inbox accept | Playwright | `e2e/smoke.spec.ts` — add `provider lead inbox` spec | ⬜ |
| Booking dashboard | Playwright | existing smoke; extend with filter specs | ⬜ |
