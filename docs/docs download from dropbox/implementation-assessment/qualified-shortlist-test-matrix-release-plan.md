# Qualified Shortlist Test Matrix and Release Plan

Date: 2026-05-02

## Test Matrix

| Area | Required coverage | Current automated coverage | Release status |
|---|---|---|---|
| Provider onboarding | Submit application, pending review, approval, rejection, more info, duplicate phone, starter credits | Registration, provider application, provider record, provider onboarding rate tests | Partial: references/profile-photo/trust evidence remain follow-up |
| Admin review | Approve, reject, more info, category approval side effects | Provider application tests and admin payment/action tests | Partial: full category-by-category admin UI remains follow-up |
| Client request capture | Create request, address privacy, photos, urgency, provider preference, budget, request ref | Client request data and create-job-request tests | Partial: PWA parity and subcategory/photo safe-preview classification remain follow-up |
| Matching | Eligibility, dispatch, existing sequential assignment, shortlist state helpers | Existing matching-service tests plus qualified state tests | Partial: top-N automatic shortlist dispatch is not fully cut over |
| Provider opportunity response | Safe preview, interest, call-out fee, arrival, negotiable, decline, expiry, idempotency | Provider opportunity response tests | Ready for service/API layer; WhatsApp buttons still need live wiring |
| Customer shortlist | Interested-only shortlist, provider card data, customer selection, selected-provider notification | Customer shortlist tests | Partial: ask-more-options/cancel actions remain follow-up |
| Final acceptance and credits | Selected provider gate, 1-credit debit, unlock, match/booking/job assignment, insufficient credits, non-selected blocked | Selected-provider acceptance tests plus wallet/lead-unlock existing tests | Ready for controlled pilot |
| Privacy | Preview excludes phone/exact address/access notes; accepted provider sees full details; wrong provider blocked; token expiry | Provider opportunity, lead detail, lead access, attachment/token tests | Ready with residual free-text redaction risk |
| URLs and WhatsApp copy | Production URLs, localhost blocking, provider terms, selected-job credit copy | Provider credit copy, lead access, job request access tests | Partial: customer shortlist-ready outbound template remains follow-up |

## Full Validation Run

| Command | Result |
|---|---|
| `npm test -- --run` | Passed, 117 files, 1130 tests, 1 skipped, 4 todo |
| `npx prisma validate` | Passed with Prisma package config deprecation warning |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 unrelated existing warnings |

## Rollout Plan

| Phase | Scope | Gate |
|---|---|---|
| 1 | Apply additive schema migrations and run Prisma validation | Migration dry run passes; no destructive SQL |
| 2 | Enable provider onboarding rate capture and admin more-info flow | Admin can approve/reject/request info in staging |
| 3 | Enable client request metadata/privacy copy in WhatsApp | Request creation and photo linking pass in staging |
| 4 | Enable provider opportunity preview/response API behind internal flag | Safe preview and response tests pass; no credit debit |
| 5 | Generate customer shortlists manually/admin-triggered for pilot requests | Customer can select provider; no credit debit |
| 6 | Enable selected-provider final acceptance for pilot providers | Debit/ledger/unlock/job assignment tests pass |
| 7 | Wire WhatsApp interested/not-interested and shortlist-ready outbound messages | Meta templates approved; no localhost links |
| 8 | Expand to production cohort after support runbook and rollback are ready | Pilot scenarios pass with named test providers/customers |

## Release Checklist

- [x] Additive migrations created.
- [x] Prisma schema validates.
- [x] Unit and integration test suite passes.
- [x] Typecheck passes.
- [x] Lint passes with known unrelated warnings.
- [x] Provider preview privacy tests pass.
- [x] Customer ticket and provider lead URL tests pass.
- [x] Credit ledger path reuses existing unlock transaction.
- [x] OpenBrain-compatible per-step notes written.
- [ ] Run migrations against staging database snapshot.
- [ ] Verify `APP_PUBLIC_URL=https://app.plugapro.co.za` in production.
- [ ] Verify `PROVIDER_LEAD_ACCESS_SECRET` is set in production.
- [ ] Approve/update WhatsApp templates in Meta.
- [ ] Wire WhatsApp interested/not-interested buttons to opportunity response service.
- [ ] Add automatic customer shortlist-ready notification.
- [ ] Pilot with named provider/customer scenarios.
- [ ] Confirm rollback flag/route to legacy sequential assignment.

## Rollback Plan

The schema changes are additive. If rollout issues occur, disable the shortlist entry points and continue using the legacy sequential assignment path. Existing wallet ledger and lead unlock records remain valid because selected-provider final acceptance uses the same ledger-first unlock module.

## OpenBrain Note

Qualified Shortlist release plan completed. Current implementation is suitable for a controlled pilot after staging migration validation, WhatsApp template approval, production URL verification, and final wiring of WhatsApp interested/not-interested and shortlist-ready notifications.
