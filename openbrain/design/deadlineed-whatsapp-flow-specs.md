# Deadlineed — WhatsApp Flow Specs

> **Status:** Updated 2026-05-05 — M5 provider WA flows delivered; customer quote handler still pending
> **Related:** [To-Be Journey](../journeys/deadlineed-to-be-journey.md) · [Implementation Plan](../tasks/deadlineed-implementation-plan.md)
>
> **Meta API version:** v21.0
> **Send helpers:** `sendText()`, `sendButtons()`, `sendList()`, `sendCtaUrl()` in `lib/whatsapp.ts`
> **Inbound router:** `processInboundMessage()` in `lib/whatsapp-bot.ts`
> **Template logging:** `logOutboundMessage()` in `lib/message-events.ts`
> **Cohort safety:** all sends pass through `assertCohortSendAllowed()` in `lib/whatsapp.ts`
>
> **Progress key:** ✅ Implemented · 🔄 Partial · ⬜ Not built · ⚠️ Code done but Meta approval pending

---

## Implementation Status

| Flow | Trigger | Status | Meta Template |
|------|---------|--------|---------------|
| CW1 — Rebook Shortcut | `rebook`, `book again` | ⬜ | n/a |
| CW2 — Multi-Site Address Picker | WA job-request flow | ⬜ | n/a |
| CW3 — Customer Quote Approval | Quote created | ✅ Send wired · ⬜ Handler not wired | ⚠️ `customer_quote_ready` pending |
| CW4 — Customer Match-Found | Lead dispatched | ✅ Wired in orchestrator | ⚠️ `customer_match_found` pending |
| CW5 — Customer En-Route | Provider location share | ✅ Wired | ⚠️ `customer_provider_en_route` pending |
| PW1 — Pause/Resume with Duration | `pause`, `break` | ⬜ (PWA availability page exists) | n/a |
| PW2 — Location Share on Accept | After lead accept | ⬜ (en-route notification wired; location prompt not added) | n/a |
| PW3 — Running Late Comms | `running late`, `late` | ✅ Wired | ⚠️ `customer_provider_running_late` pending |
| PW4 — Provider Dispute Trigger | `dispute`, `issue` | ✅ Wired | n/a |
| PW5 — Post-Job Invoice | `invoice`, `receipt` | ✅ Wired | ⚠️ `provider_invoice_send` pending |

**⚠️ Ops action required:** All 5 new templates must be submitted to Meta Business Suite for review (24–72 h approval). Send is coded and idempotent — templates will only deliver once Meta approves them.

---

## CUSTOMER-SIDE FLOWS

---

## Flow CW1 — Rebook Shortcut

**Closes gap:** W2
**Trigger keywords** (add to `lib/whatsapp-bot.ts` keyword lists):
```
rebook, book again, same job, repeat, book same
```

**Handler:** `handleRebookFlow()` — new function in `lib/whatsapp-flows/job-request.ts`

### Step 1: Find last completed job

```
DB query:
  db.jobRequest.findFirst({
    where: { customer: { phone }, status: 'MATCHED' OR match.booking.job.status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' }
  })
```

### Step 2a: Last job found — confirm rebook

**Message type:** Interactive buttons
**Body:**
```
Hi {{firstName}}! 👋

Your last job was:
*{{category}}* in {{suburb}}, {{city}}
"{{title}}"

Would you like to book the same type of job again?
```
**Buttons:**
- `rebook_confirm:<jobRequestId>` → "Book same job"
- `rebook_new` → "Start fresh"

### Step 2b: No last job — redirect to main menu

**Message type:** Text
```
Hi {{firstName}}! You don't have any previous bookings yet.

Let's start a new request — tap below to get started.
```
Then: show main menu.

### Step 3: On `rebook_confirm:<jobRequestId>`

- Pre-load `JobRequest` fields: `category`, `title`, `description`, `address` (from `JobRequest.address`)
- Skip to `collect_availability` step with pre-filled address and description
- Show confirmation:

