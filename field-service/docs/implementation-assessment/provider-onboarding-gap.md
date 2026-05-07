# Provider Onboarding — As-Is and Gap Analysis

**Codex Step:** 04  
**Date:** 2026-05-07  
**Analyst:** Claude Code (Codex pack automated assessment)

---

## Flow Summary (WhatsApp path)

The WhatsApp registration flow is implemented in `lib/whatsapp-flows/registration.ts` and handles 21 named steps:

| Step | Handler | Captures |
|---|---|---|
| `reg_start` | `startRegistration` | Dedup check (existing provider, customer, pending app) |
| `reg_collect_name` | `handleCollectName` | Intro/CTA display |
| `reg_collect_skills` | `handleCollectSkills` | `name` → routes to verification or skills |
| `reg_collect_id` | `handleCollectId` | Verification method choice (enter ID / upload doc / skip) |
| `reg_verify_enter_id` | `handleVerifyEnterId` | SA ID (13-digit Luhn) or passport (6–30 alphanumeric) |
| `reg_verify_upload_doc` | `handleVerifyUploadDoc` | ID document image → Attachment |
| `reg_verify_upload_selfie` | `handleVerifyUploadSelfie` | Selfie-with-document image → Attachment |
| `reg_collect_skills_more` | `handleCollectSkillsMore` | Skills (numbered list, multi-select, label matching) |
| `reg_collect_area` | `handleCollectArea` | Province (5 options, coming-soon notice for non-Gauteng) |
| `reg_collect_experience` | `handleCollectExperience` | Province → city list (if seeded) or suburb text fallback |
| `reg_collect_city` | `handleCollectCity` | City selection → region list |
| `reg_collect_region` | `handleCollectRegion` | Region → suburb numbered multi-select |
| `reg_collect_suburb_select` | `handleCollectSuburbSelect` | Suburb multi-select (15 per page, numeric input) |
| `reg_collect_suburb_text` | `handleCollectSuburbText` | Free-text suburb fallback when no seeded data |
| `reg_collect_availability` | (via `sendExperiencePrompt` routes) | Experience (years), then availability (Mon–Sun) |
| `reg_collect_rates` | `handleCollectRates` | Call-out fee (mandatory), rate-negotiable flag |
| `reg_collect_hourly_rate` | `handleCollectHourlyRate` | Optional hourly rate |
| `reg_collect_profile_photo` | `handleCollectProfilePhoto` | Optional profile photo → Attachment |
| `reg_collect_bio` | `handleCollectBio` | Optional bio (≤280 chars) |
| `reg_collect_alternate_mobile` | `handleCollectAlternateMobile` | Optional alternate mobile (SA E.164 validated) |
| `reg_collect_preferred_language` | `handleCollectPreferredLanguage` | Optional preferred language |
| `reg_collect_reference1` | `handleCollectReference1` | Optional reference 1 (name + phone) |
| `reg_collect_reference2` | `handleCollectReference2` | Optional reference 2 (name + phone) |
| `reg_collect_evidence` | `handleCollectEvidence` | Up to 5 evidence files (cert docs, work photos) |
| `reg_confirm` | `handleConfirm` | Summary screen — Submit / Edit / Cancel |
| `reg_pending` | `handlePending` | Final submit transaction, post-commit side effects |

**Submit transaction** (`handlePending` → `db.$transaction`):

1. Guard: customer-on-same-phone → reject.
2. Dedup: existing APPROVED or PENDING application → skip, reply status.
3. `syncProviderRecord` — upsert `Provider` row (skills, serviceAreas, active=true, availableNow=true, verified=false). Enrichment (`syncProviderSkills`, `upsertStructuredServiceAreas`) deferred post-commit to avoid TX abort state.
4. `providerApplication.create` — writes all collected fields including `idNumber` (plaintext), `callOutFee`, `hourlyRate`, `rateNegotiable`, `availability`, `experience`, etc.
5. `providerCategory.createMany` — one row per skill with `approvalStatus='PENDING_REVIEW'`, `certificationStatus`, `yearsExperience`, `skillLevel`.
6. `providerRate.createMany` — one row per skill with `callOutFee` and `hourlyRate` if provided.
7. Attachment linkage (evidence files, profile photo, ID doc + selfie).
8. AuditLog write.

**Post-submit side effects** (fire-and-forget, non-blocking):

