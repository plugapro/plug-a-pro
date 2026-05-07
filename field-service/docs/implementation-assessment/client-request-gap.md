# Client Service Request — As-Is and Gap Analysis

**Date:** 2026-05-07
**Step:** 07 of the Plug A Pro Codex Implementation Pack

---

## Request creation channels

Two independent channels produce a `JobRequest` row via the same shared service (`lib/job-requests/create-job-request.ts`).

### WhatsApp channel

Entry point: `lib/whatsapp-flows/job-request.ts` → `handleJobRequestFlow(ctx)`.

**Full step sequence (new user):**

1. `welcome` — WhatsApp greeting, main menu sent.
2. `browse_categories` — customer selects category from a paged WhatsApp list (14 categories; page size 8).
3. `collect_name` — first name collected (skipped for returning customers with a known name).
4. `collect_site` (or `collect_address`) — for returning customers with saved addresses a site picker is shown; otherwise falls through.
5. `collect_address_street` — free-text street address (e.g. `14 Main Street`).
6. `addr_select_province` → `addr_select_city` → `addr_select_region` → `addr_select_suburb` — structured location selected from `LocationNode` hierarchy.
7. `addr_confirm` — confirmation of full address before proceeding.
8. `collect_issue_description` — free-text problem description (min 5 chars).
9. `collect_availability` — availability button: ASAP / this week / weekend / next week / morning / afternoon.
10. `confirm_job_request` — provider-matching preference: Save money / Best value / Best quality.
11. `collect_photos` — optional up to 5 images (stored in Vercel Blob via `lib/whatsapp-media.ts`; linked to the request via `Attachment` after submit).
12. `job_request_submitted` — customer confirms → `createJobRequest()` is called → `JobRequest` row created → post-submit WhatsApp CTA with ticket URL sent.

**Returning user fast path:**
- Name step skipped.
- If one saved address exists: `addr_same` / `addr_new` button prompt.
- If multiple saved addresses exist: list picker before description step.
- If saved address has no `locationNodeId` (legacy): forced re-entry.

**Rebook flow:** `handleRebookFlow()` locates the most recent completed job and pre-fills category/title for one-tap re-submission.

---

### PWA channel

Entry point: `app/(customer)/book/[serviceId]/page.tsx` → renders `components/customer/BookingFlow.tsx`.

**Requires Supabase auth session** with `role === 'customer'`. Unauthenticated users are redirected to `/sign-in`.

**Multi-step form (3 steps):**

1. **Address** — structured address capture:
   - Province selector (dropdown from static list).
   - `SuburbPicker` component — searches `LocationNode` hierarchy and returns `locationNodeId`, suburb, region, city, province, postalCode.
   - GPS auto-fill via `GET /api/customer/location-reverse`.
   - Optional: unit number, complex name, address line 1, address line 2.
   - Flag-gated saved-site picker (`feature.customer.address_book`).
2. **Describe your job** — captures: subcategory, job type, title, description, access notes, photos (up to 5), urgency (ASAP/this week/flexible), preferred date, preferred time window, provider preference, budget preference, max call-out fee.
3. **Confirm** — summary card + two checkboxes (privacy + terms) → `POST /api/customer/bookings`.

**Draft persistence:** localStorage keyed by category slug; restored on page reload.

**Submission API:** `POST /api/customer/bookings` → calls `createJobRequest()` → returns `{ jobRequestId, ticketUrl }`.

**Post-submit notification:** `notifyCustomerPwaRequestSubmitted()` in `lib/client-pwa-submission-notifications.ts` sends a WhatsApp text + CTA URL with the ticket link.

---

## Captured fields (vs required)

### WhatsApp path — fields stored on JobRequest

