# Provider Onboarding Quality Gate v2 — Design

**Date:** 2026-07-02 · **Status:** Approved design, pre-implementation · **Author:** Engineering (brainstormed with founder)

## Goal

Enable a JHB North provider onboarding drive without importing the West Rand quality problem: every application that reaches the ops queue must carry **passed Didit KYC**, **at least 3 work photos**, and — for high-risk trades — **certification evidence**. Applies to **all new applications platform-wide**, both channels (WhatsApp + PWA), from the moment the gate flag flips. Existing approved providers are untouched.

## Decisions (locked with founder 2026-07-02)

1. **KYC gate placement:** at application submit — Didit must PASS before the application becomes visible/submittable (Approach A: Didit is the final flow step; the PASSED webhook completes submission).
2. **Evidence bar:** ≥ 3 work photos for every applicant; certification document or registration number additionally required for high-risk trades (plumbing, gas, geyser, locksmith, appliance_repair, air_conditioning, roofing, electrical — the existing `service-category-policy` set).
3. **Scope:** all new applications platform-wide (not region-scoped, no retroactive re-verification of the pending queue).
4. **Channels:** WhatsApp registration flow and PWA signup both enforce the bar at launch. No back door.

## What already exists (reuse, do not rebuild)

- **Didit adapter** — complete under `lib/identity-verification/vendors/didit/` (client, session, signing, webhook parse/normalize/persist, decision). Vendor selection via `resolveIdentityVerificationConsentVendorForSubject` (`lib/identity-verification/orchestrator.ts`), gated by `provider.identity.verification.automation`, `provider.identity.verification.pilot_allowlist_required`, an active `VerificationVendorConfig` row, and the vendor flag.
- **Mandatory-KYC no-skip branches + tests on main** — `lib/kyc-policy.ts` (`isKycRequiredForActivation`), no-skip branches in `lib/whatsapp-flows/registration.ts`, pinned by `__tests__/lib/whatsapp-flows/registration-kyc-mandatory.test.ts`.
- **Evidence step machinery** — `reg_collect_evidence` media-upload loop, `evidenceFileUrls String[]` on `ProviderApplication`/draft, `evidence_add_more`/`evidence_done` buttons.
- **High-risk classification** — `lib/service-category-policy.ts` (`highRiskRequirement`, `hasAutoApprovalBlockingServiceSelection`), `ProviderCertification` storage, `provider_high_risk_cert_nudge` template.
- **Draft-first application** — `ProviderApplicationDraft` holds in-progress applications.
- **Stall recovery** — in-flight identity-verification re-nudge cron (`/api/cron/identity-verification-in-flight-renudge`, fixed 2026-07-01) chases CONSENTED/AWAITING_* states.
- **Waitlist/coming-soon path** — JHB North applicants already flow in as `coming_soon` + `ServiceAreaWaitlist`; matching remains hard-gated to the West Rand pilot until the separate pilot-config change.

## Architecture

### Flow order (WhatsApp)

basics → skills → service areas → experience → **evidence (≥3 photos)** → **certification (high-risk only)** → summary/confirm → **Didit hosted verification** → *(webhook PASS)* → application PENDING + confirmation.

Rationale: Didit sessions cost money — placing the paid gate last means only applicants who cleared every free gate spend one.

### Gate behaviors (flag ON)

- **Evidence step:** "✅ Continue" is only offered once `evidenceFileUrls.length >= 3`. Attempts to finish early get: "You've added N of 3 required work photos — please add M more." `evidence_skip` and the `whatsapp.registration.evidence_skip_primary` flag path are disabled.
- **Certification step (new, high-risk only):** after evidence, applicants whose selected skills intersect the high-risk set must upload a certification document (media) or supply a registration number before reaching the summary. Stored via existing `ProviderCertification` fields on the draft.
- **Didit step:** replaces the verify-now/later choice; no skip. On summary confirmation the flow creates the identity-verification session for the application subject and sends the hosted Didit link via CTA URL button. Chat copy: verification in progress, confirmation will arrive here.
- **Submission transition:** the Didit **PASSED** webhook (existing webhook route → `persist.ts`/`decision.ts`) triggers draft → `ProviderApplication` with `status = PENDING` and fires the existing submitted-confirmation message. This is the ONLY path to PENDING while the gate flag is ON.
- **FAILED / RETRY_REQUIRED:** applicant receives a retry link; after 2 failed retries the draft converts to an application with `status = MORE_INFO_REQUIRED` and an `[quality-gate] KYC failed at application` ops note, so ops can decide manually.
- **Abandoned mid-Didit:** covered by the in-flight re-nudge cron (no new machinery).

