# Deadlineed — As-Is Journey

> **Status:** Current state as of 2026-05-05 (updated after M4 + M5 + M6 delivery)
> **Related:** [Gap Analysis](deadlineed-gap-analysis.md) · [To-Be Journey](deadlineed-to-be-journey.md)

---

## Persona Snapshot

**Deadlineed** represents a business customer — a property manager, facilities coordinator, or small-business owner — who needs to book tradespeople across one or more commercial or residential sites. Key traits:

- Books services repeatedly (≥ 2 jobs/month), often for similar categories (plumbing, HVAC, cleaning)
- Operates 1–5 sites; each has a distinct street address and sometimes a different contact person on site
- Works standard weekday hours (08:00–17:00 SAST); urgency is typically "this week" but occasionally "today/ASAP" for reactive maintenance
- Pays from a business account; needs a paper trail for expense management
- Uses both a mobile PWA and WhatsApp; prefers WhatsApp for quick status checks and the PWA for job creation

---

## Trigger Events

| Trigger | Urgency | Typical Category |
|---------|---------|-----------------|
| HVAC unit stops working in summer | ASAP | `air_conditioning` |
| Monthly scheduled maintenance round | This week | `electrical`, `plumbing` |
| Post-renovation handover punch list | This week | `handyman`, `painting` |
| Burst pipe or roof leak | ASAP | `plumbing`, `roofing` |
| Pre-inspection clean | This week | `cleaning` |

---

## Channel 1 — Customer PWA

### Step 1: Discovery / Landing (`/`)

- **Route:** `field-service/app/(customer)/page.tsx`
- **Auth:** Not required
- **What they see:**
  - Hero: "Request local home services" + "Nearby providers. Written quotes. Clear records."
  - Two CTAs: **Request a job** (→ `/services`) and **Track my booking** (→ `/bookings`)
  - "How it works" three-step explainer
  - Service category grid: 15 categories (`SERVICE_CATEGORY_OPTIONS` from `lib/service-categories.ts`), each linking to `/book/[slug]`

- **Friction:** Copy is pitched at individual homeowners, not a business managing multiple sites. No business account concept on the landing page.
- **Instrumentation:** No analytics events fired on category click.

---

### Step 2: Authentication (`/sign-in` → `/verify`)

- **State:** Unauthenticated user clicks a service category
- **Redirect:** `/services` and `/book/[slug]` check `getSession()` and redirect to `/sign-in?next=<url>` when no session
- **Flow:** Phone OTP via Supabase Auth
- **Friction:** Single phone = single account. No company account. Multiple team members cannot share one booking history.

---

### Step 3: Category Selection (`/services`)

- **Route:** `field-service/app/(customer)/services/page.tsx`
- **Auth:** Required
- **What they see:** List of 15 categories; tapping any one goes to `/book/[slug]`
- **Friction:** No "recent" or "favourite" categories for repeat bookings.

---

### Step 4: Job Request Entry — `BookingFlow` (`/book/[slug]`)

- **Route:** `field-service/app/(customer)/book/[serviceId]/page.tsx` + `components/customer/BookingFlow.tsx`
- **Pre-fill support:** `?template=<jobRequestId>` loads a previous job's category, title, and description — enables "book again" rebook shortcut
- **Address book integration:** Server page loads `CustomerAddress` records when `feature.customer.address_book` flag is enabled; passes to `BookingFlow` as `savedAddresses` prop

#### Step 4a: Address

Fields collected:
- **Saved site picker** (when `feature.customer.address_book` on and addresses exist): displayed above manual entry form; selecting a site pre-fills all address fields
- Street address (free text: `addressLine1`, `addressLine2`, `complexName`, `unitNumber`)
- Suburb picker (controlled list via `SuburbPicker.tsx` → `lib/location-nodes.ts`)
- Region, City, Province (derived from suburb selection or manual override)
- Postal code (derived from location node, never typed)
- GPS detect button (optional)

