# Provider Quote & Earnings — Design Spec
**Date:** 2026-03-31
**Project:** Plug a Pro — field-service
**Scope:** Complete the "Skilled Labourer Looking for Work" provider journey by adding quote submission, client approval, and earnings/payouts views.
**Payment:** Deferred — no PayFast or payment templates in pilot.

---

## 1. Context

The provider PWA already has: auth (phone OTP), job list dashboard, job detail + status controls (EN_ROUTE → ARRIVED → STARTED → COMPLETED), photo upload, extra work submission, and provider profile.

**Missing from the architecture diagram:**
1. Quote submission (provider PWA)
2. Client quote approval (WhatsApp + web fallback)
3. Earnings / payouts view (provider PWA)
4. WhatsApp job offer updated to 3 buttons (Accept / Inspect First / Decline)

---

## 2. State Machine

```
MATCHED
  ├─ Accept         → QUOTE_PENDING   (provider submits quote via PWA)
  ├─ Inspect First  → INSPECTION      (provider arranges visit directly with client via phone)
  │     └─ after visit → QUOTE_PENDING
  └─ Decline        → DECLINED

QUOTE_PENDING
  ├─ Client approves → SCHEDULED
  └─ Client declines → DECLINED

SCHEDULED → EN_ROUTE → ARRIVED → STARTED → COMPLETED
```

New `JobStatus` enum values: `QUOTE_PENDING`, `INSPECTION`

---

## 3. Data Model

### Quote

```prisma
model Quote {
  id             String      @id @default(cuid())
  jobId          String      @unique
  job            Job         @relation(fields: [jobId], references: [id])
  labourCost     Float
  materialsCost  Float       @default(0)
  description    String
  estimatedHours Float?
  validUntil     DateTime
  postInspection Boolean     @default(false)
  approvalToken  String      @unique
  status         QuoteStatus @default(PENDING)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
}

enum QuoteStatus { PENDING APPROVED DECLINED EXPIRED }
```

`Job.status` enum extended with `QUOTE_PENDING` and `INSPECTION`.

---

## 4. New Routes

| Route | Auth | Purpose |
|---|---|---|
| `app/technician/quotes/[jobId]/page.tsx` | Provider session | Quote submission form |
| `app/technician/earnings/page.tsx` | Provider session | Earnings dashboard |
| `app/quotes/[token]/page.tsx` | Public (token) | Client quote approval |
| `app/api/technician/quotes/route.ts` | Provider session | POST — submit quote |
| `app/api/quotes/[token]/route.ts` | Public (token) | GET + PATCH — fetch / approve / decline |
| `app/api/technician/earnings/route.ts` | Provider session | GET — earnings data |
| `app/api/technician/earnings/statement/route.ts` | Provider session | GET — PDF/HTML statement |

---

## 5. WhatsApp Flow Changes

### Job offer message

Updated from 2 buttons to 3:

```
New job available: [Category] in [Area]
Customer needs: [description]
Preferred time: [availabilityNote]

[Accept & Quote]  [Inspect First]  [Decline]
```

### Button handlers (`tech_job_view` step)

| Button ID | New behaviour |
|---|---|
| `accept_[jobId]` | Set job `QUOTE_PENDING` → send provider CTA link to `/technician/quotes/[jobId]` |
| `inspect_[jobId]` | Set job `INSPECTION` → send provider CTA link to same quote form |
| `decline_[jobId]` | Unchanged — prompt decline reason |

### Post-accept WhatsApp to provider

```
Great! Submit your quote here:
[Submit Quote →]  app.plugapro.co.za/technician/quotes/[jobId]

Include your labour cost, any materials, and estimated time.
```

### After provider submits quote — WhatsApp to client

```
You have a new quote from [ProviderName]:

Labour:     R [amount]
Materials:  R [amount]   (omitted if 0)
──────────────────────
Total:      R [total]

[description]
Est. time:  [X] hours
Valid until: [date]

[Accept Quote]  [Decline Quote]

Or view online: app.plugapro.co.za/quotes/[token]
```

### Client response handling

A new handler in the webhook processes `quote_accept_[jobId]` / `quote_decline_[jobId]` button replies:

- **Accept** → `Quote.status = APPROVED`, `Job.status = SCHEDULED` → WhatsApp confirmation to both parties
- **Decline** → `Quote.status = DECLINED`, `Job.status = DECLINED` → WhatsApp notification to provider

---

## 6. Quote Submission Form (`/technician/quotes/[jobId]`)

**Fields:**

