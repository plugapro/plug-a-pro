# Plug A Pro Codex Execution Index

## Execution started

2026-05-02 13:27:54 SAST

## Current status

completed

## Blueprint directory

`Plug A Pro/plugapro_codex_blueprint`

## Execution table

| Step | Blueprint | Output report | Status | Summary |
|---:|---|---|---|---|
| 1 | `01-as-is-assessment.md` | `docs/codex-execution/001-as-is-assessment-output.md` | Completed | Current implementation assessed; major gap is current sequential paid lead acceptance versus target shortlist-selected final acceptance. |
| 2 | `02-product-decisions-and-state-machines.md` | `docs/codex-execution/002-product-decisions-and-state-machines-output.md` | Completed with warnings | Added state mapping/guard helper module, tests, and state-machine documentation; lint passed with unrelated existing warnings. |
| 3 | `03-shared-data-model-and-migration-plan.md` | `docs/codex-execution/003-shared-data-model-and-migration-plan-output.md` | Completed with warnings | Added additive Prisma shortlist foundation schema, migration, dry-run script, and schema safety test. |
| 4 | `04-provider-onboarding-as-is-and-gap.md` | `docs/codex-execution/004-provider-onboarding-as-is-and-gap-output.md` | Completed | Provider onboarding gap report written; current WhatsApp/admin flow is reusable but lacks rates, references, structured evidence, category approval, and more-info workflow. |
| 5 | `05-provider-onboarding-data-capture.md` | `docs/codex-execution/005-provider-onboarding-data-capture-output.md` | Partially completed | Added WhatsApp call-out fee/negotiable rate capture, provider application rate fields, provider category/rate persistence, and validation tests; broader trust/profile fields remain follow-up. |
| 6 | `06-provider-admin-review-approval.md` | `docs/codex-execution/006-provider-admin-review-approval-output.md` | Partially completed | Added more-info application status/action, duplicate phone handling, category approval side effect, and tests; full category/trust/document review UI remains follow-up. |
| 7 | `07-client-request-as-is-and-gap.md` | `docs/codex-execution/007-client-request-as-is-and-gap-output.md` | Completed | Client request gap report written; existing structured address/photo flow is reusable, but explicit urgency, budget, provider preference, source/ref, and shortlist privacy copy are missing. |
| 8 | `08-client-request-data-capture-and-privacy.md` | `docs/codex-execution/008-client-request-data-capture-and-privacy-output.md` | Partially completed | Added WhatsApp urgency/provider preference/budget capture, request metadata persistence, request ref generation, privacy copy, and tests; PWA/subcategory/photo safe-preview parity remains follow-up. |
| 9 | `09-client-request-submission-and-notifications.md` | `docs/codex-execution/009-client-request-submission-and-notifications-output.md` | Completed with warnings | Request creation now returns generated requestRef and WhatsApp confirmation uses it; existing transaction, duplicate guard, photo linking, and matching trigger remain intact. |
| 10 | `10-matching-engine-as-is-and-gap.md` | `docs/codex-execution/010-matching-engine-as-is-and-gap-output.md` | Completed | Matching gap report written; current system is explainable sequential assignment, not free provider response plus customer shortlist. |
| 11 | `11-provider-opportunity-preview-and-response.md` | `docs/codex-execution/011-provider-opportunity-preview-and-response-output.md` | Completed with warnings | Added safe provider opportunity preview, free interested/not-interested response capture, idempotency, expiry guard, provider API route, and tests. |
| 12 | `12-customer-shortlist-and-selection.md` | `docs/codex-execution/012-customer-shortlist-and-selection-output.md` | Partially completed with warnings | Added customer shortlist generation, secure ticket shortlist cards, provider selection, selected-provider notification, request statuses, migration, and tests; ask-more/cancel shortlist actions remain. |
| 13 | `13-provider-final-acceptance-credit-and-unlock.md` | `docs/codex-execution/013-provider-final-acceptance-credit-and-unlock-output.md` | Completed with warnings | Added selected-provider final acceptance transaction, shared wallet unlock debit, match/booking/job assignment, notifications, matching-engine routing, and tests. |
| 14 | `14-whatsapp-template-and-url-audit.md` | `docs/codex-execution/014-whatsapp-template-and-url-audit-output.md` | Partially completed with warnings | Updated public URL validation and provider credit copy for shortlist credit timing; documented remaining WhatsApp button/shortlist-ready wiring. |
| 15 | `15-security-privacy-audit.md` | `docs/codex-execution/015-security-privacy-audit-output.md` | Completed with warnings | Hardened safe opportunity preview description handling, revalidated privacy tests, and documented token/attachment/full-detail boundaries. |
| 16 | `16-test-matrix-and-release-plan.md` | `docs/codex-execution/016-test-matrix-and-release-plan-output.md` | Completed with warnings | Created test matrix, rollout/release checklist, rollback plan, updated old copy tests, and ran full validation. |

## Global files changed

