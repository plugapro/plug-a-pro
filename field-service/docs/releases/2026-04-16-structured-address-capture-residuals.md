# Structured Address Capture Residuals

Date: 2026-04-16 (updated same day — WhatsApp path closed)

## Scope closed in this pass

- Customer web booking flow now uses controlled province → city → region → suburb selection.
- Postal code is derived from the mapped suburb dataset instead of typed free text.
- Province choices in the UI are now constrained to the seeded geography that actually has downstream mappings.
- Broad city / region alias nodes are excluded from structured suburb capture so the picker stays suburb-level.
- **WhatsApp customer job-request intake now uses the same list-based province → city → region → suburb flow as the web path.**
  - Free-text suburb and city capture steps removed from the active flow.
  - Province, city, region, suburb selections use WhatsApp list messages (max 10 rows, real pagination applied — no silent slice(0,10)).
  - Postal code is derived from the selected suburb node; it is never typed.
  - New captures always persist a valid `locationNodeId`.
  - Returning customers are only offered "Same address" when the saved address has a `locationNodeId`; legacy addresses force a new structured entry.
  - Submission uses `resolveStructuredAddressCapture` and passes the full structured field set to `createJobRequest`, matching the web API route.
  - Old in-flight conversations that land on legacy `collect_address_suburb` / `confirm_address` steps are redirected to the new flow (with a warm message).
  - Service area gate moved to city-selection time so out-of-area users see the waitlist message as soon as they pick their city, before they step through region and suburb.
  - 32 new tests covering all 10 requirements. 297 total passing.

## Verified in this pass

- `npx vitest run __tests__/lib/whatsapp-flows/job-request.test.ts __tests__/lib/structured-address.test.ts` — 297 tests, 0 failures
- `npx prisma generate` — Prisma client regenerated without error

## Triage notes

- `field-service/lib/matching-engine.ts` still contains a legacy string-based service-area fallback. This is a migration-compatibility path for providers that do not yet have structured service-area rows; it does not re-open free-text customer capture.
- `field-service/lib/geocoding.ts` still geocodes from suburb/city strings. This remains a downstream resolution helper for legacy or WhatsApp-originated requests and is not part of the new controlled address-selection UX.

## Remaining blocked residuals

1. Two seeded suburb nodes still have no reliable postcode from the current reverse-geocode source.
   - Nodes: `gauteng__east_rand__east_rand__dunnottar`, `gauteng__east_rand__east_rand__heidelberg`
   - Current handling: these nodes are not exposed in the structured customer picker because `postalCode: { not: null }` is required. Not a blocker for go-live.
   - Required follow-up: add manually curated postcodes for these nodes or replace them with more precise suburb records.

2. Migration and seed application to a live/shared database were not executed in this session.
   - Current status: migration SQL and seed logic are present in the repository; code paths were validated by tests only.
   - Why blocked: the active database target behind local environment variables was not verified as safe for mutation in this session.
   - Required follow-up: run `prisma migrate deploy` and reseed/postcode backfill in the intended deployment environment, then smoke-test the booking flow against that database.
