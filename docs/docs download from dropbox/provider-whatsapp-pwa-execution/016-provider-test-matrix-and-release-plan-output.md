# Execution Output — 16-provider-test-matrix-and-release-plan.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/16-provider-test-matrix-and-release-plan.md`

## Objective

Create and validate the provider WhatsApp + PWA test matrix and release validation plan.

## Test matrix

| Area | Coverage | Automated coverage |
|---|---|---|
| WhatsApp onboarding | Provider starts registration, captures email/ID/services/areas/rates/evidence, submits application, receives submitted confirmation | `__tests__/lib/whatsapp-flows/registration.test.ts`, `__tests__/lib/provider-onboarding-data.test.ts` |
| Approval and credits | Admin approval, starter credits, approval WhatsApp, provider credit summary command | `__tests__/lib/provider-application-notifications.test.ts`, `__tests__/lib/provider-credit-copy.test.ts`, `__tests__/lib/provider-wallet-notifications*.test.ts`, `__tests__/lib/whatsapp-flows/provider-journey.test.ts` |
| Opportunity preview | Safe preview fields, hidden customer PII/address, preview photos, optional PWA preview link | `__tests__/lib/provider-credit-copy.test.ts`, `__tests__/lib/provider-opportunity-responses.test.ts`, `__tests__/lib/matching-dispatch.test.ts` |
| Interest response | Interested/not interested, call-out fee, ETA, negotiable flag, optional note, no credit deduction | `__tests__/lib/provider-opportunity-whatsapp.test.ts`, `__tests__/lib/provider-opportunity-responses.test.ts`, `__tests__/lib/whatsapp-bot-stateless.test.ts` |
| Customer selected and accept | Selected message, WhatsApp accept/decline, atomic one-credit deduction, job assignment, full detail WhatsApp, duplicate idempotency, insufficient-credit block | `__tests__/lib/selected-provider-acceptance.test.ts`, `__tests__/lib/customer-shortlists.test.ts`, `__tests__/lib/whatsapp-bot-stateless.test.ts` |
| Job execution | Arrival confirmation, on the way, arrived, started, completion note/photo, customer notification, duplicate suppression | `__tests__/lib/provider-whatsapp-job-commands.test.ts`, `__tests__/lib/accepted-job-actions.test.ts`, `__tests__/lib/jobs.test.ts` |
| Optional PWA | Dashboard, credits, signed handoff, old links route current state, provider lead detail privacy | `__tests__/lib/provider-pwa-dashboard.test.ts`, `__tests__/lib/provider-pwa-handoff.test.ts`, `__tests__/lib/provider-lead-access.test.ts`, `__tests__/lib/provider-lead-detail.test.ts` |
| Security/privacy | Wrong provider blocked, protected fields hidden before acceptance, full details only after accepted unlock, image auth, token scope, no localhost production copy | `__tests__/lib/provider-lead-access.test.ts`, `__tests__/lib/provider-lead-detail.test.ts`, `__tests__/api/attachments-authz.test.ts`, `__tests__/api/provider-contact-customer.test.ts`, `__tests__/lib/provider-credit-copy.test.ts` |

## Release validation plan

1. Run full automated validation.
2. Confirm provider WhatsApp end-to-end journey in staging:
   - Apply/register in WhatsApp.
   - Admin approves provider.
   - Provider checks credits in WhatsApp.
   - Provider receives safe opportunity preview.
   - Provider responds interested with fee, ETA, negotiable flag, and optional note.
   - Customer selects provider.
   - Provider accepts selected job in WhatsApp.
   - Verify exactly one credit deducted and job assigned.
   - Verify full customer details arrive in WhatsApp after acceptance.
   - Provider confirms arrival.
   - Provider marks on the way.
   - Provider marks arrived.
   - Provider starts job.
   - Provider completes job with note and photo or SKIP.
3. Confirm PWA remains optional:
   - Provider can complete core journey without PWA.
   - Signed PWA links open richer current-state screens.
   - Old opportunity links resolve accepted/current state.
4. Confirm production URL configuration:
   - `APP_PUBLIC_URL=https://app.plugapro.co.za`.
   - Provider links do not contain localhost or 127.0.0.1.
5. Confirm privacy:
   - Provider previews do not expose customer phone/email/exact address/access notes/GPS/private notes.
   - Only selected accepted provider sees full details.
   - Unauthorized image requests are denied.

## Files changed

| File | Change summary |
|---|---|
| `field-service/__tests__/lib/provider-wallet-notifications-delivery.test.ts` | Updated full-suite expectation for selected-job-only payment credited copy |
| `docs/provider-whatsapp-pwa-execution/016-provider-test-matrix-and-release-plan-output.md` | Step 16 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## Commands run

```bash
npm test -- --run
npx tsc --noEmit
npm run lint
npx prisma validate
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run` | Passed; 131 files passed, 1 skipped; 1215 tests passed, 4 todo |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |
| `npx prisma validate` | Passed; schema valid, with Prisma 7 deprecation warning for `package.json#prisma` config |

## Lint warnings

The remaining lint warnings are pre-existing and unrelated to this provider blueprint execution:

| File | Warning |
|---|---|
| `components/admin/crud/form.tsx` | `react-hooks/incompatible-library` for React Hook Form `watch()` |
| `components/shared/AttachmentThumbnail.tsx` | Unused eslint-disable for `@next/next/no-img-element` |
| `components/shared/AttachmentThumbnail.tsx` | `@next/next/no-img-element` |

## Acceptance checklist

- [x] Provider can complete core journey end to end in WhatsApp.
- [x] PWA remains optional.
- [x] Privacy rules are server-enforced.
- [x] Credit rules are server-enforced.
- [x] Full automated validation passes.
- [x] Execution index completed.

## OpenBrain note

Provider WhatsApp + PWA release validation completed. The automated matrix covers onboarding, approval/credits, opportunity preview/response, customer-selected acceptance, job execution, optional PWA handoff, and security/privacy. Full tests, typecheck, lint, and Prisma validation pass.
