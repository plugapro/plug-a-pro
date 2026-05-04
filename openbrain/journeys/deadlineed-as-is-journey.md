# Deadlineed — As-Is Journey

> **Status:** Current state as of 2026-05-03
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
- **State:** Unauthenticated user arrives on landing page
- **What they see:**
  - Hero: "Request local home services" + "Nearby providers. Written quotes. Clear records."
  - Two CTAs: **Request a job** (→ `/services`) and **Track my booking** (→ `/bookings`)
  - "How it works" three-step explainer
  - Service category grid: 15 categories (`SERVICE_CATEGORY_OPTIONS` from `lib/service-categories.ts`), each linking to `/book/[slug]`

- **Friction:** Deadlineed arrives via PWA home screen bookmark; landing page copy is pitched at individual homeowners ("local home services"), not a business managing multiple sites. No business account concept or multi-site entry point.
- **Drop-off risk:** Low friction for first-time visit; friction increases when Deadlineed tries to book for a second site or a third time and has to re-enter address details every time.
- **Instrumentation:** Page is force-dynamic (`export const dynamic = 'force-dynamic'`); no analytics events fired on category click.

---

### Step 2: Authentication (`/sign-in` → `/verify`)

- **State:** Unauthenticated user clicks a service category
- **Redirect:** `/services` and `/book/[slug]` both check `getSession()` and redirect to `/sign-in?next=<url>` when no session
- **Flow:** Phone OTP via Supabase Auth
- **Friction:** Phone OTP is personal; Deadlineed has no concept of a "company account" — their personal phone number IS the account. Any team member who needs to book must use Deadlineed's credentials or have their own separate account with no linkage to the business.
- **Instrumentation gap:** No sign-in event logged to `AuditLog`.

---

### Step 3: Category Selection (`/services`)

- **Route:** `field-service/app/(customer)/services/page.tsx`
- **Auth:** Required
- **What they see:** List of 15 categories, tapping any one goes to `/book/[slug]`
- **Friction:** No "recent" or "favourite" categories for Deadlineed who books the same 3–4 categories every month.
- **Instrumentation gap:** No category selection event.

---

### Step 4: Job Request Entry — `BookingFlow` (`/book/[slug]`)

- **Route:** `field-service/app/(customer)/book/[serviceId]/page.tsx` + `components/customer/BookingFlow.tsx`
- **Steps within the flow:**

#### Step 4a: Address

Fields collected:
- Street address (free text: `addressLine1`, `addressLine2`, `complexName`, `unitNumber`)
- Suburb picker (controlled list via `SuburbPicker.tsx` → `lib/location-nodes.ts`)
- Region, City, Province (derived from suburb selection or manual override)
- Postal code (derived from location node, never typed)
- GPS detect button (optional)

**Province options** (hardcoded): Gauteng, Western Cape, KwaZulu-Natal, Eastern Cape, Limpopo, Mpumalanga, North West, Free State, Northern Cape

**Service-area guard:** If the selected city is outside active service areas, customer is shown a waitlisted screen and added to `ServiceAreaWaitlist` table.

**Friction:** Deadlineed has 3 sites and must type the full address from scratch every time. No saved address book. No "use last address" shortcut.

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

**Friction:** No way to pre-fill recurring job details. The same HVAC service-call description gets typed fresh every month.

#### Step 4c: Confirm

- Summary card with address, title, urgency, preference
- Privacy / Terms displayed again
- Submit triggers `POST /api/customer/bookings` (server action)

#### Step 4d: Submitted

- Shows success message + "Track your request" CTA → `/requests/[id]`
- Provides a shareable ticket URL (`/requests/access/[token]`) for the on-site contact

**Instrumentation:** `JobRequest` row created; no client-side event emitted to analytics.

---

### Step 5: Request Tracking (`/requests/[id]`)

- **Route:** `field-service/app/(customer)/requests/[id]/page.tsx`
- **Auth:** Required; verifies `customer.id === jobRequest.customer.id`
- **What they see:**
  - Request title, category, status badge
  - Address, creation date, match window
  - Attached photos
  - Matched provider card (name, bio, trust signals, portfolio links) + "View provider profile" button → `/providers/[id]`
  - Quote history timeline (`QuoteHistoryTimeline`)
  - Booking card (once booking exists) → "Open booking details" → `/bookings/[id]`
  - Matching activity (lead count, per-lead status and sent date) when no booking yet

**Friction:** No push notification or email when a provider is matched — Deadlineed must actively poll this page or wait for a WhatsApp message.

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

**Friction for Deadlineed:**
- Cancel reason list targets homeowners, not B2B scenarios
- No business receipt / invoice download
- No way to flag "this is a recurring job" for the audit trail

---

### Step 7: Extra Work Approval (`/approve/[token]`)

- **Route:** `field-service/app/(customer)/approve/[token]/page.tsx`
- **Auth:** None — tokenized, public
- **Source:** Customer receives WhatsApp notification; taps link → approves or declines extra work
- **What they see:** `ApprovalCard` with description + amount + Approve / Decline buttons

---

### Step 8: Provider Profile (`/providers/[id]`)

- **Route:** `field-service/app/(customer)/providers/[id]/page.tsx`
- **Auth:** Required. Access gated: only visible if the customer has a `JobRequest` matched to this provider.
- **What they see:** Provider overview, trust signals, portfolio links, completed job reviews

