# CLIENT-01 — Client PWA As-Is Assessment

## Status
COMPLETE — assessment only, no code changes

---

## Existing client routes

### Authenticated PWA routes (group: `app/(customer)/`)

| Route | Page file | Description |
|---|---|---|
| `/` | `app/(customer)/page.tsx` | Marketing home: category catalogue with "Request a job" CTA |
| `/bookings` | `app/(customer)/bookings/page.tsx` | Authenticated list of all requests + confirmed bookings; filters by status, category, site |
| `/bookings/[id]` | `app/(customer)/bookings/[id]/page.tsx` | Booking detail: job timeline, work evidence photos, quote history, cancel booking, raise dispute, invoice download, rate prompt |
| `/bookings/[id]/rate` | `app/(customer)/bookings/[id]/rate/page.tsx` | 1–5 star rating + optional comment; one rating per booking |
| `/book/[serviceId]` | `app/(customer)/book/[serviceId]/page.tsx` | Request creation entry point; resolves category slug, renders `BookingFlow` client component |
| `/requests/[id]` | `app/(customer)/requests/[id]/page.tsx` | Authenticated request detail: shortlist view, provider confirmation banner, matching activity, booking link, quote history |
| `/providers` | `app/(customer)/providers/page.tsx` | Provider browse (flag-gated: `feature.customer.provider_browse`) |
| `/providers/[id]` | `app/(customer)/providers/[id]/page.tsx` | Customer-facing provider profile: trust signals, portfolio, reviews; "Book" CTA |
| `/profile` | `app/(customer)/profile/page.tsx` | Customer profile + WhatsApp preference management |
| `/account/sites` | `app/(customer)/account/sites/page.tsx` | Saved address book (flag-gated: `feature.customer.address_book`) |
| `/account/activity` | `app/(customer)/account/activity/page.tsx` | Account activity log |
| `/services` | `app/(customer)/services/page.tsx` | Services browse page |
| `/approve/[token]` | `app/(customer)/approve/[token]/page.tsx` | Tokenized extra-work approval — no login required |
| `/confirm-completion/[token]` | `app/(customer)/confirm-completion/[token]/page.tsx` | Tokenized job completion confirmation — no login required |

### Public token route (outside `(customer)` group)

| Route | Page file | Description |
|---|---|---|
| `/requests/access/[token]` | `app/requests/access/[token]/page.tsx` | Primary WhatsApp handoff entry point. Resolves `customerAccessToken`, renders all PWA screens in a single page: request detail, matching progress, shortlist, provider confirmation, job tracking, completed, expired, cancelled |
| `/requests/handover/[token]` | `app/requests/handover/[token]/page.tsx` | Separate handover token route (file exists; not read in this pass) |

---

## Existing WhatsApp handoff links

WhatsApp messages send customers to `/requests/access/<token>?view=<screen>`. Token URLs are constructed by:

1. `getJobRequestAccessUrl(jobRequestId, view?)` in `lib/job-request-access.ts:60` — called by:
   - `lib/job-requests/create-job-request.ts:446` — on request submission, sends `?view=matching_status`
   - `lib/customer-shortlists.ts:141` — on shortlist ready, sends `?view=shortlist`
   - `lib/selected-provider-acceptance.ts:422` — on provider acceptance, sends `?view=job_tracking`
   - `lib/jobs.ts:141` — on job status transitions
   - `lib/whatsapp-flows/status.ts:768` — on matching status update, sends `?view=matching_status`
   - `lib/matching/customer-recontact.ts:571` — on re-contact flows
2. `buildClientPwaTokenPath(token, view)` in `lib/client-pwa-handoff.ts:72` — builds canonical path `/requests/access/<token>?view=<view>`

The `view` parameter maps to `ClientPwaHandoffView` / `ClientPwaScreen` types to select which UI block to render within the single-page ticket view.

---

## Secure token model

**Token type:** Random 48-character hex string (`randomBytes(24).toString('hex')`)  
**Storage:** `JobRequest.customerAccessToken` column in DB  
**TTL:** 90 days from generation/refresh (`ACCESS_TOKEN_TTL_DAYS = 90` in `lib/job-request-access.ts:6`)  
**Revocation:** `customerAccessTokenRevokedAt` timestamp column  
**Resolution:** `resolveJobRequestAccessToken(token)` — returns `active | expired | invalid` + full request payload  
**Idempotent generation:** `ensureJobRequestAccessToken(requestId)` reuses valid tokens; only rotates on expiry or revocation  

