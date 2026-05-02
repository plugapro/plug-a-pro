# Execution Output — 06-provider-opportunity-preview-whatsapp-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/06-provider-opportunity-preview-whatsapp-flow.md`

## Objective

Align provider WhatsApp opportunity notifications so providers receive a safe preview in WhatsApp and can understand the opportunity without opening the PWA.

## Current-state findings

The backend already had a safe preview service, `getSafeProviderOpportunityPreview`, that excludes customer phone/email, exact street address, house/unit details, access notes, GPS coordinates, and private fields. Dispatch paths already send WhatsApp lead notifications and, when the qualified-shortlist dispatch flag is enabled, quick replies for `interested:<leadId>` and `not_interested:<leadId>`.

The main gap was message copy: some notifications were still CTA-first and did not include all safe preview fields such as subcategory, region/city/province, urgency, budget preference, and photo count.

## Implementation completed

- Expanded `buildProviderLeadPreviewMessage` to support safe preview fields:
  - subcategory
  - area/city/province
  - region
  - urgency
  - budget preference
  - photo count
  - optional full-preview URL
- Updated matching dispatch preview copy to pass safe structured request fields where available.
- Updated `notifyProviderNewJob` to fetch `getSafeProviderOpportunityPreview` and render a safe WhatsApp preview summary before the optional PWA link.
- Changed lead-notification copy from paid lead acceptance language to qualified-shortlist language: showing interest is free; one credit is spent only after customer selection and final provider acceptance.
- Added tests asserting preview copy includes safe fields and does not include protected customer details.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-credit-copy.ts` | Safe WhatsApp opportunity preview copy expanded |
| `field-service/lib/matching/types.ts` | Optional safe preview fields added to matching request type |
| `field-service/lib/matching/dispatch.ts` | Dispatch preview passes structured safe fields |
| `field-service/lib/whatsapp-bot.ts` | Provider new-job notification renders safe preview from backend service |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | Safe preview copy coverage |
| `docs/provider-whatsapp-pwa-execution/006-provider-opportunity-preview-whatsapp-flow-output.md` | Step 6 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

Provider opportunity WhatsApp messages now include safe preview fields in the WhatsApp body where available:

- category and subcategory
- suburb/city/province area summary
- region
- urgency
- preferred time
- budget preference
- safe photo count
- truncated issue summary
- expiry/deadline
- optional signed preview link

Quick replies remain on the existing dispatch action message path.

## PWA route/screen changes

None. The signed preview link remains optional.

## API/server changes

No API route changes. Notification generation now reuses `getSafeProviderOpportunityPreview` for WhatsApp preview copy.

## Credit impact

No credit mutation behavior changed. Copy now reinforces that interest/preview is free and credit is spent only on selected-job acceptance.

## Security/privacy impact

Server-side safe preview selection remains the source for protected-field exclusion. The WhatsApp preview intentionally does not include customer phone, email, exact address, unit/house number, access notes, private notes, or GPS coordinates.

## Tests added or updated

- Updated `field-service/__tests__/lib/provider-credit-copy.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts
npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/matching-dispatch.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts` | Passed; 2 files, 33 tests |
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/matching-dispatch.test.ts` | Passed; 3 files, 35 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Provider receives safe opportunity preview in WhatsApp.
- [x] Preview includes photo count.
- [x] Preview includes optional signed full-preview link.
- [x] Protected customer details are not included in preview copy.
- [x] Existing interested/not-interested quick replies remain available.
- [x] Expiry/deadline copy remains available.

## Risks and follow-ups

- Some matching paths can only pass fields already loaded into `MatchingJobRequest`; `notifyProviderNewJob` now fetches the richer safe preview by lead id where possible.
- "View photos" remains via the signed preview link at this step. Inline media-gallery handling can be expanded later without weakening privacy.

## OpenBrain note

Provider WhatsApp opportunity preview aligned. Opportunity notifications now render a richer safe preview in WhatsApp using existing backend privacy services and keep PWA as an optional full-preview/photo link. Credit copy remains selected-job-only.
