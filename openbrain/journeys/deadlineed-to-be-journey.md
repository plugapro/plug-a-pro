# Deadlineed — To-Be Journey

> **Status:** Target state — updated 2026-05-05
> **Related:** [As-Is Journey](deadlineed-as-is-journey.md) · [Gap Analysis](deadlineed-gap-analysis.md)
> **PWA screen specs:** [deadlineed-pwa-screen-specs.md](../design/deadlineed-pwa-screen-specs.md)
> **WA flow specs:** [deadlineed-whatsapp-flow-specs.md](../design/deadlineed-whatsapp-flow-specs.md)
> **Implementation plan:** [deadlineed-implementation-plan.md](../tasks/deadlineed-implementation-plan.md)
>
> **Progress key:** ✅ Done · 🔄 Partial · ⬜ Not started

---

## Identity Model

Deadlineed operates with a two-tier identity:

- **Principal:** The primary account holder (e.g., "Acme Facilities"). One Supabase user + one `Customer` row. Has full access to all bookings across all sites.
- **Operators:** Named staff who can book under the principal account. Each operator has their own phone OTP session but their `JobRequest` rows are tagged with the `customerId` of the principal.

**Schema state:** `CustomerMember` model exists in `prisma/schema.prisma`; `Customer.isBusinessAccount` and `businessName` fields exist.

**Implementation state:**
- ✅ Schema: `CustomerAddress`, `CustomerMember`, `Customer.isBusinessAccount`
- ✅ Feature flags seeded: `feature.customer.address_book`, `feature.deadlineed.b2b_landing`
- 🔄 `/account/sites` page: LIVE
- ⬜ Operator auth wiring in `getSession()` / `resolveCustomerForSession()` — not yet done
- ⬜ Team invite UI — not yet built
- ⬜ Business onboarding prompt (post-OTP modal) — not yet built

---

## Channel 1 — Customer PWA (To-Be)

### Step 1: Landing (enhanced)

- Hero: "Book trusted tradespeople for your business" (or A/B tested B2B variant behind `feature.deadlineed.b2b_landing` flag)
- **⬜** New secondary CTA: **Manage sites →** `/account/sites` (visible for `isBusinessAccount` customers only)

### Step 2: Authentication

- OTP unchanged (Supabase phone OTP)
- **⬜** Post-OTP: if first login, short onboarding prompt: "Is this for personal or business use?" → sets `Customer.isBusinessAccount`

### Step 3: Multi-Site Address Book (`/account/sites`) — ✅ LIVE

