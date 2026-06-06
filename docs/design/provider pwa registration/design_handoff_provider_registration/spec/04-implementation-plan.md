# Provider PWA Registration — Implementation Plan

**For:** Engineering, **after design approval**
**Surface:** Plug A Pro PWA · provider role · registration journey
**Stack:** Next.js App Router · TypeScript · Prisma · Supabase (Auth + Storage) · Plus Jakarta Sans / DM Mono
**Repo:** Provider PWA lives in **`field-service/`** (same repo as admin/API).
**Principle:** Ship the MVP without over-engineering. **Reuse existing seams** (identity verification, private storage, admin more-info, structured `Category`/`LocationNode`); add only what's genuinely missing.
**Produced:** 6 June 2026 · **Revised:** 6 June 2026 (repo-grounded)

> **Do not start building until design is approved.** This plan exists so engineering can scope and sequence; it is not a green light to write UI.
>
> Revised against the live `field-service/` repo. Several earlier assumptions (separate PWA repo; identity required to submit; missing IDV/storage; "role normalisation" as a prerequisite) have been **withdrawn** — see `01-current-state.md` for the corrected facts.

---

## Cross-cutting decisions to lock before Phase 2

1. **Registration OTP/session contract.** Provider sign-in OTP is **sign-in only** (`shouldCreateUser: false`). Decide: (a) a new provider-registration OTP endpoint/session, (b) the existing endpoint extended with `intent: "registration"`, or (c) a WhatsApp deep-link session token for v1.
2. **Identity timing.** Default policy: **deferrable during application, required before credit top-up** (matches the existing HIGH-assurance credit gate). If product flips this to *submit-blocking*, completeness policy, admin expectations, and copy must change.
3. **Customer/provider same-number policy.** MVP keeps **separate numbers** (matches the existing WhatsApp onboarding block). Same-number multi-role is a future architectural decision (auth/migration/support/abuse work).
4. **Draft persistence mechanism.** Default: add a separate `ProviderApplicationDraft` table. `ProviderApplication` remains the submitted/admin-reviewed record; **do not** add `DRAFT` to `ApplicationStatus` unless product explicitly accepts that status-machine trade-off.
5. **Structured location persistence.** Store canonical `Category.slug` / `LocationNode.id`/slug on the draft first, then copy them to the submitted application alongside existing label arrays. (Today `ProviderApplication` stores strings.)
6. **More-info model.** Keep freeform `notes` (current behaviour) only, or add structured itemized requested fields?
7. **Route naming + `proxy.ts`.** Any new unauthenticated registration route must be added to `PUBLIC_PATHS`. **Do not reuse `/provider/apply`** — it redirects to `/provider/application` (status).
8. **ID-number handling.** Mask in UI now; encryption-at-rest is the standing POPIA task.

---

## Recommended phasing at a glance

| Phase | Theme | Outcome |
|---|---|---|
| 1 | Repo-aligned setup | Feature flag with WhatsApp-path-still-live fallback; `proxy.ts` allowlist for the new public route; `ProviderApplicationDraft` + hashed resume-token foundation; ID-masking in UI; **no removal of the existing `/provider/apply` redirect** |
| 2 | Capture screens (no identity yet) | Steps 0–5 + 7 + 8: profile / services / area / availability+rates / work evidence / review / submit; structured `Category`+`LocationNode` IDs persisted |
| 3 | Draft & resume | Autosave on every step; resolver routes returning users to the right step or status; draft mechanism (per Phase 1 decision) wired end-to-end |
| 4 | Identity step (reuse existing IDV) | Step 6 *choice* hands off to **existing** `/provider/verify/[token]` capture; reflect status (verified / pending / unverified) in F8 (Review) and F10d (Approved); **credit gate** unchanged |
| 5 | Admin more-info round-trip | Surface the **existing** `requestMoreInfo` reason; PWA fix screen renders itemized fields where structured + the freeform `notes` verbatim; resume returns to `PENDING` |
| 6 | Notifications, QA, analytics & launch | WhatsApp templates + SMS/email fallback; tokenised resume deep links; funnel analytics (no PII); POPIA/security review; flag rollout (internal → cohort → GA) with rollback to WhatsApp fallback |

---

## Suggested route structure

