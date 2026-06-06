# Provider PWA Registration — Executive Summary

**For:** Product / Design review
**Surface:** Plug A Pro PWA · provider role · registration journey
**Produced:** 6 June 2026 · **Revised:** 6 June 2026 (repo-grounded against `field-service/`)
**Full pack:** current-state · proposed-design · wireframe-brief · implementation-plan (in `docs/design/`)

> **Repo-grounded revision.** This pack was originally built from spec packs + a prototype. It has since been corrected against a live read of the **`field-service/`** repo (the repo that hosts the provider PWA). The product spine is unchanged; the corrections below supersede earlier stale assumptions about repo ownership, OTP, identity verification, role linking, and verification timing. **Status: no-go for engineering as originally written; go for revised wireframes + this revised pack.**

---

## What exists today (repo-confirmed)

- The **provider PWA lives in `field-service/`** (not a separate, unknown repo). Confirmed routes: `/for-providers` (acquisition), `/provider-sign-in` + `/provider-verify` (approved-provider login), `/provider/application` (read-only status), `/provider/apply` (alias → `/provider/application`), `/provider/handoff/[token]`, and **`/provider/verify/[token]` (existing identity-verification PWA)**.
- The PWA provider surface is **sign-in only for already-approved providers**. **There is still no in-PWA application *capture*** — new providers are sent to WhatsApp ("Send 'Register'"). This core finding holds.
- **`/provider/application` is read-only status**, not registration; **`/provider/apply` just redirects** to it. Do not reuse `/provider/apply` as the new registration route without an intentional engineering change.
- **An identity-verification subsystem already exists and must be reused:** `ProviderIdentityVerification`, `ProviderIdentityDocument`, `VerificationVendorConfig`, token-gated upload (`/api/provider/identity/upload`), private Supabase storage, consent capture, hosted vendor verification.
- **Policy:** identity verification is **required before paid credit purchase**, but **deferrable during application** (`idNumber` is `recommended` in onboarding completeness; a HIGH-assurance **credit gate** enforces it before top-up). It is **not** required to submit an application.
- **No `DRAFT` application status exists** (`PENDING / MORE_INFO_REQUIRED / APPROVED / REJECTED / CANCELLED`). Autosave/resume should use a separate draft record by default so `ProviderApplication` remains the submitted/admin-reviewed record.
- **Admin "request more info" already exists** (sets `MORE_INFO_REQUIRED`, reason stored in `notes`) — but it is **freeform, not itemized**.
- Structured `Category` / `LocationNode` / `ProviderCategory` / `TechnicianServiceArea` exist, **but `ProviderApplication` still stores `skills[]` / `serviceAreas[]` as strings** — structured IDs/slugs must be persisted deliberately.

---

## Main problems found

| # | Problem | Severity |
|---|---|---|
| 1 | **No PWA registration at all** — funnel offloaded to WhatsApp; the PWA owns no capture quality, and drop-off is invisible. | High |
| 2 | **POPIA exposure** — `idNumber` stored plaintext (schema TODO), displayed in admin. | High |
| 3 | **Registration upload UX missing** — identity upload UX *exists* in the token-gated verification flow, but there's no registration-context capture. **Reuse the existing IDV subsystem**, don't build a parallel one. | High |
| 4 | **No resume after abandonment** — multi-step guarantees mid-flow exits; **no `DRAFT` status exists**, so the implementation should add a separate draft/resume record. | High |
| 5 | **Application stores strings** — `ProviderApplication.skills[]`/`serviceAreas[]` are free text; structured `Category`/`LocationNode` enrichment only happens after provider-record sync. | High |
| 6 | **Role / same-number policy** — current WhatsApp onboarding **blocks** a customer number from also being a provider; same-number multi-role is *not* current behaviour. Treat as a decision, not a given. | High |
| 7 | **Upload friction & low-bandwidth reality** — entry-level Android + WhatsApp in-app browser + metered data, with no optimised flow. | High |
| 8 | **Approval/credits/leads unexplained** — easy to over-promise leads before approval; credits ≠ rand confusion. | Medium |

---

## Proposed registration flow (revised)

A net-new, mobile-first, resumable PWA flow — **8 capture steps + status states**, reusing the existing design system, data models, and identity subsystem:

