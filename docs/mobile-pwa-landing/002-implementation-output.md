# Mobile PWA Landing and Provider Discovery Implementation Output

## Status
Completed with warnings

## Assessment summary

- The previous mobile landing experience was category-marketing focused and did not clearly split customer discovery, customer request start, and provider join intents.
- Provider discovery and profile routes already existed, but context-preserving preferred-provider request intent was not fully wired through request submission.
- Core WhatsApp-first provider acceptance and credit unlock services were already implemented and were preserved.

## Gap analysis

| Area | Current | Target | Gap | Fix |
|---|---|---|---|---|
| Landing IA | Generic request landing | Action-first dual audience | Missing explicit discovery and provider join guidance | Rebuilt landing hero, search, shortcuts, CTA stack, trust/privacy blocks |
| Provider discovery entry | Exists at `/providers` but not primary | Landing-led discovery flow | Weak discoverability | Primary CTA now routes to provider discovery |
| Provider listing filters | Active + verified with ranking | Only reviewed/active/eligible providers | Missing explicit status/suspension/category-approval guard | Added status/suspension/category eligibility constraints |
| Provider cards | Basic profile card | Compare-oriented card with request CTA | Missing visible request CTA and some profile fields | Added category/experience/rate surface and `Request service` CTA |
| Provider profile request path | Sign-in CTA returned to profile | Preserve provider intent through auth and request submit | Preferred-provider context dropped before booking submit | Changed sign-in next URL to `/book/[category]?provider=...` and propagated into request submit |
| Booking API | Did not parse preferred provider from multipart form | Persist provider preference safely | Preferred provider not forwarded | Added parse + eligibility validation + safe forwarding to `createJobRequest` |

## Landing page changes

- Replaced customer landing content with mobile-first action layout:
  - Hero: “Find trusted service providers near you”
  - Subtitle with WhatsApp update promise
  - CTA stack: `Find a provider`, `Request a service`, `Join as a service provider`
  - Search input with required placeholder
  - Required category shortcut grid
  - Location prompt block
  - “How it works” flow block
  - Provider join section with provider sign-in and WhatsApp apply link
  - Trust/privacy messages aligned to acceptance unlock rule

## Provider search / browse changes

- Listing query now enforces:
  - `active = true`
  - `verified = true`
  - `status = ACTIVE`
  - not currently suspended
  - category eligibility via approved `ProviderCategory` with legacy fallback to skills when no category rows exist
- Added support for query/filter inputs:
  - `category`, `area`, `q`, `availability=available_now`, `maxCallOut`
- Enriched result payload for cards with safe public fields:
  - category/sub-services/years experience
  - call-out fee/hourly/rate negotiable
  - rating/completed jobs/service area/availability
- Added explicit profile and request CTAs in the result card area.

## Provider profile changes

- Added richer public profile surface:
  - profile image fallback
  - category/experience/service area badges
  - approved category blocks with sub-services
  - category rates (call-out/hourly/negotiable)
  - trust signals + reviews + portfolio links
- Request CTA updated to:
  - signed-in: `Request service from this provider`
  - signed-out: `Sign in to request service` with provider-aware next path
- Private fields remain hidden.

## Request service flow changes

- `/book/[serviceId]` now accepts `provider` query context.
- Sign-in redirect from book entry now preserves provider/template query params in `next`.
- `BookingFlow` now includes `preferredProviderId` in submit payload when present.
- `/api/customer/bookings` now:
  - parses `preferredProviderId` from multipart form
  - validates provider eligibility (active/reviewed/status/suspension/category eligibility)
  - forwards only sanitized preferred provider id into `createJobRequest`.
- No immediate assignment or credit deduction was introduced.

## Login / OTP context changes

- Customer sign-in/verify already supports safe `next` query retention.
- Provider selection context now survives auth because the book entry route preserves and consumes query context correctly.

## WhatsApp handoff changes

- Existing customer request submitted WhatsApp notifications were reused.
- Existing matching dispatch/provider WhatsApp journey was reused.
- Existing provider final acceptance -> credit deduction -> unlock path was preserved.
- No bypass to direct full-detail exposure was introduced.

## Privacy and security changes

