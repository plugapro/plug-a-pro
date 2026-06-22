# Mobile PWA Landing — As-Is Gap Assessment

## Current routes and components inspected

- Landing: `field-service/app/(customer)/page.tsx`
- Services/category entry: `field-service/app/(customer)/services/page.tsx`
- Request entry page: `field-service/app/(customer)/book/[serviceId]/page.tsx`
- Request form: `field-service/components/customer/BookingFlow.tsx`
- Provider listing: `field-service/app/(customer)/providers/page.tsx`
- Provider listing UI: `field-service/components/customer/ProviderSearchInput.tsx`, `field-service/components/shared/ProviderCard.tsx`
- Provider profile: `field-service/app/(customer)/providers/[id]/page.tsx`
- Request create API: `field-service/app/api/customer/bookings/route.ts`
- Request domain service: `field-service/lib/job-requests/create-job-request.ts`
- Matching + dispatch orchestration: `field-service/lib/matching/orchestrator.ts`, `field-service/lib/matching/scoring.ts`
- Safe redirects / OTP callback: `field-service/lib/safe-redirect.ts`, `field-service/app/(auth)/sign-in/page.tsx`, `field-service/app/(auth)/verify/page.tsx`
- Client WhatsApp handoff: `field-service/lib/client-pwa-submission-notifications.ts`, `field-service/lib/client-pwa-destination.ts`
- Provider WhatsApp acceptance/credit/unlock: `field-service/lib/selected-provider-acceptance.ts`, `field-service/lib/provider-lead-access.ts`, `field-service/lib/whatsapp-bot.ts`

## Current landing structure and CTAs

- The old mobile landing was category-first marketing copy:
  - headline: “Request local home services”
  - CTA: “Request a job”
  - CTA: “Track my booking”
- It did not clearly separate customer vs provider intents on first load.
- It lacked a direct “find provider” discovery-first call-to-action and lacked a dedicated provider join block on the hero path.

## Current customer path (landing → request)

1. Landing CTA routes to `/services`.
2. `/services` requires customer sign-in.
3. Customer selects category, then `/book/[serviceId]`.
4. `BookingFlow` submits to `/api/customer/bookings`.
5. `createJobRequest` creates request and triggers matching orchestration.
6. Customer receives WhatsApp request submission status update.

## Current provider path (landing → apply/join)

- Provider join was not a primary landing CTA.
- Worker path exists via `/provider-sign-in` and provider onboarding/WhatsApp flows, but not foregrounded in customer landing IA.

## Provider search/list/profile as-is

- Provider listing route exists: `/providers` (feature-flagged).
- Provider profile route exists: `/providers/[id]`.
- Listing previously used `active + verified` filters and ranking, but lacked explicit status/suspension guard and lacked full discovery IA requirements.
- Provider profile was safe by default (no private phone/address/docs/admin fields), but request CTA and profile detail presentation were minimal.

## Provider card data currently available in model

From schema and related relations:
- `Provider`: name, avatar, bio, skills, serviceAreas, experience, verified, availability, rating, completedJobsCount, status, suspension markers.
- `ProviderCategory`: categorySlug, subServices, yearsExperience, approvalStatus.
- `ProviderRate`: callOutFee, hourlyRate, rateNegotiable.

## WhatsApp/PWA handoff points as-is

- Customer request submission WhatsApp confirmation is already implemented.
- Client PWA tokenized state-aware routes are already implemented (`resolveClientPwaDestination`).
- Provider acceptance and credit unlock remains WhatsApp-first and ledger-backed.
- Privacy gate before acceptance is already enforced server-side (`resolveProviderLeadAccessToken` + attachment authorization).

## Gaps against target landing/discovery model

1. Landing IA did not provide explicit three-way CTAs (`Find provider`, `Request service`, `Join as provider`).
2. Discovery-first flow existed but was not promoted from landing.
3. Provider request intent from profile (`preferred provider`) was not reliably carried through full request submission path.
4. Booking API did not parse preferred provider field from multipart submission.
5. Booking entry sign-in redirect path did not preserve provider selection context query.
6. Provider discovery filtering did not explicitly enforce all operational visibility conditions (status/suspension/category approval fallback policy) in one place.

## Recommended implementation plan

1. Redesign customer landing IA to action-first mobile flow.
2. Keep provider browse public; gate request submission at sign-in/OTP.
3. Harden provider listing filters to reviewed/active/eligible providers only.
4. Expand provider cards/profiles using safe public fields with graceful fallback.
5. Wire preferred-provider intent end-to-end:
   - provider profile/book link -> sign-in `next` preserved
   - `/book/[serviceId]` carries preferred provider context
   - booking API validates and forwards `preferredProviderId`
6. Keep existing shortlist/acceptance/credit/unlock services unchanged.
7. Add tests for landing CTAs/categories, provider discovery safety filter, and preferred provider request persistence.

## Risks

- Legacy providers without `ProviderCategory` rows require controlled fallback to skills for category compatibility.
- Preferred provider prioritization depends on matching scoring; if provider is ineligible/unavailable, fallback to normal shortlist remains necessary.
- Any UI-level request-action changes must not bypass server-side privacy/credit gate services.
