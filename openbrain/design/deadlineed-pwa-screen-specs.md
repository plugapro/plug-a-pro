# Deadlineed — PWA Screen Specs

> **Status:** Design target as of 2026-05-03
> **Milestone:** M1 (identity/sites), M3 (quote approval), M4 (provider PWA), M6 (provider browse)
> **Related:** [To-Be Journey](../journeys/deadlineed-to-be-journey.md) · [Implementation Plan](../tasks/deadlineed-implementation-plan.md)
>
> **UI stack:** Next.js App Router · shadcn/ui (new-york) · Radix UI · Tailwind CSS v4 · lucide-react icons
> **Server action pattern:** co-located `actions.ts` files following `app/(admin)/admin/{customers,providers,locations}/actions.ts`

---

## CUSTOMER SCREENS

---

<a name="screen-address-book"></a>
## Screen C1 — Multi-Site Address Book (`/account/sites`)

**Route:** `field-service/app/(customer)/account/sites/page.tsx` (new file)
**Auth:** Required (`getSession()` + `resolveCustomerForSession()`)
**Feature flag:** `feature.customer.address_book` (seed in `scripts/seed-flags.ts`)

### Layout

```
┌──────────────────────────────────────┐
│ ← Account                            │
│ My Sites                             │
│ ─────────────────────────────────────│
│ [+ Add site]                    btn  │
│ ─────────────────────────────────────│
│ ● Head Office          [Sandton, JHB]│
│   6 Rivonia Rd, Sandton, 2196        │
│   Default ✓                    [···] │
│ ─────────────────────────────────────│
│ ● Warehouse            [Midrand, JHB]│
│   15 New Rd, Midrand, 1682           │
│                               [···]  │
└──────────────────────────────────────┘
```

### Copy

- Page title: "My Sites"
- Empty state title: "No saved sites yet"
- Empty state description: "Save a site to skip address entry every time you book."
- Empty state CTA: "Add your first site"
- Row overflow menu items: "Set as default", "Edit", "Delete"
- Delete confirmation title: "Remove this site?"
- Delete confirmation description: "This site will be removed from your address book. Any existing bookings are not affected."
- Delete confirm button: "Remove site"
- Delete cancel button: "Keep it"

### States

| State | UI |
|-------|-----|
| Loading | Skeleton rows (3 × `h-16` cards) |
| Empty | `EmptyState` component with MapPin icon |
| Has sites | Scrollable list; default site has a "Default" badge |
| Save error | `sonner` toast: "Could not save site. Please try again." |
| Delete error | `sonner` toast: "Could not remove site." |

### Validation (Add/Edit Site modal)

| Field | Rule |
|-------|------|
| Site name | Required, max 40 chars |
| Street address | Required, max 120 chars |
| Suburb | Required — selected from `SuburbPicker` (existing component) |
| Unit / complex | Optional |

### Server action

```ts
// field-service/app/(customer)/account/sites/actions.ts
createCustomerSiteAction(formData: FormData): Promise<ActionResult>
updateCustomerSiteAction(formData: FormData): Promise<ActionResult>
deleteCustomerSiteAction(siteId: string): Promise<ActionResult>
setDefaultCustomerSiteAction(siteId: string): Promise<ActionResult>
```

Underlying Prisma model: `CustomerAddress` (new table — see M1 in implementation plan).

---

## Screen C2 — Business Onboarding Prompt (modal, post-OTP first login)

**Trigger:** `Customer.isBusinessAccount` is null (unset) after first successful OTP

### Layout

```
┌───────────────────────────────┐
│  Who are you booking for?     │
│  ─────────────────────────────│
│  ○ Myself / household         │
│    For home repairs and        │
│    maintenance                 │
│  ○ A business / organisation   │
│    Manage multiple sites and   │
│    track job history by site   │
│  [Continue →]                 │
└───────────────────────────────┘
```

### Copy

- Modal title: "Who are you booking for?"
- Personal option label: "Myself / household"
- Personal option description: "For home repairs and maintenance"
- Business option label: "A business or organisation"
- Business option description: "Manage multiple sites and track job history by site"
- CTA: "Continue"

### States

