# Execution Output — 05-provider-onboarding-data-capture.md

## Status

Partially completed

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/05-provider-onboarding-data-capture.md`

## Objective

Upgrade provider onboarding to capture minimum data required for trust-aware matching, reusing the existing WhatsApp onboarding state machine.

## Current-state findings

The existing WhatsApp onboarding flow already captures provider name, skills, structured/fallback service areas, experience, availability, optional evidence note, and evidence files. It did not capture provider rates, which are required for shortlist comparison cards and matching/ranking.

## Implementation completed

- Added structured provider application rate fields:
  - `callOutFee`
  - `hourlyRate`
  - `rateNegotiable`
  - `quoteAfterInspection`
  - `emergencyAvailable`
  - `sameDayJobs`
  - `weekendJobs`
- Added additive migration `field-service/prisma/migrations/20260502140500_provider_onboarding_rate_capture/migration.sql`.
- Added `field-service/lib/provider-onboarding-data.ts` for Rand amount validation and provider-facing formatting.
- Extended WhatsApp registration flow:
  - After availability selection, provider is prompted for call-out fee.
  - Fee accepts formats like `250` and `R250`.
  - Invalid fee text is rejected and re-prompted.
  - Provider chooses whether the fee is negotiable.
  - Application summary includes call-out fee and negotiable flag.
  - Submitted `ProviderApplication` stores the captured rate fields.
  - `ProviderCategory` rows are created for submitted skills.
  - `ProviderRate` rows are created for submitted skills when a call-out fee is captured.
- Added tests for provider onboarding rate validation.

This step is marked partially completed because the full blueprint target includes many additional fields not yet captured in WhatsApp: alternate mobile, email, preferred language, ID/passport, business details, profile photo, references, previous work photo classification, certifications classification, working hours, and emergency surcharge.

## Files changed

| File | Change summary |
|---|---|
| `field-service/prisma/schema.prisma` | Added provider application rate/capability fields |
| `field-service/prisma/migrations/20260502140500_provider_onboarding_rate_capture/migration.sql` | Additive provider application rate field migration |
| `field-service/lib/provider-onboarding-data.ts` | New validation/formatting helpers for provider onboarding rates |
| `field-service/lib/whatsapp-flows/types.ts` | Added `reg_collect_rates` step and rate fields to conversation data |
| `field-service/lib/whatsapp-flows/registration.ts` | Added WhatsApp call-out fee and negotiable-rate capture; persists application/category/rate records |
| `field-service/__tests__/lib/provider-onboarding-data.test.ts` | Tests for rate validation and formatting |
| `docs/codex-execution/005-provider-onboarding-data-capture-output.md` | Step 5 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 5 |

## Schema / migration changes

Added migration:

`field-service/prisma/migrations/20260502140500_provider_onboarding_rate_capture/migration.sql`

The migration is additive only and adds nullable/defaulted fields to `provider_applications`.

## API / server action changes

None.

## UI changes

None in PWA/Admin UI.

WhatsApp registration flow changed:

- Adds call-out fee prompt after availability.
- Adds negotiable fixed/yes-no prompt.
- Includes captured rate in provider application summary.

## WhatsApp/template changes

No Meta template registry changes. Interactive WhatsApp flow copy changed in `registration.ts`.

## Security and privacy impact

No customer privacy impact. Provider-entered rates are provider-supplied operational data. Evidence upload safety behavior remains unchanged: files are uploaded before application creation and linked transactionally during submission.

## Credit impact

No wallet balance or ledger behavior changed.

## Tests added or updated

Added `field-service/__tests__/lib/provider-onboarding-data.test.ts`.

## Commands run

```bash
npx prisma generate
npx prisma validate
npm test -- --run __tests__/lib/provider-onboarding-data.test.ts
npx tsc --noEmit
npm run lint
npm test -- --run __tests__/lib/provider-onboarding-data.test.ts __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts
```

## Test results

- `npx prisma generate`: passed with Prisma package.json config deprecation warning.
- `npx prisma validate`: passed with Prisma package.json config deprecation warning.
- `npm test -- --run __tests__/lib/provider-onboarding-data.test.ts`: passed, 1 file, 3 tests.
- `npx tsc --noEmit`: passed after fixing a nullable rate value.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.
- `npm test -- --run __tests__/lib/provider-onboarding-data.test.ts __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts`: passed, 3 files, 18 tests.

## Manual verification checklist

- [x] Provider onboarding remains WhatsApp-first.
- [x] Rate capture added after availability.
- [x] Invalid fee input is rejected.
- [x] Application stores captured fee and negotiable flag.
- [x] Provider category/rate foundation records are populated on submission.
- [ ] Full target personal details captured.
- [ ] Full target business profile captured.
- [ ] Profile photo and classified previous-work photos captured.
- [ ] References captured.
- [ ] Certification/ID document fields classified and enforced.

## Risks and follow-ups

This is intentionally a minimal behavioral change to avoid making the WhatsApp onboarding flow too long in one step. Follow-up work must add trust evidence classification and references, likely with a staged approach between WhatsApp and Worker Portal profile completion.

## OpenBrain note

Provider onboarding data capture upgraded with a narrow shortlist-critical field: provider call-out fee and negotiable flag. The existing WhatsApp registration flow now captures and validates rate input, stores it on `ProviderApplication`, and seeds `ProviderRate` rows for selected skill categories. Larger trust/KYC/profile fields remain follow-up work to avoid an oversized WhatsApp intake change.
