# CODEX-16 — Test Matrix and Release Plan

## Overall implementation status

The 16-step Codex Implementation Pack for Plug A Pro's Qualified Shortlist Model is complete.
Across steps 1–15 the following was built or hardened:

| Step | Area | Key deliverables |
|------|------|-----------------|
| 01 | As-is assessment | Full audit of routes, models, actions, flags, auth, integrations |
| 02 | State machines | Product decisions for shortlist model; lifecycle state maps for Provider, JobRequest, Lead, Booking |
| 03 | Shared data model | Prisma migration `20260502133500_qualified_shortlist_foundation` adding `ProviderLeadResponse`, `ProviderShortlist`, `ProviderShortlistItem`; additive only |
| 04 | Provider onboarding gap | Gap analysis against blueprint; missing fields identified on `ProviderApplication` |
| 05 | Provider onboarding data capture | `provider-onboarding-completeness` lib; severity tiers (`block_submit` / `block_approve` / `block_customer_display` / `recommended`); `callOutFee`, `rateNegotiable`, `idNumber` added |
| 06 | Provider admin review | `provider-application-review-guards` lib; high-risk category detection; manual-review decision logic; approval-undo guard |
| 07 | Client request gap | Gap analysis of `JobRequest` against blueprint; missing `customerAccessToken` rotation, preview-notes truncation, attachment privacy rules |
| 08 | Client request data capture | Privacy-aware address model; `customerAccessToken` + expiry/revoke; `resolveJobRequestAccessScope` enforcing visibility tiers |
| 09 | Client request submission | `ensureJobRequestAccessToken` / `getJobRequestAccessUrl`; customer notification on submission; WhatsApp CTA URL rules |
| 10 | Matching engine gap | Gap analysis of matching service; cert/equipment checks, expiry reconciliation, capacity state |
| 11 | Provider opportunity preview | `getProviderLeadDetailForProvider`; safe-preview (suburb + category only) vs full-detail (post-acceptance); `resolveProviderLeadAttachmentScope` |
| 12 | Customer shortlist | `generateCustomerShortlistForRequest`, `selectShortlistedProviderForRequest`, `requestMoreShortlistOptions`, `cancelRequestFromShortlist`; state-machine transitions |
| 13 | Provider acceptance, credit, unlock | `acceptSelectedProviderJob`; 15-step atomic transaction; credit deduction via `unlockLeadForProviderInTransaction`; WhatsApp CTA messages to both parties |
| 14 | WhatsApp template audit | `whatsapp-body-lint` enforcing no raw localhost URLs; `getPublicAppUrl` returning `''` for non-production; URL guard in `whatsapp-send-raw-url-guard` |
| 15 | Security and privacy audit | `provider-access-security` regression suite; 10-point invariant checklist; attachment authz fix (job ownership over uploader); `resolveProviderLeadAttachmentScope` `isAccepted` field |
| 16 | Test matrix and release plan | This document |

---

## Test matrix

### Provider onboarding

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Provider can submit application when all block_submit fields present | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Submission blocked when name is missing | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Submission blocked when skills are missing | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Submission blocked when service areas are missing | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Approval blocked (not submission) when ID/passport missing | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Call-out fee missing blocks customer display but not approval | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Experience missing blocks customer display | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| Avatar treated as recommended only — does not block display | ✅ | `__tests__/lib/provider-onboarding-completeness.test.ts` |
| WhatsApp bot registration flow covers all onboarding steps | ✅ | `__tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts` |
| Promo credits awarded on approval milestone | ✅ | `__tests__/lib/provider-promo-awards.test.ts` |
| Promo credits awarded on mobile verification | ✅ | `__tests__/lib/provider-promo-awards.test.ts` |
| Promo credits awarded on first top-up | ✅ | `__tests__/lib/provider-promo-awards.test.ts` |
| Pre-payment promo credit cap enforced | ✅ | `__tests__/lib/provider-promo-awards.test.ts` |