**Province options** (hardcoded): Gauteng, Western Cape, KwaZulu-Natal, Eastern Cape, Limpopo, Mpumalanga, North West, Free State, Northern Cape

**Service-area guard:** If the selected city is outside active service areas, customer is shown a waitlisted screen and added to `ServiceAreaWaitlist` table.

**Friction:** Deadlineed with multiple sites still must enter addresses manually if `feature.customer.address_book` is not yet enabled for their account, or if they have not yet saved sites.

#### Step 4b: Description

Fields collected:
- Subcategory (optional free text)
- Job type: `repair`, `installation`, `inspection`, `cleaning`, `maintenance`, `other`
- Title (required, free text)
- Description (required, free text, min 20 chars)
- Photos (optional, multi-upload via Blob; batched 3 s window)
- Urgency: `Today / ASAP`, `This week`, `I'm flexible`
- Preferred date (optional, date picker)
- Preferred time window: `Any time`, `Morning (8am–12pm)`, `Afternoon (12pm–5pm)`, `Evening (5pm–8pm)`, `Flexible`
- Provider preference: `Fastest available`, `Save money / Best value`, `Best quality / Highest rated`
- Budget preference: `Balanced value`, `Budget-conscious`, `Premium quality`
- Max call-out fee (optional, numeric)
- Privacy and Terms acknowledgement (both required)

#### Step 4c: Confirm

- Summary card with address, title, urgency, preference
- Submit triggers `POST /api/customer/bookings`

#### Step 4d: Submitted

- Shows success message + "Track your request" CTA → `/requests/[id]`
- Provides a shareable ticket URL (`/requests/access/[token]`) for the on-site contact

---

### Step 5: Request Tracking (`/requests/[id]`)

- **Route:** `field-service/app/(customer)/requests/[id]/page.tsx`
- **Auth:** Required; verifies `customer.id === jobRequest.customer.id`
- **What they see:**
  - Request title, category, status badge
  - **SLA callout**: When no match yet, shows estimated matching time (copy varies by time of day: "typically 5–15 min" during business hours, "30–60 min off-peak", "first thing in the morning" overnight)
  - Address, creation date, match window
  - Attached photos
  - Matched provider card (name, bio, trust signals, portfolio links) + "View provider profile" button → `/providers/[id]`
  - Quote history timeline (`QuoteHistoryTimeline`) — Approve / Decline buttons visible to customer when quote is PENDING
  - Booking card (once booking exists) → "Open booking details" → `/bookings/[id]`
  - Matching activity (lead count, per-lead status and sent date) when no booking yet

**Friction:** No WhatsApp push notification to Deadlineed when a provider is matched — must actively poll this page. (`sendCustomerMatchFoundNotification()` IS wired in the matching orchestrator, so customers with a WhatsApp session do receive the template when a lead is dispatched.)

---

### Step 6: Booking Tracking (`/bookings/[id]`)

- **Route:** `field-service/app/(customer)/bookings/[id]/page.tsx`
- **What they see:**
  - Job progress timeline: `SCHEDULED` → `EN_ROUTE` → `ARRIVED` → `STARTED` → `AWAITING_APPROVAL` → `PENDING_COMPLETION_CONFIRMATION` → `COMPLETED`
  - Quote history
  - Extra work approval callout (links to `/approve/[token]`)
  - Completion confirmation form (server action: `transitionJob` to `COMPLETED`)
  - Work evidence photos
  - Rating prompt (once COMPLETED + no existing review)
  - Dispute form (requires 10+ chars reason; creates `Dispute` row; logs `AuditLog`)
  - Cancel booking form (only when `SCHEDULED` or `RESCHEDULED`; reasons: found another provider, no longer needed, cost too high, taking too long, other)

**Friction:**
- Cancel reason list targets homeowners, not B2B scenarios
- No business receipt / invoice download for completed jobs
- No "this is a recurring job" flag on the audit trail

---

### Step 7: Extra Work Approval (`/approve/[token]`)