| File | Reason |
|---|---|
| `docs/implementation-assessment/as-is-assessment.md` | Step 1 required as-is implementation assessment |
| `docs/codex-execution/001-as-is-assessment-output.md` | Step 1 required execution output |
| `docs/codex-execution/000-execution-index.md` | Master execution index |
| `field-service/lib/qualified-shortlist-state.ts` | Step 2 state-machine compatibility helpers |
| `field-service/__tests__/lib/qualified-shortlist-state.test.ts` | Step 2 transition helper tests |
| `field-service/docs/qualified-shortlist-state-machines.md` | Step 2 state-machine documentation |
| `docs/codex-execution/002-product-decisions-and-state-machines-output.md` | Step 2 required execution output |
| `field-service/prisma/schema.prisma` | Step 3 shortlist data-model foundation |
| `field-service/prisma/migrations/20260502133500_qualified_shortlist_foundation/migration.sql` | Step 3 additive schema migration |
| `field-service/scripts/qualified-shortlist-foundation-dry-run.ts` | Step 3 non-destructive remediation inventory script |
| `field-service/__tests__/lib/qualified-shortlist-schema-foundation.test.ts` | Step 3 schema/migration safety test |
| `docs/codex-execution/003-shared-data-model-and-migration-plan-output.md` | Step 3 required execution output |
| `docs/implementation-assessment/provider-onboarding-gap.md` | Step 4 required provider onboarding gap assessment |
| `docs/codex-execution/004-provider-onboarding-as-is-and-gap-output.md` | Step 4 required execution output |
| `field-service/lib/provider-onboarding-data.ts` | Step 5 provider rate validation/formatting helpers |
| `field-service/lib/whatsapp-flows/types.ts` | Step 5 WhatsApp registration step/data additions |
| `field-service/lib/whatsapp-flows/registration.ts` | Step 5 provider onboarding rate capture and persistence |
| `field-service/prisma/migrations/20260502140500_provider_onboarding_rate_capture/migration.sql` | Step 5 additive provider application rate field migration |
| `field-service/__tests__/lib/provider-onboarding-data.test.ts` | Step 5 provider onboarding validation tests |
| `docs/codex-execution/005-provider-onboarding-data-capture-output.md` | Step 5 required execution output |
| `field-service/prisma/migrations/20260502143000_provider_application_more_info_and_category_approval/migration.sql` | Step 6 additive application status migration |
| `field-service/lib/provider-applications.ts` | Step 6 active status update for more-info applications |
| `field-service/lib/provider-record.ts` | Step 6 provider application status typing update |
| `field-service/app/(admin)/admin/applications/page.tsx` | Step 6 more-info action and category approval side effect |
| `field-service/__tests__/lib/provider-applications.test.ts` | Step 6 provider application identity test updates |
| `docs/codex-execution/006-provider-admin-review-approval-output.md` | Step 6 required execution output |
| `docs/implementation-assessment/client-request-gap.md` | Step 7 required client request gap assessment |
| `docs/codex-execution/007-client-request-as-is-and-gap-output.md` | Step 7 required execution output |
| `field-service/lib/client-request-data.ts` | Step 8 request helper mappings and request ref generation |
| `field-service/__tests__/lib/client-request-data.test.ts` | Step 8 request helper tests |
| `field-service/lib/job-requests/create-job-request.ts` | Step 8 request metadata persistence |
| `field-service/lib/whatsapp-flows/job-request.ts` | Step 8 WhatsApp request preference/budget/privacy capture |
| `docs/codex-execution/008-client-request-data-capture-and-privacy-output.md` | Step 8 required execution output |
| `field-service/__tests__/lib/create-job-request.test.ts` | Step 9 request ref result assertion updates |
| `docs/codex-execution/009-client-request-submission-and-notifications-output.md` | Step 9 required execution output |
| `docs/implementation-assessment/matching-gap.md` | Step 10 required matching gap assessment |
| `docs/codex-execution/010-matching-engine-as-is-and-gap-output.md` | Step 10 required execution output |
| `field-service/lib/provider-opportunity-responses.ts` | Step 11 safe preview and free provider response service |
| `field-service/app/api/provider/opportunities/[leadId]/route.ts` | Step 11 authenticated provider opportunity preview/response API |
| `field-service/__tests__/lib/provider-opportunity-responses.test.ts` | Step 11 provider opportunity response/privacy tests |
| `docs/codex-execution/011-provider-opportunity-preview-and-response-output.md` | Step 11 required execution output |
| `field-service/prisma/migrations/20260502151000_customer_shortlist_statuses/migration.sql` | Step 12 additive request status migration |
| `field-service/lib/customer-shortlists.ts` | Step 12 customer shortlist generation and selection service |
| `field-service/app/requests/access/[token]/page.tsx` | Step 12 customer shortlist display and selection action |
| `field-service/components/shared/StatusBadge.tsx` | Step 12 request status badge labels |
| `field-service/__tests__/lib/customer-shortlists.test.ts` | Step 12 shortlist generation and selection tests |
| `docs/codex-execution/012-customer-shortlist-and-selection-output.md` | Step 12 required execution output |
| `field-service/lib/selected-provider-acceptance.ts` | Step 13 selected-provider final acceptance, debit, assignment, unlock, and notifications |
| `field-service/lib/matching-engine.ts` | Step 13 selected-provider acceptance routing |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Step 13 selected-provider final acceptance tests |
| `docs/codex-execution/013-provider-final-acceptance-credit-and-unlock-output.md` | Step 13 required execution output |
| `field-service/lib/provider-credit-copy.ts` | Step 14 public URL validation and shortlist credit copy updates |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | Step 14 URL/copy test updates |
| `docs/implementation-assessment/whatsapp-template-url-audit.md` | Step 14 WhatsApp template and URL audit note |
| `docs/codex-execution/014-whatsapp-template-and-url-audit-output.md` | Step 14 required execution output |
| `docs/implementation-assessment/security-privacy-audit.md` | Step 15 security/privacy audit note |
| `docs/codex-execution/015-security-privacy-audit-output.md` | Step 15 required execution output |
| `docs/implementation-assessment/qualified-shortlist-test-matrix-release-plan.md` | Step 16 test matrix, rollout plan, release checklist, rollback plan |
| `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` | Step 16 updated onboarding copy expectation |
| `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts` | Step 16 updated insufficient-credit copy expectation |
| `docs/codex-execution/016-test-matrix-and-release-plan-output.md` | Step 16 required execution output |