### Provider admin review

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| High-risk categories flagged correctly (electrical, pest_control, air_conditioning, roofing) | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| Standard categories do not require manual review | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| Mixed-category application with high-risk skill requires review | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| isHighRiskCategory is case-insensitive | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| applicationBlocksAutoApproval triggers correctly | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| isApprovalUndoBlocked when provider has active jobs | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| buildManualReviewSummary returns structured object with requirements and reason codes | ✅ | `__tests__/lib/provider-application-review-guards.test.ts` |
| Admin approval notification messages follow blueprint copy | ✅ | `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` |
| Admin rejection message has correct copy | ✅ | `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` |
| More-info-required message has correct copy | ✅ | `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` |

### Client request

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Job request access token reused when still valid | ✅ | `__tests__/lib/job-request-access.test.ts` |
| Expired token rotated; new URL points to correct path | ✅ | `__tests__/lib/job-request-access.test.ts` |
| Revoked token treated as expired; new token generated | ✅ | `__tests__/lib/job-request-access.test.ts` |
| Handoff view appended to URL without changing token path | ✅ | `__tests__/lib/job-request-access.test.ts` |
| Customer-owned access scope resolved for authenticated customer | ✅ | `__tests__/lib/job-request-access.test.ts` |
| Attachment access denied for wrong customer session | ✅ | `__tests__/api/attachments-authz.test.ts` |
| Anonymous token access resolves correct attachment scope | ✅ | `__tests__/api/attachments-authz.test.ts` |
| Provider attachment access requires job ownership (not uploader match) | ✅ | `__tests__/api/attachments-authz.test.ts` |
| Client request data model covers all blueprint fields | ✅ | `__tests__/lib/client-request-data.test.ts` |
| Client request flow state transitions are correct | ✅ | `__tests__/lib/client-request-flow.test.ts` |

### Matching

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Provider with required certifications ranked above one without | ✅ | `__tests__/lib/matching-cert-equipment.test.ts` |
| Provider without required equipment excluded from shortlist | ✅ | `__tests__/lib/matching-cert-equipment.test.ts` |
| Admin-verified certification overrides legacy cert path | ✅ | `__tests__/lib/matching-cert-equipment.test.ts` |
| Expired assignment offer transitions to EXPIRED state | ✅ | `__tests__/lib/matching-expiry.test.ts` |
| Stale assignment state reconciled by background worker | ✅ | `__tests__/lib/matching-expiry.test.ts` |
| Pending assignment workflows processed in batch | ✅ | `__tests__/lib/matching-expiry.test.ts` |
| Qualified shortlist state helpers map provider/request/lead states correctly | ✅ | `__tests__/lib/qualified-shortlist-state.test.ts` |
| Schema migration adds shortlist models without destructive SQL | ✅ | `__tests__/lib/qualified-shortlist-schema-foundation.test.ts` |
| Candidate pool filtering respects availability and service area | ✅ | `__tests__/lib/candidate-pool.test.ts` |

### Provider response (opportunity preview)

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Before acceptance: safe preview excludes customer phone, email, exact address | ✅ | `__tests__/lib/provider-privacy-unlock-flow.test.ts` |
| Before acceptance: description truncated at 180 chars (private notes hidden) | ✅ | `__tests__/lib/provider-privacy-unlock-flow.test.ts` |
| Before acceptance: provider sees suburb, category, and preview attachment | ✅ | `__tests__/lib/provider-privacy-unlock-flow.test.ts` |
| After acceptance: accepted provider receives all protected fields | ✅ | `__tests__/lib/provider-privacy-unlock-flow.test.ts` |
| Non-selected provider cannot access full details even holding a token | ✅ | `__tests__/lib/provider-privacy-unlock-flow.test.ts` |
| Interest capture flow: no credits deducted at any stage | ✅ | `__tests__/lib/provider-whatsapp-interest-flow.test.ts` |
| Interest capture: confirmation copy includes "No credits were used" | ✅ | `__tests__/lib/provider-whatsapp-interest-flow.test.ts` |
| Interest capture: invalid callout fee re-prompts | ✅ | `__tests__/lib/provider-whatsapp-interest-flow.test.ts` |
| Interest capture: invalid arrival re-prompts | ✅ | `__tests__/lib/provider-whatsapp-interest-flow.test.ts` |
| Full callout → arrival → negotiable → note → confirm path completes | ✅ | `__tests__/lib/provider-whatsapp-interest-flow.test.ts` |
| WhatsApp interest capture model (multi-step) | ✅ | `__tests__/lib/provider-whatsapp-interest-capture.test.ts` |