**Message type:** Interactive buttons
**Body:**
```
We've pre-filled your last job details:

📍 *{{street}}, {{suburb}}, {{city}}*
🔧 *{{category}}*: {{title}}

When do you need this done?
```
**Buttons:**
- `avail_asap` → "Today / ASAP"
- `avail_week` → "This week"
- `avail_flex` → "I'm flexible"

**State transitions:**
- Conversation step → `confirm_request`

**Audit:** `AuditLog` entry: `action: 'job_request.rebook_initiated'`, `entityType: 'JobRequest'`, `entityId: sourceJobRequestId`

---

## Flow CW2 — Multi-Site Address Picker (WA booking)

**Closes gap:** W7
**Trigger:** Within `job-request.ts` flow, after `collect_category` and `collect_name`, before `collect_street`

**Condition:** `Customer.addresses.length > 1` AND `feature.customer.address_book` flag enabled

### Step: `collect_site`

**Message type:** Interactive list
**Header:** "Choose a site"
**Body:**
```
Hi {{firstName}}! Which site is this job for?
```
**List rows** (one per `CustomerAddress`):
- Row title: `{{address.label}}`
- Row description: `{{address.suburb}}, {{address.city}}`
- Row ID: `site:<customerAddressId>`
- Final row: ID `site_new`, title "Enter a new address", description "Type a street address"

### On site selection (`site:<id>`):
- Load `CustomerAddress` fields → pre-fill address in conversation data
- Skip `collect_street` / `collect_province` / `collect_city` / `collect_region` / `collect_suburb` / `confirm_address`
- Jump to `collect_availability`

### On `site_new`:
- Continue with standard `collect_street` → `collect_province` → … flow
- After `confirm_address`: ask "Save this address? (Yes / No)"
  - Yes: `createCustomerSiteAction()` server action
  - No: proceed without saving

---

## Flow CW3 — Customer Quote Approval via WhatsApp

**Closes gap:** W3
**Trigger:** `Quote` created with `status = 'PENDING'`

### Outbound — Template: `customer_quote_ready` (new template to register with Meta)

**When:** `Quote` row inserted by provider via matching engine
**Send function:** `sendCustomerQuoteReadyNotification()` — new function in `lib/whatsapp.ts`
**Idempotency guard:** `Quote.approvalWhatsappSentAt` — only send once

**Message type:** `sendButtons()`
**Body:**
```
Hi {{customerName}} 👋

*{{providerName}}* has submitted a quote for your *{{serviceName}}* job.

💰 *Total: R {{amount}}*
⏱ Estimated {{estimatedHours}} hrs
📅 Proposed: {{preferredDate}} (if set, else omit)
🗓 Valid until: {{validUntil}}

{{description}}
```
**Buttons (max 3):**
- `quote_accept_<quoteId>` → "Approve quote ✓"
- `quote_decline_<quoteId>` → "Decline"
- `quote_view_<quoteId>` → "View full details" (CTA URL → `/requests/<requestId>`)

**Variables:**
- `customerName`: `Customer.name`
- `providerName`: `Provider.name`
- `serviceName`: `JobRequest.category` (label via `getServiceCategoryLabel()`)
- `amount`: `Quote.amount`
- `estimatedHours`: `Quote.estimatedHours` (omit if null)
- `preferredDate`: `Quote.preferredDate` formatted en-ZA (omit if null)
- `validUntil`: `Quote.validUntil` formatted en-ZA
- `description`: `Quote.description`
- `quoteId`: `Quote.id`
- `requestId`: `Quote.match.jobRequestId`

**After send:** Set `Quote.approvalWhatsappSentAt = new Date()`

**Logging:**
```ts
await logOutboundMessage({
  to: customer.phone,
  templateName: 'customer_quote_ready',
  externalId,
})
```

### Inbound — Quote Accept (`quote_accept_<quoteId>`)

Handler in `lib/whatsapp-bot.ts` — `isStatelessNotificationReply()` already matches `quote_accept_*` prefix (line 253). Wire to:

