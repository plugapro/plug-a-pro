# Execution Output — 02-client-pwa-channel-and-handoff-model.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/02-client-pwa-channel-and-handoff-model.md`

## Objective

Implement the shared WhatsApp-to-Client-PWA handoff model so links resolve from current backend state rather than stale link intent.

## Current-state findings

The existing request ticket URL model already uses secure `customerAccessToken` links and the public production URL helper. It did not yet expose a shared state-aware handoff resolver, so WhatsApp links could carry intent without a central service deciding which PWA screen is correct after the request moves forward.

## Implementation completed

- Added a shared Client PWA handoff resolver in `field-service/lib/client-pwa-handoff.ts`.
- Mapped current `JobRequestStatus` values to PWA views for review, matching, provider response pending, shortlist, provider confirmation, job tracking, and closed requests.
- Preserved the canonical `/requests/access/[token]` route while adding a `view` query target for the current PWA state.
- Added controlled invalid and expired recovery paths.
- Extended `getJobRequestAccessUrl` to accept an optional handoff intent while continuing to use `getPublicAppUrl`.
- Added support for trusted server-side request references by minting/reusing the canonical customer access token before resolving state.
- Added stale-link and production-URL tests.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-pwa-handoff.ts` | New shared state-aware Client PWA handoff resolver |
| `field-service/lib/job-request-access.ts` | Added optional handoff intent query to ticket URLs |
| `field-service/__tests__/lib/client-pwa-handoff.test.ts` | Added resolver coverage for stale links, request references, and recovery states |
| `field-service/__tests__/lib/job-request-access.test.ts` | Added production ticket URL intent coverage |
| `docs/client-pwa-execution/002-client-pwa-channel-and-handoff-model-output.md` | Step 2 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

No public API route changed. Server-side helpers now support state-aware handoff resolution and optional URL intent.

## UI changes

None in this step. The resolver provides the state target that later route/UI steps can consume.

## WhatsApp changes

WhatsApp ticket links can now include an explicit intent query while still resolving through the canonical secure token route. Old links remain compatible because resolver output is based on current backend request status.

## Security and privacy impact

The resolver does not expose customer private details. It only returns request id, link status, target view, path, and reason. Browser-facing links remain token-based. Request-reference resolution is intended for trusted server-side callers and converts the reference into the canonical secure access token.

## Credit impact

None. Client handoff and selection navigation does not deduct provider credits.

## Tests added or updated

- Added `field-service/__tests__/lib/client-pwa-handoff.test.ts`.
- Updated `field-service/__tests__/lib/job-request-access.test.ts`.

## Commands run

```bash
npx prisma generate
npx tsc --noEmit
npm test -- --run __tests__/lib/client-pwa-handoff.test.ts __tests__/lib/job-request-access.test.ts
npm run lint
```

## Test results

- `npx prisma generate`: passed. Prisma reported the existing package.json Prisma config deprecation warning.
- `npx tsc --noEmit`: passed.
- Focused Vitest run: passed, 2 files and 10 tests.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Shared handoff resolver exists.
- [x] Resolver accepts secure token links.
- [x] Resolver accepts trusted server-side request references.
- [x] Resolver chooses PWA destination from current backend state.
- [x] Stale shortlist links route to job tracking after request assignment.
- [x] Invalid links route to controlled recovery.
- [x] Expired links route to controlled recovery.
- [x] Production ticket URLs use `https://app.plugapro.co.za`.
- [x] No localhost URL introduced.
- [x] No provider credit deduction introduced.

## Risks and follow-ups

The route layer still needs to consume `resolveClientPwaHandoff` directly so `/requests/access/[token]` renders the correct current state in all cases. That is the focus of the next blueprint step.

## OpenBrain note

Client PWA handoff model implemented as a backend-state resolver. WhatsApp remains the primary start channel, while PWA destination decisions now come from current request state and secure token resolution rather than original link intent alone.