### Shortlist

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Customer can select a shortlisted provider | ✅ | `__tests__/lib/customer-shortlists.test.ts` |
| Customer can request more options (re-opens request) | ✅ | `__tests__/lib/customer-shortlists.test.ts` |
| Customer can cancel request from shortlist | ✅ | `__tests__/lib/customer-shortlists.test.ts` |
| Provider can decline a selected job | ✅ | `__tests__/lib/customer-shortlists.test.ts` |
| selectShortlistProviderAction enforces session auth and request ownership | ✅ | `__tests__/app/customer/request-shortlist-actions.test.ts` |
| requestMoreShortlistOptionsAction enforces session auth | ✅ | `__tests__/app/customer/request-shortlist-actions.test.ts` |
| cancelRequestFromShortlistAction enforces session auth | ✅ | `__tests__/app/customer/request-shortlist-actions.test.ts` |
| CustomerShortlistError propagated as { error } response | ✅ | `__tests__/app/customer/request-shortlist-actions.test.ts` |
| Shortlist state machine: request transitions to PROVIDER_CONFIRMATION_PENDING on selection | ✅ | `__tests__/lib/qualified-shortlist-state.test.ts` |

### Credit and acceptance

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| All 15 blueprint acceptance-transaction steps execute in sequence | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| Provider WhatsApp message matches blueprint format exactly | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| Customer WhatsApp message matches blueprint format exactly | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| All error codes surfaced correctly (NO_LEAD, LEAD_EXPIRED, INSUFFICIENT_FUNDS, etc.) | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| Duplicate accept is idempotent (DUPLICATE_ACCEPT_IGNORED / alreadyUnlocked) | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| Credit ledger entry carries idempotencyKey, traceId, balance_before, balance_after | ✅ | `__tests__/lib/provider-acceptance-credit-unlock.test.ts` |
| `acceptSelectedProviderJob` — basic acceptance path (second implementation copy) | ✅ | `__tests__/lib/selected-provider-acceptance.test.ts` |
| Credits command routes to pj_provider_status | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| balance / wallet / credit-history aliases all route correctly | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| buildProviderCreditSummaryMessage produces Available/Starter/Purchased breakdown | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| Ledger entries contain all required schema columns | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| INSUFFICIENT_FUNDS guard prevents balance going below zero | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| Optimistic-concurrency guard prevents race-condition debit | ✅ | `__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts` |
| Job completion WhatsApp flow: complete → note → photo → SKIP path | ✅ | `__tests__/lib/whatsapp-bot-completion-flow.test.ts` |

### Privacy

| Scenario | Coverage | Test file |
|----------|----------|-----------|
| Provider cannot access customer phone before acceptance | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Provider cannot access customer email before acceptance | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Provider cannot access exact street address before acceptance | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Secure tokens are scoped to provider/lead/job — cannot be replayed by wrong party | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Provider sees only own opportunities and jobs | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Non-selected providers cannot access accepted-job details | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Expired/superseded invites revoke full-detail access | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| Attachment access requires authorization (job ownership, not uploader) | ✅ | `__tests__/api/attachments-authz.test.ts` |
| Admin-only data does not appear in provider token resolution | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| resolveProviderLeadAttachmentScope returns isAccepted to enforce safeForPreview | ✅ | `__tests__/lib/provider-access-security.test.ts` |
| No production WhatsApp template body contains localhost or 127.0.0.1 | ✅ | `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` |
| getPublicAppUrl returns '' for localhost in production | ✅ | `__tests__/lib/provider-notifications-copy-and-url-rules.test.ts` |
| WhatsApp body linter rejects raw localhost URLs in template bodies | ✅ | `__tests__/lib/whatsapp-body-lint.test.ts` |
| whatsapp-send-raw-url-guard rejects non-production URLs at send time | ✅ | `__tests__/lib/whatsapp-send-raw-url-guard.test.ts` |

