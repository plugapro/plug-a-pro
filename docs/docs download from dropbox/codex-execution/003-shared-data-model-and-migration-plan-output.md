# Execution Output — 03-shared-data-model-and-migration-plan.md

## Status

Completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/03-shared-data-model-and-migration-plan.md`

## Objective

Design and implement the shared data-model foundation needed for provider onboarding, client requests, matching, shortlist, provider acceptance, and credits while reusing existing schema wherever practical.

## Current-state findings

Existing equivalents already cover providers, provider applications, provider service areas, provider availability, customers, customer addresses, service requests, request attachments, lead invites, jobs, credit balances, credit ledger, activity logs, and notifications.

Missing or incomplete target equivalents were provider category approval rows, provider rate rows, provider lead responses, provider shortlists, shortlist items, explicit request metadata, selected provider/invite references, and final-acceptance-friendly job reference fields.

## Implementation completed

- Extended `JobRequest` with nullable/defaulted request metadata:
  - `requestRef`
  - `source`
  - `subcategory`
  - `urgency`
  - `budgetPreference`
  - `maxCallOutFee`
  - `providerPreference`
  - `verifiedOnly`
  - `riskLevel`
  - `certifiedProviderRequired`
  - `submittedAt`
  - `selectedProviderId`
  - `selectedLeadInviteId`
- Extended `Lead` with shortlist/invite metadata:
  - `safePreviewToken`
  - `matchScore`
  - `rankingPosition`
  - `viewedAt`
  - `customerSelectedAt`
  - `providerAcceptedAt`
  - `expiredAt`
  - `cancelledAt`
- Extended `Job` with selected invite/reference fields:
  - `jobRef`
  - `selectedLeadInviteId`
  - `assignedAt`
  - `scheduledArrivalAt`
  - `arrivalTimeConfirmedAt`
- Added new models:
  - `ProviderCategory`
  - `ProviderRate`
  - `ProviderLeadResponse`
  - `ProviderShortlist`
  - `ProviderShortlistItem`
- Added additive migration `field-service/prisma/migrations/20260502133500_qualified_shortlist_foundation/migration.sql`.
- Added dry-run remediation inventory script `field-service/scripts/qualified-shortlist-foundation-dry-run.ts`.
- Added schema-foundation test to assert the shortlist tables exist and the migration has no destructive SQL.

## Files changed

| File | Change summary |
|---|---|
| `field-service/prisma/schema.prisma` | Added shortlist foundation fields, relations, and models |
| `field-service/prisma/migrations/20260502133500_qualified_shortlist_foundation/migration.sql` | Additive migration for request metadata, lead invite metadata, provider response, provider shortlist, category/rate foundations |
| `field-service/scripts/qualified-shortlist-foundation-dry-run.ts` | Dry-run inventory and remediation planning script |
| `field-service/__tests__/lib/qualified-shortlist-schema-foundation.test.ts` | Schema/migration safety test |
| `docs/codex-execution/003-shared-data-model-and-migration-plan-output.md` | Step 3 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 3 |

## Schema / migration changes

Additive only. No `DROP`, `DELETE`, or `TRUNCATE` operations were added.

Migration added:

`field-service/prisma/migrations/20260502133500_qualified_shortlist_foundation/migration.sql`

New tables:

- `provider_categories`
- `provider_rates`
- `provider_lead_responses`
- `provider_shortlists`
- `provider_shortlist_items`

New nullable/defaulted columns were added to `job_requests`, `leads`, and `jobs`.

## API / server action changes

None.

## UI changes

None.

## WhatsApp/template changes

None.

## Security and privacy impact

Positive foundation only. The new schema separates provider responses and shortlist items from customer private data. It does not expose any new customer contact/address fields. Existing privacy enforcement remains unchanged.

## Credit impact

No wallet or ledger behavior changed. Existing `ProviderWallet` and `WalletLedgerEntry` remain the accounting source of truth.

## Tests added or updated

Added `field-service/__tests__/lib/qualified-shortlist-schema-foundation.test.ts`.

## Commands run

```bash
find prisma/migrations -maxdepth 2 -type f | sort | tail -40
ls -la prisma/migrations | tail -20
sed -n '1,220p' prisma/seed.ts
npx prisma validate
npm test -- --run __tests__/lib/qualified-shortlist-schema-foundation.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npx prisma validate`: passed with Prisma package.json config deprecation warning.
- `npm test -- --run __tests__/lib/qualified-shortlist-schema-foundation.test.ts`: passed, 1 file, 1 test.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Schema supports provider response capture.
- [x] Schema supports customer shortlists and shortlist items.
- [x] Lead invite and job remain distinct.
- [x] Credit ledger remains unchanged and ledger-first.
- [x] Customer address fields remain separate from preview/shortlist data.
- [x] Additive migration avoids destructive operations.
- [x] Dry-run remediation script created for existing data inventory.

## Risks and follow-ups

Backfills are intentionally not applied in this step. Later implementation should backfill `requestRef`, lead match score/ranking from `MatchAttempt`, and provider category rows from existing provider skills only after the feature flow is ready to consume them.

## OpenBrain note

Qualified Shortlist shared data-model foundation added using existing schema as the anchor. The implementation adds nullable request metadata, selected provider/invite references, provider response rows, shortlist rows/items, and provider category/rate foundations. Wallet and ledger tables were intentionally left unchanged because they already satisfy the ledger-first credit model. Migration is additive and does not rewrite historical paid lead unlock data.