Access level contract (`ClientPwaAccessLevel`):
- `public_token` — WhatsApp link path, unauthenticated
- `trusted_reference` — server-side call with internal `requestId`, skips token lookup
- `expired` — token past TTL or explicitly revoked
- `invalid` — token not found in DB

The `resolveClientPwaDestination()` function in `lib/client-pwa-destination.ts` is the canonical resolver — converts token or internal ID into a `ClientPwaDestination` struct containing screen, route, allowedActions, and full request payload.

---

## Current status rendering

### `resolveClientPwaScreenForState()` in `lib/client-pwa-state.ts`

Maps `JobRequestStatus` → `ClientPwaScreen`:

| JobRequestStatus | ClientPwaScreen |
|---|---|
| `PENDING_VALIDATION` | `request_submitted` |
| `OPEN` | `matching_progress` |
| `MATCHING` | `providers_reviewing` |
| `SHORTLIST_READY` | `shortlist` |
| `PROVIDER_CONFIRMATION_PENDING` | `provider_confirmation` |
| `MATCHED` (no job) | `job_tracking` |
| `MATCHED` + job status | delegates to job resolver |
| `EXPIRED` | `expired` |
| `CANCELLED` | `cancelled` |

Maps `JobStatus` → `ClientPwaScreen` when `MATCHED`:

| JobStatus | ClientPwaScreen |
|---|---|
| `SCHEDULED`, `EN_ROUTE` | `job_tracking` |
| `ARRIVED`, `STARTED`, `PAUSED`, `AWAITING_APPROVAL`, `PENDING_COMPLETION_CONFIRMATION`, `CALLBACK_REQUIRED` | `active_job` |
| `COMPLETED` | `completion_review` |
| `CANCELLED`, `FAILED` | `cancelled` |

The `/requests/access/[token]` page renders content blocks conditionally on `destination.screen` — all screens live in one Server Component, no client-side navigation.

---

## Photo upload

**Status: EXISTS — full implementation**

- Upload UI: `BookingFlow.tsx` (client component) — `<input type="file" accept="image/*" multiple>`, up to 5 photos
- `photos` state (`File[]`) is appended to `FormData` on submission
- Privacy consent: `photosSafeForPreview` boolean checkbox — customers confirm photos contain no sensitive info
- Draft state persists to `localStorage` but photos are NOT persisted (file objects cannot be serialised)
- Upload endpoint: `POST /api/customer/services/[serviceId]` (via `BookingFlow` fetch)
- Attachment model: `JobRequestAttachment` with `label: 'customer_photo'`, `safeForPreview: true/false`
- Thumbnails displayed: in `/requests/[id]` and `/requests/access/[token]` via `<img src="/api/attachments/[id]">` and `AttachmentThumbnail`
- Token-gated photo access on ticket page: `src="/api/attachments/[id]?token=<token>"`

**Gap:** No photo re-upload or add-more-photos after submission. No preview thumbnails before submission (just filename list).

---

## Address capture

**Status: EXISTS — full implementation with saved address book**

- Address form in `BookingFlow.tsx` (step: `address`) captures: street, suburb, city, province, postal code, complex/unit
- Suburb autocomplete: `SuburbPicker` component — calls `/api/locations/suburbs` and `/api/customer/location-reverse`
- GPS detection: `navigator.geolocation` → `/api/customer/location-reverse` → populates suburb/city/province
- `locationNodeId` linked to `LocationNode` table via suburb picker selection
- Saved address book (flag: `feature.customer.address_book`): customers can select a saved site instead of re-entering
- Address saved as `CustomerAddress` linked to `Customer`
- Management page: `/account/sites`

---

## Shortlist page

**Status: EXISTS — fully implemented on two surfaces**

**Surface 1: `/requests/[id]` (authenticated)**
- Shows shortlist cards when `status === 'SHORTLIST_READY' || status === 'PROVIDER_CONFIRMATION_PENDING'` and no match exists
- Each card: provider name, avatar, bio, call-out fee, estimated arrival, rate/negotiable, jobs completed, rating, skills, portfolio URLs
- Actions: "Select provider" (server action `selectShortlistProviderAction`), "Ask for more options", "Cancel request"
- Selected state shown inline: "Selected. We are asking this provider to confirm on WhatsApp."