Indicative — engineering picks the final names. Any unauthenticated route must be added to `proxy.ts` `PUBLIC_PATHS`. **Do not reuse `/provider/apply`** (it redirects to `/provider/application`, the read-only status page).

```
app/(provider)/provider/register/
   layout.tsx                  # focused flow shell (no bottom nav), draft autosave context
   page.tsx                    # resolver entry → redirects to correct step/state
   welcome/page.tsx            (F0)
   phone/page.tsx              (F1, F1c, F1d — separate-number conflict)
   profile/page.tsx            (F2)
   services/page.tsx           (F3)
   area/page.tsx               (F4)
   availability/page.tsx       (F5)
   verify/page.tsx             (F6 — choice; "Verify now" hands off to existing /provider/verify/[token])
   evidence/page.tsx           (F7)
   review/page.tsx             (F8)
   submitted/page.tsx          (F9)
   status/page.tsx             (F10 — resolver-driven: pending / more-info / approved / rejected)
# Existing: /provider/application (status), /provider/apply (redirect), /provider/handoff/[token], /provider/verify/[token]
```
Implement a `resolveProviderRegistrationDestination()` (provider analogue of `resolveClientPwaDestination()`).

## Suggested component structure

```
components/provider/register/
   RegisterShell.tsx          # AuthShell + Stepper + StepFooter + Save&exit
   PhoneStep.tsx / OtpStep.tsx
   NumberConflictScreen.tsx   # F1d: separate-number policy
   ProfileStep.tsx
   ServicesStep.tsx           # binds to Category
   AreaStep.tsx               # binds to LocationNode + radius
   AvailabilityStep.tsx       # days / hours / emergency / call-out fee
   VerifyChoiceStep.tsx       # F6 — "Verify now" hands off to existing IDV; "Verify later" → continue
   EvidenceStep.tsx           # PhotoGrid + References + Certificates
   ReviewStep.tsx             # SummarySection[] with Edit + identity status block
   SubmittedScreen.tsx
   StatusScreen.tsx           # 5 returning states
   MoreInfoFixScreen.tsx      # F10c: itemized + freeform notes fallback
shared/
   EvidenceUpload.tsx         # NEW: work-photos/certificates only
   ServiceAreaPicker.tsx      # NEW
   IdentityStatusBlock.tsx    # NEW: reads existing IDV state; not a submit gate
```
Reuse existing `Button`, `Input`, `PhoneInput`, `OTPInput`, `Card`, `Chip`, `Avatar`, `Stepper`, `StepFooter`, `Toast`. **Reuse — do not rebuild —** identity capture (`/provider/verify/[token]` + `/api/provider/identity/upload`) and private storage (`lib/storage.ts`).

## Suggested server-action / API structure

```
saveRegistrationDraft(step, partialData)      # upsert ProviderApplicationDraft; autosave
submitProviderApplication()                    # validate complete → status PENDING (identity NOT required to submit)
resolveProviderRegistrationDestination(ctx)    # state resolver: step / status / conflict / handoff
uploadEvidenceFile(kind, file)                 # work-evidence / certificates only — separate from identity
# Reuse (do NOT rebuild):
#   /api/provider/identity/upload                 (token-gated identity media upload, private storage)
#   /provider/verify/[token]/actions.ts            (consent + ID basis + document/selfie + hosted vendor start)
# Admin side (already exists; surface only):
#   requestMoreInfo(applicationId, note)            → ApplicationStatus: MORE_INFO_REQUIRED (note freeform)
#   approve / reject  → status transitions via existing flow
```
Provider-facing draft saves are session-scoped writes (not `crudAction()` mutations) — still validated server-side, rate-limited, and audited.

## Suggested database / model changes

**Reuse existing models — minimal, additive-only changes. Repo-grounded.**

