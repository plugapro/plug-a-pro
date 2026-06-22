# Execution Output — 11-provider-opportunity-preview-and-response.md

## Status

Completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/11-provider-opportunity-preview-and-response.md`

## Objective

Implement provider safe preview and provider interest/not-interested response capture for matched opportunities without deducting credits or exposing full customer details.

## Current-state findings

The existing provider lead detail flow already had a preview/full-detail separation, but the active response path was still the legacy paid lead acceptance flow. A new free opportunity response path was needed so provider interest can be captured before customer shortlist selection.

## Implementation completed

- Added a safe opportunity preview service that selects only non-sensitive request, timing, area, and attachment fields.
- Added provider opportunity response capture for `INTERESTED` and `NOT_INTERESTED`.
- Required call-out fee and estimated arrival time for interested responses.
- Added idempotency handling for duplicate provider/WhatsApp events.
- Marked expired invites as expired before rejecting late responses.
- Added authenticated provider API route for safe preview and provider response submission.
- Added focused tests for privacy, interested response, required arrival time, decline, expiry, and idempotency.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-opportunity-responses.ts` | Safe preview and free provider opportunity response service |
| `field-service/app/api/provider/opportunities/[leadId]/route.ts` | Authenticated GET/POST provider opportunity endpoint |
| `field-service/__tests__/lib/provider-opportunity-responses.test.ts` | Provider opportunity response and privacy tests |
| `docs/codex-execution/011-provider-opportunity-preview-and-response-output.md` | Step 11 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 11 |

## Schema / migration changes

None in this step. This uses the `ProviderLeadResponse` and lead response fields added in step 3.

## API / server action changes

Added `GET /api/provider/opportunities/[leadId]` to return safe opportunity preview data for the authenticated provider.

Added `POST /api/provider/opportunities/[leadId]` to capture provider response data:

- `response`
- `callOutFee`
- `estimatedArrivalAt`
- `rateType`
- `rateAmount`
- `negotiable`
- `providerNote`
- `idempotencyKey`

## UI changes

None in this step. The endpoint/service are ready for provider portal or WhatsApp wiring.

## WhatsApp/template changes

No template copy was changed in this step. The response service supports WhatsApp idempotency keys and a `source` field for future WhatsApp wiring.

## Security and privacy impact

Safe preview is enforced server-side by Prisma `select` clauses. The preview path excludes customer phone, customer email, exact street address, unit/apartment details, complex access details, GPS coordinates, and private access notes. Full customer details remain outside this free opportunity response flow.

## Credit impact

No credits are deducted for previewing, interested responses, duplicate responses, or not-interested responses. The service returns `creditsDeducted: 0` explicitly.

## Tests added or updated

- `field-service/__tests__/lib/provider-opportunity-responses.test.ts`

## Commands run

```bash
npm test -- --run __tests__/lib/provider-opportunity-responses.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npm test -- --run __tests__/lib/provider-opportunity-responses.test.ts`: passed, 1 file, 6 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Provider safe preview excludes customer phone.
- [x] Provider safe preview excludes exact address.
- [x] Provider safe preview includes photos/attachments.
- [x] Provider can respond interested.
- [x] Provider response saves call-out fee.
- [x] Provider response saves estimated arrival.
- [x] Provider response saves negotiable flag.
- [x] Provider can decline/not interested.
- [x] Expired invite cannot respond.
- [x] Duplicate response is handled through idempotency.
- [x] No credits are deducted.

## Risks and follow-ups

The WhatsApp opportunity message dispatch has not yet been switched from the legacy paid lead acceptance copy. Step 12 should consume `ProviderLeadResponse` rows to build customer shortlists, and step 13 should move paid unlock timing to selected-provider final acceptance.

## OpenBrain note

Provider opportunity preview/response foundation completed. Providers can now view server-enforced safe opportunity data and submit free interest or not-interest responses with call-out fee, estimated arrival, rate metadata, and duplicate-event idempotency. Full customer details and wallet debit remain reserved for the later selected-provider final acceptance stage.