| Field | Type | Required |
|---|---|---|
| Labour cost (R) | Number | Yes (> 0) |
| Materials cost (R) | Number | No (default 0) |
| Total | Auto-calculated display | — |
| Description / scope | Textarea (min 10 chars) | Yes |
| Estimated duration | Number (hours) | No |
| Valid for | Select: 24h / 48h / 72h / 1 week | Yes |
| Post-inspection toggle | Checkbox | No |

**Guards:**
- `job.status` must be `QUOTE_PENDING` or `INSPECTION`
- `job.provider.phone` must match session provider phone → else 403 → redirect `/technician`

**On submit:**
1. `POST /api/technician/quotes` — creates `Quote` with random `approvalToken` (cuid), sets `Job.status = QUOTE_PENDING`
2. Sends WhatsApp message to client with buttons + web link
3. Redirects provider to `/technician/jobs/[jobId]` with success toast

**Inspection state:** If `job.status === 'INSPECTION'`, show banner "Submit your quote after your site inspection." Pre-check and disable the `postInspection` toggle.

**Duplicate prevention:** If a `Quote` already exists for `jobId`, return the existing record with a "Quote already submitted" notice.

---

## 7. Client Approval Page (`/quotes/[token]`)

**Public — no auth. Token lookup only.**

Displays:
- Provider name
- Labour / materials / total breakdown
- Scope description
- Estimated duration
- Valid until timestamp
- Accept / Decline buttons

**On accept:** `PATCH /api/quotes/[token]` `{ action: 'approve' }` — wrapped in Prisma transaction:
1. Check `quote.status === 'PENDING'` and `quote.validUntil > now()` — else return 409 (expired/already actioned)
2. Set `Quote.status = APPROVED`
3. Set `Job.status = SCHEDULED`
4. Send WhatsApp confirmations to both parties
5. Return success — page shows confirmation with job date

**On decline:** Same flow with `action: 'decline'` → `DECLINED` on both records.

**Expired quote:** Page shows "This quote expired on [date]. Please contact the provider to request a new one."

---

## 8. Earnings Dashboard (`/technician/earnings`)

**Sections:**

### Current month summary
- Gross earned
- Commission (15%)
- Net payout
- Pending payout (jobs completed, payout not yet transferred)
- Paid out (transferred)

### Job breakdown (current month)
Table: category, area, completed date, gross, net (gross × 0.85)

### Monthly history
Accordion by month — each row shows month label, net total, paid status, PDF download button.

### PDF statements
`GET /api/technician/earnings/statement?month=2026-02` — returns HTML with print stylesheet (no external PDF library). Client triggers `window.print()` to save as PDF.

**API response shape:**
```ts
{
  currentMonth: {
    gross: number
    commission: number
    net: number
    pending: number
    paid: number
    jobs: {
      id: string
      category: string
      area: string
      completedAt: string
      gross: number
      net: number
    }[]
  }
  history: {
    month: string       // "2026-02"
    gross: number
    net: number
    paid: boolean
    payoutId: string | null
  }[]
}
```

**Commission tooltip:** "Plug a Pro charges 15% commission on gross earnings. This covers platform fees, payment processing, and customer acquisition."

---

## 9. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Quote expired | Approval page shows expiry message; cron/inline check marks `EXPIRED` |
| Client taps Accept twice (concurrent) | Prisma transaction with status pre-check → 409 on second tap |
| Provider submits quote twice | API returns existing quote + "already submitted" notice |
| Client has no WhatsApp | Web link always included; token valid until `validUntil` |
| Provider auth mismatch on quote form | 403 → redirect `/technician` |
| No ProviderPayout records | Earnings API returns empty `history: []` — no error |
| PDF generation failure | Fallback: plain HTML + `window.print()` |

---

## 10. Testing Approach

- **Quote API:** unit tests — valid submit, duplicate submit, auth mismatch, expired/wrong-status job
- **Approval token:** uniqueness on generation, expiry enforcement, concurrent-accept race condition
- **State machine:** integration test MATCHED → QUOTE_PENDING → SCHEDULED end-to-end
- **Earnings API:** seed jobs with known gross, verify 15% commission and grouping by month
- **WhatsApp mocks:** existing `sendButtons` / `sendCtaUrl` mock pattern extended for quote buttons

---

## 11. Out of Scope (Pilot)

- Payment processing (PayFast, payment_received template)
- booking_confirmation, payment_reminder, payment_received WhatsApp templates
- Stripe / any payment gateway
- Payout transfers (ProviderPayout records created but status stays PENDING)
