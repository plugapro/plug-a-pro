# Execution Output — 03-client-pwa-route-map-and-state-resolver.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/03-client-pwa-route-map-and-state-resolver.md`

## Objective

Create a centralized Client PWA route and state resolver so tokenized WhatsApp links and authenticated client routes render from current backend state.

## Current-state findings

The app already has canonical customer routes (`/bookings`, `/requests/[id]`, `/bookings/[id]`, `/bookings/[id]/rate`) plus the secure WhatsApp ticket route (`/requests/access/[token]`). The missing piece was a shared destination resolver returning the current screen, route, request, job, allowed actions, access level, and reason.

## Implementation completed

- Added `field-service/lib/client-pwa-state.ts` for centralized request/job status to PWA screen mapping.
- Added `field-service/lib/client-pwa-destination.ts` for resolving token, request id, or job id inputs to the current PWA destination.
- Preserved existing route conventions instead of creating duplicate `/client/*` routes.
- Updated the WhatsApp ticket route to use `resolveClientPwaDestination`.
- Updated the authenticated request detail route to align to the resolver and redirect completed/active matched jobs to existing booking/review routes.
- Updated the handoff resolver to reuse the shared state mapping.
- Added focused tests for state mapping, destination routing, stale token links, invalid tokens, and completed-job review routing.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-pwa-state.ts` | New centralized state-to-screen and allowed-action mapping |
| `field-service/lib/client-pwa-destination.ts` | New Client PWA destination resolver |
| `field-service/lib/client-pwa-handoff.ts` | Reused shared state mapping for handoff views |
| `field-service/app/requests/access/[token]/page.tsx` | Token route now resolves through Client PWA destination resolver |
| `field-service/app/(customer)/requests/[id]/page.tsx` | Authenticated request route now aligns to destination resolver |
| `field-service/__tests__/lib/client-pwa-state.test.ts` | State mapping tests |
| `field-service/__tests__/lib/client-pwa-destination.test.ts` | Destination resolver tests |
| `docs/client-pwa-execution/003-client-pwa-route-map-and-state-resolver-output.md` | Step 3 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

No public API contract changed. Server-side route resolution is now centralized in shared helpers.

## UI changes

No new visual route system was introduced. Existing ticket and authenticated request pages now use the resolver’s current-state decision. Authenticated request links for already-booked jobs redirect to the existing booking or review screen.

## WhatsApp changes

Old WhatsApp ticket links continue to open `/requests/access/[token]`, but that route now resolves the current PWA screen from backend state. A stale shortlist link for an assigned job resolves to job tracking rather than the old shortlist state.

## Security and privacy impact

Secure token access remains enforced server-side. Invalid and expired token paths return controlled recovery destinations. The resolver returns only routing state, allowed actions, and the request data already authorized by the token/authenticated route.

## Credit impact

None. Client selection and route resolution do not deduct credits.

## Tests added or updated

- Added `field-service/__tests__/lib/client-pwa-state.test.ts`.
- Added `field-service/__tests__/lib/client-pwa-destination.test.ts`.
- Existing handoff and ticket URL tests were rerun.

## Commands run

```bash
npm test -- --run __tests__/lib/client-pwa-state.test.ts __tests__/lib/client-pwa-destination.test.ts __tests__/lib/client-pwa-handoff.test.ts __tests__/lib/job-request-access.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 4 files and 15 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Route resolver exists.
- [x] Resolver returns screen, route, request, job, allowed actions, access level, and reason.
- [x] Secure token access is handled server-side.
- [x] Request id and job id references are supported for trusted server-side routing.
- [x] Existing route system was reused.
- [x] Stale WhatsApp shortlist links resolve to current job tracking state.
- [x] Invalid token links resolve to controlled recovery.
- [x] Expired token links resolve to controlled recovery.
- [x] Client selection still does not deduct provider credits.

## Risks and follow-ups

Draft request resume is mapped in the screen/action model, but the current persisted `JobRequestStatus` enum does not include a draft status. The request creation blueprint should decide whether draft lives outside `JobRequest` or requires a later schema extension.

## OpenBrain note

Client PWA route and state resolution is now centralized around backend request/job state. WhatsApp ticket links and authenticated request pages use the same screen mapping while preserving existing Plug A Pro routes.
