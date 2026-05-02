# Execution Output — 04-client-pwa-request-creation-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/04-client-pwa-request-creation-flow.md`

## Objective

Align the Client PWA request creation flow with the WhatsApp-first, PWA-assisted journey while reusing the existing `/book/[serviceId]` request path and backend creation API.

## Current-state findings

The existing PWA flow already creates authenticated customer job requests through `/api/customer/bookings`, but it only captured address, title, description, photos, and broad urgency. It did not capture subcategory, job type, provider preference, budget preference, max call-out fee, privacy acknowledgement, terms acknowledgement, or WhatsApp prefill fields.

## Implementation completed

- Added shared request-flow helpers and option lists in `field-service/lib/client-request-flow.ts`.
- Added structured capture for subcategory, job type, preferred date, preferred time window, provider preference, budget preference, and optional max call-out fee.
- Added privacy and terms acknowledgement gates before submit.
- Added the required privacy copy before submission.
- Added local save-and-continue draft persistence for PWA request details.
- Added WhatsApp-created draft continuation support through `/book/[serviceId]` query prefill fields.
- Updated `/api/customer/bookings` multipart parsing for `requestedWindowStart` and `maxCallOutFee`.
- Preserved the existing request creation route and backend `createJobRequest` service.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-request-flow.ts` | New Client PWA request option, validation, and timing helpers |
| `field-service/components/customer/BookingFlow.tsx` | Added structured request fields, draft persistence, acknowledgements, and submit payload mapping |
| `field-service/app/(customer)/book/[serviceId]/page.tsx` | Added WhatsApp/PWA query prefill handoff into `BookingFlow` |
| `field-service/app/api/customer/bookings/route.ts` | Added multipart parsing for max call-out fee and requested window start |
| `field-service/__tests__/lib/client-request-flow.test.ts` | Added validation and timing helper tests |
| `docs/client-pwa-execution/004-client-pwa-request-creation-flow-output.md` | Step 4 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None. Existing `JobRequest` fields were reused for subcategory, timing, provider preference, budget preference, and max call-out fee. Job type is included in the request description because no dedicated `jobType` schema field exists.

## API / server action changes

`POST /api/customer/bookings` now accepts multipart `requestedWindowStart` and `maxCallOutFee` values in addition to the existing request creation fields.

## UI changes

The existing mobile-first booking flow now captures specific type of work, job type, preferred date and time window, provider preference, budget preference, optional max call-out fee, privacy acknowledgement, and request-detail acknowledgement.

## WhatsApp changes

No WhatsApp bot copy changed in this step. The PWA request route can now accept query-prefilled draft fields from a WhatsApp handoff link.

## Security and privacy impact

The submit screen explicitly tells customers that phone number and exact address are shared only after provider selection and selected-provider acceptance. No provider-facing privacy boundary changed in this step.

## Credit impact

None. Creating or completing a client request does not deduct provider credits.

## Tests added or updated

- Added `field-service/__tests__/lib/client-request-flow.test.ts`.
- Reran existing `field-service/__tests__/lib/create-job-request.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/client-request-flow.test.ts __tests__/lib/create-job-request.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 2 files and 19 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Client can start a request in the existing PWA route.
- [x] WhatsApp-created draft fields can prefill the PWA route through query params.
- [x] Category remains captured by `/book/[serviceId]`.
- [x] Subcategory is captured.
- [x] Description is captured.
- [x] Urgency and preferred timing are captured.
- [x] Provider preference is captured.
- [x] Budget preference is captured.
- [x] Review screen shows the structured summary.
- [x] Privacy acknowledgement is shown and required.
- [x] Existing backend request creation service is reused.

## Risks and follow-ups

Save-and-continue drafts are currently local PWA drafts because there is no persisted draft request state in the existing schema. A server-side WhatsApp draft would require either a dedicated draft model or a non-destructive `JobRequestStatus` extension in a later step.

## OpenBrain note

Client PWA request creation now captures the qualified-shortlist inputs needed for provider matching while keeping WhatsApp as the starting channel and the existing PWA booking route as the structured handoff surface.
