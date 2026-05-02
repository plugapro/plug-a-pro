# Execution Output — 04-provider-onboarding-whatsapp-first-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/04-provider-onboarding-whatsapp-first-flow.md`

## Objective

Align provider onboarding so a provider can complete the application in WhatsApp, with required structured details captured before submission and PWA remaining optional.

## Current-state findings

The existing WhatsApp registration flow already supported application intro, full name, service categories, structured work areas/suburbs, experience, availability, call-out fee, negotiable flag, optional proof note, optional media/document uploads, summary confirmation, duplicate prevention, application submission, admin notification, and submitted confirmation.

Missing or weak areas for this step were email capture, ID/passport capture, submit-time validation for ID/passport, and persistence of email/ID into existing fields without adding a migration.

## Implementation completed

- Added optional email capture after full-name capture.
- Added required ID/passport capture before service-category selection.
- Added submit-time validation so an application cannot be submitted without an ID/passport value.
- Persisted provider email into the pending `Provider` record through `syncProviderRecord`.
- Persisted ID/passport into existing `ProviderApplication.idNumber`.
- Kept the ID/passport out of logs and user-facing summaries; summaries show only `Provided`/`Missing`.
- Added provider type to the WhatsApp summary as `Independent service provider`.
- Added derived `yearsExperience` and `skillLevel` values to `ProviderCategory` rows from the captured experience label.
- Updated onboarding tests for email/ID capture and persistence.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/whatsapp-flows/types.ts` | Registration steps/data extended for provider email and ID/passport |
| `field-service/lib/provider-record.ts` | Pending provider record sync now accepts/persists email |
| `field-service/lib/whatsapp-flows/registration.ts` | WhatsApp onboarding email and ID/passport capture, validation, summary, persistence |
| `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` | Tests updated/added for email and ID/passport onboarding |
| `docs/provider-whatsapp-pwa-execution/004-provider-onboarding-whatsapp-first-flow-output.md` | Step 4 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

Provider WhatsApp application now captures:

- full name
- optional email
- ID/passport for review
- service categories
- structured work areas/suburbs
- years of experience
- availability
- call-out fee
- negotiable flag
- optional proof note
- optional photos/documents
- terms/credit acknowledgement through the existing intro and submit confirmation

The flow still supports pause/continue through the existing conversation persistence and timeout resume behavior.

## PWA route/screen changes

None. PWA application/profile screens remain optional.

## API/server changes

No API route changes. Server-side registration submission now validates `providerIdNumber`, passes `providerEmail` into provider sync, stores `ProviderApplication.idNumber`, and populates structured category review rows with derived experience/skill-level values.

## Credit impact

No credit mutations changed. Onboarding intro/submission copy continues to state that starter credits are granted after approval and one credit is spent only when a customer-selected job is accepted.

## Security/privacy impact

ID/passport is captured for provider review and stored in the existing `ProviderApplication.idNumber` field. The raw value is not included in logs or the WhatsApp application summary.

## Tests added or updated

- Updated `field-service/__tests__/lib/whatsapp-flows/registration.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/whatsapp-flows/registration.test.ts __tests__/lib/provider-onboarding-data.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/whatsapp-flows/registration.test.ts __tests__/lib/provider-onboarding-data.test.ts` | Passed; 2 files, 58 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Provider can start application in WhatsApp.
- [x] Provider can submit full name.
- [x] Provider can submit or skip email.
- [x] Provider must submit ID/passport before service selection.
- [x] Provider can select service categories and work areas/suburbs.
- [x] Provider can submit availability, call-out fee, and negotiable flag.
- [x] Provider can upload optional evidence media/documents.
- [x] Application is not submitted when required fields are missing.
- [x] Application submitted confirmation is preserved.
- [x] PWA is not required for application submission.

## Risks and follow-ups

- Email is persisted on the pending `Provider` record; `ProviderApplication` has no email column. Avoid adding a migration unless the admin review UI specifically needs application-level email history.
- Sub-services and references are still captured only indirectly through selected category and optional proof note/media. Deeper structured capture can be added later without blocking WhatsApp-first submission.
- Profile photo versus previous-work photos are still represented as generic evidence attachments; later profile/dashboard work can classify attachments for display.

## OpenBrain note

Provider onboarding WhatsApp-first flow aligned. The existing registration flow remains canonical and now captures optional email plus required ID/passport before submission, stores data in existing provider/application fields, validates required review data server-side, and keeps PWA optional for provider application completion.