- `syncProviderSkills` and `upsertStructuredServiceAreas` (post-commit enrichment).
- `checkJobsForNewProviderAvailability` — checks open demand immediately.
- `sendTemplate('technician_application_received')` — transactional WhatsApp confirmation.
- `sendAdminNewApplication` — admin notification.

**No Supabase auth account is created during WhatsApp registration.** The provider exists only as a `Provider` + `ProviderApplication` row.

---

## Flow Summary (PWA path)

The Worker Portal PWA path is handled separately from the WhatsApp flow. Key differences:

- Provider must authenticate via Supabase before accessing the portal (OTP or magic link to their phone/email).
- Profile completion is handled through the PWA UI, not the WhatsApp step machine.
- Application data submitted via the PWA goes through server actions in `app/(admin)/admin/providers/actions.ts` and related routes.
- After WhatsApp-only registration, a provider who visits the portal must create a Supabase account using the **same phone number** to link their existing `Provider` row via `userId`.

**The auth linkage from WhatsApp to PWA is implicit (phone match) and not automatically completed.**

---

## Captured fields vs required fields

| Field | Completeness severity | WhatsApp captured | PWA captured | Matching-required | Customer-display | Status |
|---|---|---|---|---|---|---|
| `name` | block_submit | yes | yes | no | yes | OK |
| `phone` | block_submit | yes (sender E.164) | yes | yes (identity) | yes | OK |
| `skills` | block_submit | yes | yes | yes | yes | OK |
| `serviceAreas` | block_submit | yes (structured + text fallback) | yes | yes | yes | OK |
| `availability` | block_submit | yes | yes | yes | indirect | OK |
| `idNumber` | block_approve | yes (optional, SA ID or passport) | yes | no | no | POPIA gap — see below |
| `experience` | block_customer_display | yes | yes | no | yes | OK |
| `callOutFee` | block_customer_display | yes | yes | yes (sort/filter) | yes | OK |
| `avatarUrl` | recommended | yes (optional photo step) | yes | no | yes | OK |
| `bio` | optional | yes (optional bio step) | yes | no | yes | OK |
| `hourlyRate` | optional | yes (skippable) | yes | no | yes | OK |
| `rateNegotiable` | optional | yes | yes | no | yes | OK |
| `alternateMobileE164` | optional | yes | yes | no | indirect | OK |
| `preferredLanguage` | optional | yes | yes | no | indirect | OK |
| `reference1Name/Mobile` | optional | yes | no | no | no | Gap: PWA has no reference capture UI |
| `reference2Name/Mobile` | optional | yes | no | no | no | Gap: PWA has no reference capture UI |
| `locationNodeIds` | not in completeness validator | yes (suburb multi-select) | unknown | yes (structured matching) | no | Gap: completeness validator does not check `locationNodeIds` |
| `quoteAfterInspection` | optional | no | no | no | no | Intentional — deferred |
| `emergencyAvailable` | optional | no | no | no | no | Intentional — defaults false |

**Key finding:** The completeness validator (`evaluateProviderProfileCompleteness`) does not validate `locationNodeIds`. A provider with only string-label service areas and no structured location node IDs passes `canSubmit` but may not match location-aware job queries correctly. This is mitigated by the string-label fallback in matching, but is a structural gap.

---

## Auth gap: WhatsApp-only provider and portal access

**Status: Known, undocumented, and unmitigated.**

When a provider registers exclusively through WhatsApp:

1. A `Provider` row is created with `userId = null`.
2. A `ProviderApplication` row is created with `providerId` linked.
3. No Supabase auth account is created.
4. The provider's phone number is not registered in Supabase Auth.

**Consequence:** The provider **cannot log in to the Worker Portal** without a separate OTP/magic-link signup flow that matches their phone to an existing `Provider` row via `phone` field.

**Current linkage mechanism:** `syncProviderRecord` in `lib/provider-record.ts` matches on `phone` and upserts the Provider row. When the provider later signs up via Supabase, the `Provider.userId` field gets populated by a separate linkage step (not automated).

**Missing mitigations:**

- No automatic Supabase invite is sent after application approval (unlike `AdminUser`, which uses `supabase.auth.admin.inviteUserByEmail`).
- The Worker Portal login page does not surface "Your account is pending — register via OTP" messaging for this case.
- The approval WhatsApp notification sends a "Access Worker Portal" CTA, but the provider will fail authentication on the portal if they have no Supabase account.