- **Route:** `field-service/app/(customer)/approve/[token]/page.tsx`
- **Auth:** None — tokenized, public
- **Source:** Customer receives WhatsApp notification; taps link → approves or declines extra work
- **What they see:** `ApprovalCard` with description + amount + Approve / Decline buttons

---

### Step 8: Provider Profile (`/providers/[id]`)

- **Route:** `field-service/app/(customer)/providers/[id]/page.tsx`
- **Auth:** Required. Gated by `feature.customer.provider_browse` flag.
- **Access:** Open to any authenticated customer (prior-match gate removed under the flag)
- **What they see:** Provider overview, trust signals (verified badge, skills, service areas, experience, evidence note, portfolio URLs), completed job count, average rating, recent customer reviews

---

### Step 9: Provider Catalogue (`/providers`)

- **Route:** `field-service/app/(customer)/providers/page.tsx`
- **Auth:** Required. Gated by `feature.customer.provider_browse` flag.
- **What they see:**
  - Horizontal-scroll category filter bar (all 15 categories + "All")
  - Vertical list of verified, active providers ordered by `averageRating DESC`
  - Take: 20 per page; optional `?category=` and `?area=` query params
  - Each `ProviderCard` shows: name, avatar, skills, service area, rating, completedJobsCount, verified badge
  - Tapping a card → `/providers/[id]`
- **Data query:** `Provider.findMany({ active: true, verified: true, skills: { has: category }, serviceAreas: { has: area } })`
- **Gap:** No ranking by availability, distance, or reliability score — ordered purely by rating. No pagination beyond take:20.

---

### Step 10: My Bookings Dashboard (`/bookings`)

- **Route:** `field-service/app/(customer)/bookings/page.tsx`
- **Sections:**
  - Active requests (status not in `EXPIRED`/`CANCELLED`, no booking yet)
  - Confirmed bookings (booking row + job exists)
  - **"Book again" CTA** on completed booking rows — links to `/book/{{category}}?template={{jobRequestId}}` to pre-fill the new request
- **Friction:** All requests and bookings in a single flat list — no grouping by site, category, or month. Deadlineed managing 3 sites and 4 active jobs sees an undifferentiated pile. No search or filter.

---

### Step 11: Multi-Site Address Book (`/account/sites`) — ✅ IMPLEMENTED

- **Route:** `field-service/app/(customer)/account/sites/page.tsx`
- **Auth:** Required. Gated by `feature.customer.address_book` flag.
- **Model:** `CustomerAddress` table (id, customerId, label, street, suburb, city, province, postalCode, lat, lng, locationNodeId, isDefault)
- **What they see:** List of named sites; Add / Edit / Delete / Set-default actions via `<AddSiteDialog>` and `<SiteCard>` client components
- **Usage:** Sites appear in BookingFlow address step as a picker (when flag on and addresses exist)

---

### Step 12: Account Activity Log (`/account/activity`) — ✅ IMPLEMENTED

- **Route:** `field-service/app/(customer)/account/activity/page.tsx`
- **Auth:** Required
- **What they see:** Last 50 `AuditLog` rows where `actorId = customer.userId` OR `entityId` in customer's `JobRequest` IDs
- **Displays:** action, entity type, reference, timestamp — formatted for readability
- **Note:** Read-only; no ops-only fields exposed

---

## Channel 2 — Customer WhatsApp

Customer WhatsApp is a **full parallel booking channel** via `lib/whatsapp-flows/job-request.ts`.

### Inbound Router

All inbound messages go through `processInboundMessage()` in `lib/whatsapp-bot.ts`:

1. Photo batching (3 s window for `collect_photos` step)
2. City text de-duplication (800 ms window vs interactive city selection)
3. Phone queue (one message per phone processed at a time)

### WA-JR Flow Steps

