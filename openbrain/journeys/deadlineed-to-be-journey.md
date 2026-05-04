# Deadlineed — To-Be Journey

> **Status:** Target state — gaps closed from [Gap Analysis](deadlineed-gap-analysis.md)
> **Related:** [As-Is Journey](deadlineed-as-is-journey.md) · [PWA Screen Specs](../design/deadlineed-pwa-screen-specs.md) · [WhatsApp Flow Specs](../design/deadlineed-whatsapp-flow-specs.md)
>
> **Milestone reference:** M1–M7 from [Implementation Plan](../tasks/deadlineed-implementation-plan.md)

---

## Identity Model

Deadlineed operates with a two-tier identity:

- **Principal:** The primary account holder (e.g., "Acme Facilities"). One Supabase user + one `Customer` row. Has full access to all bookings across all sites.
- **Operators:** Named staff who can book under the principal account. Each operator has their own phone OTP session but their `JobRequest` rows are tagged with the `customerId` of the principal.

This closes gaps C9, C11.

**New Prisma fields (M1):**
- `Customer.isBusinessAccount: Boolean` (default false)
- `Customer.businessName: String?`
- `CustomerMember` table: `{ id, principalCustomerId, memberUserId, memberName, memberPhone, role: "BOOKER" | "VIEWER", addedAt, active }`

---

## Channel 1 — Customer PWA (To-Be)

### Step 1: Landing (unchanged surface, updated copy)

- Hero headline: "Book trusted tradespeople for your business" (or A/B tested B2B variant behind `feature.deadlineed.b2b_landing` flag)
- New secondary CTA: **Manage sites →** `/account/sites` (visible for `isBusinessAccount` customers only)

### Step 2: Authentication

- OTP unchanged (Supabase phone OTP)
- Post-OTP: if first login, short onboarding prompt: "Is this for personal or business use?" → sets `Customer.isBusinessAccount`
- If operator logs in with a phone registered under a `CustomerMember` row → session resolves to operator role, principal's `customerId` used for all `JobRequest` rows

### Step 3: Multi-Site Address Book (`/account/sites`) — *NEW* (M1)

