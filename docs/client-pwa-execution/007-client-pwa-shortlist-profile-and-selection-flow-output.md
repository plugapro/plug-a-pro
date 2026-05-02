# Execution Output — 07-client-pwa-shortlist-profile-and-selection-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/07-client-pwa-shortlist-profile-and-selection-flow.md`

## Objective

Align the Client PWA shortlist comparison, provider profile viewing, and provider selection flow.

## Current-state findings

The tokenized ticket screen already displayed shortlist cards with call-out fee, arrival, rate, provider bio, trust signals, portfolio links, ask-more-options, cancel, and select-provider actions. Selection already moved the request to `PROVIDER_CONFIRMATION_PENDING`, set selected provider/lead fields, notified the provider, and did not deduct credits. The missing part was an explicit PWA provider profile view from the shortlist screen.

## Implementation completed

- Added an in-route provider profile view on `/requests/access/[token]?view=shortlist&provider=[providerId]`.
- Added `View profile` actions to shortlist cards.
- Added shortlist intro copy: count of suitable providers and comparison guidance.
- Added selected-provider confirmation copy with the provider name where available.
- Extended shortlist provider data to include service areas for the profile view.
- Kept provider private phone/address/documents/admin notes out of the profile view.
- Preserved the existing selection service and credit behavior.

## Files changed

| File | Change summary |
|---|---|
| `field-service/app/requests/access/[token]/page.tsx` | Added shortlist intro, provider profile panel, profile action, and named selection confirmation |
| `field-service/lib/customer-shortlists.ts` | Included provider service areas in customer shortlist profile data |
| `docs/client-pwa-execution/007-client-pwa-shortlist-profile-and-selection-flow-output.md` | Step 7 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

No public API contract changed. Existing shortlist and selection server actions are reused.

## UI changes

The shortlist screen now shows a clear provider count and comparison instruction. Each provider card has a `View profile` action. The profile panel shows profile photo, bio, category, experience, verification/trust signals, call-out fee, rate, arrival, service areas, previous work links, rating, and completed jobs.

## WhatsApp changes

No WhatsApp sender changes in this step. Existing WhatsApp shortlist links continue to resolve to the tokenized PWA shortlist screen.

## Security and privacy impact

Provider profile view excludes provider phone, provider private address, ID/passport, private documents, reference contacts, and admin notes. Customer full details remain locked until selected-provider acceptance.

## Credit impact

No provider credits are deducted at client selection. Credit deduction remains deferred to selected-provider acceptance.

## Tests added or updated

No new test file was required. Existing shortlist, selected-provider acceptance, and destination tests were rerun to verify selection and credit behavior.

## Commands run

```bash
npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/client-pwa-destination.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 3 files and 20 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Client sees shortlist.
- [x] Client can view provider profile from shortlist.
- [x] Client can select provider using existing selection action.
- [x] Selected provider notification/request path remains in place.
- [x] No credits are deducted at selection.
- [x] Full customer details remain locked before selected-provider acceptance.
- [x] Provider private fields are not shown in customer profile view.

## Risks and follow-ups

The provider profile is implemented as an in-route tokenized panel rather than a separate route, preserving the current route system. A later UX pass can add smoother tab/panel navigation without changing privacy or selection behavior.

## OpenBrain note

Client PWA shortlist now supports comparison, profile review, and provider selection from the existing secure ticket route, while preserving the qualified-shortlist credit rule that selection is free and acceptance is the charge point.