**Surface 2: `/requests/access/[token]` (token-gated, no login)**
- Full shortlist with provider cards + expanded "View profile" link (opens same page with `?provider=<id>`)
- `profileItem` expansion: renders selected provider's full profile inline above the list
- Same actions via inline server actions on the token page
- Error feedback via `selection` query param: `provider-confirming`, `failed`, `invalid`, `more-options`, `more-options-failed`, `cancel-failed`, `cancelled`

---

## Provider profile (customer view)

**Status: EXISTS — two surfaces**

**Surface 1: `/providers/[id]` (flag-gated)**
- Flag: `feature.customer.provider_browse` — redirects to `/` when disabled
- Shows: bio, trust signals, skills, portfolio links, recent reviews from completed jobs
- "Book" CTA links to `/book/[primarySkillCategory]?provider=[id]`

**Surface 2: Inline on shortlist cards**
- Shown in both `/requests/[id]` and `/requests/access/[token]`
- `profileItem` expansion on token page shows full provider detail (bio, stats, skills, areas, portfolio, trust signals)
- No full-page provider profile reachable from token route — only inline expansion via `?provider=<id>` query param

**Gap:** Token-route customers cannot navigate to the standalone `/providers/[id]` page without signing in. Provider phone/email is never exposed in any customer-facing view (correct privacy posture).

---

## Job tracking

**Status: EXISTS — full timeline on two surfaces**

**Surface 1: `/bookings/[id]`**
- 7-step visual timeline: SCHEDULED → EN_ROUTE → ARRIVED → STARTED → AWAITING_APPROVAL → PENDING_COMPLETION_CONFIRMATION → COMPLETED
- Work evidence photos from provider (grid layout)
- "Confirm completion" button when `PENDING_COMPLETION_CONFIRMATION`
- "Rate your experience" prompt when `COMPLETED` and unrated
- Raise dispute form
- Invoice download link (PDF)
- Cancel booking form when `SCHEDULED | RESCHEDULED`

**Surface 2: `/requests/access/[token]`**
- 9-step timeline via `buildClientPwaJobTrackingSteps()` in `lib/client-pwa-job-tracking.ts`
- Steps: submitted → providers matched → customer selected → provider accepted → arrival confirmed → en route → arrived → in progress → completed
- Work evidence photos with token-gated `src`
- Rating prompt + "Book again" on completion
- No cancel or dispute from token page (those require authenticated session)

**Completion confirmation alternative path:** `/confirm-completion/[token]` — HMAC-signed, 72h TTL token, no login required. Used when provider marks job `PENDING_COMPLETION_CONFIRMATION` via WhatsApp.

---

## Privacy enforcement

**Current rules enforced client-side:**

1. **Provider contact details never exposed** — DB selects for provider in customer views exclude `phone` and `email` columns. Provider is identified by name only until job is assigned.
2. **Address hidden until match confirmed** — request detail on token page shows customer's own address; no cross-customer address leakage possible (token scope is one request).
3. **Photo privacy consent** — `photosSafeForPreview` checkbox in `BookingFlow`; value stored on `JobRequestAttachment.safeForPreview`. Attachments served at `/api/attachments/[id]?token=<token>` — token required for unauthenticated access.
4. **Ownership guard on authenticated pages** — `/requests/[id]` and `/bookings/[id]` both check `customer.id === jobRequest.customer.id` and redirect to `/bookings` on mismatch.
5. **Token page access level** — `destination.accessLevel !== 'public_token'` check causes invalid/expired render with no data exposure.
6. **Provider shortlist data scope** — shortlist cards expose: name, avatar, bio, experience, skills, portfolio URLs, stats. Phone/email absent from all DB selects in shortlist queries.
7. **"Provider-shared evidence" label** — portfolio URLs shown with explicit UI label distinguishing provider-supplied vs. Plug A Pro reviewed.

**Gaps:**
- No rate-limiting on token endpoint (brute-force token enumeration)
- `resolveJobRequestAccessToken` does not check if request is in a state that warrants public disclosure — expired requests still have their full payload returned before the `expired` guard
- No `noStore()` or explicit cache directives on token pages beyond `export const dynamic = 'force-dynamic'`

---

## Gaps against Qualified Shortlist Model