| Step | User action | Bot response |
|------|-------------|-------------|
| `show_menu` | Sends reset keyword (`hi`, `hello`, `hey`, `start`, `menu`, `home`, etc.) | Main menu with buttons: **Request a job**, **Track my booking**, **Help** |
| `collect_category` | Taps "Request a job" | Category list (up to 14 categories per page, max 10 list rows — paged) |
| `collect_name` | Selects category | "What's your first and last name?" |
| `collect_street` | Replies with name | "What is the street address for the job?" |
| `collect_province` | Replies with street | Province selection list (9 provinces) |
| `collect_city` | Selects province | City selection list (filtered by province) |
| `collect_region` | Selects city | Region list (filtered by city) |
| `collect_suburb` | Selects region | Suburb list (filtered by region) |
| `confirm_address` | Selects suburb | Address confirmation card |
| `collect_availability` | Confirms address | "When do you need this done?" — ASAP / This week / Flexible |
| `collect_description` | Selects availability | "Describe what you need done." (≥ 10 chars) |
| `collect_photos` | Types description | "Optional: send up to 5 photos." (3 s batch window) |
| `confirm_request` | Sends/skips photos | Confirmation summary card |
| `submitted` | Confirms | "Your request is in! We'll find a provider shortly." + tracking link |

**Saved address reuse:** `resolveWhatsAppIdentity()` checks for a saved `WhatsAppSavedAddress` and offers to reuse it. Multi-site picker (choosing from `CustomerAddress` list via WA list message) is NOT yet wired — remains single-last-used-address.

**Service-area waitlist:** If the selected city is not active, customer is added to `ServiceAreaWaitlist` and receives a "not yet available" message.

### Customer-Side WA Notifications (outbound templates)

| Template | Trigger | Variables | Status |
|----------|---------|-----------|--------|
| `customer_match_found` | Lead dispatched in matching orchestrator | providerFirstName, serviceLabel, jobRequestId | ✅ Wired |
| `customer_quote_ready` | Quote created by provider (`/api/technician/quotes`) | customerFirstName, providerFullName, serviceLabel, quoteAmount, estimatedHours, validUntilDate, shortDescription | ✅ Wired |
| `customer_provider_en_route` | Provider location shared after job acceptance | providerFirstName, serviceLabel, jobSuburb | ✅ Wired |
| `customer_provider_running_late` | Provider triggers running-late keyword | customerFirstName, providerFirstName, delayLabel, serviceLabel | ✅ Wired |
| `slot_available` | `sendSlotAvailableNotification()` | customerName, slotLabel, bookingUrl | Existing |
| `no_technician_available` | `sendNoProviderAvailable()` | customerName, serviceName, originalDate, bookingUrl | Existing |

**All 5 templates** (`customer_match_found`, `customer_quote_ready`, `customer_provider_en_route`, `customer_provider_running_late`, `provider_invoice_send`) are registered in `lib/messaging-templates.ts` with example text, but **must be submitted to Meta Business Suite for approval** before live sends succeed.

### WA Quote Accept/Decline (NOT YET WIRED)

The `WhatsApp bot` has `isStatelessNotificationReply()` logic that matches `quote_accept_*` and `quote_decline_*` payload prefixes. However, the handler functions `handleQuoteAcceptReply()` / `handleQuoteDeclineReply()` have not been wired yet — the payload is recognised but no action is taken. Customers must approve/decline quotes via the PWA `QuoteHistoryTimeline` inline buttons.

### WA Status Keywords

| Keyword group | Triggers | Resulting flow |
|---------------|---------|----------------|
| Reset | hi, hello, hey, start, menu, home, restart, hola, sawubona, howzit, 0, stop, exit, terug, phinda | Shows main menu |
| Status | status, booking, my booking, track, where, update | `handleStatusFlow` |
| Reschedule | reschedule, change time, change date, move booking, different time | Reschedule flow |
| Cancel | cancel, cancellation, kanselleer, stop booking | Cancel flow |
| Marketing opt-out | stop offers, unsubscribe, stop marketing, no marketing, opt out, optout | `applyOptOut()` |
| Marketing opt-in | start offers, subscribe, start marketing, opt in, optin | `applyOptIn()` |

---

## Channel 3 — Provider PWA — ✅ SUBSTANTIALLY IMPLEMENTED (M4)

