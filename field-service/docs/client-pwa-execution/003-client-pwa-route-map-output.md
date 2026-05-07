# CLIENT-03 — Client PWA Route Map and State Resolver

## Status

PASS

No gaps found. The state-to-screen mapping covers all 14 blueprint entries. The resolver return type includes all required fields. No code changes were required.

---

## Actual route map

| Intent | Actual route | Page file | Auth required |
|---|---|---|---|
| No active request / home | `/bookings` | `app/(customer)/bookings/page.tsx` | yes |
| Create new request | `/new` (BookingFlow — referred to in blueprint) | `app/(customer)/book/[serviceId]/page.tsx` | yes |
| Request detail / status | `/requests/[id]?view=<screen>` | `app/(customer)/requests/[id]/page.tsx` | yes |
| Token-based handoff (WhatsApp links) | `/requests/access/[token]?view=<screen>` | `app/requests/access/[token]/page.tsx` | no |
| Token recovery (expired / invalid) | `/requests/access/recovery?reason=<reason>` | `app/requests/access/recovery/page.tsx` | no |
| Job tracking | `/bookings/[id]` | `app/(customer)/bookings/[id]/page.tsx` | yes |
| Active job | `/bookings/[id]` (same page, view controlled by job status) | `app/(customer)/bookings/[id]/page.tsx` | yes |
| Completion / review | `/bookings/[id]/rate` | `app/(customer)/bookings/[id]/rate/page.tsx` | yes |
| Provider profile | `/providers/[id]` | `app/(customer)/providers/[id]/page.tsx` | yes (flag-gated) |

**Notes on blueprint vs. actual naming:**

- Blueprint suggests `/client/requests/:requestId` style paths. Actual paths use `/requests/[id]` without the `/client/` prefix. These are equivalent — the `(customer)` route group is the namespace; the segment names differ only in convention.
- Blueprint refers to `/new` for the BookingFlow entry point. The actual file is `app/(customer)/book/[serviceId]/page.tsx`, which accepts a `serviceId` param. The resolver's `client_home` screen produces `/bookings`, not `/new` — the creation entry point is a separate flow outside the resolver scope.
- The `requests/access/*` routes live outside the `(customer)` layout group (`app/requests/access/`) so they render without authentication. This is intentional for WhatsApp handoff targets.

---

## State-to-screen mapping coverage

Blueprint uses conceptual state names. The resolver maps actual `JobRequestStatus` and `JobStatus` enum values.

| Blueprint state | Blueprint screen | Mapped? | Actual status(es) | Screen produced | Route pattern |
|---|---|---|---|---|---|
| no active request | client home | yes | `null` / no requestId | `client_home` | `/bookings` |
| draft | request form current step | yes | `request_form` is a screen; no matching request status — driven by `resolveClientPwaScreenForState` when no status present, or caller sets screen directly | `request_form` | `/requests/[id]?view=request_form` |
| submitted | request submitted | yes | `PENDING_VALIDATION` | `request_submitted` | `/requests/access/[token]?view=request_submitted` or `/requests/[id]?view=request_submitted` |
| matching | matching progress | yes | `OPEN` | `matching_progress` | `/requests/access/[token]?view=matching_progress` |
| awaiting_provider_responses | providers reviewing | yes | `MATCHING` | `providers_reviewing` | `/requests/access/[token]?view=providers_reviewing` |
| shortlist_ready | shortlist | yes | `SHORTLIST_READY` | `shortlist` | `/requests/access/[token]?view=shortlist` |
| customer_selection_pending | shortlist | yes | `SHORTLIST_READY` (no separate enum value; the schema has no `CUSTOMER_SELECTION_PENDING` status — both blueprint sub-states map to `SHORTLIST_READY` → `shortlist` screen) | `shortlist` | `/requests/access/[token]?view=shortlist` |
| provider_confirmation_pending | waiting for provider confirmation | yes | `PROVIDER_CONFIRMATION_PENDING` | `provider_confirmation` | `/requests/access/[token]?view=provider_confirmation` |
| assigned | job confirmed / tracking | yes | `MATCHED` (no job yet, or job=`SCHEDULED`/`EN_ROUTE`) | `job_tracking` | `/bookings/[id]` |
| scheduled | job tracking | yes | `MATCHED` + job `SCHEDULED` or `EN_ROUTE` | `job_tracking` | `/bookings/[id]` |
| in_progress | active job | yes | `MATCHED` + job `ARRIVED`, `STARTED`, `PAUSED`, `AWAITING_APPROVAL`, `PENDING_COMPLETION_CONFIRMATION`, `CALLBACK_REQUIRED` | `active_job` | `/bookings/[id]` |
| completed | completion / review | yes | `MATCHED` + job `COMPLETED` | `completion_review` | `/bookings/[id]/rate` |
| cancelled | cancelled | yes | `CANCELLED` (request) or `MATCHED` + job `CANCELLED`/`FAILED` | `cancelled` | `/requests/access/[token]?view=cancelled` |
| expired | expired | yes | `EXPIRED` (request) or token `expired` status | `expired` | `/requests/access/recovery?reason=expired` |

