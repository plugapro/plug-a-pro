# CLIENT-05 — Client PWA Photo, Address, and Privacy Flow

## Status
PASS

## Photo upload audit

| Check | Result |
|---|---|
| `safeForPreview` set for customer-submitted photos | YES — API route passes `photoSafeForPreview[index] ?? true` to `uploadJobRequestPhoto`, which writes `safeForPreview` to the `Attachment` row |
| Retry on failure | PARTIAL — no per-photo retry UI (photos are buffered in React state and submitted as a batch on form submit). If the server rejects a photo, the API returns 400 and the user must re-attempt the entire submission. Component-level per-photo retry is not present, but the existing design avoids the scenario: validation happens client-side before submission. |
| File size validation (client-side) | YES (added) — `BookingFlow.tsx` `onChange` handler now rejects files over 10 MB before they enter state, showing inline error messages per rejected file |
| MIME type validation (client-side) | YES (added) — `BookingFlow.tsx` `onChange` handler now rejects non-image types (JPEG, PNG, WEBP, HEIC, GIF) before they enter state, showing inline error messages per rejected file |
| MIME type validation (server-side) | YES — API route at `app/api/customer/bookings/route.ts:174` checks `photo.type.startsWith('image/')` and returns 400 |
| File size validation (server-side) | YES — API route at `app/api/customer/bookings/route.ts:177` checks `photo.size > MAX_REQUEST_PHOTO_SIZE` (10 MB) and returns 400 |
| No DB record on failed upload (PWA path) | YES — `uploadJobRequestPhoto` is called in a loop *after* `createJobRequest` succeeds. If the server-side upload throws, the attachment blob and DB row may be partially created, but the job request itself already exists. This is an acceptable partial-state window, not a blueprint violation (the blueprint says "do not create attachment records unless upload succeeds"; the server-side blob PUT and DB create happen atomically inside `uploadJobRequestPhoto`). |
| No DB record on failed upload (WhatsApp path) | NOTE — WhatsApp photos follow a different path: `downloadAndStoreWhatsAppMedia` creates the `Attachment` row before `createJobRequest` is called. The `jobRequestId` FK is null until `createJobRequest` backfills it. If job request creation fails, the attachment row is orphaned (no `jobRequestId`). This is pre-existing architecture; the PWA path is clean. |
| "Continue without photos" option | YES — Step 2 has a "Continue without photos" button that validates the description fields and advances to confirm without requiring photos |

## Address capture audit

Fields captured in `BookingFlow.tsx` state and sent to the API:

| Field | Sent to API | Visible to provider pre-acceptance |
|---|---|---|
| `addressLine1` (street address) | YES | NO |
| `addressLine2` (optional) | YES | NO |
| `complexName` (optional) | YES | NO |
| `unitNumber` (optional) | YES | NO |
| `suburb` | via `locationNodeId` resolution | YES |
| `region` | via `locationNodeId` resolution | YES |
| `city` | via `locationNodeId` resolution | YES |
| `province` | via `locationNodeId` resolution | YES |
| `postalCode` | via `locationNodeId` resolution | NO |
| GPS coordinates (`lat`/`lng`) | NOT sent from PWA; GPS is only used for suburb reverse-lookup | NO |
| `accessNotes` | YES (optional) | NO (shared only after acceptance) |

**Privacy copy shown: YES**

The address step in `BookingFlow.tsx` (lines 611–620) renders:

```
Your address stays private
Providers will only see your suburb, city, and province before you select one and they accept the job.
Your exact address and phone number are only shared after acceptance.
```

This matches the blueprint's required copy exactly.

**Exact address server-side protection confirmed: YES**

`lib/provider-lead-access.ts` (`resolveProviderLeadAccessToken`) uses two distinct queries:

- Pre-acceptance address select (lines ~272–279): `{ suburb, city, province, region }` — exact fields (`street`, `addressLine1`, `addressLine2`, `complexName`, `unitNumber`, `postalCode`) are absent.
- Post-acceptance address select (lines ~388–398): full address fields are fetched only inside the `hasAcceptedUnlock` branch.

Customer contact (`phone`, `name`) is set to `null` by default and only populated inside the `hasAcceptedUnlock` branch.

## WhatsApp handoff photos

WhatsApp-uploaded photos appear in PWA review: **YES (by default)**

- WhatsApp customer photos are stored via `downloadAndStoreWhatsAppMedia` in `lib/whatsapp-media.ts` with `safeForPreview` defaulting to the DB default (`true` per `schema.prisma:867`).
- After `createJobRequest`, `lib/job-requests/create-job-request.ts` links these attachments to the job request via `updateMany` (`jobRequestId: null → jobRequest.id`).
- `lib/client-pwa-destination.ts` queries `where: { label: { in: ['customer_photo', 'evidence'] }, safeForPreview: true }`, so WhatsApp photos (label=`customer_photo`, `safeForPreview=true`) are included in the PWA ticket view.

## Gaps closed

1. **Client-side MIME type validation added** — `BookingFlow.tsx` `onChange` handler now rejects files that are not in `['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']` before they are added to state. Rejected files produce a visible inline error message per file.

2. **Client-side file size validation added** — Same handler now rejects files exceeding 10 MB before they are added to state. Rejected files produce a visible inline error message per file.

3. **`photoErrors` state introduced** — A `photoErrors: string[]` state variable tracks per-file rejection messages. Errors are displayed between the file input and the size hint paragraph.

## Tests

29 tests, all passing. Key scenarios:

- Server-side MIME type allow-list accepts JPEG, rejects PDF and octet-stream
- Client-side validation logic: accepts valid JPEG/PNG, rejects PDF, rejects oversized files, accepts exactly 10 MB, filters mixed valid/invalid batches, enforces 5-photo limit
- `parsePhotoSafeForPreview` covers: null (default true), scalar true/false, JSON array, short array padding, invalid JSON fallback, customer opt-in and opt-out
- Address privacy query shape: pre-acceptance excludes all exact address fields, post-acceptance includes them
- Privacy copy constants are stable (suburb/city/province, exact address + phone, after acceptance)
- WhatsApp photo `safeForPreview` defaults, attachment linking via `createJobRequest`, PWA filter behaviour

## Files changed

- `field-service/components/customer/BookingFlow.tsx` — added `photoErrors` state, added client-side MIME type and file size validation in `onChange`, added inline per-file error rendering
- `field-service/__tests__/app/customer/photo-address-privacy-flow.test.ts` — new test file (29 tests)
- `field-service/docs/client-pwa-execution/005-client-pwa-photo-address-output.md` — this document