| Field | Captured? | How |
|---|---|---|
| `category` | Yes | List selection |
| `title` | Yes | Category label used as title |
| `description` | Yes | Free text (issue + availability note combined) |
| `source` | Yes | `'whatsapp'` |
| `subcategory` | No | Not captured on WhatsApp |
| `urgency` | Yes | Availability button mapped to `urgent/soon/flexible` |
| `providerPreference` | Yes | 3-button preference |
| `budgetPreference` | No | Removed from active flow (pass-through for in-flight) |
| `verifiedOnly` | No | Always false on WhatsApp path |
| `requestedWindowStart/End/ArrivalLatest` | Partial | `requestedWindowEnd` / `requestedArrivalLatest` set from urgency |
| `requiredSkillTags/CertificationCodes/EquipmentTags/VehicleTypes` | Yes | Resolved from `resolveCategoryRequirements()` |
| `maxCallOutFee` | No | Not captured on WhatsApp |
| `photos (Attachment)` | Yes | Up to 5, stored in Vercel Blob |

### PWA path — fields stored on JobRequest

| Field | Captured? | How |
|---|---|---|
| `category` | Yes | URL param (`/book/[serviceId]`) |
| `subcategory` | Yes | Optional text input |
| `title` | Yes | Required text input |
| `description` | Yes | Optional textarea (prepended with job type) |
| `source` | Yes | `'web'` (set by API route) |
| `urgency` | Yes | 3-button urgency + optional date/time window |
| `requestedWindowStart/End/ArrivalLatest` | Yes | Resolved from `resolvePreferredTimingWindow()` |
| `providerPreference` | Yes | Dropdown (5 options incl. `fastest_available`, `verified_only`) |
| `budgetPreference` | Yes | Dropdown (4 options) |
| `verifiedOnly` | Yes | Derived from `providerPreference === 'verified_only'` |
| `maxCallOutFee` | Yes | Optional numeric input |
| `accessNotes` | Yes | Optional textarea (address-level privacy) |
| `photos (Attachment)` | Yes | Up to 5, uploaded via FormData |
| `requiredSkillTags/CertificationCodes/EquipmentTags/VehicleTypes` | Yes | Resolved from `resolveCategoryRequirements()` |

### Field gaps for Qualified Shortlist Model

The following fields exist on the schema but are **not collected by either channel today**:

| Missing field | Location | Required for |
|---|---|---|
| `subcategory` on WhatsApp | `JobRequest.subcategory` | Provider matching precision |
| `budgetPreference` on WhatsApp | `JobRequest.budgetPreference` | Shortlist sorting |
| `maxCallOutFee` on WhatsApp | `JobRequest.maxCallOutFee` | Filtering by price ceiling |
| `jobType` / scope indicator | Not a DB field; encoded in description | Inspection-vs-repair routing |
| `customerAcceptedAmount` | `JobRequest.customerAcceptedAmount` | Auto-booking on assignment |
| `estimatedDurationMinutes` | Default 120; not captured | Scheduling slots |

---

## Address handling

### Structure

`Address` model (stored in `addresses` table) is fully structured:

```
street (legacy concatenation)
addressLine1   — primary street line (e.g. "14 Main Road")
addressLine2   — optional secondary line
complexName    — optional complex / estate name
unitNumber     — optional unit / flat number
accessNotes    — sensitive; gate codes, dog warnings, parking; hidden from providers
suburb         — normalised via LocationNode
region         — normalised via LocationNode
city           — normalised via LocationNode
province       — normalised via LocationNode
postalCode     — derived from selected suburb node (4-digit SA code)
locationNodeId — FK to LocationNode.SUBURB
lat / lng      — geocoded by Nominatim/Google; optional
```

### WhatsApp path

- Street line: free text.
- Province → city → region → suburb: all selected from `LocationNode` controlled lists via paged WhatsApp list messages.
- Postal code: derived from the `LocationNode.postalCode` on the selected suburb.
- Old in-flight conversations that used free-text suburb/city are redirected to the new structured picker.

### PWA path

- Province: dropdown (9 SA provinces).
- Suburb: `SuburbPicker` component sends `GET /api/customer/location-reverse?lat&lng` or searches `LocationNode` by keyword; returns full structured selection.
- Street: free-text `addressLine1` (required); `addressLine2`, `complexName`, `unitNumber` optional.

### Address reuse

Both channels support reusing a saved `Address` via `existingAddressId`. The PWA reuse is flag-gated (`feature.customer.address_book`). WhatsApp reuse is always available for returning customers.

---

## Photo handling