```ts
async function handleQuoteAcceptReply(quoteId: string, phone: string) {
  // 1. Load Quote + match + jobRequest + customer
  // 2. Verify customer.phone matches
  // 3. Call existing quote approval server action
  //    (same logic as /requests/[id] QuoteHistoryTimeline approve button)
  // 4. Send confirmation to customer
  // 5. Notify provider
}
```

**Confirmation to customer (text):**
```
✅ *Quote approved!*

We've confirmed your approval of R {{amount}} for {{serviceName}} with {{providerName}}.

You'll receive a booking confirmation shortly.

Ref: {{quoteId_short}}
```

**Notification to provider (text):**
```
🎉 *Quote approved by {{customerName}}*

Your quote of R {{amount}} for the {{serviceName}} job has been approved.

Reply *menu* to view your active jobs.
```

**State transitions:**
- `Quote.status` → `APPROVED`
- `Quote.approvedAt` → `new Date()`
- `Booking` created (via existing `createBookingFromQuote()` or equivalent)

**Audit:** `AuditLog` entry: `action: 'quote.approved'`, `entityType: 'Quote'`, `entityId: quoteId`, `actorId: customer.phone`, `actorRole: 'customer'`

### Inbound — Quote Decline (`quote_decline_<quoteId>`)

**Confirmation to customer (text):**
```
Quote declined. {{providerName}} has been notified.

If you'd like to get another quote, reply *menu* to start a new request or wait — we may be able to match you with another provider.
```

**Notification to provider (text):**
```
Your quote for the {{serviceName}} job was declined by {{customerName}}.

Reply *menu* for your job list.
```

**State transitions:**
- `Quote.status` → `DECLINED`
- `Quote.declinedAt` → `new Date()`
- Trigger rematch flow (optional — orchestrator re-checks for next provider)

---

## Flow CW4 — Customer Match-Found Notification

**Closes gap:** C14
**Trigger:** `Lead` row created (provider notified), OR `Match.status` → `MATCHED`

**Template:** `customer_match_found` (new — register with Meta)
**Send function:** `sendCustomerMatchFoundNotification()` — new function in `lib/whatsapp.ts`
**Idempotency guard:** `JobRequest.matchFoundWhatsappSentAt` (new field, M3 migration)

**Message type:** `sendCtaUrl()`
**Body:**
```
Hi {{customerName}} 👋

Great news! We've found a provider for your *{{serviceName}}* job.

*{{providerName}}* is reviewing your request and will submit a quote shortly.

Track your request here:
```
**CTA button:** "Track request" → `/requests/<requestId>`

---

## Flow CW5 — Customer En-Route Notification

**Closes gap:** W5
**Trigger:** `Job.status` → `EN_ROUTE` (via provider WA command `on my way`)

**Template:** `customer_provider_en_route` (new — register with Meta)
**Send function:** `sendCustomerEnRouteNotification()` — new function

**Message type:** Text (or template if 24-h window expired)
```
🚗 *{{providerName}} is on the way!*

Your {{serviceName}} provider is headed to {{suburb}}.

Reply *status* at any time for an update.
```

**State transitions:** none (job remains `EN_ROUTE`)
**Logging:** `logOutboundMessage({ templateName: 'customer_provider_en_route', ... })`

---

## PROVIDER-SIDE FLOWS

---

## Flow PW1 — Pause / Resume with Duration

**Closes gap:** Q1
**New keywords** (add to `PROVIDER_JOURNEY_TRIGGERS` in `lib/whatsapp-flows/provider-journey.ts`):
```
pause, break, taking a break, back later, back in 30, back in 1 hour,
back in 2 hours, back tomorrow
```

### Step 1: Show duration picker

**Message type:** Interactive buttons
```
⏸ *Taking a break?*

How long would you like to pause? You won't receive new leads during this time.

You can resume anytime by replying *available*.
```
**Buttons:**
- `pause_30` → "30 minutes"
- `pause_60` → "1 hour"
- `pause_120` → "2 hours"

*(For longer durations, send a second follow-up list — or use "rest of day" via `pause_eod` button)*

### Step 2: On duration selection

