# CLIENT-06 — Client PWA Submission and Matching Status Flow

## Status
PASS

## Submission flow

| Check | Result |
|-------|--------|
| Duplicate prevention | YES — `DuplicateActiveRequestError` thrown inside the Prisma transaction in `createJobRequest` for any matching PENDING_VALIDATION / OPEN / MATCHING request from the same phone + category. API route now returns HTTP 409 with `existingRequestId` and `existingStatus`. |
| WhatsApp confirmation on submit | YES — `notifyCustomerPwaRequestSubmitted()` fires in `POST /api/customer/bookings` after successful creation; sends text + CTA link. |
| Matching triggered | YES — `orchestrateMatch()` called via `after()` in `createJobRequest`; falls back to inline await when `after()` is unavailable. |

## Status screen coverage

### Token page (`/requests/access/[token]/page.tsx`)

All three blueprint screens were already present and correct before this step.

| Status | Screen | Copy present | Correct text |
|--------|--------|--------------|--------------|
| PENDING_VALIDATION | `request_submitted` | YES | "Request submitted / We've received your {category} request in {suburb}, {city}. / We're checking suitable providers..." |
| OPEN | `matching_progress` | YES | "We're checking suitable providers" + 6-item criteria grid (service type, area, availability, experience, rate, verification level) |
| MATCHING | `providers_reviewing` | YES | "Providers are reviewing your request. We'll notify you when your shortlist is ready." |
| SHORTLIST_READY | `shortlist` | YES (pre-existing) | Shortlist card with provider selection |

### Auth-gated page (`/(customer)/requests/[id]/page.tsx`)

Gap found and fixed in this step. Previously all three statuses collapsed into a single `getMatchEtaCopy()` string with no blueprint copy.

| Status | Screen | Copy before fix | Copy after fix |
|--------|--------|-----------------|----------------|
| PENDING_VALIDATION | `request_submitted` | Generic ETA string only | "Request submitted" heading + "We've received your {category} request in {suburb}, {city}. We're checking suitable providers." + ETA |
| OPEN | `matching_progress` | Generic ETA string only | "We match based on:" heading + 6-item criteria grid + ETA |
| MATCHING | `providers_reviewing` | Generic ETA string only | "Providers are reviewing your request. We'll notify you when your shortlist is ready." + ETA |

## WhatsApp handoff

| Check | Result |
|-------|--------|
| Token page shows correct status screens | YES — `destination.screen` drives conditional rendering; `request_submitted`, `matching_progress`, and `providers_reviewing` blocks all present and render correctly |
| Matching-in-progress notification wired | YES — `notifyCustomerMatchingInProgress()` called in `orchestrateMatch()` at step 5a; guarded by `matchFoundWhatsappSentAt` idempotency field |
| Notification non-fatal | YES — failure caught and logged; orchestrator result unaffected |

## Gaps closed

1. **Auth-gated request detail page** (`/(customer)/requests/[id]/page.tsx`): Added per-status blueprint copy blocks for `PENDING_VALIDATION`, `OPEN`, and `MATCHING` states. Added `normaliseLocationDisplayName` import to render suburb/city consistently with the token page.
2. **API route duplicate submission handling** (`/api/customer/bookings/route.ts`): Added `DuplicateActiveRequestError` import and a dedicated `if (err instanceof DuplicateActiveRequestError)` catch that returns HTTP 409 with `existingRequestId` and `existingStatus` in the response body. Previously the error fell through to the generic 500 handler.

## Tests

18 tests, all passing.

| Suite | Scenarios |
|-------|-----------|
| Status screen resolution | PENDING_VALIDATION → request_submitted; OPEN → matching_progress; MATCHING → providers_reviewing; SHORTLIST_READY → shortlist; allowed actions per screen |
| Submission WhatsApp notification | Sends with category + area; no-phone guard; null suburb/city omits area clause |
| Matching-in-progress notification | Sends when not already sent; idempotency guard (isAlreadySent); non-throwing on failure |
| DuplicateActiveRequestError | Name/message/fields correct; instanceof check |

## Files changed

- `field-service/app/(customer)/requests/[id]/page.tsx` — Added `normaliseLocationDisplayName` import; added per-status copy blocks for PENDING_VALIDATION, OPEN, MATCHING ahead of the generic ETA banner
- `field-service/app/api/customer/bookings/route.ts` — Added `DuplicateActiveRequestError` import; added 409 catch branch
- `field-service/__tests__/app/customer/submission-matching-status.test.ts` — New test file (18 tests)
- `field-service/docs/client-pwa-execution/006-client-pwa-submission-matching-output.md` — This document