| Need | Approach |
|---|---|
| Draft application | **No `DRAFT` status exists today.** Use a new `ProviderApplicationDraft` table as the default. This avoids forcing partial rows into a submitted-record table that currently requires `name`, `phone`, and defaults `submittedAt`. |
| Structured skills/areas | UI binds to `Category` / `LocationNode`. **Persist canonical IDs/slugs** on the draft, then copy to the submitted application alongside the existing string fields; today the application stores `skills[]`/`serviceAreas[]` as strings and structured `ProviderCategory` / `TechnicianServiceArea` rows appear only after provider-record sync. |
| Identity documents | **Reuse `ProviderIdentityVerification` / `ProviderIdentityDocument` + private storage (`lib/storage.ts`) + `/api/provider/identity/upload`.** Do **not** add a parallel `ProviderDocument` model. |
| Work evidence / certificates | Separate, lower-sensitivity uploads — private storage with signed-URL admin access. |
| More-info requests | Current model stores reason as a freeform `notes` field. Optional Phase 5 enhancement: add a structured `reviewRequestedItems[]` field for the itemized PWA fix screen (otherwise fall back to `notes`). |
| ID encryption | Mask in UI now; encryption-at-rest is the standing POPIA task (out of scope of MVP UI work). |
| Travel radius | Store `travelRadiusKm` on the draft; copy to submitted application only if a follow-on schema addition is approved. |

**Externally-referenced columns are breaking changes** — `Provider.status` enum values, `idNumber`, etc. are consumed by the provider mobile app / KYC flow. **Additive only**; never rename or repurpose.

## Suggested validation approach

- **Shared schema** (e.g. Zod) used both client (instant feedback) and server (authoritative). Never trust client-only.
- SA ID: 13-digit + Luhn + date plausibility; passport: pattern. Phone: normalise ZA formats.
- File (evidence): MIME allowlist, max size post-compression, min dimensions for legibility.
- **Submit gate (server):** profile, services (with Category id), area (≥1 LocationNode id), availability + call-out fee, T&Cs consent. **Identity is NOT a submit requirement.**
- **Credit-purchase gate (server):** enforced by the existing HIGH-assurance credit gate: provider `kycStatus === VERIFIED` plus a current `ProviderIdentityVerification` row with `status: PASSED`, `decision: PASS`, and `assuranceLevel: HIGH`.

## Suggested file-upload / storage approach

- **Identity uploads:** **reuse** the existing token-gated `/api/provider/identity/upload` → private storage via `lib/storage.ts`. Do **not** build a parallel pipeline.
- **Work-evidence / certificates:** new uploader, private storage, signed-URL admin access. Path scheme: `providers/{providerId}/evidence/{uuid}`. Content-type validation server-side.
- Client-side **compression** before upload; **chunked/retryable** with progress; **file-picker fallback** when camera permission is denied.
- Always tolerate WhatsApp in-app-browser quirks.

## Suggested admin-review dependencies

- Submitted applications already surface in the existing **Applications** queue.
- **"Request more info" already exists** (`requestMoreInfo` → `MORE_INFO_REQUIRED`, reason in `notes`; resume returns to `PENDING`). Don't reimplement — surface it well in the PWA.
- Status transitions via the existing admin flow; ID masking in admin (last 4 + explicit reveal).
- **Credit purchase is gated on identity verification**, not on `Provider.status` alone. Approved + unverified → PWA shows "Verify identity to unlock credits".

## Suggested analytics / logging events

`registration_started`, `step_completed{step}`, `step_abandoned{step}`, `otp_sent/verified/failed`, `upload_started/succeeded/failed{kind}`, `consent_given`, `application_submitted`, `draft_resumed{via}`, `status_viewed{state}`, `approved_viewed`, `rejected_viewed`. Capture **funnel drop-off per step** (the key metric for this flow). No PII in analytics payloads (no ID numbers, no document contents).

## Suggested security & POPIA considerations

- **Consent** captured explicitly before ID/selfie; link to provider privacy page; log consent timestamp.
- **Data minimisation** — collect only what review needs.
- **Mask `idNumber`** everywhere in UI; **encrypt at rest** before GA (existing schema TODO).
- **Private storage**, admin-only signed access, defined **retention** for rejected applications.
- **Rate-limit** OTP and draft endpoints; bot/abuse protection on submit.
- **HttpOnly session** — all session checks server-side.
- **Audit** all admin actions via `crudAction()`.

## Rollback considerations

- Ship behind a **feature flag** (e.g. `provider.pwa.registration`) with a clean **flag-off state**: the current "Apply via WhatsApp" footnote remains the fallback. (All admin features already require a flag-off state — apply the same discipline here.)
- **Additive migrations only** (new enum values/fields) so rollback doesn't strip data; never rename externally-referenced columns.
- Keep the WhatsApp entry path working throughout — the PWA flow is additive, not a hard cutover.
- Feature-flag uploads/IDV separately from the basic flow so verification can be toggled without disabling registration.