## Global migrations

| Migration | Reason | Status |
|---|---|---|
| `20260502133500_qualified_shortlist_foundation` | Step 3 additive shortlist foundation tables/fields | Added |
| `20260502140500_provider_onboarding_rate_capture` | Step 5 additive provider application rate fields | Added |
| `20260502143000_provider_application_more_info_and_category_approval` | Step 6 additive application status value | Added |
| `20260502151000_customer_shortlist_statuses` | Step 12 additive request status values | Added |

## Global tests run

| Command | Result |
|---|---|
| Not run | Documentation-only step; no production code changed |
| `npm test -- --run __tests__/lib/qualified-shortlist-state.test.ts` | Passed, 1 file, 5 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npx prisma generate` | Passed with Prisma package.json config deprecation warning |
| `npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts` | Passed, 2 files, 9 tests |
| `npx prisma validate` | Passed with Prisma package.json config deprecation warning |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-lead-access.test.ts __tests__/lib/job-request-access.test.ts` | Passed, 3 files, 39 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npm test -- --run __tests__/lib/provider-opportunity-responses.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/lib/provider-lead-access.test.ts` | Passed, 3 files, 24 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npm test -- --run` | Passed, 117 files, 1130 tests, 1 skipped, 4 todo |
| `npx prisma validate` | Passed with Prisma package.json config deprecation warning |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts` | Passed, 3 files, 12 tests |
| `npx prisma validate` | Passed with Prisma package.json config deprecation warning |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |
| `npx prisma validate` | Passed with Prisma package.json config deprecation warning |
| `npm test -- --run __tests__/lib/qualified-shortlist-schema-foundation.test.ts` | Passed, 1 file, 1 test |
| `npx prisma generate` | Passed with Prisma package.json config deprecation warning |
| `npm test -- --run __tests__/lib/provider-onboarding-data.test.ts` | Passed, 1 file, 3 tests |
| `npm test -- --run __tests__/lib/provider-onboarding-data.test.ts __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts` | Passed, 3 files, 18 tests |
| `npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/admin/provider-credit-payments-actions.test.ts` | Passed, 2 files, 12 tests |
| `npm test -- --run __tests__/lib/provider-applications.test.ts __tests__/lib/provider-record.test.ts` | Passed, 2 files, 15 tests |
| `npm test -- --run __tests__/lib/client-request-data.test.ts __tests__/lib/create-job-request.test.ts` | Passed, 2 files, 20 tests |
| `npm test -- --run __tests__/lib/provider-opportunity-responses.test.ts` | Passed, 1 file, 6 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |

## Final blockers / decisions needed

- Confirm whether `Provider.verified` remains the operational approval flag or whether `KycStatus.VERIFIED` must become a hard full-detail unlock gate.
- Confirm migration strategy for active leads currently in sequential paid acceptance flow.
- Decide how to persist future target states that are currently represented only by helper-level compatibility mappings.
- Plan backfills for `requestRef`, provider categories, and lead ranking fields before enabling the shortlist UI.
- Complete remaining provider onboarding trust/profile fields after rate capture: references, profile photo, classified ID/certification/work-photo evidence, and business profile fields.
- Add a provider reply/remediation path for `MORE_INFO_REQUIRED` applications.
- Add PWA parity, subcategory capture, and photo safe-preview classification for client request capture.
- Add shortlist-specific ask-for-more-options and cancel-request actions.
- Wire live WhatsApp interested/not-interested buttons to the opportunity response service and add customer shortlist-ready outbound notification.
- Consider structured access-note redaction beyond preview-note truncation.

## Current recommendation

All blueprint steps 1-16 have execution output files. Next action is staging migration validation and controlled pilot preparation.
