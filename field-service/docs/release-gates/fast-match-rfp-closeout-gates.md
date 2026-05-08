# Fast Match + Review Providers First Close-Out Gates

## Purpose

This gate set closes the remaining product/ops gaps for both matching journeys:
- stale smoke-route drift
- missing cross-channel journey verification
- missing Fast Match KPI baseline evidence
- missing live WhatsApp device verification evidence
- status-vocabulary mismatch between blueprint and persisted enums

## Required automated gates

Run all gates below before release sign-off:

```bash
npm test -- --run __tests__/lib/fast-match-regression-sweep.test.ts
npm run test:e2e:journeys
npm test -- --run __tests__/lib/journey-status-vocabulary.test.ts
npx prisma validate
npx tsc --noEmit
npm run lint
```

## Fast Match KPI soft gate

Generate a 7-day KPI baseline:

```bash
npm run ops:fast-match:kpi-report -- --days=7 --json
```

Attach the JSON output to release evidence and confirm these are present:
- `declineRate`
- `timeoutRate`
- `queueExhaustionRate`
- `medianFirstProviderResponse`
- `medianProviderConfirmation`

## Live WhatsApp harness gate

For a real device run (customer + provider numbers), monitor request progression:

```bash
npm run ops:whatsapp:live-harness -- --request-id=<jobRequestId> --timeout-minutes=30 --json
```

Pass criteria:
- request reaches `MATCHED`
- match includes booking + job creation
- timeline shows lead sent/response/selection/acceptance progression

## Review Providers First WhatsApp interaction matrix (final ops pass)

Confirm copy and action availability for each branch:
- candidate list ready
- shortlist add
- shortlist review
- send request to shortlist
- partial provider responses
- no responses by expiry
- customer chooses provider
- provider final accept / decline

All messages must preserve:
- no raw URLs in body text
- no snake_case values shown to users
- credit rule wording consistency (`1 credit = R50`, charge only on final selected-job acceptance)

## Phone UX verification gate

Run on both iOS and Android inside WhatsApp in-app browser:
- deep link to provider profile token page opens
- shortlist action returns to request context correctly
- “Show 3 more” keeps context and excludes prior providers
- stale/expired token states render safe fallback
- Fast Match live rotation updates appear while request is active

