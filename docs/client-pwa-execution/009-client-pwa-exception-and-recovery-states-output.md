# Execution Output — 09-client-pwa-exception-and-recovery-states.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/09-client-pwa-exception-and-recovery-states.md`

## Objective

Add controlled Client PWA exception and recovery states for known request, link, and action failures.

## Current-state findings

Invalid and expired token handling already returned a safe card with trace ID, but the copy was ticket-specific rather than the required generic recovery language. Cancelled and expired request states could still render normal ticket context without a clear recovery panel.

## Implementation completed

- Updated invalid/expired token copy to “This link is no longer valid” with latest WhatsApp/new-link guidance.
- Added controlled recovery cards for failed selection, failed more-options, failed cancel, and invalid action states.
- Added expired/no-provider recovery state with help and start-new-request actions.
- Added cancelled request recovery state with start-new-request action.
- Added support contact links to the public Plug A Pro contact page instead of creating a new route.
- Added state mapping tests for cancelled and expired request states.

## Files changed

| File | Change summary |
|---|---|
| `field-service/app/requests/access/[token]/page.tsx` | Added controlled exception/recovery cards and updated invalid-link copy |
| `field-service/__tests__/lib/client-pwa-state.test.ts` | Added cancelled/expired state mapping tests |
| `docs/client-pwa-execution/009-client-pwa-exception-and-recovery-states-output.md` | Step 9 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

None.

## UI changes

The secure ticket route now shows controlled recovery UI for invalid/expired links, failed known actions, expired/no-provider requests, and cancelled requests.

## WhatsApp changes

No WhatsApp sender changed in this step. Copy now tells customers to open the latest WhatsApp message or request a new link.

## Security and privacy impact

Error states do not expose protected request data. Invalid token states still include a support trace ID.

## Credit impact

None.

## Tests added or updated

- Updated `field-service/__tests__/lib/client-pwa-state.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/client-pwa-state.test.ts __tests__/lib/client-pwa-destination.test.ts __tests__/lib/customer-shortlists.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 3 files and 17 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Known exception states have controlled UI.
- [x] Invalid token handled safely.
- [x] Expired token handled safely.
- [x] Cancelled request handled safely.
- [x] Expired/no-provider request has recovery actions.
- [x] Failed actions show non-generic recovery guidance.
- [x] Protected data is not shown in invalid-link states.
- [x] Trace ID remains available for support on invalid-link states.

## Risks and follow-ups

Provider-declined-after-selection does not yet have a dedicated backend status distinct from provider-confirmation pending or shortlist-ready. If the provider confirmation timeout flow adds a specific state, the resolver can map it to the “choose another provider” recovery panel.

## OpenBrain note

Client PWA exception states now fail closed with controlled recovery copy, latest-WhatsApp-link guidance, support trace IDs where appropriate, and no protected data exposure.