See [PWA Screen Specs — Address Book](#screen-address-book).

- Deadlineed can save multiple named sites: "Head Office", "Warehouse", "Shop Front"
- Each site is a `CustomerAddress` row linked to `Customer.id` and an optional `LocationNode`
- Default site is used as pre-fill on BookingFlow Step 1
- Adding a site uses the same suburb-picker flow as current BookingFlow Step 1 but saves the result persistently

### Step 4: BookingFlow (enhanced)

#### Step 4a: Address (enhanced)

- **Saved site picker** replaces manual address entry for returning Deadlineed customers
  - If `Customer.addresses.length > 0`, show "Choose a saved site" list above the manual entry form
  - "Add new site" option at bottom saves the address after booking
- **Use last address** shortcut (single saved address falls back here)
- Manual entry unchanged for first-time use

#### Step 4b: Description (enhanced)

- **Job template picker** — if `Customer` has ≥ 1 completed job in the same category, show "Use a template" toggle. Selecting a past job pre-fills title + description.
- Remaining fields unchanged

#### Step 4c — Step 4d: unchanged

### Step 5: Request Tracking (`/requests/[id]`) — enhanced

- **Match-found banner** — once `JobRequest.status` = `MATCHING` or a `Lead` row exists, a banner shows: "We've found a provider — they're reviewing your request."
- Quote approval now also available via inline WA buttons (see WA specs); the PWA `QuoteHistoryTimeline` component retains the approve/decline buttons for PWA users

### Step 6: Booking Tracking (`/bookings/[id]`) — enhanced

- **Invoice download** CTA once booking status = `COMPLETED` (generates PDF from `Booking` + `Quote` + `Job` data)
- **En-route notification** banner: once job status = `EN_ROUTE`, show estimated arrival time (derived from `Job.enRouteAt` + provider last-known location if available)
- Business-relevant cancel reasons added: "Budget approved elsewhere", "Job no longer needed — business decision", "Provider communication issue"

### Step 7: Extra Work Approval (`/approve/[token]`) — unchanged

### Step 8: Provider Profile — open to all logged-in customers (M6)

- **Remove the prior-match gate** (`hasRelationship` check in `app/(customer)/providers/[id]/page.tsx:34`)
- Provider profile publicly browsable from `/providers` catalogue (new route)
- Still requires authentication (OTP gate remains)

### Step 9: My Bookings Dashboard (`/bookings`) — enhanced (M1, M6)

- **Site filter** — if `Customer.isBusinessAccount`, show a dropdown to filter by site
- **Category filter** — filter by `JobRequest.category`
- **"Book again" CTA** on each completed booking row — pre-fills the new booking with same category, same site, and same description template
- **Request a job** FAB (floating action button) for quick re-entry

---

## Channel 2 — Customer WhatsApp (To-Be)

### Enhanced Notification Templates

| Template (new) | Trigger | Variables | Closes gap |
|----------------|---------|-----------|-----------|
| `customer_match_found` | `Lead` created for a `JobRequest` | customerName, providerName, serviceName, requestRef | C14 |
| `customer_provider_en_route` | Job status → `EN_ROUTE` | customerName, providerName, eta (optional), jobUrl | W5 |
| `customer_quote_ready` | `Quote` created with status `PENDING` | customerName, providerName, amount, validUntil, acceptUrl, declineUrl | W3 |
| `customer_extra_work_wa` | `ExtraWork` created | customerName, description, amount | W6 |

### Quote Approval via WhatsApp Buttons (M3)

New interactive button message for quote approval:
- Body: "{{providerName}} has submitted a quote of R{{amount}} for your {{serviceName}} job. Valid until {{validUntil}}."
- Buttons: **Approve quote** (`quote_accept_<quoteId>`) · **Decline quote** (`quote_decline_<quoteId>`)
- Handler: `lib/whatsapp-bot.ts` already handles `quote_accept_*` / `quote_decline_*` prefixes in `isStatelessNotificationReply()` — the handler function needs to be wired to `Quote.updateMany` + notification back to provider

### Rebook Keyword (M2)

New keyword group added to `lib/whatsapp-bot.ts`:
- Keywords: `rebook`, `book again`, `same job`, `repeat`, `book same`
- Handler: fetches the customer's last `COMPLETED` job request and offers to pre-fill the flow

### Multi-Site WA Address Picker (M1)

After trigger keyword "Request a job" and name collection, new step: if `Customer.addresses.length > 1`, show a WA list of saved sites instead of asking for street address free text. User selects a site; flow jumps to `collect_availability`.

---

## Channel 3 — Provider PWA (To-Be) (M4)

### Lead Inbox (`/provider/leads`) — *NEW*

See [PWA Screen Specs — Lead Inbox](#screen-provider-lead-inbox).

- Lists all `Lead` rows for the authenticated provider where `status IN ('SENT', 'VIEWED')`
- Each row shows: category, suburb, urgency, expiry countdown, accept/decline buttons
- Tapping a lead row opens lead detail with customer request summary and job URL

### Lead Detail (`/provider/leads/[leadId]`) — *NEW*

- Full job description, address suburb/city, photos, urgency, provider preference, max call-out fee
- Accept / Decline buttons (calls same server action as WA accept/decline)
- Credit balance shown: "Accepting costs 1 credit. You have N credits."

### Profile Editor (`/provider/profile`) — *NEW*

- Edit: name, bio, experience, skills (multi-select from `SERVICE_CATEGORY_OPTIONS`), service areas, portfolio URLs, rates
- Re-upload ID / evidence documents (creates new `ProviderApplication` row as amendment, triggers ops review)
- Read-only: verified status, average rating, completed jobs count

### Availability Toggle (`/provider/availability`) — *NEW*

- Toggle: Available / Paused
- If pausing: duration picker (30 min, 1 h, 2 h, rest of day, indefinite)
- Writes `TechnicianAvailability.availabilityState` + `breakUntil`
- Mirror of WA `offline`/`available` keywords — same DB fields

### Earnings Dashboard (`/provider/earnings`) — *NEW*

- Credit wallet balance: total, promo, paid
- Job history: completed jobs with payout amounts
- Credit purchase CTA

---

## Channel 4 — Provider WhatsApp (To-Be) (M5)

### Pause / Resume with Duration

New keywords: `pause`, `break`, `back in 1 hour`, `back in 2 hours`, `back tomorrow`

On `pause`: bot replies with duration picker (buttons: 30 min · 1 h · 2 h · Rest of day · Indefinite).
Response sets `TechnicianAvailability.breakUntil = now + duration`. Auto-resume cron already handles the expiry.

Closes gap Q1.

### Location Share on Accept

After a provider accepts a lead (both via WA button and PWA button):
- Bot replies: "Share your location so we can give your customer an estimated arrival." (CTA URL or location request)
- If provider sends a WA location message, coordinates are stored on `Job.providerCurrentLat / Lng` (new fields)
- Customer receives `customer_provider_en_route` template with eta when provider sends `on my way`

Closes gap Q2.

### Late-Arrival Comms (M5)

New keyword group: `running late`, `delayed`, `late`, `bit late`
Handler: sends `customer_provider_running_late` template (new) to customer with `providerName`, `jobCategory`, `estimatedDelay` (optional free text). Logs `JobStatusEvent` with note.

Closes gap Q3.

### Provider Dispute Trigger (M5)

New keyword: `dispute`, `issue with job`, `raise issue`
Flow: "Briefly describe the issue (min 10 characters)." → creates `Dispute` row with `raisedByRole: 'provider'` → notifies ops via existing `detectQueueBreaches` + ops alert.

Closes gap Q4.

### Post-Job Invoice Keyword (M5)

New keyword: `invoice`, `send invoice`, `receipt`
Handler: queries the completed `Job` + `Booking` + `Quote` → generates a formatted text invoice and sends via `sendText()`. Optionally triggers a PDF link via Vercel Blob.

Closes gap Q5.

---

## Cross-Cutting To-Be

| Area | To-Be state | How |
|------|------------|-----|
| Business identity | `Customer.isBusinessAccount` + `CustomerMember` table | M1 migration; server actions updated |
| Audit trail visibility | Customer-facing activity log on `/account/activity` | Reads from `AuditLog` filtered to `actorId = customer.id` or `entityId in customer.jobRequestIds` |
| SLA visibility | Match ETA banner on request detail | Derived from cron cadence (5 min day / 30 min off-hours) shown as "typically within X minutes" |
| B2B feature flag | `feature.deadlineed.b2b_landing` seeded via `scripts/seed-flags.ts` | M1 |
| Quote approval idempotency | `Quote.approvalWhatsappSentAt` guard similar to provider approval | M3 |
| Notification events | All new templates logged to `MessageEvent` via `logOutboundMessage()` | M3, M5 |