## Testing approach

- **Unit:** validation schemas (ID Luhn, phone normalisation, file checks), resolver state mapping.
- **Integration:** draft autosave/resume, submit → `PENDING`, admin transitions, approved-but-unverified credit lock, and verified high-assurance credit unlock.
- **E2E (mobile viewport + in-app-browser emulation):** full happy path, resume-after-exit, upload failure/retry, OTP errors, each Step-9 state.
- **Device lab:** real entry-level Android + WhatsApp in-app browser; camera/geolocation permission-denied paths.
- **Security/POPIA:** verify private storage, signed-URL expiry, masking, consent logging, rate limits.

## QA checklist

- [ ] Flag-off shows the existing "Apply via WhatsApp" fallback; flag-on shows the new flow; **`/provider/apply` still redirects to `/provider/application`** (status).
- [ ] New registration route is added to `proxy.ts` `PUBLIC_PATHS`.
- [ ] Welcome states "reviewed before going live" and lists what's needed.
- [ ] Phone normalises ZA formats; **existing-customer number routes to the separate-number conflict screen** (MVP policy).
- [ ] **Registration OTP/session contract** behaves per the Phase-1 decision (separate from sign-in OTP semantics).
- [ ] Every step autosaves; exiting and returning resumes at the right step (draft mechanism per Phase 1).
- [ ] Services binds to `Category` and **persists canonical ids/slugs**; Area binds to `LocationNode` and persists ids; radius respected.
- [ ] Availability + call-out fee captured; review reflects them.
- [ ] **Identity step is a choice, not a submit gate**: "Verify later" lets the application be submitted; "Verify now" hands off to the existing IDV flow.
- [ ] **Submission allowed without identity verification.** Review shows identity status block with Verify CTA (warn, not blocking).
- [ ] ID number masked (last 4) wherever it renders; consent timestamp captured in the IDV flow.
- [ ] Evidence uploads compress, show progress, retry on failure, fall back to file picker without camera; documents land in **private** storage.
- [ ] **Approved-but-unverified providers see "Verify identity to unlock credits"** — the credit gate behaves as today.
- [ ] All five Step-10 returning states route correctly via the resolver and via deep link; more-info shows itemized fields where structured + **freeform `notes` verbatim**.
- [ ] Notifications fire on submit/more-info/approved/rejected (or graceful fallback if a template isn't approved).
- [ ] Funnel analytics emit per step; **no PII** in payloads.
- [ ] Works at 360–390px in WhatsApp in-app browser; 44px+ targets; AA contrast; visible focus; reduced-motion respected.

---

## Phase detail

Each phase: **Task · Why · What good looks like · Acceptance criteria · Risks & edge cases.**

---

### Phase 1 — Repo-aligned setup
- **Task:** Add a `provider.pwa.registration` feature flag with a clean flag-off fallback (“Apply via WhatsApp” footnote stays live); allowlist the new registration route in `proxy.ts` `PUBLIC_PATHS`; mask `idNumber` in UI; add the `ProviderApplicationDraft` + hashed resume-token foundation. **Do not** rebuild identity capture / private storage / admin more-info — they exist.
- **Why:** A safe foundation that respects what's already in `field-service/` and doesn't touch externally-referenced columns. Avoids baking compliance/UX debt into screens.
- **What good looks like:** Migrations are additive and reversible; ID masking ships UI-side; the flag toggles cleanly; the new route is reachable unauthenticated when the flag is on; `/provider/apply` redirect to `/provider/application` is untouched; no `DRAFT` status is added to `ApplicationStatus`.
- **Acceptance criteria:** ID masked everywhere it renders; draft mechanism merged; proxy allowlist in place; flag rollout plan documented.
- **Risks & edge cases:** **Additive only** for externally-referenced columns; do not rename or repurpose `Provider.status` / `idNumber`. Forgetting the proxy allowlist sends unauthenticated users to provider sign-in.

### Phase 2 — Capture screens (no identity yet)
- **Task:** Build Steps 0–5 + 7 (review) + 8 (submitted) end-to-end **without identity**: registration shell (Stepper + sticky StepFooter + Save & exit), phone + OTP (per decision #1), separate-number conflict screen, profile, services (Category id + slug persisted), area (LocationNode ids + radius), availability + call-out fee, work evidence, review with identity-status block (not blocking), submit → `PENDING`.
- **Why:** Delivers the core funnel and lets a provider submit — the highest-value increment — without entangling the existing IDV flow.
- **What good looks like:** A provider can complete an application end-to-end, leave mid-flow, return and resume, review, and submit. Mobile-first, in-app-browser-safe; the application carries canonical Category/LocationNode ids alongside labels.
- **Acceptance criteria:** Phase-2 QA items pass except those covering identity; funnel events emit; submit creates `ProviderApplication: PENDING` with structured ids persisted.
- **Risks & edge cases:** Long category/LocationNode lists need search; keyboard layout shifts on mobile; very old drafts — “still relevant?” prompt; in-app-browser quirks.

### Phase 3 — Draft & resume
- **Task:** Autosave on every step; tokenised resume deep link (provider analogue of `customerAccessToken`, distinct from the existing handoff token) with only a token hash stored server-side; implement `resolveProviderRegistrationDestination()` so returning users land on the right step or returning state.
- **Why:** Multi-step flows guarantee exits; without resume, providers restart from zero and most won't.
- **What good looks like:** Draft survives reload, sign-out, and link expiry recovery; resolver decisions are testable and unambiguous.
- **Acceptance criteria:** Resume from deep link works; resolver routes to the correct screen for each state in the matrix; expired tokens land on a recovery screen.
- **Risks & edge cases:** Stale drafts; signup-vs-sign-in collisions; analytics double-counting on resume.

### Phase 4 — Identity step (reuse existing IDV)
- **Task:** Implement Step 6 as a **choice** — “Verify now” hands off to **the existing** `/provider/verify/[token]` capture (consent, masked ID, document, selfie); “Verify later” continues. Reflect verification status in Review (F8) and Approved (F10d). Wire the identity-status block. **Do not** reimplement identity capture / storage.
- **Why:** Per repo policy, identity is required before credit top-up but deferrable during application. Reusing the existing flow avoids divergence and respects the credit gate.
- **What good looks like:** Returning from `/provider/verify/[token]` lands the provider back in registration with the verification status reflected; Approved + unverified clearly shows “Verify identity to unlock credits”.
- **Acceptance criteria:** Verify-now → existing flow → returns to registration with status; submit works for both verified and unverified; credit gate (HIGH-assurance) blocks credit top-up while unverified.
- **Risks & edge cases:** Vendor mismatch / manual fallback (existing IDV handles it; surface honest copy); token expiry; permission-denied camera → file fallback.

### Phase 5 — Admin more-info round-trip
- **Task:** Build the PWA more-info fix screen (F10c) on top of the **existing** admin `requestMoreInfo` action: render itemized requested fields where structured (optional new field) and **fall back to the freeform `notes` verbatim**; preserve other submitted data read-only; route in from the notification deep link.
- **Why:** Freeform notes are hard for a provider to action precisely; a structured UI shortens the loop without rewriting the admin model.
- **What good looks like:** A provider receives a message, taps in, sees exactly what's needed (or the freeform note), updates, resubmits; admin sees the application back at `PENDING`.
- **Acceptance criteria:** Round-trip works end-to-end; only-note case displays cleanly; everything else stays read-only during the fix.
- **Risks & edge cases:** Multiple requested items; re-upload failure; admins editing the note mid-fix.

### Phase 6 — Notifications, QA, analytics & launch
- **Task:** Wire post-registration notifications (submitted / more-info / approved / rejected, optional draft-abandon nudge) via pre-approved WhatsApp templates with SMS/email fallback; complete the test matrix (unit / integration / E2E / device lab in WhatsApp in-app browser / security); funnel analytics; POPIA/security review; flag rollout internal → cohort → GA with rollback to the WhatsApp fallback.
- **Why:** Compliance-/trust-sensitive; the funnel's front door must be measured and safe to launch.
- **What good looks like:** Each event reliably notifies via an available channel; QA green on real low-end Android in WhatsApp in-app browser; funnel dashboard live; one-flip rollback to WhatsApp.
- **Acceptance criteria:** QA checklist complete; analytics validated (no PII); security/POPIA approved; flag rollout plan executed with monitoring.
- **Risks & edge cases:** WhatsApp template approval (24–72h) — don't block launch on it (fall back); in-app-browser regressions only show on real devices; performance on entry-level Android.