**Risk level:** Medium. Providers who are WhatsApp-only approved cannot access credits, accept job leads via the portal, or manage availability from the portal until they separately create a Supabase account. The WhatsApp channel remains functional.

---

## High-risk category blockers

**Status: Correct and working.**

Implemented in `lib/service-category-policy.ts` via `hasAutoApprovalBlockingServiceSelection`.

| Category | Risk level | `blocksAutoApproval` | `certificationRequiredForApproval` | CATEGORY_POLICIES registered |
|---|---|---|---|---|
| `electrical` | regulated | yes | yes | yes |
| `pest_control` | regulated | yes | yes | yes |
| `air_conditioning` | high_risk | yes | yes | yes |
| `roofing` | high_risk | yes | yes | yes |
| `plumbing` | standard | **no** | no | yes |

The `assessProviderApplicationForOpsReview` function in `lib/provider-application-review-support.ts` calls `hasAutoApprovalBlockingServiceSelection` and adds `HIGH_RISK_CATEGORY` to the reason codes if any blocking category is selected. `autoApproveProviderApplications` in `lib/provider-auto-approve.ts` skips applications with `HIGH_RISK_CATEGORY` and routes them to manual OPS queue review.

**Plumbing correctly does not block auto-approval.** The `CATEGORY_POLICIES` entry for `plumbing` has `regulated: false` and no entries in `SERVICE_COMPLIANCE_REQUIREMENTS`, so it flows through the standard auto-approve path.

**One gap:** `CATEGORY_POLICIES` entries (`plumbing`, `pest_control`, `roofing`, etc.) have empty `requiredCertificationCodes: []` and `requiredEquipmentTags: []`. This is intentional per the disclaimer in `service-category-policy.ts` (Plug A Pro does not verify regulatory compliance), but it means that `certificationRequiredForApproval: true` in `SERVICE_COMPLIANCE_REQUIREMENTS` has no matching enforcement in the certification check. Admins must manually verify certificates during OPS review — there is no automated blocking on missing cert.

---

## Starter credit award

**Status: Implemented and working via side-effect marker system.**

The award flow in `lib/provider-auto-approve.ts`:

1. Phase A transaction approves the application and creates/updates the `Provider` record.
2. Phase B side effect `PROMO_AWARD` calls `awardPromoCreditsForMilestone(providerId, 'MOBILE_VERIFIED', ...)`.
3. The award is idempotent via `ProviderAutoApproveSideEffectMarker` — duplicate awards are blocked.
4. Schema compatibility is pre-checked via raw SQL (`checkProviderPromoAwardSchemaCompatibility`) before any run.
5. Retry schedule: 5 retries at intervals of 5, 15, 30, 60, 180 minutes.

The `NOTIFICATION` side effect reads back `promoAwards` to build the approval WhatsApp message (`buildProviderApplicationApprovedMessage` in `lib/provider-application-notifications.ts`), so the credit summary in the message reflects the actual awarded amount at send time.

**Gaps:**

- If the `ProviderPromoAwardType` enum or `provider_promo_awards` table schema is missing/incompatible at deploy time, the promo award side effect is skipped silently (logged as `console.error` only). There is no alerting or circuit-breaker beyond the log line.
- Manual admin approval (via admin panel, not auto-approve cron) goes through `crudAction()` → `app/(admin)/admin/providers/actions.ts`. It is **not confirmed** whether `awardPromoCreditsForMilestone` is called on manual approval. This is a potential gap — providers approved manually may not receive starter credits.

---

## Completeness check

**Status: Working, with two coverage gaps.**

`evaluateProviderProfileCompleteness` in `lib/provider-onboarding-completeness.ts` evaluates 8 fields across 6 groups with a 4-level severity ladder.

**What works:**
- `block_submit` fields (`name`, `phone`, `skills`, `serviceAreas`, `availability`) prevent submission.
- `block_approve` field (`idNumber`) prevents admin approval server-side.
- `block_customer_display` fields (`callOutFee`, `experience`) prevent customer visibility.
- `recommended` (`avatarUrl`) is soft and non-blocking.

**Gap 1:** The completeness validator accepts `serviceAreas` as any non-empty string array. A provider with only `['Gauteng']` (province-level) satisfies `canSubmit` but will not match suburb-level job queries. The validator does not check `locationNodeIds` or minimum area granularity.

