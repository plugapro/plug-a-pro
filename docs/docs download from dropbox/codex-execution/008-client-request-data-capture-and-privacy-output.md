# Execution Output — 08-client-request-data-capture-and-privacy.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/08-client-request-data-capture-and-privacy.md`

## Objective

Upgrade client request capture to collect matching-critical data while protecting customer privacy before provider final acceptance.

## Current-state findings

The existing WhatsApp request flow already captures customer name/phone, category, structured address, issue description, availability, and app-controlled photos. Step 3 added request metadata fields to `JobRequest`, and both the WhatsApp flow and PWA now pass shortlist-relevant fields end-to-end (`urgency`, `providerPreference`, `budgetPreference`, `maxCallOutFee`, `verifiedOnly`, `subcategory`, `accessNotes`) into `createJobRequest`.

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

This step is now complete after PWA parity updates and post-submission privacy-preserving access-notes handling.

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

PWA booking flow updates:

- `components/customer/BookingFlow.tsx` now captures:
  - `subcategory`
  - `photosSafeForPreview`
  - `accessNotes`
  - all shortlist-relevant preference/timing fields (`urgency`, `providerPreference`, `budgetPreference`, `maxCallOutFee`).

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
- [x] PWA request capture updated with same fields.
- [x] Subcategory/job type capture added.
- [x] Photo `safe_for_preview` classification added.
- [x] Structured `accessNotes` captured and forwarded for post-acceptance unlock details.

## Risks and follow-ups

The WhatsApp flow now has two extra list prompts. Watch completion rates and consider collapsing preference/budget into a single prompt if drop-off increases. The web-originated request path is now shortlist-equivalent in parity.

## OpenBrain note

Client request capture upgraded for shortlist readiness by adding urgency, provider preference, budget preference, source, request reference, submitted timestamp, and privacy copy to the creation flow. Existing structured address and attachment systems are reused. `accessNotes` is now persisted as structured post-acceptance-only detail.
