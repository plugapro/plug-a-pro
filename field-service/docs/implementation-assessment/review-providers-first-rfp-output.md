# Review Providers First / RFP Flow Implementation Output

## Status

Completed with warnings.

## What was implemented

- Added RFP configuration support:
  - `RFP_PROVIDER_RESPONSE_MINUTES` (default 15)
  - `MAX_PROVIDER_REVIEW_BATCHES` (default 3)
  - `MAX_SHORTLISTED_PROVIDERS` (default 3)
  - `MIN_SHORTLISTED_PROVIDERS` (default 1)
- Extended post-submit mode fork:
  - `review_first` no longer dispatches provider invites immediately.
  - Candidate ranking is generated and persisted for customer review.
- Implemented customer review candidate retrieval:
  - top ranked providers in deterministic batches of 3
  - excludes already shortlisted/sent providers
- Implemented shortlist persistence for review-first:
  - idempotent provider shortlist
  - enforced 1–3 shortlist rule
- Implemented “send request to shortlisted providers”:
  - only shortlisted providers are invited
  - response window set to 15 minutes
  - provider gets safe preview only
- Implemented provider response summary notifications to customer:
  - sends progress as responses arrive
  - handles none-responded timeout case
- Implemented RFP invitation expiry sweep (cron):
  - expires review-first leads when window elapses
  - triggers customer summary update
- Added safe public provider profile route with tokenized access:
  - `/provider-public-profile/{token}`
  - no login required
  - request-scoped and provider-scoped token validation
  - no private provider details exposed
- Added shortlist action from public provider profile.
- Fixed review-first TypeScript/runtime gaps found during remediation:
  - aligned `ProviderRate` field usage to `rateNegotiable`
  - corrected `Lead` ordering to `sentAt` (no `createdAt` on `Lead`)
  - added `customerId` to profile-token request resolution for shortlist ownership
  - corrected provider RFP CTA to use signed provider lead preview URL (`getProviderLeadAccessUrl`) instead of customer profile URL
  - updated RFP response summary to derive "available" from `ProviderLeadResponse` records (not lead status)
  - prevented expiry sweeps from expiring already-responded leads (`respondedAt != null`)

## Core files changed

- `lib/review-first.ts` (new)
- `lib/review-provider-profile-access.ts` (new)
- `lib/request-matching-mode.ts`
- `app/(customer)/requests/[id]/page.tsx`
- `app/(customer)/requests/[id]/actions.ts`
- `app/provider-public-profile/[token]/page.tsx` (new)
- `app/api/review-first/provider-profile/shortlist/route.ts` (new)
- `app/api/cron/match-leads/route.ts`
- `lib/provider-opportunity-responses.ts`
- `lib/client-pwa-destination.ts`

## Tests added

- `__tests__/lib/review-provider-profile-access.test.ts`
- `__tests__/api/review-first-provider-profile-shortlist.test.ts`

## Validation

- `npm test -- --run` ✅ 179 files, 2036 tests passed
- `npx prisma validate` ✅ passed
- `npx tsc --noEmit` ✅ passed
- `npm run lint` ✅ passed with 3 pre-existing warnings (unchanged)

## OpenBrain note

Review Providers First lets customers view matching provider profiles, shortlist 1–3 providers, and send the request only to selected providers. Providers get 15 minutes to respond with availability, call-out fee, ETA, and optional note. Credits are consumed only when the customer-selected provider accepts the final job.
