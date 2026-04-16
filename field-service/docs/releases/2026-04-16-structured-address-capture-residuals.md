# Structured Address Capture Residuals

Date: 2026-04-16

## Scope closed in this pass

- Customer web booking flow now uses controlled province -> city -> region -> suburb selection.
- Postal code is derived from the mapped suburb dataset instead of typed free text.
- Province choices in the UI are now constrained to the seeded geography that actually has downstream mappings.
- Broad city / region alias nodes are excluded from structured suburb capture so the picker stays suburb-level.

## Verified in this pass

- `npm test -- --run __tests__/lib/location-nodes.test.ts __tests__/lib/structured-address.test.ts __tests__/lib/create-job-request.test.ts`
- `npm run build`
- `npm run lint`

## Triage notes

- `field-service/lib/matching-engine.ts` still contains a legacy string-based service-area fallback. This is a migration-compatibility path for providers that do not yet have structured service-area rows; it does not re-open free-text customer capture in the web booking flow.
- `field-service/lib/geocoding.ts` still geocodes from suburb/city strings. This remains a downstream resolution helper for legacy or WhatsApp-originated requests and is not part of the new controlled customer address-selection UX.

## Blocked residuals

1. WhatsApp customer job-request intake still collects suburb and city as typed text.
   - Evidence: [job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/job-request.ts:187), [job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/job-request.ts:207), [job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/job-request.ts:335)
   - Why blocked: this needs a separate interaction redesign for WhatsApp list/button flows so the same mapped hierarchy can be navigated without free-text suburb/city prompts.
   - Required follow-up: replace the current typed suburb/city steps with a structured interactive province/city/region/suburb selection flow and feed the resulting `locationNodeId` into `createJobRequest`.

2. Two seeded suburb nodes still have no reliable postcode from the current reverse-geocode source.
   - Nodes: `gauteng__east_rand__east_rand__dunnottar`, `gauteng__east_rand__east_rand__heidelberg`
   - Current handling: these nodes are not exposed in the new structured customer picker because postcode is mandatory for new structured capture.
   - Required follow-up: add a manually curated postcode source for these nodes or replace them with more precise suburb records.

3. Migration and seed application to a live/shared database were not executed in this session.
   - Current status: migration SQL and seed logic are present in the repository; code paths were validated by tests, lint, and production build only.
   - Why blocked: the active database target behind local environment variables was not verified as safe for mutation in this session.
   - Required follow-up: run the Prisma migration and reseed/postcode backfill in the intended deployment environment, then smoke-test the booking flow against that database.
