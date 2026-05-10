# OpenBrain implementation note — 2026-05-10

## Decision

WhatsApp `View providers` deep links must render Review Providers First candidates directly on the token-based request page (`/requests/access/[token]`) and must not depend on an authenticated customer session.

## Root cause

- The authenticated request page (`/requests/[id]`) rendered Review Providers First candidates.
- The token request page (`/requests/access/[token]`) did not load or render those candidates.
- Result: customer could receive a `Review Providers First is ready` WhatsApp CTA, open the link, and see no provider options.

## Implementation

1. Extended `buildCustomerRequestTicketViewModel` to load:
- review candidates (batch-aware) via `getProviderCandidatesForCustomerReview`
- review shortlist state via `getCustomerReviewShortlist`
- both as non-fatal reads with guarded fallback logs

2. Updated `/requests/access/[token]` page:
- parse `batch` query param
- render Review Providers First candidate cards in pending OPS_REVIEW state
- render explicit states for:
  - finding providers
  - no matching providers
  - shortlist summary
- added token-scoped `Send request` action using `sendRequestToShortlistedProviders`

3. Updated provider public profile return navigation:
- `Back to request` now prefers token-safe request URL (`/requests/access/...`) instead of session route fallback.

4. Added regression tests:
- `__tests__/lib/customer-request-ticket-view-model.test.ts`
- validates review candidate + shortlist loading for token flow

## Validation

- `npm test -- --run` passed (`2134` tests)
- `npx prisma validate` passed
- `npx tsc --noEmit` passed
- `npm run lint` passed with existing unrelated warnings

## Deployment

- Commit: `0f026ce`
- Production alias updated: `https://app.plugapro.co.za`