**Gap 2:** `callOutFee` is marked `block_customer_display` (severity 3), meaning a provider without a call-out fee can be approved but will not appear on customer shortlists. The `reg_collect_rates` step makes this mandatory in the WhatsApp flow, so this gap only manifests if the admin manually creates/updates a provider record without a rate, or if the PWA submission path bypasses the WhatsApp rate step.

---

## Gaps and risks

| # | Area | Severity | Description |
|---|---|---|---|
| G1 | Auth — WhatsApp-only provider | **Medium** | No Supabase account created on WhatsApp registration. Approved provider cannot log in to Worker Portal without separate OTP signup. Approval notification sends portal CTA that will fail. |
| G2 | POPIA — `idNumber` plaintext | **Medium** | `ProviderApplication.idNumber` is stored as plaintext `String?`. Schema comment acknowledges this: "Encrypt at rest before GA." No encryption implementation exists yet. |
| G3 | Manual approval — promo credits | **Medium** | `autoApproveProviderApplications` calls `awardPromoCreditsForMilestone`. Manual admin approval path is not confirmed to call this. Providers approved manually may not receive 3 starter credits. |
| G4 | Completeness validator — `locationNodeIds` | **Low** | Validator does not check structured location node linkage. Province-level string areas pass validation but may underperform in suburb-level matching. |
| G5 | High-risk auto-block — no cert enforcement | **Low** | `certificationRequiredForApproval: true` in compliance requirements has no automated cert-presence check. Manual OPS review must verify; there is no server-side guard during admin approval. |
| G6 | Promo award — no alerting | **Low** | Schema compatibility failure silently skips promo award with only `console.error`. No webhook, Slack alert, or metric increment. |
| G7 | Reference data — no PWA capture | **Low** | WhatsApp collects `reference1Name/Mobile` and `reference2Name/Mobile`. The PWA provider onboarding UI has no reference capture step. Admins reviewing applications see these only for WhatsApp-originated applications. |
| G8 | Test coverage — manual approval path | **Low** | 32 onboarding tests cover the WhatsApp registration blueprint. No test confirms promo credit award on manual admin approval. |

---

## Recommendations

1. **G1 — Auth gap:** After approval (auto or manual), send a Supabase OTP invite to the provider's phone number using `supabase.auth.admin.inviteUserByEmail` (or phone OTP equivalent). This is the same pattern as `AdminUser` invite. On portal login with matching phone, run `provider.updateMany({ where: { phone }, data: { userId } })` to link the record. Update the approval WhatsApp message to say "To access the portal, open the link and complete a one-time phone verification."

2. **G2 — POPIA `idNumber`:** Implement AES-256-GCM at-rest encryption using a KMS-managed key before GA. Store the encrypted ciphertext and IV. Add a `idNumberEncrypted Boolean @default(false)` migration flag or a dedicated `idNumberHash` field for lookup. Mark the plaintext field as deprecated. This is a pre-GA blocker for any market that enforces POPIA §26.

3. **G3 — Manual approval promo:** Audit `app/(admin)/admin/providers/actions.ts` for the admin approval action. If `awardPromoCreditsForMilestone` is not called there, add it with the same idempotency guard used by `autoApproveProviderApplications`.

4. **G4 — Completeness validator:** Add a soft `recommended` check for `locationNodeIds` with reason "Structured location nodes improve suburb-level matching." Keep severity `recommended` (not `block_approve`) to avoid breaking existing applications.

5. **G5 — High-risk cert:** Add an admin review screen warning when an application has `HIGH_RISK_CATEGORY` and no cert attachments. This is a UX guard, not a server-side block (consistent with the platform disclaimer).

6. **G6 — Promo alerting:** Increment an observable metric (or write an `AdminAuditEvent`) when promo award schema compatibility fails. This allows monitoring dashboards to detect the failure mode without log scraping.

---

## OpenBrain Note

This assessment is derived from static code analysis of `lib/whatsapp-flows/registration.ts`, `lib/provider-auto-approve.ts`, `lib/provider-applications.ts`, `lib/provider-onboarding-completeness.ts`, `lib/provider-application-review-support.ts`, `lib/provider-application-notifications.ts`, `lib/provider-onboarding-data.ts`, and `lib/service-category-policy.ts`, cross-referenced with `prisma/schema.prisma` and `docs/provider-onboarding-data-model.md`.

No production code was changed. Findings G1 (auth gap) and G2 (POPIA idNumber) are the highest-priority items for pre-GA closure. G3 (manual approval promo) should be resolved before the first manual approval batch is processed.