The provider PWA now has a full suite of routes in the `app/(provider)/` route group, guarded by `requireProvider()`.

### Provider Dashboard (`/provider`) ✅

- **Route:** `field-service/app/(provider)/provider/page.tsx`
- **What they see:**
  - Active and upcoming jobs summary (counts by status)
  - Wallet balance (total, paid credits, promo credits)
  - Profile completeness meter with weighted score and hint for missing fields
  - Alerts for low credits and unconfirmed selected jobs
  - Quick links to leads, earnings, profile, availability
- **Data:** Provider, active jobs, wallet, leads (pending), profile completeness calculation

### Lead Inbox (`/provider/leads`) ✅

- **Route:** `field-service/app/(provider)/provider/leads/page.tsx`
- **What they see:** Queue of `SENT` / `VIEWED` leads with: category, suburb, urgency, expiry countdown, status badge
- **Data:** `getProviderLeadListForProvider(providerId)` — Lead records with `jobRequest` reference

### Lead Detail (`/provider/leads/[leadId]`) ✅

- **Route:** `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`
- **Preview (before accept):** Category, job type, area, preferred time window, estimated value, short notes
- **Locked section:** Credit cost shown; full customer name, phone, address hidden until accepted
- **Accept action:** `acceptLead()` → `matchingEngine.acceptLead()` → deducts credits → creates Match → redirect with `?accepted=1&remainingBalance=...`
- **Decline action:** `declineLead()` → re-dispatch
- **Dispute action:** `disputeUnlockedLead()` — refund dispute with reason (CUSTOMER_NOT_RESPONSIVE, INVALID_LEAD, CUSTOMER_DECLINED, OTHER)
- **Error handling:** Insufficient credits, already expired, lead already taken — all return typed reason codes

### Provider Profile Editor (`/provider/profile`) ✅

- **Route:** `field-service/app/(provider)/provider/profile/page.tsx`
- **What they can edit:** Name, email, bio, experience, skills (multi-select from `SERVICE_CATEGORY_OPTIONS`), service areas (LocationNode picker), evidence note, portfolio URLs, weekly availability schedule
- **Awards:** Promo credits via `evaluateAndAwardProviderProfileCompletionPromoCredits()` on first completion
- **Read-only:** Verified status, average rating, completed jobs count, recent reviews (5-star + comment)
- **Syncs:** `TechnicianServiceArea` records, `ProviderSchedule`, `AuditLog`

### Availability Toggle (`/provider/availability`) ✅

- **Route:** `field-service/app/(provider)/provider/availability/page.tsx`
- **Mode selector:** ALWAYS_AVAILABLE / SCHEDULE (weekly hours) / PAUSED (stop leads until date)
- **Pause until:** datetime picker; sets `TechnicianAvailability.breakUntil`
- **Flags:** emergencyAvailable, sameDayAvailable
- **Writes:** `Provider.availableNow`, `TechnicianAvailability`, `ProviderSchedule`, `AuditLog`
- **Note:** WA `offline`/`available` keywords and this PWA page write the same DB fields

### Earnings Dashboard (`/provider/earnings`) ✅

- **Route:** `field-service/app/(provider)/provider/earnings/page.tsx`
- **What they see:** Monthly earnings totals (gross, commission, net), job-by-job breakdown, prior months history
- **Data:** `ProviderPayout` records with `Job → Booking → Match → JobRequest` graph

### Credits & Wallet (`/provider/credits`) ✅

- **Route:** `field-service/app/(provider)/provider/credits/page.tsx`
- **What they see:** Credit balance (total, paid, promo, estimated leads unlockable), ledger of last 50 transactions, top-up options
- **Payment paths:** Payfast (online, instant) + Manual EFT (bank details + unique reference)
- **Data:** `ProviderWallet`, `WalletLedgerEntry`, `ProviderTopUpIntent`

### Active Job Detail (`/provider/jobs/[id]`) ✅