**DB write:**
```ts
db.technicianAvailability.update({
  where: { providerId },
  data: {
    availabilityState: 'PAUSED',
    breakUntil: new Date(Date.now() + durationMs),
    notes: `Paused via WhatsApp — ${durationLabel}`,
  },
})
db.provider.update({ where: { id: providerId }, data: { availableNow: false } })
```

**Confirmation:**
```
✓ *Paused for {{durationLabel}}*

You're now offline until {{resumeTime}}.

Reply *available* at any time to come back online early.
```

**Auto-resume:** existing cron step `1j` in `match-leads/route.ts` handles `breakUntil <= now`.

**Audit:** `AuditLog` `action: 'provider.availability.paused'`, `after: { breakUntil, durationMinutes }`

---

## Flow PW2 — Location Share on Lead Accept

**Closes gap:** Q2
**Trigger:** Provider accepts a lead (button `accept:<leadId>` or `match_accept_<leadId>`)

**Immediately after accept confirmation:**

**Message type:** Text
```
📍 *Optional: Share your location*

Your customer will be notified when you're en route. Sharing your location now helps us give them an estimated arrival.

Just tap the attachment (📎) and choose *Location*, or reply *skip* to skip this step.
```

### On WA location message received:

**Handler:** `processInboundMessage()` detects `message.type === 'location'` while provider is in `post_accept_location_prompt` conversation step

**DB write (M5 migration — new `Job` fields):**
```ts
db.job.update({
  where: { id: jobId },
  data: {
    providerCurrentLat: message.location.latitude,
    providerCurrentLng: message.location.longitude,
    providerLocationSharedAt: new Date(),
  },
})
```

**Customer notification:** `customer_provider_en_route` template sent (Flow CW5)

**Confirmation to provider:**
```
✓ Location shared. Your customer has been notified.

Reply *menu* to view your jobs.
```

### On `skip`:
```
No problem. You can share your location later via the job portal.
```

---

## Flow PW3 — Running Late Comms

**Closes gap:** Q3
**New keywords:**
```
running late, delayed, late, bit late, stuck in traffic, traffic
```

### Handler

Checks if provider has an active `Job` with `status IN ('SCHEDULED', 'EN_ROUTE')`.

**If active job found:**

**Message type:** Interactive buttons
```
No worries. How long is the delay?
```
**Buttons:**
- `late_15` → "~15 minutes"
- `late_30` → "~30 minutes"
- `late_60` → "~1 hour"

### On delay selection:

**Customer notification (new template `customer_provider_running_late`):**
```
Hi {{customerName}} 👋

Quick update from {{providerName}} — they're running about *{{delayLabel}}* late for your {{serviceName}} job.

They're still on their way. Thank you for your patience 🙏
```

**Confirmation to provider:**
```
✓ Customer notified — {{customerName}} knows you're running {{delayLabel}} late.
```

**Log:** `JobStatusEvent` with `notes: 'Provider reported running late via WhatsApp — delay: {{delayLabel}}'`

**If no active job:**
```
It looks like you don't have an active job right now. Reply *menu* for your job list.
```

---

## Flow PW4 — Provider Dispute Trigger

**Closes gap:** Q4
**New keywords:**
```
dispute, issue with job, raise issue, problem with job, complaint
```

### Step 1: Confirm intent

**Message type:** Interactive buttons
```
We're sorry to hear there's an issue. Raising a dispute will flag this for ops review.

Which job is this about?
```
If single active job: auto-select and skip this step.
If multiple active jobs: show list.

### Step 2: Describe the issue

**Message type:** Text
```
Please describe the issue briefly (minimum 10 characters). Our ops team will review the job record, quote, and photos.
```

### On text reply (≥ 10 chars):

**DB write:**
```ts
db.dispute.create({
  data: {
    jobId,
    raisedById: provider.userId,
    raisedByRole: 'provider',
    reason: message.text,
    status: 'OPEN',
  },
})
recordAuditLog({ action: 'dispute.raise', entityType: 'job', ... })
```

