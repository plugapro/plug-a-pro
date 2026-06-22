# Plug A Pro Provider WhatsApp + PWA Execution Index

## Execution started

2026-05-02 SAST

## Current status

completed

## Blueprint directory

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint`

## Execution table

| Step | Blueprint | Output report | Status | Summary |
|---:|---|---|---|---|
| 1 | `01-provider-as-is-assessment.md` | `docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md` | Completed | Existing provider WhatsApp commands, PWA routes, webhook handlers, APIs, credits, job status flows, signed token model, privacy boundaries, and WhatsApp-complete gaps documented. |
| 2 | `02-provider-channel-responsibility-model.md` | `docs/provider-whatsapp-pwa-execution/002-provider-channel-responsibility-model-output.md` | Completed | Shared provider channel responsibility model added with tests enforcing WhatsApp-primary ownership for core provider actions and explicit blockers for current PWA-heavy gaps. |
| 3 | `03-provider-whatsapp-command-and-state-machine.md` | `docs/provider-whatsapp-pwa-execution/003-provider-whatsapp-command-and-state-machine-output.md` | Completed | Canonical provider text command model added, provider commands routed into existing provider journey, menu rows aligned, and command/state tests added. |
| 4 | `04-provider-onboarding-whatsapp-first-flow.md` | `docs/provider-whatsapp-pwa-execution/004-provider-onboarding-whatsapp-first-flow-output.md` | Completed | WhatsApp onboarding now captures optional email, required ID/passport, persists review data into existing provider/application fields, and validates required data before submission. |
| 5 | `05-provider-optional-pwa-profile-and-dashboard-flow.md` | `docs/provider-whatsapp-pwa-execution/005-provider-optional-pwa-profile-and-dashboard-flow-output.md` | Completed | Existing `/provider` dashboard aligned as optional richer workspace with opportunity, selected-pending, active/completed job, credit, and profile completeness signals. |
| 6 | `06-provider-opportunity-preview-whatsapp-flow.md` | `docs/provider-whatsapp-pwa-execution/006-provider-opportunity-preview-whatsapp-flow-output.md` | Completed | WhatsApp opportunity preview copy expanded with safe structured fields, photo count, optional preview URL, and selected-job-only credit wording. |
| 7 | `07-provider-interest-rate-response-whatsapp-flow.md` | `docs/provider-whatsapp-pwa-execution/007-provider-interest-rate-response-whatsapp-flow-output.md` | Completed | WhatsApp multi-step interested response capture added for fee, ETA, negotiable flag, optional note, and no-credit confirmation. |
| 8 | `08-provider-customer-selected-and-acceptance-whatsapp-flow.md` | `docs/provider-whatsapp-pwa-execution/008-provider-customer-selected-and-acceptance-whatsapp-flow-output.md` | Completed | Selected-provider WhatsApp acceptance verified; duplicate accept now sends clear no-extra-credit message while atomic credit/job assignment remains canonical. |
| 9 | `09-provider-credit-balance-and-ledger-flow.md` | `docs/provider-whatsapp-pwa-execution/009-provider-credit-balance-and-ledger-flow-output.md` | Completed | WhatsApp credit summary aligned with available/starter/purchased balances, credit-history aliases added, existing PWA credit history retained, and ledger-first wallet model documented. |
| 10 | `10-provider-full-job-details-and-privacy-unlock-flow.md` | `docs/provider-whatsapp-pwa-execution/010-provider-full-job-details-and-privacy-unlock-flow-output.md` | Completed | Accepted-job WhatsApp full details expanded with customer, address, access, job reference, preferred time, description, photo availability, and arrival prompt while PWA details remain server-gated. |
| 11 | `11-provider-arrival-and-job-execution-whatsapp-flow.md` | `docs/provider-whatsapp-pwa-execution/011-provider-arrival-and-job-execution-whatsapp-flow-output.md` | Completed | Direct WhatsApp job commands now support bare arrival times, confirm-arrival syntax, customer notification, duplicate suppression, and blueprint status copy. |
| 12 | `12-provider-completion-photos-notes-and-history-flow.md` | `docs/provider-whatsapp-pwa-execution/012-provider-completion-photos-notes-and-history-flow-output.md` | Completed | WhatsApp completion now captures note, asks for photo-or-skip, stores completion data, links uploaded photo, and reuses job transition customer notification. |
| 13 | `13-provider-pwa-routes-and-handoff-flow.md` | `docs/provider-whatsapp-pwa-execution/013-provider-pwa-routes-and-handoff-flow-output.md` | Completed | State-aware provider handoff resolver and secure alias routes added; old signed opportunity/job links resolve through canonical current-state PWA screens. |
| 14 | `14-provider-security-token-and-access-rules.md` | `docs/provider-whatsapp-pwa-execution/014-provider-security-token-and-access-rules-output.md` | Completed | Provider token/access rules hardened with safe-preview attachment filtering, provider-owned unlock gating, and trace IDs for denied contact handoff. |
| 15 | `15-provider-notifications-copy-and-url-rules.md` | `docs/provider-whatsapp-pwa-execution/015-provider-notifications-copy-and-url-rules-output.md` | Completed | Provider approval, wallet, top-up, and credits PWA copy aligned with WhatsApp-complete and selected-job-only credit rules; production URL regression added. |
| 16 | `16-provider-test-matrix-and-release-plan.md` | `docs/provider-whatsapp-pwa-execution/016-provider-test-matrix-and-release-plan-output.md` | Completed | Provider test matrix and release validation plan documented; full tests, typecheck, lint, and Prisma validation passed. |

## Global files changed

| File | Reason |
|---|---|
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Provider WhatsApp + PWA execution index |
| `docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md` | Step 1 required execution output |
| `field-service/lib/provider-channel-responsibility.ts` | Step 2 shared provider WhatsApp-first/PWA-optional channel model |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Step 2 channel model assertions |
| `docs/provider-whatsapp-pwa-execution/002-provider-channel-responsibility-model-output.md` | Step 2 required execution output |
| `field-service/lib/provider-whatsapp-command-model.ts` | Step 3 canonical provider WhatsApp command/state model |
| `field-service/lib/whatsapp-bot.ts` | Step 3 provider text command routing |
| `field-service/lib/whatsapp-flows/provider-journey.ts` | Step 3 provider menu labels and credit copy |
| `field-service/__tests__/lib/provider-whatsapp-command-model.test.ts` | Step 3 command routing/state tests |
| `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` | Step 3 provider menu assertions |
| `docs/provider-whatsapp-pwa-execution/003-provider-whatsapp-command-and-state-machine-output.md` | Step 3 required execution output |
| `field-service/lib/whatsapp-flows/types.ts` | Step 4 provider onboarding email and ID/passport state data |
| `field-service/lib/provider-record.ts` | Step 4 provider email sync |
| `field-service/lib/whatsapp-flows/registration.ts` | Step 4 WhatsApp onboarding capture and validation |
| `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` | Step 4 onboarding tests |
| `docs/provider-whatsapp-pwa-execution/004-provider-onboarding-whatsapp-first-flow-output.md` | Step 4 required execution output |
| `field-service/lib/provider-pwa-dashboard.ts` | Step 5 provider dashboard/profile completeness helper |
| `field-service/__tests__/lib/provider-pwa-dashboard.test.ts` | Step 5 dashboard helper tests |
| `field-service/app/(provider)/provider/page.tsx` | Step 5 provider dashboard counts and profile completeness |
| `docs/provider-whatsapp-pwa-execution/005-provider-optional-pwa-profile-and-dashboard-flow-output.md` | Step 5 required execution output |
| `field-service/lib/provider-credit-copy.ts` | Step 6 safe opportunity preview copy |
| `field-service/lib/matching/types.ts` | Step 6 optional matching safe preview fields |
| `field-service/lib/matching/dispatch.ts` | Step 6 structured safe preview dispatch copy |
| `field-service/lib/whatsapp-bot.ts` | Step 6 provider new-job safe preview rendering |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | Step 6 safe preview copy tests |
| `docs/provider-whatsapp-pwa-execution/006-provider-opportunity-preview-whatsapp-flow-output.md` | Step 6 required execution output |
| `field-service/lib/provider-opportunity-whatsapp.ts` | Step 7 WhatsApp opportunity response helper |
| `field-service/__tests__/lib/provider-opportunity-whatsapp.test.ts` | Step 7 arrival parsing tests |
| `field-service/lib/whatsapp-flows/types.ts` | Step 7 pending opportunity response conversation data |
| `field-service/lib/whatsapp-bot.ts` | Step 7 multi-step interested response capture |
| `docs/provider-whatsapp-pwa-execution/007-provider-interest-rate-response-whatsapp-flow-output.md` | Step 7 required execution output |
| `field-service/lib/whatsapp-bot.ts` | Step 8 duplicate selected-job accept WhatsApp copy |
| `docs/provider-whatsapp-pwa-execution/008-provider-customer-selected-and-acceptance-whatsapp-flow-output.md` | Step 8 required execution output |
| `field-service/lib/provider-credit-copy.ts` | Step 9 WhatsApp credit summary copy |
| `field-service/lib/whatsapp-flows/provider-journey.ts` | Step 9 provider credit/status summary output |
| `field-service/lib/provider-whatsapp-command-model.ts` | Step 9 credit-history command aliases |
| `field-service/lib/provider-whatsapp-job-commands.ts` | Step 9 typecheck narrowing fix for job command aliases |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | Step 9 credit summary copy tests |
| `field-service/__tests__/lib/provider-whatsapp-command-model.test.ts` | Step 9 command routing tests |
| `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` | Step 9 provider credit/status WhatsApp tests |
| `docs/provider-whatsapp-pwa-execution/009-provider-credit-balance-and-ledger-flow-output.md` | Step 9 required execution output |
| `field-service/lib/selected-provider-acceptance.ts` | Step 10 full customer/job detail WhatsApp payload |
| `field-service/lib/provider-channel-responsibility.ts` | Step 10 full-detail channel status |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Step 10 selected acceptance notification tests |
| `field-service/__tests__/lib/provider-lead-detail.test.ts` | Step 10 PWA full-detail privacy tests |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Step 10 channel responsibility tests |
| `docs/provider-whatsapp-pwa-execution/010-provider-full-job-details-and-privacy-unlock-flow-output.md` | Step 10 required execution output |
| `field-service/lib/provider-whatsapp-job-commands.ts` | Step 11 arrival/job execution WhatsApp command handling |
| `field-service/lib/provider-channel-responsibility.ts` | Step 11 arrival channel status |
| `field-service/__tests__/lib/provider-whatsapp-job-commands.test.ts` | Step 11 provider job command tests |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Step 11 arrival channel assertion |
| `docs/provider-whatsapp-pwa-execution/011-provider-arrival-and-job-execution-whatsapp-flow-output.md` | Step 11 required execution output |
| `field-service/lib/whatsapp-bot.ts` | Step 12 provider completion note/photo capture |
| `field-service/lib/provider-whatsapp-job-commands.ts` | Step 12 completion finalization helper |
| `field-service/lib/whatsapp-flows/types.ts` | Step 12 completion conversation state |
| `field-service/lib/provider-channel-responsibility.ts` | Step 12 completion channel status |
| `field-service/__tests__/lib/provider-whatsapp-job-commands.test.ts` | Step 12 completion command tests |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Step 12 completion channel assertion |
| `docs/provider-whatsapp-pwa-execution/012-provider-completion-photos-notes-and-history-flow-output.md` | Step 12 required execution output |
| `field-service/lib/provider-pwa-handoff.ts` | Step 13 provider PWA handoff resolver |
| `field-service/app/provider/handoff/[token]/page.tsx` | Step 13 secure generic handoff route |
| `field-service/app/provider/lead/[token]/page.tsx` | Step 13 secure lead handoff alias |
| `field-service/app/provider/job/[token]/page.tsx` | Step 13 secure job handoff alias |
| `field-service/app/provider/jobs/[jobId]/handover/page.tsx` | Step 13 resolver-backed job handoff redirect |
| `field-service/__tests__/lib/provider-pwa-handoff.test.ts` | Step 13 handoff resolver tests |
| `docs/provider-whatsapp-pwa-execution/013-provider-pwa-routes-and-handoff-flow-output.md` | Step 13 required execution output |
| `field-service/lib/provider-lead-access.ts` | Step 14 signed provider lead access hardening |
| `field-service/app/api/provider/leads/[leadId]/contact-customer/route.ts` | Step 14 denied contact handoff trace IDs |
| `field-service/__tests__/lib/provider-lead-access.test.ts` | Step 14 safe-preview and unlock ownership tests |
| `field-service/__tests__/api/provider-contact-customer.test.ts` | Step 14 denied contact handoff test |
| `docs/provider-whatsapp-pwa-execution/014-provider-security-token-and-access-rules-output.md` | Step 14 required execution output |
| `field-service/lib/provider-application-notifications.ts` | Step 15 provider approval copy |
| `field-service/lib/provider-wallet-notifications.ts` | Step 15 provider wallet/top-up copy |
| `field-service/app/(provider)/provider/credits/page.tsx` | Step 15 provider credits PWA copy |
| `field-service/__tests__/lib/provider-application-notifications.test.ts` | Step 15 approval copy tests |
| `field-service/__tests__/lib/provider-wallet-notifications.test.ts` | Step 15 wallet copy and URL tests |
| `docs/provider-whatsapp-pwa-execution/015-provider-notifications-copy-and-url-rules-output.md` | Step 15 required execution output |
| `field-service/__tests__/lib/provider-wallet-notifications-delivery.test.ts` | Step 16 full-suite expectation updated for selected-job-only payment credited copy |
| `docs/provider-whatsapp-pwa-execution/016-provider-test-matrix-and-release-plan-output.md` | Step 16 required execution output |

## Global tests run

| Command | Result |
|---|---|
| Not run | Step 1 documentation-only assessment |
| `npm test -- --run __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 1 file, 3 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts` | Passed; 2 files, 33 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/whatsapp-flows/registration.test.ts __tests__/lib/provider-onboarding-data.test.ts` | Passed; 2 files, 58 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-pwa-dashboard.test.ts __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 2 files, 5 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts` | Passed; 2 files, 33 tests |
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/matching-dispatch.test.ts` | Passed; 3 files, 35 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/whatsapp-bot-stateless.test.ts` | Passed; 2 files, 27 tests |
| `npm test -- --run __tests__/lib/provider-opportunity-whatsapp.test.ts __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/whatsapp-bot-stateless.test.ts` | Passed; 3 files, 29 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/customer-shortlists.test.ts __tests__/lib/whatsapp-bot-stateless.test.ts` | Passed; 3 files, 34 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts` | Passed; 3 files, 58 tests |
| `npx tsc --noEmit` | Passed after TypeScript-only narrowing fix in `provider-whatsapp-job-commands.ts` |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 3 files, 13 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-whatsapp-job-commands.test.ts __tests__/lib/provider-channel-responsibility.test.ts __tests__/lib/provider-whatsapp-command-model.test.ts` | Passed; 3 files, 23 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-whatsapp-job-commands.test.ts __tests__/lib/provider-channel-responsibility.test.ts __tests__/lib/whatsapp-bot-stateless.test.ts` | Passed; 3 files, 38 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-pwa-handoff.test.ts __tests__/lib/provider-lead-access.test.ts __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 2 files, 18 tests |
| `rm -rf .next .eslintcache && npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-lead-access.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/api/attachments-authz.test.ts __tests__/api/provider-contact-customer.test.ts __tests__/lib/provider-whatsapp-job-commands.test.ts` | Passed; 5 files, 55 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run __tests__/lib/provider-wallet-notifications.test.ts __tests__/lib/provider-application-notifications.test.ts __tests__/lib/provider-credit-copy.test.ts` | Passed; 3 files, 42 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npm test -- --run` | Passed; 131 files passed, 1 skipped; 1215 tests passed, 4 todo |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 existing unrelated warnings |
| `npx prisma validate` | Passed; schema valid, with Prisma 7 deprecation warning for `package.json#prisma` config |

## Current blockers / decisions needed

- None.

## Current recommendation

Provider WhatsApp + PWA blueprint execution is complete through Step 16.
