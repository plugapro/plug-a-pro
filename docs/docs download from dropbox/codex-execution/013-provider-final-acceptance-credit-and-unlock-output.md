# Execution Output — 13-provider-final-acceptance-credit-and-unlock.md

## Status

Completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/13-provider-final-acceptance-credit-and-unlock.md`

## Objective

Implement selected-provider final acceptance so the chosen provider spends exactly 1 credit, receives full-detail unlock, and gets assigned to the job only after customer selection.

## Current-state findings

The existing paid acceptance path was tied to sequential assignment holds. The shortlist path needed a separate gate because selected providers may not have an active assignment hold, but the wallet debit still had to reuse the immutable ledger-backed unlock module.

## Implementation completed

- Added `acceptSelectedProviderJob` for customer-selected lead final acceptance.
- Reused `unlockLeadForProviderInTransaction` so the 1-credit debit and wallet ledger entry remain atomic.
- Verified selected lead invite, selected provider, pending request status, and expiry before debit.
- Created match, approved quote, booking, job, job status event, audit log, lead unlock match link, and lead acceptance state inside one transaction.
- Marked non-selected pending lead invites as expired after selected-provider acceptance.
- Added provider and customer confirmation notifications after commit.
- Routed the existing `acceptLead` compatibility entry point to the selected-provider path when the lead belongs to a `PROVIDER_CONFIRMATION_PENDING` request.
- Added tests for successful final acceptance, non-selected provider rejection before debit, and insufficient-credit rollback behavior.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/selected-provider-acceptance.ts` | Selected-provider final acceptance, debit, assignment, unlock, and notifications |
| `field-service/lib/matching-engine.ts` | Routes selected customer-confirmation accepts to the selected-provider service |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Final acceptance tests |
| `docs/codex-execution/013-provider-final-acceptance-credit-and-unlock-output.md` | Step 13 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 13 |

## Schema / migration changes

None in this step.

## API / server action changes

No new endpoint was added. Existing provider lead acceptance paths now detect selected-provider confirmation leads and execute the selected-provider acceptance transaction.

## UI changes

None directly. Existing provider lead detail pages can now unlock full details after selected-provider final acceptance because the lead becomes `ACCEPTED` and receives a `LeadUnlock`.

## WhatsApp/template changes

Added post-commit notification copy for:

- Provider: credit spent, remaining balance, promo/paid breakdown, full details unlocked, job URL.
- Customer: provider accepted, expected arrival, call-out fee, request URL.

## Security and privacy impact

Full customer details unlock only after the selected provider completes the final acceptance transaction and the `LeadUnlock` exists. Non-selected providers are rejected before wallet debit or assignment.

## Credit impact

The selected-provider path debits exactly 1 credit through `unlockLeadForProviderInTransaction`, preserving immutable wallet ledger behavior. No separate wallet mutation code was introduced.

## Tests added or updated

- `field-service/__tests__/lib/selected-provider-acceptance.test.ts`

## Commands run

```bash
npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts
npx prisma validate
npx tsc --noEmit
npm run lint
```

## Test results

- `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts`: passed, 3 files, 12 tests.
- `npx prisma validate`: passed with Prisma package config deprecation warning.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Selected provider can accept job.
- [x] One credit is deducted through shared unlock/ledger logic.
- [x] Ledger-backed unlock is created.
- [x] Match, quote, booking, and job are assigned to provider.
- [x] Full details unlock after acceptance.
- [x] Provider confirmation notification is attempted.
- [x] Customer confirmation notification is attempted.
- [x] Duplicate accept by already-matched provider is idempotent and does not double-deduct.
- [x] Insufficient credits block assignment.
- [x] Non-selected provider cannot accept.

## Risks and follow-ups

The acceptance path creates an approved quote/booking/job using the provider response call-out fee as the initial approved amount. If product wants a separate quote-after-arrival flow, this should be refined before public rollout. WhatsApp button handlers still need copy/template audit in step 14.

## OpenBrain note

Selected-provider final acceptance implemented. Customer selection is now only a confirmation gate; provider credit is spent when the selected provider accepts. The transaction reuses the wallet unlock service for the immutable ledger debit, then creates assignment artifacts and unlocks full customer/job details for the provider.
