# Execution Output — 02-product-decisions-and-state-machines.md

## Status

Completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/02-product-decisions-and-state-machines.md`

## Objective

Create the official state-machine and product-decision foundation for the Qualified Shortlist Model, reusing current statuses where practical and adding transition helpers for future implementation steps.

## Current-state findings

The current app has persisted Prisma enums for provider status, KYC status, application status, request status, lead status, match status, job status, dispatch decision status, match attempts, and assignment holds. These are coarser than the Qualified Shortlist Model and currently support sequential offer/acceptance rather than provider interest, customer shortlist selection, and selected-provider final acceptance.

The safest foundation is a compatibility layer that maps current persisted values into target Qualified Shortlist states without immediately migrating production statuses.

## Implementation completed

- Added `field-service/lib/qualified-shortlist-state.ts`.
- Added target state types for providers, requests, lead invites, and jobs.
- Added mappings from existing status fields to target shortlist states.
- Added transition helpers:
  - `canProviderReceiveLeads`
  - `canProviderAppearInShortlist`
  - `canProviderAccessWorkerPortal`
  - `canRequestRunMatching`
  - `canLeadInviteReceiveProviderResponse`
  - `canCustomerSelectProvider`
  - `canProviderAcceptSelectedJob`
  - `canProviderViewFullJobDetails`
  - `canShowExpiryCountdown`
- Added focused tests in `field-service/__tests__/lib/qualified-shortlist-state.test.ts`.
- Documented the state-machine decision in `field-service/docs/qualified-shortlist-state-machines.md`.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/qualified-shortlist-state.ts` | New target state mappings and transition guard helpers |
| `field-service/__tests__/lib/qualified-shortlist-state.test.ts` | Tests for provider, request, lead invite, job, expiry, full-detail, and selected-acceptance guards |
| `field-service/docs/qualified-shortlist-state-machines.md` | State-machine documentation and OpenBrain-compatible decision note |
| `docs/codex-execution/002-product-decisions-and-state-machines-output.md` | Step 2 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 2 |

## Schema / migration changes

None.

## API / server action changes

None.

## UI changes

None.

## WhatsApp/template changes

None.

## Security and privacy impact

Positive foundation only. `canProviderViewFullJobDetails` encodes the rule that full customer data is visible only after an unlock or accepted assignment belongs to the same provider. No existing routes were changed in this step.

## Credit impact

No wallet or ledger behavior changed. `canProviderAcceptSelectedJob` creates a guard for future selected-provider acceptance, where the credit debit will move in later steps.

## Tests added or updated

Added `field-service/__tests__/lib/qualified-shortlist-state.test.ts`.

## Commands run

```bash
find . -maxdepth 2 -type f -name 'vitest.config.*' -o -name 'vite.config.*' -o -name 'tsconfig.json'
sed -n '1,220p' __tests__/lib/provider-lead-detail.test.ts
sed -n '1,240p' __tests__/lib/provider-trust.test.ts
sed -n '1,200p' vitest.config.ts
sed -n '1,220p' tsconfig.json
npm test -- --run __tests__/lib/qualified-shortlist-state.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npm test -- --run __tests__/lib/qualified-shortlist-state.test.ts`: passed, 1 file, 5 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 pre-existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Target provider state machine documented.
- [x] Target request state machine documented.
- [x] Target lead invite state machine documented.
- [x] Target job state machine documented.
- [x] Existing statuses mapped where practical.
- [x] Transition helper functions added.
- [x] Tests cover core state transitions.
- [x] Expiry countdown is guarded by invite state, not raw expiry alone.

## Risks and follow-ups

The target states `interested`, `shortlisted`, `customer_selected`, and `provider_confirmation_pending` are not yet first-class persisted statuses. Later schema and flow steps must add persistence for those states or map them from new child records.

## OpenBrain note

Qualified Shortlist state-machine foundation added as a compatibility layer over current Prisma enums. This preserves existing production data while giving new shortlist code explicit guards for provider eligibility, request matching, provider responses, customer selection, selected-provider acceptance, detail unlock, and expiry countdown behavior.