---

## Test summary

| Metric | Value |
|--------|-------|
| Total tests passing | 1820 |
| Total tests failing | 0 |
| Test files | 167 |
| Test framework | Vitest (node environment) |
| E2E framework | Playwright |
| CI config | `.github/workflows/` — lint + test on every PR and push |

### Test file distribution

| Directory | Files | Notes |
|-----------|-------|-------|
| `__tests__/lib/` | 121 | Unit and integration — lib functions, state machines, WhatsApp flows |
| `__tests__/api/` | ~20 | API route handlers — auth, webhooks, attachments, credits, bookings |
| `__tests__/app/` | ~16 | Server actions — customer requests, admin, provider |
| `__tests__/integration/` | ~5 | Cross-layer integration tests |
| `__tests__/components/` | ~3 | UI component rendering |
| `__tests__/provider/` | ~2 | Provider-specific edge cases |

---

## Rollout plan

### Phase 1 — Infrastructure (days 1–2)
Enable `admin.crud.providers`, `admin.crud.customers`, `admin.users.v2` feature flags in staging.
Verify all admin CRUD surfaces load cleanly. Run `pnpm test` and Playwright smoke suite.

### Phase 2 — Provider onboarding (days 3–5)
Deploy provider onboarding completeness checks and `provider-application-review-guards`.
Enable the updated WhatsApp registration flow for a pilot cohort.
Verify high-risk category detection and manual-review routing with test applications.

### Phase 3 — Promo credits (day 6)
Run `field-service/scripts/seed-flags.ts` to ensure `provider.promo_credits` flag is present.
Award promo credits to all existing approved providers via a one-time backfill script.
Enable promo credit milestone awards for new approvals going forward.

### Phase 4 — Client request privacy (days 7–8)
Deploy `customerAccessToken` rotation, `resolveJobRequestAccessScope`, and preview-notes truncation.
Audit existing `JobRequest` rows: back-fill `customerAccessToken` for any OPEN requests.
Confirm that customer-facing WhatsApp ticket URLs resolve correctly in staging.

### Phase 5 — Qualified shortlist model (days 9–11)
Apply Prisma migration `20260502133500_qualified_shortlist_foundation` to staging, then production.
Enable `matching.shortlist.v2` flag for internal test accounts.
Run full matching cycle end-to-end: request → lead batch → provider interest → shortlist → selection.

### Phase 6 — Provider opportunity preview (days 12–13)
Enable safe-preview enforcement: confirm suburb-only address in lead preview messages.
Verify attachment scope: preview attachments visible, full-detail attachments gated.
Deploy `resolveProviderLeadAttachmentScope` with `isAccepted` field.

### Phase 7 — Acceptance transaction (days 14–15)
Enable `provider.acceptance.v2` flag.
Run acceptance end-to-end: provider accepts selected job → credit deducted → both parties notified.
Verify idempotency: second accept attempt returns `alreadyUnlocked: true` without double-charging.

### Phase 8 — Production cutover and monitoring (day 16+)
Flip all shortlist-model flags to 100% in production.
Monitor credit ledger for anomalies (negative balances, missing idempotency keys).
Monitor WhatsApp delivery rates for all new message templates.
Archive legacy dispatch mode code paths once 2 weeks of clean production data are collected.

---

## Release checklist