- **Route:** `field-service/app/(provider)/provider/jobs/[id]/page.tsx`
- **What they see:** Customer info, full address (Google Maps link), scheduled window, job notes, status history timeline
- **Actions:** Status update via `<JobStatusControls>` (calls `POST /api/technician/jobs/[id]/status`)
- **Evidence:** Photo gallery + `<EvidenceUploader>` for new uploads (active jobs only)
- **Extra work:** `<ExtraWorkForm>` for scope additions (description + amount) when STARTED
- **Disputes:** Form to raise dispute (min 10 chars); one OPEN dispute per job

### Quote Submission (`/provider/quotes/[matchId]`) ✅

- **Route:** `field-service/app/(provider)/provider/quotes/[matchId]/page.tsx`
- **Displays:** Match detail, customer photos, quote history timeline, inspection status
- **Actions:** `<QuoteForm>` for new/revised quotes; `markInspectionComplete()` when inspection scheduled
- **States:** Pending (awaiting customer), declined (revise), approved (no further action)

### Tokenized Deep Links (WhatsApp links)

| Route | Purpose |
|-------|---------|
| `app/provider/handoff/[token]` | Main entry; validates token → redirects to PWA lead or job page |
| `app/provider/lead/[token]` | Alias → handoff |
| `app/provider/job/[token]` | Alias → handoff |
| `app/provider/jobs/[jobId]/arrival` | Check-in redirect → handover |
| `app/provider/jobs/[jobId]/handover` | Full job detail via token (for WhatsApp link recipients) |
| `app/provider/jobs/[jobId]/quick-update` | Quick status update redirect → handover |

---

## Channel 4 — Provider WhatsApp

### Registration Flow (`lib/whatsapp-flows/registration.ts`)

**Trigger keywords:** register, join, technician, provider, apply, signup, sign up, i want to work, want to work, looking for work, find work, i want work, need work, find a job, get work, ek wil werk, ngifuna ukusebenza

**Flow steps:**
1. `reg_intro` — Intro message with CTA "Apply now" / "Not now" buttons
2. `reg_collect_name` — "What is your full name?"
3. `reg_collect_skills` — Multi-select skill list (14 trade categories)
4. `reg_collect_area` — Province → City → Region selection
5. `reg_collect_experience` — "Briefly describe your experience."
6. `reg_collect_availability` — Days/times available
7. `reg_collect_rates` — Hourly rate or fixed
8. `reg_collect_id` — SA ID or Passport number
9. `reg_collect_evidence` — "Upload up to 5 photos/docs as evidence." (3 s batch window)
10. `reg_review` — Summary with "Submit" / "Edit" buttons
11. `reg_submitted` — "Application submitted! We'll review it soon."

**Post-submission:** Creates `ProviderApplication` row with status `PENDING`. Phase 1 auto-approve cron (`/api/cron/provider-auto-approve`) runs every 25 min during business hours.

### Lead Dispatch (`lib/whatsapp.ts`)

**Template:** `job_offer`
- Sent to provider phone number
- Variables: `providerFirstName`, `serviceName`, `area`, `scheduledWindow`, `jobUrl`
- `jobUrl` is a signed handover URL from `lib/provider-lead-access.ts`

**Provider response via button payload:**
- `accept:<leadId>` — starts credit deduction + match creation
- `decline:<leadId>` — tries next provider via matching engine
- `hd_unavailable:<leadId>` — hard-decline: unavailable
- `hd_area:<leadId>` — hard-decline: wrong area
- `hd_other:<leadId>` — hard-decline: other reason

### Provider Job Commands (WhatsApp)

Handled in `lib/provider-whatsapp-job-commands.ts`:

| Command | WhatsApp text | Job status transition |
|---------|--------------|----------------------|
| En route | `on my way`, `en route` | `EN_ROUTE` → triggers `sendCustomerEnRouteNotification()` |
| Arrived | `arrived`, `on site`, `i'm here` | `ARRIVED` |
| Start | `starting`, `started`, `starting work` | `STARTED` |
| Complete | `done`, `completed`, `finished`, `job done` | `PENDING_COMPLETION_CONFIRMATION` |
| Cancel | `cancel`, `cancellation` | Cancellation flow |