- Photos are stored in **Vercel Blob** via `lib/storage.ts` (download + upload wrapper in `lib/whatsapp-media.ts` for WhatsApp; direct multipart upload for PWA).
- Each photo creates an `Attachment` row with `label = 'customer_photo'`, `uploadedBy`, `blobKey`, `mimeType`, `sizeBytes`.
- WhatsApp: photos are uploaded before `JobRequest` exists (during the `collect_photos` step); linked atomically inside `createJobRequest.$transaction` via `Attachment.updateMany({ jobRequestId: null })`. Link count is verified; mismatch throws `JobRequestPhotoLinkError`.
- PWA: photos are uploaded as FormData multipart with the submission request; created with `jobRequestId` already set.
- `safeForPreview` flag exists on `Attachment`. Defaults to `true`. Customer can uncheck "Share photos with shortlisted providers" in the PWA confirm step; when unchecked, `photoSafeForPreview = false` is passed to the API route.

### Provider access gate

- Before `LeadUnlock` exists: providers see the `safeForPreview` flag determines inclusion.
- After `LeadUnlock` (provider accepted): `lib/provider-lead-detail.ts` fetches the full `Address` including `accessNotes` only when a `LeadUnlock` row exists for that lead.
- There is **no explicit attachment gating by unlock status** in the token page (`app/requests/access/[token]/page.tsx`). Photos are always rendered via `/api/attachments/[id]?token=...`. The API route must validate token scope.

---

## Status model

### JobRequestStatus enum (schema)

```
PENDING_VALIDATION  — just submitted, platform reviewing
OPEN                — validated, broadcasting leads to providers
MATCHING            — at least one lead sent, awaiting acceptance
SHORTLIST_READY     — qualified shortlist ready for customer comparison
PROVIDER_CONFIRMATION_PENDING — customer selected provider; awaiting final acceptance
MATCHED             — provider accepted, Match created
EXPIRED             — no provider accepted within window
CANCELLED           — customer cancelled
```