| State | UI |
|-------|-----|
| Selecting | Both options tappable; no default selection |
| Submitting | CTA shows spinner |
| Error | `sonner` toast: "Couldn't save your preference. Try again." |

**On "Continue":** `setCustomerAccountTypeAction(type: 'personal' | 'business')` — sets `Customer.isBusinessAccount` and optionally prompts for `Customer.businessName`.

---

## Screen C3 — BookingFlow Address Step (enhanced)

**Component:** `field-service/components/customer/BookingFlow.tsx` — `address` step (enhanced)
**Feature flag:** `feature.customer.address_book`

### Layout (when saved sites exist)

```
┌──────────────────────────────────────┐
│ Choose a saved site                  │
│                                      │
│ ● Head Office — Sandton, JHB        │
│ ● Warehouse — Midrand, JHB          │
│ ● Shop Front — Rosebank, JHB        │
│ ─────────── or ──────────────────── │
│ Enter a new address ▾               │
└──────────────────────────────────────┘
```

Manual address entry form (collapsed by default when sites exist):
- Same fields as current implementation
- "Save this address to my sites" checkbox (checked by default if `isBusinessAccount`)

### States

| State | Condition |
|-------|----------|
| Saved sites list shown | `Customer.addresses.length > 0` AND flag enabled |
| Manual entry only | No saved sites or flag disabled (current behaviour) |
| GPS detect | Unchanged |

---

## Screen C4 — Bookings Dashboard (enhanced)

**Route:** `field-service/app/(customer)/bookings/page.tsx` (enhance existing)

### Layout (business account)