**Confirmation:**
```
✓ *Issue raised*

Your dispute (#{{disputeId_short}}) has been logged. Ops will review the job record and get back to you.

Ref: {{disputeId_short}}
```

**Ops alert:** Existing `detectQueueBreaches()` in `lib/ops-dashboard/alerts.ts` will surface this in the next cron sweep.

---

## Flow PW5 — Post-Job Invoice

**Closes gap:** Q5
**New keywords:**
```
invoice, send invoice, receipt, send receipt, billing, send bill
```

### Handler

Checks for provider's most recently completed `Job` (status `COMPLETED`).

**If completed job found:**

**Message type:** Text
```
📄 *Invoice for {{customerName}}*
{{serviceName}} — {{suburb}}, {{city}}
Date completed: {{completedAt}}
──────────────────────
Labour:    R {{labourCost}}
Materials: R {{materialsCost}}
──────────────────────
*Total:    R {{totalAmount}}*
──────────────────────
Job ref: {{jobId_short}}
Provided by: {{providerName}}
via Plug A Pro
```

Optional: generate PDF via Vercel Blob and send CTA URL "Download PDF" → `sendCtaUrl()`.

**Confirmation to provider:**
```
Invoice details sent to {{customerPhone}} ✓
```

**Logging:** `logOutboundMessage({ templateName: 'provider_invoice_send', ... })`

**If no completed job:**
```
No completed jobs found. Reply *menu* for your job list.
```

---

## Template Registry Summary

### New templates to register with Meta

| Template name | Direction | Type | Trigger |
|---------------|-----------|------|---------|
| `customer_quote_ready` | Outbound → customer | Buttons (3) | `Quote.status = 'PENDING'` created |
| `customer_match_found` | Outbound → customer | CTA URL | First `Lead` created for `JobRequest` |
| `customer_provider_en_route` | Outbound → customer | Text | `Job.status` → `EN_ROUTE` |
| `customer_provider_running_late` | Outbound → customer | Text | Provider sends running-late keyword |
| `provider_invoice_send` | Outbound → customer (on behalf of provider) | Text / CTA URL | Provider sends invoice keyword |

### Existing templates referenced

| Template name | Function | File |
|---------------|----------|------|
| `slot_available` | Customer: slot available for rescheduling | `lib/whatsapp.ts:688` |
| `no_technician_available` | Customer: no match found | `lib/whatsapp.ts:709` |
| `job_offer` | Provider: new lead dispatch | `lib/whatsapp.ts:753` |
| `provider_application_approved` | Provider: application approved | `lib/provider-application-notifications.ts:138` |
| `technician_job_reminder` | Provider: 1 h pre-job reminder | `lib/whatsapp.ts:781` |
| `technician_payment_released` | Provider: payment released | `lib/whatsapp.ts:823` |

---

## Inbound Payload Reference

### Button reply

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "quote_accept_<quoteId>",
      "title": "Approve quote ✓"
    }
  }
}
```

Parsed by `parseInbound()` in `lib/whatsapp-interactive.ts` → `{ type: 'button', id: 'quote_accept_<quoteId>' }`.

### List selection

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list_reply",
    "list_reply": {
      "id": "site:<customerAddressId>",
      "title": "Head Office"
    }
  }
}
```

### Location share

```json
{
  "type": "location",
  "location": {
    "latitude": -26.1076,
    "longitude": 28.0567,
    "name": "Current location"
  }
}
```

---

## Opt-In / Opt-Out Policy

All new templates must check `canSend()` from `lib/whatsapp-policy.ts` before calling `sendTemplate()`.

Customer-facing templates check `Customer.whatsappServiceOptIn` (all notification templates are service-class, not marketing; do not check `whatsappMarketingOptIn`).

Provider-facing templates check `Provider.active` (paused providers still receive job reminders for already-accepted jobs).

Cohort safety: all sends pass through `assertCohortSendAllowed()` in `lib/whatsapp-interactive.ts`. New `isTestRequest` / `isTestJob` metadata should be included in the `context.metadata` argument for all sends triggered by test-flagged entities.