| # | Item | Status |
|---|------|--------|
| 1 | All Vitest tests passing (`pnpm test`) | DONE — 1820 passing, 0 failing |
| 2 | No `as any` without a TODO comment | DONE — audit performed in CODEX-15 |
| 3 | Additive-only migrations (no DROP TABLE / DROP COLUMN / TRUNCATE) | DONE — verified by `qualified-shortlist-schema-foundation.test.ts` |
| 4 | Every admin mutation goes through `crudAction()` | DONE — enforced in all CODEX-06, 12, 13 actions |
| 5 | No hard deletes without OWNER role | DONE — no hard-delete paths introduced in steps 1–15 |
| 6 | Destructive confirmation pattern on destructive admin actions | DONE — existing admin UX pattern preserved |
| 7 | Every admin-facing feature is behind a feature flag | DONE — `matching.shortlist.v2`, `provider.acceptance.v2` etc. seeded |
| 8 | No production WhatsApp template contains localhost URL | DONE — enforced by `whatsapp-body-lint.test.ts` + `whatsapp-send-raw-url-guard.test.ts` |
| 9 | Provider cannot read protected customer fields before acceptance | DONE — `provider-access-security.test.ts` (10 invariants) |
| 10 | Attachment access uses job ownership, not uploader | DONE — `attachments-authz.test.ts` regression added |
| 11 | Credit ledger entries carry idempotencyKey and traceId | DONE — enforced in `provider-acceptance-credit-unlock.test.ts` |
| 12 | Negative credit balance impossible (INSUFFICIENT_FUNDS + optimistic lock) | DONE — `provider-credit-balance-and-ledger-flow.test.ts` |
| 13 | Playwright smoke suite references valid routes only | PENDING — `e2e/smoke.spec.ts` still references `/admin/breached` and `/admin/supply` which have no matching app routes; update required before Phase 8 cutover |
| 14 | OpenBrain knowledge log entry filed for each completed step | DONE — all 15 prior steps logged |

---

## Known deviations

| Spec item | Deviation | Justification |
|-----------|-----------|---------------|
| Blueprint refers to `Application` model | Actual Prisma model is `ProviderApplication` | Pre-existing naming; renaming would be a destructive migration. All new code uses `ProviderApplication` consistently. |
| Blueprint refers to `Location` model | Actual model is `LocationNode` | Pre-existing naming. `LocationNode` is more semantically precise for the hierarchical location tree. |
| Blueprint specifies `Category` as a Prisma model | No `Category` model exists; categories are string slugs on `JobRequest.category` and `Provider.skills` | Formalising categories as a managed model is deferred to a later sprint. Adding a string-slug `CategoryRequiredCertification` bridge table would require a schema design decision on whether to normalise retroactively. |
| Blueprint specifies multi-role admin users (`roles: Role[]`) | Current `AdminUser` has a single `role: Role` field | Multi-role support is a non-trivial schema migration and product decision. Current single-role model covers all operational requirements. |
| Smoke suite references `/admin/breached` and `/admin/supply` | These routes do not exist in the current route tree | Legacy test artifact. Smoke suite must be updated before Phase 8 production cutover (see Release Checklist item 13). |
| CODEX-13 spec lists `LEAD_ALREADY_ACCEPTED` as a reachable error code | The implementation returns `ok: true, alreadyUnlocked: true` on duplicate accept instead | This is intentional: idempotent acceptance is safer than returning an error when the client retries. Documented in `provider-acceptance-credit-unlock.test.ts` comment block. |

---

## Acceptance criteria status

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Provider cannot read protected customer fields (phone, email, exact address, GPS, private notes) before the customer selects them and they accept | PASS | `provider-privacy-unlock-flow.test.ts` (5 scenarios); `provider-access-security.test.ts` (10 invariants) |
| 2 | Credits are deducted exactly once per accepted selected job; previewing and interest submission are free | PASS | `provider-acceptance-credit-unlock.test.ts` (15-step transaction + idempotency test); `provider-whatsapp-interest-flow.test.ts` ("No credits were used" assertion) |
| 3 | Acceptance transaction is atomic: either all 15 steps complete or none do (no partial state) | PASS | `provider-acceptance-credit-unlock.test.ts` — transaction mock verifies rollback on any step failure; `$transaction` used throughout |
| 4 | No WhatsApp message template reaches production with a localhost or 127.0.0.1 URL | PASS | `provider-notifications-copy-and-url-rules.test.ts`; `whatsapp-body-lint.test.ts`; `whatsapp-send-raw-url-guard.test.ts` — three independent enforcement layers |
| 5 | All existing Vitest tests remain green after every step's changes | PASS | 1820 passing, 0 failing across 167 test files |
| 6 | Schema migrations are additive only — no existing data or column is dropped or renamed in any step-1-through-15 migration | PASS | `qualified-shortlist-schema-foundation.test.ts` asserts `NOT MATCH /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i` on the migration SQL |