```
┌──────────────────────────────────────┐
│ My Requests & Bookings               │
│ Site: [All sites ▾]  Cat: [All ▾]   │
│ ─────────────────────────────────────│
│ ACTIVE REQUESTS                      │
│ ┌─────────────────────────────────┐  │
│ │ HVAC Service    [Head Office]   │  │
│ │ Sandton · OPEN · 2 May          │  │
│ │ Pending match              [→]  │  │
│ └─────────────────────────────────┘  │
│ ─────────────────────────────────────│
│ COMPLETED BOOKINGS                   │
│ ┌─────────────────────────────────┐  │
│ │ Plumbing        [Warehouse]     │  │
│ │ Midrand · COMPLETED · 30 Apr    │  │
│ │ R 850                [Book again]│  │
│ └─────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### New elements

- **Site filter dropdown** — `Select` component; options: "All sites" + each `CustomerAddress.label`; only shown for `isBusinessAccount` customers
- **Category filter dropdown** — `Select` component; options: "All categories" + active categories from existing bookings
- **"Book again" CTA** on completed booking rows — navigates to `/book/[category]?template=<jobRequestId>`; BookingFlow reads `?template` param and pre-fills description
- **Site badge** on each row — shows `CustomerAddress.label` if the job was linked to a named site

### States

| State | UI |
|-------|-----|
| Loading | Skeleton cards |
| Filters applied | Filtered list with "X results" count |
| No results for filter | "No bookings match your filters." with "Clear filters" link |

---

## Screen C5 — Booking Detail (enhanced)

**Route:** `field-service/app/(customer)/bookings/[id]/page.tsx` (enhance existing)

### New elements

**Invoice download section** (shown when `Job.status = 'COMPLETED'`):

```
┌──────────────────────────────────────┐
│ Invoice & Receipt                    │
│ ─────────────────────────────────────│
│ Total paid: R 1,250.00               │
│ Job ref: XXXXXXXX                    │
│ [Download invoice PDF]          btn  │
└──────────────────────────────────────┘
```

Copy:
- Section label: "Invoice & Receipt"
- Total paid label: "Total paid"
- CTA: "Download invoice PDF"
- Loading: "Generating invoice…"
- Error: `sonner` toast: "Could not generate invoice. Please try again."

**En-route banner** (shown when `Job.status = 'EN_ROUTE'`):

```
┌──────────────────────────────────────┐
│ 🚗 Your provider is on the way       │
│ {{providerName}} is headed to your   │
│ location.                            │
└──────────────────────────────────────┘
```

Copy: "Your provider is on the way — {{providerName}} is headed to your location."

---

## Screen C6 — Provider Browse Catalogue (`/providers`) — *NEW* (M6)

**Route:** `field-service/app/(customer)/providers/page.tsx` (new file)
**Auth:** Required
**Feature flag:** `feature.customer.provider_browse`

### Layout

```
┌──────────────────────────────────────┐
│ ← Back                               │
│ Browse Providers                     │
│ Category: [Plumbing ▾]  Area: [All▾]│
│ ─────────────────────────────────────│
│ ┌─────────────────────────────────┐  │
│ │ 👤 Lovemore Sibanda             │  │
│ │ ★ 4.8 (12 reviews)             │  │
│ │ Plumbing · Handyman             │  │
│ │ Sandton, Midrand                │  │
│ │ ✓ Marketplace Reviewed          │  │
│ │ [View profile]            →     │  │
│ └─────────────────────────────────┘  │
│ ...                                  │
└──────────────────────────────────────┘
```

Uses existing `components/shared/ProviderCard.tsx` (currently unused).

### Copy

- Page title: "Browse Providers"
- Category filter label: "Category"
- Area filter label: "Area"
- Empty state: "No providers found for these filters."
- CTA on card: "View profile"

### States

| State | UI |
|-------|-----|
| Loading | 3 × skeleton `ProviderCard` |
| Filters active | Filtered list |
| Empty | `EmptyState` with Users icon |

---

## Screen C7 — Provider Profile (ungated)

**Route:** `field-service/app/(customer)/providers/[id]/page.tsx` (modify existing)
**Change:** Remove `hasRelationship` guard (currently lines 34–44); any authenticated customer can view

---

## Screen C8 — Quote Approval (in-app, enhanced)

**Component:** `components/quotes/QuoteHistoryTimeline.tsx` (enhance)
**Change:** When a `Quote` has `status = 'PENDING'` and `approvalToken` is set, show Approve / Decline inline buttons (in addition to the existing tokenized PWA link). Calls existing server action pattern.

### Copy

- Quote card header: "Quote ready for your review"
- Amount line: "Total: R {{amount}}"
- Labour / materials breakdown: "Labour R {{labourCost}} · Materials R {{materialsCost}}"
- Hours: "Estimated {{estimatedHours}} hours"
- Preferred date: "Proposed date: {{preferredDate}}"
- Valid until: "Valid until {{validUntil}}"
- Approve button: "Approve quote"
- Decline button: "Decline"
- Approved state: "Quote approved ✓"
- Declined state: "Quote declined"
- Error toast: "Could not process your response. Please try again."

---

## PROVIDER SCREENS

---

<a name="screen-provider-lead-inbox"></a>
## Screen P1 — Provider Lead Inbox (`/provider/leads`) — *NEW* (M4)

**Route:** `field-service/app/(provider)/leads/page.tsx` (new route group `(provider)`)
**Auth:** `requireProvider()` guard from `lib/auth.ts`
**Feature flag:** `feature.provider.pwa_inbox`

### Layout

```
┌──────────────────────────────────────┐
│ Lead Inbox                           │
│ ─────────────────────────────────────│
│ OPEN LEADS (2)                       │
│ ┌─────────────────────────────────┐  │
│ │ Plumbing · Sandton, JHB         │  │
│ │ Today / ASAP · Expires 14:30   │  │
│ │ 1 credit to accept              │  │
│ │ [Accept]  [Decline]             │  │
│ └─────────────────────────────────┘  │
│ ─────────────────────────────────────│
│ ACCEPTED                             │
│ ┌─────────────────────────────────┐  │
│ │ HVAC · Midrand, JHB             │  │
│ │ MATCHED · Scheduled Mon 9 AM   │  │
│ │ [View job details →]            │  │
│ └─────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Copy

- Page title: "Lead Inbox"
- Section header open: "Open Leads ({{count}})"
- Section header accepted: "Accepted"
- Lead row: "{{category}} · {{suburb}}, {{city}}"
- Urgency: urgency label from `mapAvailabilityToUrgency()`
- Expiry: "Expires {{time}}" (derived from `Lead.expiresAt`)
- Credit cost: "1 credit to accept"
- Accept button: "Accept"
- Decline button: "Decline"
- Empty open: "No open leads right now. We'll notify you via WhatsApp when a new job comes in."
- Empty accepted: "No accepted leads yet."
- Accept error toast: "Could not accept lead. Check your credit balance."
- Low credits warning: "You have {{n}} credits left. Top up to keep accepting leads." + link to credits purchase

