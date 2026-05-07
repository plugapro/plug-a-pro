# CLIENT-08 — Client PWA Provider Confirmation and Job Tracking Flow

## Status
PASS

## State coverage

| State | Copy present | Actions present |
|-------|-------------|-----------------|
| PROVIDER_CONFIRMATION_PENDING | Yes — "Waiting for provider confirmation / You selected {name}. We notified them on WhatsApp and are asking them to confirm the job now." | Contact support present. "Choose another provider" not surfaced (no timeout/decline path shown in these pages; handled upstream in shortlist). |
| ASSIGNED (MATCHED) — token page | Yes — "Your provider accepted the job / Provider: {name} / Expected: {arrival} / Call-out: {fee}" | Track job, View provider, Contact support — all present. |
| ASSIGNED (MATCHED) — /requests/[id] | Redirects to /bookings/{id} before rendering; ASSIGNED state is rendered on the booking page. | N/A — redirect is correct. |
| SCHEDULED | Yes — timeline step "Provider accepted" is current | Timeline present on both pages. |
| ARRIVAL_TIME_CONFIRMED | Yes — timeline step "Arrival time confirmed" becomes current when job.arrivalTimeConfirmedAt is set | Driven by `buildClientPwaJobTrackingSteps`. |
| ON_THE_WAY (EN_ROUTE) | Yes — timeline step "Provider on the way" | Present in both tracking pages. |
| ARRIVED | Yes — timeline step "Provider arrived" | Present. |
| IN_PROGRESS (STARTED) | Yes — timeline step "Job in progress" | Present. AWAITING_APPROVAL also maps to this step. |
| COMPLETED | Yes — "Job completed / Please confirm everything is in order." card | Rate provider, Book again, View invoice/receipt — all present on token page and booking detail page. |

## Job tracking timeline

The timeline is driven by `buildClientPwaJobTrackingSteps` in `lib/client-pwa-job-tracking.ts`.

| # | Step key | Label | Present |
|---|----------|-------|---------|
| 1 | REQUEST_SUBMITTED | Request submitted | Present |
| 2 | PROVIDERS_MATCHED | Providers matched | Present |
| 3 | CUSTOMER_SELECTED | You selected provider | Present |
| 4 | PROVIDER_ACCEPTED | Provider accepted | Present |
| 5 | ARRIVAL_CONFIRMED | Arrival time confirmed | Present |
| 6 | EN_ROUTE | Provider on the way | Present |
| 7 | ARRIVED | Provider arrived | Present |
| 8 | STARTED | Job in progress | Present |
| 9 | COMPLETED | Job completed | Present |

Prior to this step the booking detail page (`/bookings/[id]`) used a hard-coded 7-step inline list that did not match the blueprint. This was replaced with `buildClientPwaJobTrackingSteps`.

## WhatsApp handoff links for job events

| Event | Links to token route (/requests/access/{token}) | Note |
|-------|------------------------------------------------|------|
| Provider accepted (MATCHED) | Yes — `selected-provider-acceptance.ts:422` calls `getJobRequestAccessUrl(requestId, 'job_tracking')` | CTA button sent to customer |
| Arrival confirmed | No direct CTA URL — text-only notification sent from `provider-whatsapp-job-commands.ts:notifyCustomerArrival` | Plain text; no CTA button. Acceptable for arrival. |
| ON_THE_WAY (EN_ROUTE) | Yes — `jobs.ts` side effect sends text; also sends `sendProviderOnTheWay` WhatsApp template which includes `bookingUrl` | Links to /bookings/{id} as fallback; ticket URL preferred via `ticketUrl ?? bookingUrl` |
| STARTED | Yes — `jobs.ts:170-187` sends CTA with `ticketUrl ?? bookingUrl` | Correct |
| PENDING_COMPLETION_CONFIRMATION | Yes — `jobs.ts:195-210` sends sign-off CTA using `completionUrl ?? ticketUrl ?? bookingUrl` | Correct |
| COMPLETED | Yes — `jobs.ts:214-221` calls `sendJobCompleted` with `invoiceUrl: ticketUrl ?? bookingUrl ?? ''` | Correct |

