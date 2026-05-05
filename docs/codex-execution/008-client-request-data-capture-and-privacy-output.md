# Execution Output — 08-client-request-data-capture-and-privacy.md

## Status

Partially completed

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/08-client-request-data-capture-and-privacy.md`

## Objective

Upgrade client request capture to collect matching-critical data while protecting customer privacy before provider final acceptance.

## Current-state findings

The existing WhatsApp request flow already captures customer name/phone, category, structured address, issue description, availability, and app-controlled photos. Step 3 added request metadata fields to `JobRequest`, but the flow did not yet populate urgency, budget preference, provider preference, source, submitted timestamp, or request reference.

## Implementation completed

- Added `field-service/lib/client-request-data.ts` helpers for:
  - Availability-to-urgency mapping.
  - Provider preference mapping.
  - Budget preference mapping.
  - Customer-facing request reference generation.
- Extended `CreateJobRequestParams` and `createJobRequest` to persist:
  - `requestRef`
  - `source`
  - `subcategory`
  - `urgency`
  - `budgetPreference`
  - `maxCallOutFee`
  - `providerPreference`
  - `verifiedOnly`
  - `submittedAt`
- Extended WhatsApp job request flow:
  - Derives urgency from selected availability.
  - Captures provider preference.
  - Captures budget preference.
  - Adds privacy explanation to the request review summary.
  - Sends submission copy explaining that phone/exact address are shared only after customer selection and provider acceptance.
  - Passes new fields into `createJobRequest`.
- Added focused tests for request helper mappings and request reference generation.

This step is partially completed because PWA `BookingFlow` capture and explicit subcategory/job-type capture still need equivalent updates, and photo `safe_for_preview` classification is not yet implemented.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-request-data.ts` | New request helper mappings and request ref generation |
| `field-service/__tests__/lib/client-request-data.test.ts` | Tests for urgency/preference/ref helpers |
| `field-service/lib/whatsapp-flows/types.ts` | Added request preference/budget steps and conversation fields |
| `field-service/lib/whatsapp-flows/job-request.ts` | Added urgency/provider preference/budget capture and privacy copy |
| `field-service/lib/job-requests/create-job-request.ts` | Persisted new request metadata fields |
| `docs/codex-execution/008-client-request-data-capture-and-privacy-output.md` | Step 8 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 8 |

## Schema / migration changes

No new migration in this step. It uses the fields added in step 3.

## API / server action changes

`createJobRequest` now accepts and persists shortlist-relevant request metadata.

## UI changes

No PWA UI changes.

WhatsApp flow changes:

- Adds provider preference list after availability.
- Adds budget preference list before photos.
- Review summary includes urgency, preference, budget, and privacy explanation.

## WhatsApp/template changes

No Meta template registry changes. Interactive WhatsApp flow copy was updated.

## Security and privacy impact

Positive. Customer review and submission copy now explicitly states that phone number and exact address are shared only after customer selection and provider acceptance. Server-side preview/privacy enforcement remains unchanged.

## Credit impact

None.

## Tests added or updated

Added `field-service/__tests__/lib/client-request-data.test.ts`.

## Commands run

```bash
npx prisma generate
npm test -- --run __tests__/lib/client-request-data.test.ts __tests__/lib/create-job-request.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npx prisma generate`: passed with Prisma package.json config deprecation warning.
- `npm test -- --run __tests__/lib/client-request-data.test.ts __tests__/lib/create-job-request.test.ts`: passed, 2 files, 20 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings.

## Manual verification checklist

- [x] WhatsApp client request captures urgency.
- [x] WhatsApp client request captures provider preference.
- [x] WhatsApp client request captures budget preference.
- [x] Request metadata is persisted by shared create service.
- [x] Privacy explanation appears before submission.
- [x] Exact address and phone are not added to provider preview by this step.
- [ ] PWA request capture updated with same fields.
- [ ] Subcategory/job type capture added.
- [ ] Photo `safe_for_preview` classification added.

## Risks and follow-ups

The WhatsApp flow now has two extra list prompts. Watch completion rates and consider collapsing preference/budget into a single prompt if drop-off increases. PWA capture must be updated before web-originated requests are shortlist-equivalent.

## OpenBrain note

Client request capture upgraded for shortlist readiness by adding urgency, provider preference, budget preference, source, request reference, submitted timestamp, and privacy copy to the WhatsApp/shared creation flow. Existing structured address and attachment systems are reused. Remaining work: PWA parity, subcategory capture, and safe-preview classification for photos.