### States

| State | UI |
|-------|-----|
| Loading | Skeleton rows |
| Empty (open) | `EmptyState` with Inbox icon + WhatsApp reminder copy |
| Accept loading | Button spinner; both buttons disabled |
| Insufficient credits | Inline callout: "Not enough credits" + "Top up" CTA |

### Validation

- Accept requires `Provider.credits >= LEAD_UNLOCK_COST_CREDITS` (checked server-side)
- Accept is idempotent: if `Lead.status` already `ACCEPTED`, return success without double-charging

### Server action

```ts
// field-service/app/(provider)/leads/actions.ts
acceptLeadAction(leadId: string): Promise<ActionResult>
declineLeadAction(leadId: string, reason: string): Promise<ActionResult>
```

---

## Screen P2 — Lead Detail (`/provider/leads/[leadId]`) — *NEW*

### Layout

```
┌──────────────────────────────────────┐
│ ← Lead Inbox                         │
│ Plumbing Job · OPEN                  │
│ ─────────────────────────────────────│
│ Sandton, JHB (exact address on       │
│ accept)                              │
│ Urgency: Today / ASAP                │
│ Max call-out fee: R 500              │
│ ─────────────────────────────────────│
│ DESCRIPTION                          │
│ Burst pipe under kitchen sink.       │
│ Water leaking onto floor. Need       │
│ someone within 2 hours.              │
│ ─────────────────────────────────────│
│ PHOTOS (2)                           │
│ [img] [img]                          │
│ ─────────────────────────────────────│
│ 💳 Credit balance: 5 credits         │
│ Accepting this lead costs 1 credit   │
│ ─────────────────────────────────────│
│ [Accept — 1 credit]  [Decline]       │
└──────────────────────────────────────┘
```

### Copy

- Address: "{{suburb}}, {{city}} — exact address revealed on accept"
- Max call-out: "Max call-out fee: R {{amount}}" (or "Not specified" if null)
- Credit note: "Accepting this lead costs 1 credit. You have {{n}} credits remaining."
- Accept CTA: "Accept — 1 credit"
- Decline CTA: "Decline"
- Post-accept: "Lead accepted! Full customer details are now unlocked." + "View job details" link

---

## Screen P3 — Provider Profile Editor (`/provider/profile`) — *NEW* (M4)

### Layout

```
┌──────────────────────────────────────┐
│ My Profile                           │
│ ─────────────────────────────────────│
│ Name                [Lovemore Siban.]│
│ Bio                 [text area]      │
│ Experience          [text area]      │
│ ─────────────────────────────────────│
│ SKILLS                               │
│ [✓ Plumbing] [✓ Handyman] [Electrical│
│ ─────────────────────────────────────│
│ SERVICE AREAS                        │
│ Sandton · Midrand                    │
│ [Edit areas]                         │
│ ─────────────────────────────────────│
│ PORTFOLIO LINKS                      │
│ [https://...            ] [+ Add]    │
│ ─────────────────────────────────────│
│ DOCUMENTS                            │
│ SA ID on file ✓        [Re-upload]   │
│ Evidence (3 files) ✓   [Re-upload]   │
│ ─────────────────────────────────────│
│ [Save changes]                       │
└──────────────────────────────────────┘
```

### Copy

- Section headers: Name, Bio, Experience, Skills, Service Areas, Portfolio Links, Documents
- Skills instruction: "Select all the services you offer"
- Portfolio link placeholder: "https://your-portfolio-link"
- Add portfolio link: "+ Add link"
- Document row — ID: "SA ID or Passport on file ✓"
- Document row — Evidence: "Evidence photos/docs ({{count}} files) ✓"
- Re-upload CTA: "Re-upload"
- Re-upload note: "Re-uploading triggers a brief ops review but does not remove your active status."
- Save CTA: "Save changes"
- Saved toast: "Profile updated"
- Error toast: "Could not save profile. Please try again."

### Validation