All events ultimately resolve to either the token route (`/requests/access/{token}`) or the booking page (`/bookings/{id}`). Token route is preferred.

## Completion actions

Rendered on both the token page (`/requests/access/[token]/page.tsx`) and the booking detail page (`/bookings/[id]/page.tsx`) when `job.status === 'COMPLETED'`.

| Action | Token page | Booking detail page |
|--------|-----------|---------------------|
| "Job completed" heading | Present | Present (added in this step) |
| "Please confirm everything is in order." | Present | Present (added in this step) |
| Rate provider | Present (`/bookings/{id}/rate`) | Present — shows rating if already rated |
| Report issue | Present (via "Report issue or view receipt" → `/bookings/{id}`) | Present (existing raise-dispute form) |
| Book again | Present (`/book/{category}`) | Present (added in this step) |
| View invoice/receipt | Present (via ghost button "Report issue or view receipt") | Present — "View invoice / receipt" button downloads PDF |

## Gaps closed

1. **`/bookings/[id]/page.tsx` — 7-step inline timeline replaced with 9-step blueprint timeline**
   - Removed hard-coded `JOB_TIMELINE` constant (7 steps, wrong labels).
   - Added `import { buildClientPwaJobTrackingSteps }` from `@/lib/client-pwa-job-tracking`.
   - `buildClientPwaJobTrackingSteps({ status, arrivalTimeConfirmedAt })` now drives the booking page timeline — identical to the token page.
   - Timeline wrapped in a `Card` component for visual consistency with the token page.

2. **`/bookings/[id]/page.tsx` — Blueprint completion card added**
   - Replaced the bare "Rate your experience →" link and separate invoice download link.
   - New card shows: "Job completed / Please confirm everything is in order." with Rate provider, Book again, View invoice / receipt actions.
   - Conditional "Rated {score}/5 — thank you!" shown when rating exists, matching the token page pattern.

## Tests

**32 tests, 0 failures** — new file `__tests__/app/customer/job-tracking-flow.test.ts`

Key scenarios:
- PROVIDER_CONFIRMATION_PENDING resolves to `provider_confirmation` screen with correct reason
- MATCHED + all 6 job statuses resolve to correct screens (job_tracking / active_job / completion_review)
- `buildClientPwaJobTrackingSteps` returns exactly 9 steps with blueprint labels in order
- Each step has required keys (`key`, `label`, `description`, `done`, `current`)
- Exactly 1 step is current at any job status
- Progression: SCHEDULED (no arrival) → "Provider accepted"; SCHEDULED (with arrival) → "Arrival time confirmed"; EN_ROUTE → "Provider on the way"; ARRIVED → "Provider arrived"; STARTED → "Job in progress"; PENDING_COMPLETION_CONFIRMATION → "Job completed"; AWAITING_APPROVAL → "Job in progress"
- Step 9 description is "Please confirm everything is in order."
- WhatsApp handoff: `buildClientPwaTokenPath` builds correct token URL with `view=job_tracking`
- All post-acceptance job status screens map to `job_tracking`/`active_job`/`completion_review` (which all resolve to the `job_tracking` handoff view)

Full suite: **171 passed | 1 skipped (pre-existing) | 0 failed** (1965 tests + 4 todo)

## Files changed

- `field-service/app/(customer)/bookings/[id]/page.tsx` — replaced 7-step inline timeline with `buildClientPwaJobTrackingSteps`, added blueprint completion card
- `field-service/__tests__/app/customer/job-tracking-flow.test.ts` — new, 32 tests
- `field-service/docs/client-pwa-execution/008-client-pwa-job-tracking-output.md` — this document