```
0 Welcome / what you'll need
1 Confirm mobile number   (registration OTP/session — separate from sign-in OTP)
2 Basic profile
3 Services               (→ Category: main + secondary + experience)
4 Service area           (→ LocationNode + radius; persist IDs/slugs, not just labels)
5 Availability & rates   (availability + call-out fee; needed before going live)
6 Identity verification  (CHOICE: Verify now / Verify later — required before credit top-up, NOT to submit; reuses existing IDV flow)
7 Work evidence (optional)
8 Review & submit        (submit → application PENDING; identity may still be deferred)
9 Submitted / pending
10 Returning states: Draft · Pending · More-info (itemized + notes fallback) · Approved (credits gated on verify) · Not approved
```

**Load-bearing decisions:** trust-before-data, one-thing-per-screen, autosave + resume, honest approval messaging, structured category/area capture (persisting canonical IDs), low-bandwidth uploads, plain SA English. **Identity is deferrable** ("Verify now / Verify later", framed as required before buying credits). WhatsApp stays a *referral + notification* channel — **not** redesigned. Same-number customer/provider linking is **out** unless product changes the policy.

---

## Key design decisions needed (open — for product/engineering)

1. **Registration OTP/session:** new endpoint, existing provider OTP extended with `intent: "registration"`, or WhatsApp deep-link token first? (Current provider OTP is sign-in only — `shouldCreateUser: false`.)
2. **Identity timing:** keep **deferrable during application, required before credit top-up** (recommended), or make ID/selfie submit-blocking (a policy change)?
3. **Customer/provider same-number policy:** keep **separate numbers** for MVP (recommended), or build same-number multi-role identity (auth/migration/support/abuse work)?
4. **Draft persistence:** default to a separate `ProviderApplicationDraft` table; avoid adding `DRAFT` to `ApplicationStatus` unless the submitted-record trade-off is explicitly accepted.
5. **Structured locations before approval:** canonical `Category.slug` / `LocationNode.id`/slug live on the draft first, then are copied to the submitted application alongside labels.
6. **More-info model:** keep freeform `notes` only, or add structured itemized requested fields?
7. **Route naming + proxy:** `/provider/register` (or similar) must be added to `proxy.ts` `PUBLIC_PATHS`, or unauthenticated users get bounced to sign-in.
8. **Reapplication policy** after rejection — allowed, and how soon?

---

## Engineering impact (revised)

- **Reuse, don't rebuild:** the identity subsystem (`ProviderIdentityVerification`, `ProviderIdentityDocument`, `/provider/verify/[token]`, `/api/provider/identity/upload`, private storage) already exists — **do not invent a parallel `ProviderDocument` model**. Admin "request more info" already exists.
- **Likely additive schema** (not "no changes"): `ProviderApplicationDraft`, hashed resume-token storage, and a way to persist canonical `Category`/`LocationNode` IDs on the draft and submitted application.
- **New UI surface:** registration capture screens (profile, services, areas, availability/rates, review), an identity-choice screen that hands off to the existing IDV flow, an itemized more-info fix screen, and a same-number conflict screen.
- **New server surface:** a **registration OTP/session contract** (decision required), draft autosave/submit, and a provider registration **state resolver** (don't assume the existing handoff token solves drafts).
- **Routing/infra:** any unauthenticated `/provider/...` registration route must be **allowlisted in `proxy.ts`**; feature-flag with a flag-off fallback that keeps WhatsApp live.
- **Compliance:** ID masking in UI; reuse the existing private-storage + consent capture; data minimisation + retention.
- **Sequencing:** re-phased around existing seams (repo-aligned setup → capture screens → draft/resume + resolver → identity integration → admin more-info round-trip → notifications → QA). See implementation plan.

---

## Recommended next decision meeting — agenda

1. **Confirm the discovery** — is the "no PWA registration today" finding accurate against the live repo? (10 min, assign code-confirmation owner)
2. **Lock the cross-cutting decisions** — OTP channel, IDV now/later, required fields, reapplication policy, approval SLA, role normalisation (25 min).
3. **Approve the proposed flow & wireframe brief** — sign off scope so design can start Figma frames (15 min).
4. **Phase plan & owners** — confirm the 6-phase sequence, assign Phase 1 cleanup owner, set the feature-flag rollout expectation (15 min).
5. **POPIA/security checkpoint** — agree masking-now / encrypt-before-GA, consent copy owner, storage/RLS owner (10 min).
6. **Decide WhatsApp's role** — referral-into-PWA vs parallel capture; who owns the deep-link/notification templates (Meta approval lead time) (10 min).

**Outputs to leave with:** approved flow, decisions locked, design brief handed to the designer, Phase 1 owner assigned, code-confirmation owner assigned.
