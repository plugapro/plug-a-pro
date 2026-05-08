# Quick Match / Fast Match Implementation Output

## Status

Completed with warnings.

## Implemented

- Added post-submit matching mode selection for customer PWA requests.
- Deferred provider outreach until customer picks a matching mode.
- Added Quick Match and Review Providers First mode selection endpoint:
  - `POST /api/customer/requests/[id]/matching-mode`
- Quick Match now starts one-provider-at-a-time outreach only after selection.
- Provider response TTL now uses:
  - `FAST_MATCH_PROVIDER_RESPONSE_MINUTES` (default `10`)
- Provider preview copy updated to state the response window in minutes.
- Quick Match progress updates now notify the customer when:
  - provider declines
  - provider times out
  - customer asks to try another provider
- “Try another provider” now releases active hold(s) and rotates forward immediately.
- PWA and WhatsApp status copy updated to avoid passive “still searching” wording.

## Warnings / Known constraints

- `matchingMode` was implemented without a new DB enum/migration by reusing existing request state transitions and `assignmentMode`.
- `PENDING_VALIDATION` is now used as the post-submit “awaiting matching mode” state for PWA requests.
- Existing shortlist model remains intact; Quick Match is layered on top by:
  - deferred dispatch
  - thresholded shortlist trigger (`1` for quick mode via `AUTO_ASSIGN`)

## Files touched (high level)

- Request creation / submit:
  - `lib/job-requests/create-job-request.ts`
  - `app/api/customer/bookings/route.ts`
  - `components/customer/BookingFlow.tsx`
- Matching mode:
  - `lib/request-matching-mode.ts` (new)
  - `app/api/customer/requests/[id]/matching-mode/route.ts` (new)
  - `app/(customer)/requests/[id]/actions.ts`
  - `app/(customer)/requests/[id]/page.tsx`
- Matching TTL and provider dispatch copy:
  - `lib/matching/config.ts`
  - `lib/matching/dispatch.ts`
  - `lib/provider-credit-copy.ts`
- Rotation and progress:
  - `lib/provider-opportunity-responses.ts`
  - `lib/matching/service.ts`
  - `lib/customer-shortlists.ts`
  - `lib/whatsapp-flows/status.ts`
  - `lib/client-pwa-submission-notifications.ts`
  - `lib/client-pwa-state.ts`
  - `components/shared/StatusBadge.tsx`
- Tests:
  - `__tests__/lib/create-job-request.test.ts`
  - `__tests__/api/customer-bookings.test.ts`
  - `__tests__/api/customer-request-matching-mode.test.ts` (new)
  - `__tests__/lib/client-pwa-submission-notifications.test.ts`
  - `__tests__/lib/client-pwa-notification-url-rules.test.ts`
  - `__tests__/app/customer/submission-matching-status.test.ts`
  - `__tests__/lib/client-pwa-handoff-model.test.ts`

## OpenBrain note

Quick Match now contacts one suitable provider at a time after the customer explicitly selects matching mode.  
Provider response window defaults to 10 minutes via `FAST_MATCH_PROVIDER_RESPONSE_MINUTES`.  
If a provider declines or times out, the system rotates forward and notifies the customer of progress.  
Credits are consumed only when the customer-selected provider accepts the final job.