1. **No standalone shortlist page** — shortlist is embedded inside `/requests/[id]` and the token page. No dedicated `/requests/[id]/shortlist` route with clean URL for deep-linking from WhatsApp.
2. **No dedicated provider profile page reachable from token route** — inline expansion via query param is functional but not a clean URL. Deep-linking to a specific provider's profile from WhatsApp is not possible without signing in.
3. **No real-time updates** — all pages are SSR `force-dynamic`. There is no WebSocket, polling, or Server-Sent Events to notify the customer when shortlist appears or provider confirms. Customer must manually refresh or open a new WhatsApp link.
4. **No photo re-upload after submission** — once submitted, customers cannot add or replace photos on the request.
5. **No request creation form accessible from token route** — the token page is read-only. A new customer arriving via WhatsApp cannot create a new request without signing in and navigating to `/book/[category]`.
6. **No in-flight request modification** — customers cannot update description, title, or schedule window after submission.
7. **No urgency/scheduling visibility on shortlist cards** — the shortlist card shows `estimatedArrivalAt` from the provider's response, but there is no display of the customer's original requested window alongside it for comparison.
8. **`/requests/access/recovery` not implemented** — `client-pwa-destination.ts` and `client-pwa-handoff.ts` both route expired/invalid tokens to `/requests/access/recovery?reason=...`, but this route does not appear to exist in the file tree.
9. **No explicit sign-in bridge on token page for shortlist actions** — server actions on the token page (`selectShortlistProvider`, `cancelRequestAction`) re-verify the token internally but the UX does not prompt sign-in when a token expires mid-session.
10. **No push notification / service worker** — the PWA has no `manifest.json` or service worker; it cannot send background notifications when the shortlist becomes ready. All notifications flow through WhatsApp.
11. **`/providers` browse requires flag** — `feature.customer.provider_browse` must be enabled. Currently the flag infrastructure exists but may not be seeded in production.
12. **No waitlist recovery UX** — `BookingFlow` has a `waitlisted` step that sets `waitlistedCity` but the rendered output for this state is minimal (not read in full in this pass).

---

## Reuse recommendations

| Component / module | Recommendation |
|---|---|
| `BookingFlow.tsx` | Extend: add photo preview thumbnails before submit, add post-submit photo upload step |
| `resolveClientPwaDestination()` | Keep as canonical resolver for all new token and authenticated routes |
| `resolveClientPwaScreenForState()` + `allowedActionsForClientPwaScreen()` | Keep: already the single source of truth for screen/action derivation |
| `buildClientPwaJobTrackingSteps()` | Keep: extend with `AWAITING_APPROVAL` and `CALLBACK_REQUIRED` display steps if needed |
| `getCustomerShortlistForRequest()` | Keep: shared between authenticated and token surfaces |
| `StatusBadge` | Keep across all new screens |
| `ProviderTrustSignals` + `ProviderTrustNote` | Keep: privacy-safe trust display already correct |
| `QuoteHistoryTimeline` | Keep: already audience-aware (`audience="customer"`) |
| `/requests/access/[token]` single-page architecture | Keep for WhatsApp handoff; consider extracting discrete sub-components per screen to reduce file size (currently ~740 lines) |
| `/bookings/[id]` job tracking timeline | Candidate for extraction to a shared `JobTrackingTimeline` component reused on token page |

---

## Implementation risks

1. **`/requests/access/recovery` is referenced but missing** — any expired or invalid token triggers a redirect to a non-existent route, producing a 404. This must be built before any token links reach production at scale.
2. **Single-page token route complexity** — `app/requests/access/[token]/page.tsx` is ~740 lines with all screens inline. Adding new screens will increase maintenance burden. Plan for component extraction in step 3.
3. **No polling / real-time on shortlist** — customers must rely on WhatsApp notifications to know when to open the PWA. If WhatsApp delivery fails, they may never see the shortlist. Consider fallback polling or a "Refresh" button with visual feedback.
4. **Token TTL mismatch with blueprint** — current TTL is 90 days; blueprint spec says 72h. Aligning to 72h will break any existing active tokens and reduce the window for re-opening old WhatsApp links. Decision needed before implementation.
5. **Photo draft persistence gap** — `localStorage` draft saves text fields but not `File` objects. A returning customer who closes the browser mid-form loses their selected photos. No recovery path exists.
6. **`BookingFlow` is a single 900+ line client component** — step extraction would improve maintainability and allow independent testing of each step. Risk of regressions if refactored without full test coverage.
7. **No customer tests** — `field-service/__tests__` has zero test files matching "customer | Customer | request | ticket". All customer-facing flows are currently untested.
8. **Address book flag dependency** — the saved-sites UX path in `BookingFlow` is only active when `feature.customer.address_book` is enabled. If the flag is off, every request requires re-entering the full address, degrading repeat-customer UX.