**Gap:** No public provider browse. Deadlineed cannot find and compare providers before booking.

---

### Step 9: My Bookings Dashboard (`/bookings`)

- **Route:** `field-service/app/(customer)/bookings/page.tsx`
- **Sections:**
  - Active requests (status not in `EXPIRED`/`CANCELLED`, no booking yet or booking not confirmed)
  - Confirmed bookings (have a booking + job row)
- **Friction:** All requests and bookings in a single flat list — no grouping by site, category, or month. Deadlineed managing 3 sites and 4 active jobs sees an undifferentiated pile.

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

**Saved address reuse:** `resolveWhatsAppIdentity()` checks for a saved `WhatsAppSavedAddress` on the customer record and offers to reuse it on the province step.

**Service-area waitlist:** If the selected city is not active, customer is added to `ServiceAreaWaitlist` and receives a "not yet available" message with an opt-in confirmation.

### Customer-Side WA Notifications (outbound templates)

| Template | Trigger | Variables |
|----------|---------|----------|
| `slot_available` | `sendSlotAvailableNotification()` in `lib/whatsapp.ts:688` | customerName, slotLabel, bookingUrl |
| `no_technician_available` | `sendNoProviderAvailable()` in `lib/whatsapp.ts:709` | customerName, serviceName, originalDate, bookingUrl |

**Gap:** Customer has no WhatsApp-native path to approve a quote or confirm/decline extra work. The only path is the `/approve/[token]` PWA link.

**Gap:** No customer WhatsApp notification when a provider accepts the lead or when the job starts. The tracking page must be polled.

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

## Channel 3 — Provider PWA

**Current state: essentially empty.**

The provider PWA surface consists of:
- A registration deep-link confirmation page (reachable after WhatsApp registration)
- Worker portal URL referenced in `lib/provider-credit-copy.ts` (`getWorkerPortalUrl()`)

There is no:
- Lead inbox
- Profile editor
- Calendar / availability toggle
- Earnings dashboard
- Document re-upload
- Job status management via PWA (all via WhatsApp commands)

This is a significant gap. Providers have no PWA interface for day-to-day operations.

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

**Post-submission:** Creates `ProviderApplication` row with status `PENDING`. Phase 1 auto-approve cron (`/api/cron/provider-auto-approve`) runs every 25 min during business hours and approves non-high-risk complete applications.

### Provider Approval Notification

**Template:** `provider_application_approved` (sent by `notifyProviderApplicationApprovedOnce()` in `lib/provider-application-notifications.ts`)

Triggered: immediately after auto-approve (fire-and-forget) and retried by `match-leads` cron (step 1g).

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

Lead acceptance deducts 1 credit from the provider wallet (`LEAD_UNLOCK_COST_CREDITS`).

Post-accept confirmation: either CTA URL message "View Job" or fallback text with credit balance update.

### Provider Job Commands (via WhatsApp)

Handled in `lib/provider-whatsapp-job-commands.ts`:

| Command | WhatsApp text | Job status transition |
|---------|--------------|----------------------|
| En route | `on my way`, `en route` | `EN_ROUTE` |
| Arrived | `arrived`, `on site`, `i'm here` | `ARRIVED` |
| Start | `starting`, `started`, `starting work` | `STARTED` |
| Complete | `done`, `completed`, `finished`, `job done` | `PENDING_COMPLETION_CONFIRMATION` |
| Cancel | `cancel`, `cancellation` | Cancellation flow |

### Provider Availability / Journey Triggers

**PROVIDER_JOURNEY_TRIGGERS:** available, online, im available, i'm available, ek is beskikbaar, offline, not available, not working, ek is nie beskikbaar, provider menu, my dashboard, verify, verification, verify identity, complete verification

**PROVIDER_KEYWORDS:** myjobs, my jobs, my work, jobs — shows active job list

### Provider Notifications

| Template | When sent | Key variables |
|----------|----------|--------------|
| `provider_application_approved` | On auto-approve | applicationId, phone, name |
| `job_offer` | On lead dispatch | providerFirstName, serviceName, area, scheduledWindow, jobUrl |
| `technician_job_reminder` | 1 h before scheduled job | providerFirstName, serviceName, address, scheduledWindow, jobUrl |
| `technician_payment_released` | On payment release | (from `lib/whatsapp.ts:823`) |

---

## Cross-Cutting Observations

| Area | Current state | Note |
|------|--------------|------|
| Identity | Single phone = single account | No concept of principal + operators |
| Multi-site | No address book; address typed fresh each booking | Addresses stored per `JobRequest`, not reusable |
| Recurring jobs | Not supported | No recurring rule or template on `JobRequest` |
| Quote approval | PWA-only (`/approve/[token]` + QuoteHistoryTimeline) | No WA-native quote approve/decline path |
| Instrumentation | `AuditLog` used for ops events; no customer analytics | No events for page views, step abandonment, funnel |
| Business identity | None | Deadlineed has no "company" concept on the platform |
| Test cohort | `internal_staff_test` controlled by `isInternalTestPhone()` | B2B cohort not defined |
| Notifications lag | Customer learns of match only by polling `/requests/[id]` | No match-found WhatsApp notification to customer |