See [PWA Screen Specs — Address Book](../design/deadlineed-pwa-screen-specs.md#screen-c1).

- Deadlineed can save multiple named sites: "Head Office", "Warehouse", "Shop Front"
- Each site is a `CustomerAddress` row linked to `Customer.id`
- Default site used as pre-fill on BookingFlow Step 1

### Step 4: BookingFlow (enhanced)

#### Step 4a: Address — 🔄 Partial

- **✅** Saved site picker prop passes into `BookingFlow` from server page when flag on and addresses exist
- **🔄** Full address-step UX confirmation needed: selecting a site pre-fills all fields and skips manual entry
- "Enter a new address" fallback always available

#### Step 4b: Description — ✅ Template pre-fill LIVE

- **✅ "Book again" CTA** on completed bookings → `/book/[cat]?template=[id]` → pre-fills title + description
- **✅ `?template` param** loading in BookingFlow server page

#### Steps 4c–4d: unchanged

### Step 5: Request Tracking (`/requests/[id]`) — ✅ SLA callout LIVE

- **✅** SLA callout shows matching ETA copy based on time-of-day
- **✅** Quote History Timeline shows Approve / Decline inline buttons for PENDING quotes
- **✅** Provider card shows verified/skills/trust signals
- **⬜** Match-found banner (WA notification wired; PWA banner may not yet show for mid-flow polling)

### Step 6: Booking Tracking (`/bookings/[id]`) — 🔄 Partial

- **🔄** Invoice download: not yet implemented — B2B customers need PDF receipt
- **✅** En-route notification: `customer_provider_en_route` template wired on WA; PWA timeline shows EN_ROUTE status
- **⬜** Business-relevant cancel reasons

### Step 7: Extra Work Approval (`/approve/[token]`) — unchanged

### Step 8: Provider Profile — ✅ LIVE (flag-gated)

- **✅** Prior-match gate removed under `feature.customer.provider_browse` flag
- **✅** Full trust signals: verified badge, skills, reviews, experience, portfolio

### Step 9: Provider Catalogue (`/providers`) — ✅ LIVE (flag-gated)

- **✅** Category filter bar, provider list ordered by rating
- **⬜** Ranking by availability, distance, or reliability score — still rating-only
- **⬜** Pagination beyond take:20

### Step 10: My Bookings Dashboard — 🔄 Partial

- **✅** "Book again" CTA on completed rows
- **⬜** Site filter (dropdown to filter by CustomerAddress)
- **⬜** Category filter
- **⬜** Request a job FAB

---

## Channel 2 — Customer WhatsApp (To-Be)

### Quote Approval via WhatsApp Buttons — 🔄 Partial

- **✅** `customer_quote_ready` template wired on quote creation; sends Accept/Decline quick-reply buttons
- **⬜** Handler in `whatsapp-bot.ts` for `quote_accept_<id>` / `quote_decline_<id>` payloads NOT yet wired
- On completion: updates `Quote.status`, creates `Booking`, notifies provider

### Match-Found Notification — ✅ WIRED (Meta approval pending)

- **✅** `sendCustomerMatchFoundNotification()` called in matching orchestrator
- **✅** Template registered in `lib/messaging-templates.ts`
- **⬜** Meta Business Suite template approval required before live sends succeed

### En-Route Notification — ✅ WIRED (Meta approval pending)

- **✅** `sendCustomerEnRouteNotification()` wired to provider location-share event
- **⬜** Meta approval pending

### Running-Late Notification — ✅ WIRED (Meta approval pending)

- **✅** `handleRunningLateFlow()` + `sendCustomerRunningLateNotification()` wired
- **⬜** Meta approval pending

### Rebook Keyword — ⬜ NOT YET BUILT

New keyword group to add to `lib/whatsapp-bot.ts`:
- Keywords: `rebook`, `book again`, `same job`, `repeat`, `book same`
- Handler: fetches last COMPLETED job request → offers to pre-fill flow
- See [WA Flow Specs — CW1](../design/deadlineed-whatsapp-flow-specs.md)

### Multi-Site WA Address Picker — ⬜ NOT YET BUILT

After trigger keyword "Request a job" and name collection:
- If `Customer.addresses.length > 1`, show a WA list of saved sites
- User selects a site; flow jumps to `collect_availability` skipping address steps
- `site_new` option enters standard address collection
- See [WA Flow Specs — CW2](../design/deadlineed-whatsapp-flow-specs.md)

---

## Channel 3 — Provider PWA (To-Be) — ✅ IMPLEMENTED (M4)

All M4 deliverables are live behind `feature.provider.pwa_inbox` flag:

| Screen | Route | Status |
|--------|-------|--------|
| Dashboard | `/provider` | ✅ |
| Lead inbox | `/provider/leads` | ✅ |
| Lead detail + accept/decline | `/provider/leads/[leadId]` | ✅ |
| Profile editor + reviews | `/provider/profile` | ✅ |
| Availability toggle | `/provider/availability` | ✅ |
| Earnings dashboard | `/provider/earnings` | ✅ |
| Credits & wallet | `/provider/credits` | ✅ |
| Active job detail | `/provider/jobs/[id]` | ✅ |
| Quote submission | `/provider/quotes/[matchId]` | ✅ |

**Remaining provider PWA gaps:**
- ⬜ Quick-duration pause buttons on availability page (currently datetime picker only)
- ⬜ Location share prompt after PWA lead acceptance (WA-only currently)

---

## Channel 4 — Provider WhatsApp (To-Be)

### Pause / Resume with Duration — 🔄 Partial

- **✅** `/provider/availability` page supports PAUSED mode with datetime picker
- **⬜** WA `offline` keyword is still a binary toggle — quick duration buttons (`pause 1h`, `break`, `back tomorrow`) not yet added to `PROVIDER_JOURNEY_TRIGGERS`

### Location Share on Accept — 🔄 Partial

- **✅** `sendCustomerEnRouteNotification()` wired; triggers when provider shares location
- **⬜** Automatic WA location prompt after lead acceptance not yet added to bot flow
- **⬜** `Job.providerCurrentLat / Lng / providerLocationSharedAt` fields may need schema migration

### Running-Late Comms — ✅ IMPLEMENTED

- **✅** `handleRunningLateFlow()` wired with keywords; `customer_provider_running_late` template registered
- **⬜** Meta template approval pending

### Provider Dispute Trigger — ✅ IMPLEMENTED

- **✅** `handleProviderDisputeFlow()` wired

### Post-Job Invoice — ✅ IMPLEMENTED

- **✅** `handleInvoiceFlow()` + `sendProviderInvoiceTemplate()` wired; idempotency via `Job.invoiceWhatsappSentAt`
- **⬜** Meta template `provider_invoice_send` approval pending

---

## Shared Backend Journey

### State Machine

```
JobRequest statuses:
  PENDING_VALIDATION → OPEN → MATCHING → MATCHED → EXPIRED | CANCELLED

Lead statuses:
  SENT → VIEWED → ACCEPTED | DECLINED | EXPIRED

Match statuses:
  PROPOSED → INSPECTION_SCHEDULED → INSPECTION_COMPLETE → QUOTED → QUOTE_APPROVED → CANCELLED

Booking statuses:
  SCHEDULED | RESCHEDULED | CANCELLED | COMPLETED

Job statuses:
  SCHEDULED → EN_ROUTE → ARRIVED → STARTED → PAUSED
  → AWAITING_APPROVAL → PENDING_COMPLETION_CONFIRMATION
  → COMPLETED | FAILED | CALLBACK_REQUIRED

Quote statuses:
  PENDING → APPROVED | DECLINED | EXPIRED
```

### Data Flow: PWA action → Backend → WhatsApp trigger → Customer update

```
1. Customer submits job request (PWA or WA)
   → POST /api/customer/bookings
   → Creates JobRequest (status: OPEN)
   → Triggers matching orchestrator

2. Matching orchestrator runs (cron: every 5 min day / 30 min off-hours)
   → Loads candidate pool; filters; scores; ranks
   → Atomically reserves best provider
   → Creates Lead (status: SENT)
   → Sends `job_offer` template to provider (WhatsApp)
   → Sends `customer_match_found` template to customer (WhatsApp) [Meta approval required]
   → Updates JobRequest.status → MATCHING

3. Provider accepts lead (WA button or PWA `/provider/leads/[leadId]`)
   → Deducts 1 credit from wallet
   → Creates LeadUnlock
   → Creates Match (status: PROPOSED)
   → Lead.status → ACCEPTED
   → Sends match confirmation to provider
   → Customer receives no additional notification (match-found already sent in step 2)

4. Provider submits quote (PWA `/provider/quotes/[matchId]` or WA)
   → POST /api/technician/quotes
   → Creates Quote (status: PENDING)
   → Sends `customer_quote_ready` template to customer [Meta approval required]
   → Match.status → QUOTED

5. Customer approves quote (PWA QuoteHistoryTimeline or WA [handler pending])
   → Quote.status → APPROVED
   → Creates Booking (status: SCHEDULED)
   → Match.status → QUOTE_APPROVED
   → Sends booking confirmation to customer (WhatsApp)
   → Notifies provider

6. Provider executes job (WA commands or PWA status controls)
   → "on my way" → Job.status → EN_ROUTE
      → sendCustomerEnRouteNotification() [Meta approval required]
   → "arrived" → Job.status → ARRIVED
   → "starting work" → Job.status → STARTED
   → "done" → Job.status → PENDING_COMPLETION_CONFIRMATION
      → Sends completion confirmation link to customer (WhatsApp)

7. Customer confirms completion (tokenized link `/confirm-completion/[token]`)
   → Job.status → COMPLETED
   → Rating prompt shown in PWA
   → Payment release triggered

8. Provider triggers invoice (WA: "invoice")
   → handleInvoiceFlow()
   → sendProviderInvoiceTemplate() → customer receives formatted invoice on WhatsApp
   → Job.invoiceWhatsappSentAt stamped (idempotent)
```

### Admin Visibility

All state transitions write to:
- `AuditLog` (actorId, actorRole, action, entityType, entityId, before/after JSON)
- `JobStatusEvent` (for Job status changes: fromStatus, toStatus, actorId, notes)
- `MessageEvent` (for outbound WhatsApp via `logOutboundMessage()`)
- `AdminAuditEvent` (for admin-initiated mutations via `crudAction()`)

Admin can observe the full journey in:
- `/admin/bookings` (booking + job lifecycle)
- `/admin/matches` (match status)
- `/admin/messages` (outbound WhatsApp log)
- `/admin/dispatch` (dispatch console: rerank, override, assign)

---

## Cross-Cutting To-Be

| Area | To-Be state | Status |
|------|------------|--------|
| Business identity | `CustomerMember` model + operator auth resolution | 🔄 Schema done; auth integration pending |
| Multi-site address book | `/account/sites` live; BookingFlow site picker integrated | 🔄 Flag on; e2e flow confirmation needed |
| WA multi-site picker | `collect_site` step in `job-request.ts` after `collect_name` | ⬜ Not built |
| Quote approval parity | WA template sent; PWA inline buttons live | 🔄 WA handler not wired |
| Invoice download | PDF from Booking + Quote + Job data | ⬜ Not built |
| Provider catalogue | `/providers` + `/providers/[id]` live (flag-gated) | ✅ Done |
| Provider PWA | All M4 screens live | ✅ Done |
| Provider WA M5 | Running late, invoice, dispute wired | ✅ Done; Meta approval pending |
| SLA visibility | Hour-of-day ETA callout on request detail | ✅ Done |
| Customer activity log | `/account/activity` lists last 50 audit events | ✅ Done |
| B2B feature flag | `feature.deadlineed.b2b_landing` seeded | 🔄 Flag exists; landing variant not built |
| Meta template approval | 5 new templates registered in code | ⬜ Ops task: submit to Meta Business Suite |
| Notification de-dup | All 5 new WA sends have idempotency guards | ✅ Done |
