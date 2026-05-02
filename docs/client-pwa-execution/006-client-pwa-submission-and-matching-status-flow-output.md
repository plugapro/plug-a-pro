# Execution Output — 06-client-pwa-submission-and-matching-status-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/06-client-pwa-submission-and-matching-status-flow.md`

## Objective

Align request submission confirmation and matching-status screens in the Client PWA.

## Current-state findings

Request creation already validates required fields, prevents duplicate client submits with the existing loading guard, creates a `JobRequest`, and triggers matching once through `createJobRequest`. The PWA confirmation copy still implied a provider would accept directly, and PWA submissions did not send a WhatsApp confirmation through the existing notification sender.

## Implementation completed

- Added `notifyCustomerPwaRequestSubmitted` using the existing WhatsApp `sendText` notification path.
- Wired PWA request submission to send a best-effort WhatsApp confirmation after request creation and photo upload.
- Updated PWA submitted copy to say the customer will be notified when their shortlist is ready.
- Added token-ticket status screens for request submitted, matching progress, and providers reviewing.
- Kept matching trigger ownership in `createJobRequest` so matching still starts once.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-pwa-submission-notifications.ts` | New PWA request submitted WhatsApp confirmation helper |
| `field-service/app/api/customer/bookings/route.ts` | Sends best-effort WhatsApp confirmation after PWA request submission |
| `field-service/components/customer/BookingFlow.tsx` | Updated submitted copy to shortlist-ready expectation |
| `field-service/app/requests/access/[token]/page.tsx` | Added submitted, matching, and providers-reviewing status cards |
| `field-service/__tests__/lib/client-pwa-submission-notifications.test.ts` | Added WhatsApp confirmation helper tests |
| `field-service/__tests__/api/customer-bookings.test.ts` | Added PWA submission notification assertion |
| `docs/client-pwa-execution/006-client-pwa-submission-and-matching-status-flow-output.md` | Step 6 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

`POST /api/customer/bookings` now sends a best-effort WhatsApp request-submitted confirmation after successful request creation. Notification failure is caught and does not roll back the request.

## UI changes

The ticket page now renders backend-state-specific cards for submitted, matching, and providers-reviewing states. The submitted PWA screen now sets the expectation that a shortlist is next.

## WhatsApp changes

PWA submissions now send a WhatsApp confirmation using the existing WhatsApp sender with ticket link when available.

## Security and privacy impact

Notification copy does not expose private address or provider details. Ticket links remain secure token links.

## Credit impact

None. Submission, matching status, and notifications do not deduct provider credits.

## Tests added or updated

- Added `field-service/__tests__/lib/client-pwa-submission-notifications.test.ts`.
- Updated `field-service/__tests__/api/customer-bookings.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/api/customer-bookings.test.ts __tests__/lib/client-pwa-submission-notifications.test.ts __tests__/lib/create-job-request.test.ts __tests__/lib/client-pwa-destination.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 4 files and 24 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Request submits through the existing backend route.
- [x] Matching trigger remains centralized in `createJobRequest`.
- [x] Client sees request-submitted state.
- [x] Client sees matching-progress state.
- [x] Client sees providers-reviewing state.
- [x] WhatsApp confirmation is sent after PWA submission.
- [x] Notification failure does not fail the request.
- [x] Duplicate client clicks remain guarded by the existing loading state.

## Risks and follow-ups

Backend idempotency for repeated browser POSTs is still limited because there is no durable client submission idempotency key in the current schema. The UI prevents normal double-click duplication, and matching remains triggered once per created request.

## OpenBrain note

Client PWA submission now confirms through WhatsApp and shows current matching status from backend state, keeping matching ownership in the existing request creation service and avoiding a parallel matching trigger.