**Note:** `AWAITING_RESPONSES`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED` listed in the task brief are **not** on `JobRequest`. They belong to `BookingStatus` and `JobStatus`, which are downstream of a `Match`. The task brief conflates the two state machines.

### PWA screen mapping (`lib/client-pwa-state.ts`)

| Request status | PWA screen |
|---|---|
| `PENDING_VALIDATION` | `request_submitted` |
| `OPEN` | `matching_progress` |
| `MATCHING` | `providers_reviewing` |
| `SHORTLIST_READY` | `shortlist` |
| `PROVIDER_CONFIRMATION_PENDING` | `provider_confirmation` |
| `MATCHED` | delegates to job status |
| `EXPIRED` | `expired` |
| `CANCELLED` | `cancelled` |

Job status sub-screens: `job_tracking`, `active_job`, `completion_review`, `cancelled`.

---

## Customer tracking pages

### Authenticated tracking (`app/(customer)/requests/[id]/page.tsx`)

- **Auth required**: Supabase session with `role === 'customer'`.
- Confirms customer owns the request.
- Redirects to `/bookings/[id]` if a booking exists.
- Shows: request title/description, address (street + suburb + city), creation date, expiry, photos, lead activity (provider names + status), matched provider card (bio, trust signals, portfolio), quote timeline, booking summary.
- **Does not render the shortlist** (shortlist is only in the token page).

### Token-based tracking (`app/requests/access/[token]/page.tsx`)

- **No auth required**: 90-day `customerAccessToken` on `JobRequest`.
- Renders the full Qualified Shortlist Model journey in a single page:
  - Status: submitted / matching_progress / providers_reviewing.
  - **Shortlist section**: ranked provider cards with call-out fee, estimated arrival, rate, completed jobs, rating, portfolio URLs, trust signals, per-item select button.
  - Provider confirmation: waiting state with support link.
  - Job tracking: step timeline from `buildClientPwaJobTrackingSteps()`.
  - Work evidence: job photos.
  - Quote history timeline.
  - Completion: rate provider / book again / report issue.
- Server actions: `selectShortlistProvider`, `askForMoreShortlistOptions`, `cancelRequestAction` — all re-validate the token before acting.

---

## Shortlist page

The shortlist is rendered **inside the token page** at `/requests/access/[token]?view=shortlist`.

**Current shortlist display:**
- Provider name, verified status, avatar.
- Call-out fee, estimated arrival time.
- Hourly rate (or "Negotiable").
- Completed jobs count, average rating.
- Skills, service areas (first 5 each).
- Portfolio URLs.
- Trust signals (via `buildProviderTrustSignals()`).
- Trust note (marketplace-approved vs provider-supplied).
- "View profile" link opens provider detail panel on the same page via `?provider=<id>` query param.
- "Select provider" form action.

**Shortlist generation** (`lib/customer-shortlists.ts` → `generateCustomerShortlistForRequest()`):
- Reads `ProviderLeadResponse` rows with `response = 'INTERESTED'`, `callOutFee != null`, `estimatedArrivalAt != null`, non-expired leads, active + verified providers.
- Sorted by `estimatedArrivalAt ASC, callOutFee ASC`.
- Creates `ProviderShortlist` + `ProviderShortlistItem` rows; supersedes any previous PUBLISHED shortlist.
- Updates `JobRequest.status = 'SHORTLIST_READY'`.
- Notifies customer via WhatsApp text + CTA URL.

**Gap:** `ProviderShortlistItem` does not expose `callOutFee` and `estimatedArrivalAt` directly via `getCustomerShortlistForRequest()`. The page reads them from the linked `leadInvite.providerResponses` record. This works but creates a query dependency not obvious from the model.

---

## Privacy enforcement

### Before provider acceptance

- `Address.accessNotes` is **schema-comment-gated**: never returned in provider safe-preview payloads.
- `lib/provider-lead-detail.ts` only populates `accessNotes` when a `LeadUnlock` exists for that lead (i.e. provider accepted and paid credits).
- Providers receive a safe preview with only suburb, city, province — no street, no house number, no access notes.

### After acceptance (LeadUnlock)

- `lib/provider-lead-detail.ts` fetches full `Address` including `accessNotes` when `unlock != null`.
- The customer's phone number is revealed to the provider at this point.

### Customer-facing token page

- `Address.street`, suburb, and city are rendered on the customer's ticket page (customer can see their own exact address — this is correct).
- `accessNotes` are **not rendered** on the token page — correct.

### Photo gating

- `Attachment.safeForPreview` flag exists but **no explicit server-side gate** was found in the shortlist item query or token-page Prisma include. The token page renders all `attachments` where `label IN ['customer_photo', 'evidence']` without checking `safeForPreview`. This is a gap.

---

## Gaps against Qualified Shortlist Model

| # | Gap | Severity | Notes |
|---|---|---|---|
| G1 | `safeForPreview` not enforced in token-page attachment query | High | All photos shown to token-holder regardless of flag |
| G2 | No shortlist page in the authenticated PWA (`/requests/[id]`) | Medium | Auth'd customers see matching activity but not the shortlist |
| G3 | WhatsApp path does not capture subcategory, maxCallOutFee, or budgetPreference | Medium | Reduces provider matching precision from WhatsApp-originated requests |
| G4 | WhatsApp path `title` is just the category label | Low | Shortlist display shows category label, not a meaningful job title |
| G5 | `ProviderShortlistItem` lacks `callOutFee` / `estimatedArrivalAt` as denormalized fields | Low | Page reads from `leadInvite.providerResponses`; fragile if response is deleted |
| G6 | No duplication check for `SHORTLIST_READY` → `OPEN` regression on status model | Low | If matching is re-triggered, status could revert; idempotency guards needed |
| G7 | `accessNotes` field captured in PWA BookingFlow (stored on Address) but not shown in the authenticated request detail page | Low | Customer cannot review own access notes post-submission |
| G8 | Attachment API route (`/api/attachments/[id]?token=...`) token validation not inspected here | High | Needs separate audit in Step 15 |
| G9 | PWA `providerPreference` options (`fastest_available`, `verified_only`, etc.) differ from WhatsApp options (`save_money`, `best_value`, `best_quality`) | Medium | Both sets write to `JobRequest.providerPreference` with different values; matching engine must handle both |
| G10 | No customer-facing "request more options" timeout or fallback messaging from shortlist screen | Medium | User left waiting if shortlist is exhausted; only manual support link shown |

---

## Reuse recommendations

| Asset | Reuse decision |
|---|---|
| `lib/job-requests/create-job-request.ts` | Shared entry point for both channels; no duplication required |
| `lib/client-pwa-state.ts` | `resolveClientPwaScreenForState()` is the canonical screen resolver; extend here for new screens |
| `lib/client-pwa-destination.ts` | Single entry point for token + request-id + job-id resolution; reuse everywhere |
| `lib/client-pwa-handoff.ts` | WhatsApp CTA URL builder; reuse for all outbound links |
| `lib/customer-shortlists.ts` | `generateCustomerShortlistForRequest()` and `getCustomerShortlistForRequest()` are the canonical shortlist writers/readers |
| `lib/structured-address.ts` | `resolveStructuredAddressCapture()` is shared between WA and PWA paths for address normalisation |
| `lib/job-request-access.ts` | `ensureJobRequestAccessToken()` and `resolveJobRequestAccessToken()` are the only token generators — do not duplicate |
| `lib/client-request-flow.ts` | PWA-only timing/validation helpers; WhatsApp uses `lib/client-request-data.ts` equivalents |
| `components/customer/BookingFlow.tsx` | PWA multi-step form; extend here for new fields — do not create parallel form components |

---

## Required changes

### For Qualified Shortlist Model parity

1. **Enforce `safeForPreview`** in `clientPwaRequestInclude` (inside `lib/client-pwa-destination.ts`) by adding `where: { safeForPreview: true }` to the `attachments` include for the shortlist / providers-reviewing screens. Full `safeForPreview = false` attachments should only be included for the token-holder post-acceptance.

2. **Add shortlist rendering to the authenticated request detail page** (`app/(customer)/requests/[id]/page.tsx`). Currently auth'd customers miss the shortlist section that only appears on the token page.

3. **Align `providerPreference` values** across channels or add a normalisation layer in the matching engine to translate both value sets to a single internal enum.

4. **Denormalise shortlist display data**: store `callOutFee` and `estimatedArrivalAt` on `ProviderShortlistItem` at shortlist generation time rather than joining through `providerResponses` at read time. Schema already has `displayCallOutFee` and `displayArrivalTime` columns — they should be populated.

5. **Capture richer data on WhatsApp**: add subcategory and max-callout-fee steps to the WhatsApp flow, or at minimum include them as optional quick-reply steps.

6. **Attachment API route audit** (Step 15): confirm `safeForPreview` is enforced server-side in `/api/attachments/[id]` before any attachment URL is served to a provider or unauthenticated token holder.

---

## Risks

| Risk | Likelihood | Impact |
|---|---|---|
| Provider receives photo marked `safeForPreview = false` before acceptance | Medium | Privacy violation |
| Customer selects a provider from the shortlist before `LeadUnlock` is created, leaving `accessNotes` in limbo | Low | Operational confusion; exact address/access notes not automatically shared |
| WhatsApp request with `category = 'cat_plumbing'` label conflicts with PWA request using `category = 'plumbing'` slug | Low | Matching engine may not recognise WA category IDs if it compares against slug values |
| `ProviderShortlist.status = 'DRAFT'` rows never published (no trigger guard) | Low | Silent failure; customer waits without shortlist |
| Token expiry at 90 days means long-running requests lose customer access link | Low | Edge case; token renewal needs to be triggered on extension |

---

## OpenBrain Note

This document was produced in Step 07. The following items require follow-up in later steps:

- **Step 08** (Data Capture and Privacy): address the `safeForPreview` gap (G1) and the access-notes render gap (G7) with concrete code changes.
- **Step 09** (Submission and Notifications): align the two-notification pattern (WhatsApp text + CTA URL) and confirm idempotency guards.
- **Step 12** (Customer Shortlist): handle G2, G5, G10.
- **Step 15** (Security and Privacy): audit G8, confirm attachment API token validation.
