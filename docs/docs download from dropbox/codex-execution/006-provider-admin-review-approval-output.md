# Execution Output — 06-provider-admin-review-approval.md

## Status

Partially completed

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/06-provider-admin-review-approval.md`

## Objective

Upgrade admin review so provider approval has clear meaning and registered providers do not receive leads until reviewed and approved.

## Current-state findings

Admin already supports provider application listing, claim/release, approve, reject, duplicate active application detection, provider record sync, Worker Portal auth user creation/linking, starter credit award through wallet ledger, queue release, and approval/rejection WhatsApp notification.

Missing capabilities included request-more-info, category-specific approval semantics, verification/trust levels, document review UI, reference review, and richer review fields.

## Implementation completed

- Added `MORE_INFO_REQUIRED` to `ApplicationStatus`.
- Added additive migration `field-service/prisma/migrations/20260502143000_provider_application_more_info_and_category_approval/migration.sql`.
- Updated active application identity helpers so `MORE_INFO_REQUIRED` applications still reserve the provider phone number and block duplicate active applications.
- Added admin `requestMoreInfo` server action on `/admin/applications`.
- Added More info form/action to pending application cards.
- More-info action:
  - Validates admin reason.
  - Sets application status to `MORE_INFO_REQUIRED`.
  - Stores notes, reviewed timestamp, and reviewer ID.
  - Releases onboarding queue claim.
  - Sends WhatsApp message explaining that more information is needed and the provider is not approved for leads.
- Updated approval action to allow `PENDING` or `MORE_INFO_REQUIRED` applications.
- Updated approval action to create/update `ProviderCategory` rows for submitted skills and mark them `APPROVED`.
- Updated tests for active provider application identity behavior.

This step is partially completed because full category-by-category admin UI, verification/trust level controls, reference review, and document/photo review UI are still follow-up work.

## Files changed

| File | Change summary |
|---|---|
| `field-service/prisma/schema.prisma` | Added `ApplicationStatus.MORE_INFO_REQUIRED` |
| `field-service/prisma/migrations/20260502143000_provider_application_more_info_and_category_approval/migration.sql` | Additive enum migration |
| `field-service/lib/provider-applications.ts` | Treat more-info applications as active for duplicate phone checks |
| `field-service/lib/provider-record.ts` | Updated provider application status type compatibility |
| `field-service/app/(admin)/admin/applications/page.tsx` | Added request-more-info action/UI and category approval side effect |
| `field-service/__tests__/lib/provider-applications.test.ts` | Updated duplicate active application tests for more-info status |
| `docs/codex-execution/006-provider-admin-review-approval-output.md` | Step 6 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 6 |

## Schema / migration changes

Added enum value:

```sql
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'MORE_INFO_REQUIRED';
```

## API / server action changes

Added `requestMoreInfo` server action in `field-service/app/(admin)/admin/applications/page.tsx`.

Updated `approveApplication` to approve provider category rows for submitted skills.

## UI changes

Admin application cards now include a required “Info needed” field and `More info` action.

## WhatsApp/template changes

No Meta template registry changes. Added interactive WhatsApp copy for `interactive:provider_more_info_required`.

## Security and privacy impact

Positive. Providers in `MORE_INFO_REQUIRED` remain unapproved and cannot receive leads. The status also blocks duplicate applications for the same phone number.

## Credit impact

Starter credit award remains ledger-first through `awardMobileVerifiedPromoCreditsInTransaction`. Approval still awards starter credits through the existing transaction path. More-info does not award credits.

## Tests added or updated

Updated `field-service/__tests__/lib/provider-applications.test.ts`.

## Commands run

```bash
npx prisma generate
npx prisma validate
npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/admin/provider-credit-payments-actions.test.ts
npx tsc --noEmit
npm run lint
npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts
```

## Test results

- `npx prisma generate`: passed with Prisma package.json config deprecation warning.
- `npx prisma validate`: passed with Prisma package.json config deprecation warning.
- `npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/admin/provider-credit-payments-actions.test.ts`: passed, 2 files, 12 tests.
- `npx tsc --noEmit`: passed after updating provider record status typing.
- `npm run lint`: passed with 3 unrelated existing warnings.
- `npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts`: passed, 2 files, 15 tests.

## Manual verification checklist

- [x] Admin can approve provider applications.
- [x] Admin can reject provider applications.
- [x] Admin can request more information.
- [x] Approved provider categories are marked approved in the new category foundation.
- [x] Starter credits still use ledger-first promo award path.
- [x] More-info providers remain unapproved for leads.
- [x] Category-specific approve/reject UI per category.
- [ ] Verification/trust level admin controls.
- [ ] Document/photo/reference review UI.

## Alignment status

- Step 6 alignment remains partial: trust verification controls and full document/photo/reference review UX remain follow-ups.

## Risks and follow-ups

`MORE_INFO_REQUIRED` is now a real persisted status, but there is not yet a provider reply flow that turns a more-info application back into `PENDING`. Admins can still approve the application after status remediation, but the follow-up intake workflow should be completed.

## OpenBrain note

Provider admin review upgraded with a non-destructive more-info status/action and category approval side effect. Approval remains transactional with provider record sync and starter credits through the existing wallet ledger path. Category-specific UI and trust/KYC controls remain follow-up work.
