# Execution Output — 05-client-pwa-photo-address-and-privacy-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/05-client-pwa-photo-address-and-privacy-flow.md`

## Objective

Align Client PWA photo upload, structured address capture, and provider privacy separation.

## Current-state findings

The app already had structured address capture, geolocation-assisted suburb selection, photo upload through the existing storage helper, tokenized attachment rendering, and provider safe-preview queries. The main gaps were that PWA-uploaded photos used the older `evidence` label while some ticket resolvers only selected `customer_photo`, safe-preview was implicit rather than explicit on upload, and the address privacy copy was not shown at the address step.

## Implementation completed

- Made customer request photo uploads explicitly set `safeForPreview: true`.
- Changed PWA customer photo upload labels to `customer_photo`.
- Kept backward compatibility by rendering both `customer_photo` and legacy `evidence` request attachments in ticket resolvers.
- Added removable selected-photo rows before submit.
- Added a “continue without photos” path that still validates required request fields.
- Added address privacy copy to the address capture step.
- Proper-cased provider opportunity preview area fields while still excluding exact address fields.
- Preserved existing file size and MIME validation in the storage/API path.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/storage.ts` | Added explicit `safeForPreview` support for request photo uploads |
| `field-service/app/api/customer/bookings/route.ts` | Uploads PWA request photos as `customer_photo` with safe preview enabled |
| `field-service/lib/job-request-access.ts` | Token ticket resolver includes `customer_photo` and legacy `evidence` request attachments |
| `field-service/lib/client-pwa-destination.ts` | Client PWA destination resolver includes both current and legacy request photo labels |
| `field-service/components/customer/BookingFlow.tsx` | Added address privacy copy and removable selected-photo review |
| `field-service/lib/provider-opportunity-responses.ts` | Proper-cased safe-preview area fields without adding exact address fields |
| `field-service/__tests__/api/customer-bookings.test.ts` | Updated customer photo upload expectations |
| `docs/client-pwa-execution/005-client-pwa-photo-address-and-privacy-flow-output.md` | Step 5 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

`POST /api/customer/bookings` now passes `label: customer_photo` and `safeForPreview: true` to the existing upload helper for request photos.

## UI changes

The request form now shows address privacy copy at address capture and lets customers remove selected photos before submitting. Customers can continue without photos after the required request details validate.

## WhatsApp changes

No WhatsApp copy changed in this step. Ticket rendering now supports both new PWA-uploaded customer photo labels and legacy request evidence labels, which supports WhatsApp/PWA mixed capture histories.

## Security and privacy impact

Provider previews still exclude phone, exact street address, unit/complex details, postal code, access notes, private notes, latitude, and longitude. Safe-preview attachment filtering remains server-side. Exact address and phone sharing remains gated until selected-provider acceptance.

## Credit impact

None. Photo upload, address capture, and client review do not deduct provider credits.

## Tests added or updated

- Updated `field-service/__tests__/api/customer-bookings.test.ts`.
- Reran provider safe-preview tests and token/destination resolver tests.

## Commands run

```bash
npm test -- --run __tests__/api/customer-bookings.test.ts __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/lib/job-request-access.test.ts __tests__/lib/client-pwa-destination.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 5 files and 23 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Client can upload photos through the existing request form.
- [x] Client can remove selected photos before submit.
- [x] Client can continue without photos where allowed.
- [x] Photos render in token ticket resolvers for current and legacy labels.
- [x] Structured address capture remains in place.
- [x] Privacy copy is shown at address capture.
- [x] Provider safe preview cannot access exact address fields.
- [x] Safe preview flags are set for PWA customer photo uploads.
- [x] File size and MIME validation remain enforced.

## Risks and follow-ups

Direct post-submission photo upload and retry-after-submit are not separate routes yet; current retry is handled by resubmitting after the upload error. A later route/state step can add post-submit attachment management if the product wants editable photo uploads after request submission.

## OpenBrain note

Client PWA photo and address handling now uses explicit safe-preview semantics and shows privacy copy at the point of address capture, while preserving server-side provider preview redaction and existing storage flows.
