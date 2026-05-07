# CLIENT-11 — Client PWA Notifications, Copy, and URL Rules

## Status
PASS

## Localhost scan
Result: CLEAN

The only `localhost` references in `field-service/lib/` are inside the production guard itself in `lib/provider-credit-copy.ts` (lines 47–48 and 135–137) — these are the guard logic that detects and blocks localhost URLs, not raw URLs being sent to customers.

No customer-facing WhatsApp body contains a hardcoded localhost or 127.0.0.1 URL.

## Client message coverage

| Message type | Present | File / function | Uses URL helper | Copy correct |
|---|---|---|---|---|
| `request_started` | N/A | In-PWA screen only — no WA notification required | N/A | N/A |
| `continue_request` | N/A | In-PWA action only — no WA notification required | N/A | N/A |
| `add_photos_details` | N/A | In-PWA action only — no WA notification required | N/A | N/A |
| `request_submitted` | ✅ | `lib/client-pwa-submission-notifications.ts` → `notifyCustomerPwaRequestSubmitted` | ✅ `getJobRequestAccessUrl` → `getPublicAppUrl` | ✅ Fixed (privacy copy added) |
| `matching_in_progress` | ✅ | `lib/client-pwa-submission-notifications.ts` → `notifyCustomerMatchingInProgress` | N/A (no URL in body) | ✅ |
| `providers_reviewing` | ✅ | Covered by `notifyCustomerMatchingInProgress` — dispatched when request enters `MATCHING` status, which maps the `providers_reviewing` PWA screen | N/A | ✅ |
| `shortlist_ready` | ✅ | `lib/customer-shortlists.ts` → `notifyCustomerShortlistReady` | ✅ `getJobRequestAccessUrl` → `getPublicAppUrl` | ✅ |
| `provider_selected` | ✅ | `lib/customer-shortlists.ts` → `notifySelectedProvider` (notifies provider, not customer) | ✅ `getProviderLeadAccessUrlByLeadId` → `getPublicAppUrl` | ✅ |
| `provider_accepted` | ✅ | `lib/selected-provider-acceptance.ts` → `notifySelectedAcceptanceCommitted` (customer leg) | ✅ `getJobRequestAccessUrl` → `getPublicAppUrl` | ✅ |
| `arrival_confirmed` | ✅ | `lib/accepted-job-actions.ts` → `saveAcceptedLeadArrival` → `notifyCustomer` | N/A (plain text, no URL) | ✅ |
| `provider_on_the_way` | ✅ | `lib/accepted-job-actions.ts` → `markAcceptedLeadAction('on_the_way')` → `notifyCustomer` | N/A (plain text) | ✅ |
| `provider_arrived` | ✅ | `lib/accepted-job-actions.ts` → `markAcceptedLeadAction('arrived')` → `notifyCustomer` | N/A (plain text) | ✅ |
| `job_completed` | ✅ | `lib/whatsapp.ts` → `sendJobCompleted` / `lib/jobs.ts` status transition handler | ✅ `getPublicAppUrl` | ✅ |
| `review_requested` | ✅ **Added** | `lib/client-pwa-submission-notifications.ts` → `notifyCustomerReviewRequested` (new) | ✅ CTA URL via `sendCtaUrl`; body is URL-clean | ✅ |

## Privacy and trust copy

**Present in submission message (`request_submitted`):** YES (fixed in this step)
- Added `CLIENT_PWA_PRIVACY_COPY` constant and embedded it in `notifyCustomerPwaRequestSubmitted` body.
- Exact wording: "Your exact address and phone number are only shared after you select a provider and that provider accepts the job."

**Present in shortlist-ready message:** YES (pre-existing)
- Wording: "Your phone number and exact address will only be shared after you select a provider and they accept."
- Shortlist compare-providers phrase also present: "You can compare providers before choosing."

## Gaps closed

1. **Privacy copy in `request_submitted`** — `notifyCustomerPwaRequestSubmitted` was missing the required privacy copy. Added `CLIENT_PWA_PRIVACY_COPY` exported constant and embedded it in the message body.

2. **`review_requested` notification — new function** — No customer WhatsApp notification existed for the `review_requested` journey step (post-job completion, invite customer to leave feedback). Added `notifyCustomerReviewRequested` to `lib/client-pwa-submission-notifications.ts`. Follows the same non-throwing, idempotency-guarded pattern as `notifyCustomerMatchingInProgress`. URL travels via CTA only — no raw URL in the text body.

## Tests

**20 tests, 20 passing** in `field-service/__tests__/lib/client-pwa-notification-url-rules.test.ts`

Key scenarios:
- `CLIENT_PWA_PRIVACY_COPY` exported with correct wording
- `request_submitted` body contains privacy copy; no raw URL in body
- `request_submitted` CTA URL is sent via `sendCtaUrl` (not inline)
- `matching_in_progress` body contains expected copy; no raw URL
- `matching_in_progress` idempotency (`isAlreadySent`) respected
- `review_requested` function exported from correct module
- `review_requested` body contains completion and feedback copy; no raw URL
- `review_requested` CTA sent separately when `reviewUrl` provided
- `review_requested` no CTA when `reviewUrl` is null
- `review_requested` null phone guard, error non-throw, idempotency
- `getPublicAppUrl()` returns production plugapro.co.za URL correctly
- `getPublicAppUrl()` never returns localhost in any variant
- Shortlist-ready copy phrases validated

Full suite: 174 passed, 1 skipped, 0 failures (pre-existing skipped test unchanged).

## Files changed

- `field-service/lib/client-pwa-submission-notifications.ts` — added `CLIENT_PWA_PRIVACY_COPY` constant, embedded privacy copy in `notifyCustomerPwaRequestSubmitted`, added `notifyCustomerReviewRequested` function
- `field-service/__tests__/lib/client-pwa-notification-url-rules.test.ts` — new test file, 20 tests