### PWA parity

- `lib/provider-registration/pwa-flow.ts` validation: reject final submit unless `evidenceFileUrls.length >= 3`; require certification input when high-risk skills selected.
- The existing "Identity verification" step in `ProviderRegistrationClient` becomes non-skippable when the gate flag is ON; final submit is disabled until the verification session reports PASSED (client re-resolves the verification token's status via the existing server path on return/refresh; the webhook remains the source of truth for the PENDING transition — if no lightweight status read exists, the implementation plan adds one read-only endpoint).

### Vendor selection change

When the gate flag is ON, **application-stage subjects** resolve to the Didit vendor without requiring a `ProviderIdentityVerificationPilotAllowlist` row (the allowlist continues to gate post-approval/legacy re-verification). Implemented as a scoped bypass inside `resolveIdentityVerificationConsentVendorForSubject`; automation flag + active vendor config + Didit vendor flag still required.

## Flags & rollout sequence

| Switch | Setting |
|---|---|
| `provider.onboarding.quality_gate_v2` (new) | default OFF; controls ALL submit-time enforcement in both channels |
| `provider.identity.verification.automation` | ON at rollout |
| Didit vendor flag + `VerificationVendorConfig` row | active at rollout |
| `provider.kyc.required_for_activation` | ON (defense-in-depth: even legacy-path applications cannot be APPROVED unverified) |
| `DIDIT_API_KEY` / `DIDIT_WEBHOOK_SECRET` / workflow IDs | verified present in Vercel prod before flip |

Rollout: ship dark → seed flag OFF → verify Didit config end-to-end with the internal test provider (isTestUser cohort) → flip `quality_gate_v2` ON → monitor first-day funnel via the existing funnel report.

## Error handling

- Didit API unavailable at session-create: applicant sees "verification is temporarily unavailable — we'll message you here shortly"; draft stays in the pre-Didit state; the re-nudge cron retries the link issue. No silent fallback to the manual vendor while the gate flag is ON (a manual-review application would dodge the bar).
- Webhook signature failures: existing didit `signing.ts` verification; failures logged, no state change.
- Media upload failures in evidence/cert steps: existing media retry copy; count only successfully stored files.

## Testing

- Extend `registration-kyc-mandatory.test.ts`: new step order; no skip at evidence, cert, or Didit steps when gate ON.
- Evidence count: 0/1/2 photos blocked with correct copy; 3 proceeds. Skip paths disabled when gate ON; unchanged when OFF.
- High-risk cert: high-risk selection requires cert before summary; non-high-risk skips the step entirely.
- PWA: pwa-flow validation rejections (photos, cert); submit blocked pre-PASS.
- Webhook: PASSED → draft becomes PENDING application + confirmation sent exactly once (idempotent); FAILED×2 → MORE_INFO_REQUIRED + ops note.
- Vendor resolution: application-stage subject gets Didit without allowlist when gate ON; post-approval subject still requires allowlist.
- Flag OFF: entire current behavior preserved (regression suite unchanged).

## Out of scope

- JHB North matching/pilot-config flip (separate change: the agreed 7-suburb slice — Fourways, Morningside, Bryanston, Illovo, Linden, Parkhurst, Hyde Park).
- The ad/marketing campaign driving onboarding traffic.
- Retroactive re-verification of the existing pending queue.
- Retiring `matching.kyc_grace_legacy_providers` (tracked in `docs/decisions/2026-06-28-kyc-grace-flag-retirement.md`).