| Field | Rule |
|-------|------|
| Name | Required, max 80 chars |
| Bio | Optional, max 500 chars |
| Experience | Optional, max 1000 chars |
| Skills | At least 1 required |
| Portfolio URLs | Each must be a valid URL (if provided) |

### Server action

```ts
// field-service/app/(provider)/profile/actions.ts
updateProviderProfileAction(formData: FormData): Promise<ActionResult>
reuploadProviderDocumentsAction(files: File[]): Promise<ActionResult>
```

---

## Screen P4 — Availability Toggle (`/provider/availability`) — *NEW* (M4, M5)

### Layout

```
┌──────────────────────────────────────┐
│ Availability                         │
│ ─────────────────────────────────────│
│ Current status                       │
│ ● AVAILABLE                 [Pause ▾]│
│ ─────────────────────────────────────│
│ Pause duration                       │
│ (shown when Pause tapped)            │
│ ○ 30 minutes                         │
│ ○ 1 hour                             │
│ ○ 2 hours                            │
│ ○ Rest of today                      │
│ ○ Indefinitely                       │
│                    [Confirm pause]   │
└──────────────────────────────────────┘
```

### Copy

- Status available: "You are available for new leads."
- Status paused (timed): "Paused until {{time}}. You'll be auto-resumed when this window ends."
- Status paused (indefinite): "You are paused. Reply 'available' on WhatsApp or tap below to resume."
- Resume CTA: "Resume now"
- Pause button: "Pause"
- Confirm pause CTA: "Confirm pause"
- Cancel: "Keep me available"
- After pause: toast "Availability paused until {{time}}"
- After resume: toast "You're back online — we'll send you leads"

### States

| State | UI |
|-------|-----|
| Available | Green badge; Pause dropdown visible |
| Paused (timed) | Amber badge; countdown; "Resume now" CTA |
| Paused (indefinite) | Red badge; "Resume now" CTA |
| Submitting | Button spinner |

### Server action

```ts
// field-service/app/(provider)/availability/actions.ts
pauseProviderAction(durationMinutes: number | null): Promise<ActionResult>
resumeProviderAction(): Promise<ActionResult>
```

Writes `TechnicianAvailability.availabilityState` and `breakUntil` — same fields as WA `offline`/`available` keywords.

---

## Screen P5 — Earnings Dashboard (`/provider/earnings`) — *NEW* (M4)

### Layout

```
┌──────────────────────────────────────┐
│ Earnings & Credits                   │
│ ─────────────────────────────────────│
│ 💳 Credit balance    5 credits       │
│   Promo: 2 · Paid: 3                │
│   [Top up credits]                   │
│ ─────────────────────────────────────│
│ RECENT JOBS                          │
│ Apr 30  Plumbing · Sandton   R 850   │
│ Apr 28  Handyman · Midrand   R 420   │
│ Apr 22  Cleaning · Rosebank  R 680   │
│ ─────────────────────────────────────│
│ [View all]                           │
└──────────────────────────────────────┘
```

### Copy

- Section: "Earnings & Credits"
- Credit balance line: "{{total}} credits — Promo: {{promo}} · Paid: {{paid}}"
- Top up CTA: "Top up credits"
- Recent jobs header: "Recent jobs"
- Job row: "{{date}}  {{category}} · {{suburb}}  R {{amount}}"
- No jobs: "No completed jobs yet."
- View all CTA: "View all jobs"

### States

| State | UI |
|-------|-----|
| Loading | Skeleton |
| Has data | Balance card + job list |
| Zero credits | Balance card with warning callout: "0 credits — you won't receive new leads until you top up." |

---

## Shared Components

| Component | File | Used in |
|-----------|------|---------|
| `SuburbPicker` | `components/customer/SuburbPicker.tsx` | C1, C3 |
| `ProviderCard` | `components/shared/ProviderCard.tsx` | C6 |
| `StatusBadge` | `components/shared/StatusBadge.tsx` | C4, P1 |
| `EmptyState` | `components/shared/EmptyState.tsx` | C1, C4, P1, P5 |
| `AlertCallout` | `components/shared/AlertCallout.tsx` | C5 en-route, P4 zero credits |
| `QuoteHistoryTimeline` | `components/quotes/QuoteHistoryTimeline.tsx` | C8 |