### Provider Running-Late Comms ✅ WIRED

**Trigger keywords:** `running late`, `delayed`, `late`, `stuck in traffic`
**Handler:** `handleRunningLateFlow()` in `lib/whatsapp-flows/provider-journey.ts`
**Action:** Sends `customer_provider_running_late` template to customer (4 body params: customerFirstName, providerFirstName, delayLabel, serviceLabel)
**Idempotency:** Checked via `JobStatusEvent.notes = 'provider_running_late'` before sending

### Post-Job Invoice ✅ WIRED

**Trigger keywords:** `invoice`, `send invoice`, `receipt`
**Handler:** `handleInvoiceFlow()` in `lib/whatsapp-flows/provider-journey.ts`
**Action:** Sends `provider_invoice_send` template to customer (10 body params: customer, service, location, completion date, costs, totals, job ref, provider name)
**Idempotency:** `Job.invoiceWhatsappSentAt` timestamp field added to schema (migration `20260504210000`)

### Provider Dispute Trigger ✅ WIRED

**Trigger keywords:** `dispute`, `issue with job`, `raise issue`
**Handler:** `handleProviderDisputeFlow()` in `lib/whatsapp-flows/provider-journey.ts`
**Action:** Captures dispute description → creates `Dispute` row with `raisedByRole: 'provider'` → AuditLog written

### Provider Journey Keywords

**PROVIDER_JOURNEY_TRIGGERS:** available, online, im available, i'm available, ek is beskikbaar, offline, not working, ek is nie beskikbaar, provider menu, my dashboard, verify, verification, running late, delayed, late, stuck in traffic, invoice, send invoice, receipt, dispute, issue with job, raise issue

**PROVIDER_KEYWORDS:** myjobs, my jobs, my work, jobs — shows active job list

### Provider Notifications

| Template | When sent | Key variables |
|----------|----------|--------------|
| `provider_application_approved` | On auto-approve | applicationId, phone, name |
| `job_offer` | On lead dispatch | providerFirstName, serviceName, area, scheduledWindow, jobUrl |
| `technician_job_reminder` | 1 h before scheduled job | providerFirstName, serviceName, address, scheduledWindow, jobUrl |
| `technician_payment_released` | On payment release | (from `lib/whatsapp.ts`) |
| `provider_invoice_send` | On `invoice` keyword | 10 body vars (customer, service, location, costs, ref, provider) |

---

## Cross-Cutting Observations

| Area | Current state | Note |
|------|--------------|------|
| Identity | Single phone = single account; `CustomerMember` model exists in schema but operator resolution not yet wired in `getSession()` | Schema done; auth integration pending |
| Multi-site address book | `CustomerAddress` schema done; `/account/sites` page exists; BookingFlow integration partially done | Flag `feature.customer.address_book` controls rollout |
| Recurring jobs | "Book again" CTA exists on completed bookings; no cron rule or recurrence model on `JobRequest` | Rebook shortcut only |
| WA multi-site picker | Not yet wired in `job-request.ts` flow | Single last-used address still used |
| Quote approval (WA) | `quote_accept_*` / `quote_decline_*` payload recognised in bot; handler not yet wired | PWA inline approval works |
| Business onboarding prompt | `Customer.isBusinessAccount` field not yet seeded via post-OTP UI | Schema exists; UI not built |
| Provider WhatsApp M5 | Running late, invoice, dispute all wired | Meta template submission still required |
| Instrumentation | `AuditLog` used for ops events; no customer-facing analytics events | Customer activity log page exists (`/account/activity`) |
| Test cohort | `internal_staff_test` controlled by `isInternalTestPhone()` | B2B cohort flag seeded but not yet applied |
| SLA visibility | Matching-time copy exists on request detail page | Derived from hour-of-day, no DB query |
| Environment isolation | Single WhatsApp WABA for staging + production; isolation via test-cohort gate only | Warning comment added to `lib/whatsapp.ts` |