**Note on `customer_selection_pending`:** The blueprint lists this as a distinct state but the Prisma `JobRequestStatus` enum has no such value. `SHORTLIST_READY` covers the entire period from shortlist publication through customer selection. Both blueprint sub-states resolve to screen `shortlist`. This is correct by design.

---

## Resolver return shape

All fields required by the blueprint are present in `ClientPwaDestination`:

| Field | Type | Present? |
|---|---|---|
| `screen` | `ClientPwaScreen` | present |
| `route` | `string` | present |
| `request` | `ClientPwaDestinationRequest \| null` | present |
| `job` | `ClientPwaDestinationJob \| null` | present |
| `allowedActions` | `ClientPwaAllowedAction[]` | present |
| `accessLevel` | `ClientPwaAccessLevel` | present |
| `reason` | `string` | present |

`ClientPwaAccessLevel` covers `'public_token' | 'trusted_reference' | 'invalid' | 'expired'`.

---

## Gaps closed

None. The resolver and state file were already complete and correct. No code changes were made in this step.

---

## Tests

**1872 passing, 0 failing** (168 test files, 4 todo).

Client-pwa specific test files and passing counts:

| File | Tests |
|---|---|
| `__tests__/lib/client-pwa-handoff-model.test.ts` | 52 |
| `__tests__/lib/client-pwa-destination.test.ts` | 4 |
| `__tests__/lib/client-pwa-handoff.test.ts` | 6 |
| `__tests__/lib/client-pwa-state.test.ts` | 3 |
| `__tests__/lib/client-pwa-job-tracking.test.ts` | 4 |
| `__tests__/lib/client-pwa-submission-notifications.test.ts` | (additional) |
| `__tests__/lib/client-request-data.test.ts` | (additional) |
| `__tests__/lib/client-request-flow.test.ts` | (additional) |

The 52 handoff tests from step 2 all pass. TypeScript (`tsc --noEmit`) reports 0 errors in any `client-pwa-*` file. The only pre-existing TSC errors are in `__tests__/lib/provider-whatsapp-interest-flow.test.ts` (tuple destructuring overload mismatch, present before this step).

---

## Files changed

None. This step was read-only verification.

**Files read:**
- `field-service/lib/client-pwa-destination.ts`
- `field-service/lib/client-pwa-state.ts`
- `field-service/__tests__/lib/client-pwa-handoff-model.test.ts`
- `field-service/__tests__/lib/client-pwa-destination.test.ts`
- `field-service/__tests__/lib/client-pwa-handoff.test.ts`
- `field-service/__tests__/lib/client-pwa-state.test.ts`
- `field-service/prisma/schema.prisma` (enum verification)