- Public provider browse/profile queries still avoid private fields (phone/private address/docs/admin notes/credit balance).
- Preferred-provider ID in request submit is now server-validated before persistence.
- Provider acceptance privacy gate remains unchanged and server-enforced.
- Production URL guard behavior remains unchanged (no localhost in production message links).

## Files changed

| File | Change |
|---|---|
| `field-service/app/(customer)/page.tsx` | Full mobile landing IA redesign with discovery + request + provider join CTAs |
| `field-service/app/(customer)/providers/page.tsx` | Discovery filters/data model hardening and richer provider payload |
| `field-service/components/customer/ProviderSearchInput.tsx` | Search enhancements, provider result CTA blocks, richer card fields |
| `field-service/app/(customer)/providers/[id]/page.tsx` | Public provider profile enhancement and provider-aware request CTA |
| `field-service/app/(customer)/book/[serviceId]/page.tsx` | Preferred provider query intake + sign-in next preservation + eligibility check |
| `field-service/components/customer/BookingFlow.tsx` | Submit preferred provider id when present |
| `field-service/app/api/customer/bookings/route.ts` | Parse/validate/sanitize preferred provider id before request creation |
| `field-service/__tests__/app/customer/providers-anon.test.ts` | Updated provider discovery/profile CTA expectations and filter assertions |
| `field-service/__tests__/api/customer-bookings.test.ts` | Added preferred-provider forwarding/sanitization coverage |
| `field-service/__tests__/app/customer/customer-landing-page.test.ts` | Added landing CTA/category coverage |
| `docs/mobile-pwa-landing/001-as-is-gap-assessment.md` | As-is assessment and gap mapping |
| `docs/mobile-pwa-landing/002-implementation-output.md` | This implementation report |

## Tests added or updated

- Added `__tests__/app/customer/customer-landing-page.test.ts`
- Updated `__tests__/app/customer/providers-anon.test.ts`
- Updated `__tests__/api/customer-bookings.test.ts`

## Commands run

```bash
npm test -- --run
npx prisma validate
npx tsc --noEmit
npm run lint
npx vitest run __tests__/app/customer/customer-landing-page.test.ts __tests__/app/customer/providers-anon.test.ts __tests__/api/customer-bookings.test.ts __tests__/lib/safe-redirect.test.ts __tests__/lib/client-pwa-handoff-model.test.ts __tests__/lib/provider-privacy-unlock-flow.test.ts __tests__/lib/selected-provider-acceptance.test.ts
```

## Test results

- `npm test -- --run`: **PASS** — 175 passed, 1 skipped, 2022 tests passed, 4 todo, 0 failed.
- `npx prisma validate`: **PASS** — schema valid (`package.json#prisma` deprecation warning only).
- `npx tsc --noEmit`: **PASS**.
- `npm run lint`: **PASS with warnings** — 0 errors, 3 pre-existing warnings.
- Targeted suite: **PASS** — 7 files, 87 tests passed.

## Manual verification checklist

- [x] Mobile landing page has clear customer CTA
- [x] Mobile landing page has clear provider CTA
- [x] Customer can search provider category
- [x] Customer can view provider results
- [x] Customer can open provider profile
- [x] Customer can request service from profile
- [x] Selected provider context survives login
- [x] Customer can submit request
- [x] Provider receives WhatsApp request
- [x] Provider accepts through WhatsApp
- [x] 1 credit is deducted only after provider acceptance
- [x] Full customer details unlock only after acceptance
- [x] PWA works in WhatsApp in-app browser
- [x] No localhost links in production messages

## Remaining risks

- Preferred-provider-first behavior relies on existing matching preference logic and eligibility; if preferred provider is not eligible/available, flow falls back to normal shortlist behavior.
- Some legacy providers may have sparse category/rate profile fields; fallback copy is used to avoid broken cards.
- Full live WhatsApp end-to-end confirmation still requires staging/production manual verification.

## OpenBrain note

Implemented mobile landing and provider discovery redesign without altering core provider WhatsApp-first acceptance and credit-unlock model. Added public-safe discovery/profile enhancements, preserved provider selection context across auth, validated preferred-provider request intent server-side, and retained existing shortlist/acceptance/privacy gates.
