# Provider PWA Registration - Claude Design Handover

**Audience:** Claude Design / UI design agent
**Purpose:** Update the provider PWA registration design pack after a repo-first revision.
**Produced:** 2026-06-06
**Source folder:** `docs/design/provider pwa registration/design/`
**Repo checked:** `field-service/`

---

## Instruction To Claude Design

Update the existing provider PWA registration design documents using the repo-confirmed facts below. Do not design or assume new backend behaviour that conflicts with the current `field-service` implementation unless it is explicitly labelled as a product/engineering decision.

The current design direction is usable, but the pack is not implementation-ready as written. Keep the mobile-first, resumable, trust-before-data spine. Correct the stale assumptions around app ownership, OTP, identity verification, role linking, more-info handling, public routing, and structured location persistence.

---

## Go / No-Go

**No-go for engineering implementation as written.**

**Go for revised wireframes and design pack update** once the corrections below are applied.

Reason: the original pack was built from specs/prototypes before a live repo read. The live repo has more provider PWA, identity verification, admin review, and routing infrastructure than the pack assumed.

---

## Repo-Confirmed Baseline

### 1. The provider PWA is in `field-service`

The docs currently say the PWA is a separate repo with unconfirmed internals. That is stale for this review.

Repo evidence:

- Provider acquisition page: `field-service/app/(customer)/for-providers/page.tsx`
- Provider sign-in: `field-service/app/(auth)/provider-sign-in/page.tsx`
- Provider OTP verify: `field-service/app/(auth)/provider-verify/page.tsx`
- Provider application status: `field-service/app/(provider)/provider/application/page.tsx`
- Provider apply alias: `field-service/app/(provider)/provider/apply/page.tsx`
- Provider handoff route: `field-service/app/provider/handoff/[token]/page.tsx`
- Provider identity verification PWA: `field-service/app/provider/verify/[token]/page.tsx`

Design update: replace "PWA separate repo" with "provider PWA surfaces are in `field-service`; routes and proxy rules must be checked there."

### 2. The main finding remains true: no PWA application capture exists

The provider sign-in page is for approved providers only. New providers are still sent to WhatsApp.

Repo evidence:

- `field-service/app/(auth)/provider-sign-in/page.tsx:219` says "Use the mobile number linked to your approved Plug A Pro provider profile."
- `field-service/app/(auth)/provider-sign-in/page.tsx:303` shows "Not approved yet?"
- `field-service/app/(auth)/provider-sign-in/page.tsx:305` tells applicants to send `Register` on WhatsApp.

Design update: keep the "no in-PWA registration capture" finding, but remove the prototype-only caveat.

### 3. `/provider/application` is read-only status, not registration

`/provider/application` shows the provider's most recent `ProviderApplication` after login. It does not create or edit an application.

Repo evidence:

- `field-service/app/(provider)/provider/application/page.tsx:1` describes the route as application status.
- `field-service/app/(provider)/provider/application/page.tsx:5` says WhatsApp is the primary application channel.
- `field-service/app/(provider)/provider/application/page.tsx:63` loads the latest `ProviderApplication`.
- `field-service/app/(provider)/provider/application/page.tsx:191` says no application record means applications are submitted via WhatsApp.

`/provider/apply` is only an alias:

- `field-service/app/(provider)/provider/apply/page.tsx:1` says it is an alias.
- `field-service/app/(provider)/provider/apply/page.tsx:9` redirects to `/provider/application`.

Design update: do not use `/provider/apply` as the new registration route unless engineering intentionally changes it.

### 4. Provider OTP sign-in cannot be reused blindly for registration

The current provider OTP path is a sign-in path, not a registration path.

Repo evidence:

- `field-service/app/api/auth/provider/send-code/route.ts:771` calls `supabase.auth.signInWithOtp`.
- `field-service/app/api/auth/provider/send-code/route.ts:773` uses `shouldCreateUser: false`.
- `field-service/app/api/auth/provider/verify-code/route.ts:135` resolves the worker from a verified OTP session.
- `field-service/app/api/auth/provider/verify-code/route.ts:154` rejects when the resolved provider/application is not eligible.

Important nuance: `send-code` may return a uniform "verify OTP" response even when no provider exists. That is anti-enumeration behaviour for sign-in, not a complete registration session.

Design update: Step 1 must not say "reuse provider sign-in OTP" as-is. The revised pack must specify one of these:

1. New provider-registration OTP endpoint/session.
2. Existing provider OTP endpoint extended with an explicit `intent: "registration"` contract.
3. WhatsApp deep-link session token replaces OTP for the first version.

Until engineering picks one, frame OTP as **decision required**.

### 5. Customer/provider role linking conflicts with current policy

The design proposes that an existing customer number can "add a provider profile" to the same identity. Current WhatsApp onboarding blocks this.

Repo evidence:

- `field-service/lib/whatsapp-flows/registration.ts:2420` checks for an existing customer.
- `field-service/lib/whatsapp-flows/registration.ts:2425` throws when that customer exists.
- `field-service/lib/whatsapp-flows/job-request.ts` contains copy that provider and customer profiles must use separate WhatsApp numbers.

Design update: do not present same-number customer/provider linking as current behaviour. Make it a product/engineering decision:

**Decision required:** keep separate phone identities, or introduce same-number multi-role accounts with migration, auth, support, and abuse handling.

Recommended for MVP: keep the existing separate-number rule and use clear recovery copy. Same-number role linking is a later architecture change.

### 6. Identity verification already exists and must be reused

The pack treats document upload, selfie capture, consent, and automated IDV as mostly net-new. That is stale.

Repo evidence:

- `field-service/prisma/schema.prisma:962` defines `ProviderIdentityVerification`.
- `field-service/prisma/schema.prisma:1039` defines `ProviderIdentityDocument`.
- `field-service/prisma/schema.prisma:1140` defines `VerificationVendorConfig`.
- `field-service/prisma/schema.prisma:1152` defines `ProviderIdentityVerificationPilotAllowlist`.
- `field-service/app/provider/verify/[token]/actions.ts:55` records consent.
- `field-service/app/provider/verify/[token]/actions.ts:104` captures identity basis and identifier.
- `field-service/app/provider/verify/[token]/actions.ts:179` handles document completion.
- `field-service/app/provider/verify/[token]/actions.ts:239` handles selfie completion.
- `field-service/app/provider/verify/[token]/actions.ts:342` starts hosted vendor verification from consent.
- `field-service/app/api/provider/identity/upload/route.ts:9` is the token-gated identity upload endpoint.
- `field-service/lib/storage.ts:166` uploads identity documents into private Supabase storage.

Design update: do not invent a parallel `ProviderDocument` model for ID/selfie. The new registration design should reuse or compose the existing provider identity-verification flow.

### 7. Identity verification is required before paid credit purchase, but deferrable during onboarding

The current design says ID + selfie are required to submit the application. That conflicts with current repo policy and recent product wording.

Repo evidence:

- `field-service/lib/provider-onboarding-completeness.ts:76` marks `idNumber` as `recommended`.
- `field-service/lib/provider-onboarding-completeness.ts:79` says ID/passport verification is required before paid credit purchase.
- `field-service/lib/identity-verification/credit-gate.ts` owns the HIGH-assurance credit gate.
- `field-service/app/(provider)/provider/credits/actions.ts` returns `creditPurchaseLocked`.

Design update:

- Do not call identity verification "optional".
- Do call it **required before credit top-up / deferrable during application** unless the product owner explicitly changes the policy.
- Replace "Skip" with "Verify later" / "Defer identity verification".
- If the design still wants identity verification inside registration, present it as:
  - Primary: **Verify now**
  - Secondary: **Verify later**
  - Copy: "Required before you can buy credits and unlock paid lead access."

### 8. Application status has no `DRAFT`

Current `ApplicationStatus` values:

- `PENDING`
- `MORE_INFO_REQUIRED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

Repo evidence:

- `field-service/prisma/schema.prisma:2385`

Design update: autosave/resume is still the right design direction. For implementation, use a separate `ProviderApplicationDraft` table and create `ProviderApplication` only on submit. Do not add `DRAFT` to `ApplicationStatus` unless product explicitly accepts the submitted-record trade-off.

### 9. Admin more-info already exists, but it is not itemized

The original docs describe "request more info" as mostly new. The action already exists.

Repo evidence:

- `field-service/app/(admin)/admin/applications/page.tsx:382` defines `requestMoreInfo`.
- `field-service/app/(admin)/admin/applications/page.tsx:412` sets status to `MORE_INFO_REQUIRED`.
- `field-service/app/(admin)/admin/applications/page.tsx:415` stores the reason in `notes`.
- `field-service/lib/provider-applications.ts:220` resumes a more-info application back to `PENDING`.

Design update: the gap is not "create more-info." The gap is:

- itemized missing fields,
- a PWA "fix exactly this" screen,
- better provider-facing routing from the WhatsApp notification,
- preserving all other submitted data read-only.

### 10. Structured categories and locations exist, but application capture still stores strings

Categories and location nodes are live.

Repo evidence:

- `field-service/prisma/schema.prisma:2696` defines `Category`.
- Actual field is `label`, not `name`: `field-service/prisma/schema.prisma:2699`.
- `field-service/prisma/schema.prisma:172` defines `LocationNode`.
- `field-service/prisma/schema.prisma:755` defines `ProviderCategory`.
- `field-service/prisma/schema.prisma:1509` defines `TechnicianServiceArea`.
- `field-service/lib/provider-record.ts:83` can upsert structured service areas from `locationNodeIds`.

But `ProviderApplication` still stores:

- `skills: String[]`
- `serviceAreas: String[]`

Repo evidence:

- `field-service/prisma/schema.prisma:352`
- `field-service/prisma/schema.prisma:353`

Design update: keep structured pickers in the UI. The implementation plan must specify how selected `Category` and `LocationNode` IDs survive before approval. Otherwise the PWA captures structured data but submits only labels.

Recommended wording:

"The UI binds to `Category` and `LocationNode`; engineering must persist both display labels and canonical IDs/slugs so matching and provider enrichment can use structured data."

### 11. Provider record is currently created before approval in WhatsApp submit

The current WhatsApp submit path creates/syncs a `Provider` row with `verified: false`, then creates `ProviderApplication`.

Repo evidence:

- `field-service/lib/whatsapp-flows/registration.ts:2485` calls `syncProviderRecord`.
- `field-service/lib/whatsapp-flows/registration.ts:2504` then creates `ProviderApplication`.
- `field-service/lib/provider-record.ts:211` maps unverified providers to `APPLICATION_PENDING`.

Design update: avoid assuming `ProviderApplication.providerId` is null until approval. The design can remain user-facing, but the implementation plan should not use "provider row only after approval" as a hard invariant.

### 12. New public routes must be allowlisted in `proxy.ts`

Provider routes are protected by default.

Repo evidence:

- `field-service/proxy.ts:25` defines `PUBLIC_PATHS`.
- `field-service/proxy.ts:94` defines provider-protected paths as `/provider`, `/technician`, `/api/provider`.
- `field-service/proxy.ts:267` checks whether a path is public.

Design update: any unauthenticated route like `/provider/register` must include proxy/public-path work. Otherwise users will be redirected to provider sign-in.

---

## Revised Design Spine

Keep the original design principles, with these corrections:

1. **PWA registration is additive, not a replacement for WhatsApp on day one.**
2. **Provider sign-in remains approved-provider login.**
3. **Registration OTP/session is a separate contract.**
4. **Identity verification is required before credit top-up, but can be deferred during application unless product changes policy.**
5. **Structured category/location capture must persist canonical IDs/slugs, not only labels.**
6. **More-info is an existing admin state; the design needs a better targeted provider fix screen.**
7. **All new public provider registration routes need proxy allowlisting.**

---

## Recommended Revised Flow For Wireframes

Design this as the default MVP unless product explicitly decides to make identity submit-blocking.

```text
Entry:
  /for-providers CTA or WhatsApp/Register deep link

0 Welcome / what you need
1 Confirm mobile number
   - registration OTP/session, not provider sign-in OTP as-is
   - if number is already an approved provider: route to sign-in/status
   - if number is existing customer: show separate-number policy or decision state
2 Basic profile
3 Services
   - main category from Category
   - secondary services if needed
   - experience
4 Service area
   - LocationNode search/select
   - labels plus canonical IDs/slugs
   - travel radius if engineering can persist it
5 Availability and rates
   - current completeness rules need availability
   - call-out fee blocks customer display, so include it before review or mark as needed before going live
6 Identity verification choice
   - Verify now
   - Verify later
   - copy: required before buying credits / paid lead access
   - if Verify now: reuse existing provider identity-verification flow
7 Work evidence
   - optional photos, certificates, references
8 Review and submit
   - submit creates/updates application to PENDING
9 Submitted / pending review
10 Returning states
   - draft/resume
   - pending/under review
   - more info required
   - approved
   - not approved
```

Important: If product decides ID/selfie must be required before submit, Step 6 becomes a blocking verification step and the implementation plan must change the current completeness policy, admin expectations, and funnel copy.

---

## Update Instructions By Existing Document

### `provider-pwa-registration-executive-summary.md`

Replace:

- "PWA separate repo" caveat.
- "Identity verification unknown/manual now" framing.
- "ID + selfie required to submit" as an assumed default.

Add:

- `field-service` is the checked repo.
- Existing identity-verification subsystem exists and must be reused.
- Current policy: verification is required before credit top-up, deferrable during onboarding.
- OTP/session contract is a decision blocker.
- Same-number customer/provider linking is not current policy.

### `provider-pwa-registration-current-state.md`

Update the as-is map:

- `/for-providers` is the public provider acquisition page.
- `/provider-sign-in` is approved-provider sign-in.
- `/provider-verify` verifies provider sign-in OTP.
- `/provider/application` is authenticated, read-only application status.
- `/provider/apply` redirects to `/provider/application`.
- `/provider/verify/[token]` is the existing identity-verification PWA.
- `/api/provider/identity/upload` is token-gated identity media upload.

Revise gaps:

- Keep "no PWA registration capture."
- Change "no upload UX exists" to "registration upload UX does not exist; identity upload UX exists in token-gated verification."
- Change "more-info action new" to "more-info exists but needs itemized PWA correction flow."
- Change "unstructured capture" to "WhatsApp stores application strings; structured enrichment exists after provider record sync."

### `provider-pwa-registration-proposed-design.md`

Update Step 1:

- Do not reuse provider sign-in OTP as-is.
- Add a registration-session decision.

Update Step 5:

- Rename from "Verification (ID + selfie) required" to "Identity verification choice."
- Use "Verify now" / "Verify later."
- Make clear it is required before credit top-up / paid lead access.
- If product wants it blocking, mark that as a policy change.

Update Step 9:

- More-info state should render itemized admin requests where available; current `notes` may be the fallback.

### `provider-pwa-registration-wireframe-brief.md`

Revise frame list:

- Add a same-number customer conflict frame.
- Add a registration OTP/session uncertainty note.
- Add "Verify now / Verify later" variants.
- Add a more-info targeted fix frame that can handle both itemized fields and freeform admin note fallback.
- Add route/proxy caveat for `/provider/register`.

### `provider-pwa-registration-implementation-plan.md`

Re-phase around existing seams:

1. Repo-aligned setup:
   - route choice and proxy allowlist,
   - registration OTP/session contract,
   - draft persistence decision,
   - structured category/location persistence decision,
   - feature flag registration.
2. Application capture screens:
   - profile, services, areas, availability/rates, review.
3. Draft/resume and status resolver:
   - do not assume current provider handoff token solves drafts.
4. Identity integration:
   - reuse `ProviderIdentityVerification`, `ProviderIdentityDocument`, `/provider/verify/[token]`, `/api/provider/identity/upload`.
5. Admin more-info PWA round trip:
   - itemized missing fields or notes fallback.
6. Notifications and WhatsApp entry:
   - templates/deep links use existing provider handoff concepts where possible.
7. QA:
   - mobile viewport,
   - WhatsApp in-app browser,
   - OTP anti-enumeration,
   - no PII analytics,
   - proxy public path checks,
   - identity credit gate.

Remove or rewrite:

- "No new top-level models required" as a blanket statement. Drafts and structured application selections may need additive schema.
- "ProviderApplication providerId set after approval" as a hard statement.
- "Create ProviderDocument only if..." unless it explicitly acknowledges the existing `ProviderIdentityDocument`.

---

## Open Decisions For Product / Engineering

1. **Registration OTP/session:** new endpoint, existing endpoint with intent, or WhatsApp token-first?
2. **Identity timing:** deferrable during application, or required before submit?
3. **Customer/provider same-number policy:** keep separate numbers for MVP, or build multi-role identity?
4. **Draft persistence:** default to a separate `ProviderApplicationDraft` table.
5. **Structured locations before approval:** canonical `Category.slug` and `LocationNode.id` values live on the draft first, then are copied into the submitted application where supported.
6. **More-info model:** freeform note only, or structured requested items?
7. **Route naming:** `/provider/register`, `/provider/application/start`, or another public route?

Recommended MVP choices:

- Separate registration OTP/session from provider sign-in.
- Keep customer/provider phone identities separate.
- Treat identity as required-before-credit-top-up and deferrable during application.
- Add explicit draft persistence via `ProviderApplicationDraft` rather than overloading `PENDING` or adding `DRAFT` to the submitted application status machine.
- Persist `Category.slug` and `LocationNode.id`/slug with labels.
- Add itemized more-info fields later if not needed for the first wireframe, but design the UI to support them.

---

## Do Not Design Yet

Keep these out of scope unless the user explicitly expands scope:

- Redesigning the WhatsApp onboarding conversation.
- Changing credit purchase / Pay@ screens.
- Redesigning the provider dashboard.
- Redesigning admin Applications.
- Final high-fidelity design system work.
- Production rollout or deployment plan.

---

## Claude Design Prompt

Use this prompt if handing off to another Claude Design session:

```text
You are updating the Plug A Pro provider PWA registration design pack in:
docs/design/provider pwa registration/design/

Read provider-pwa-registration-claude-design-handover.md first.

Task:
Revise the existing executive summary, current-state, proposed-design, wireframe-brief, and implementation-plan docs so they match the live field-service repo.

Hard constraints:
- Provider PWA routes live in field-service.
- No PWA application capture exists yet.
- /provider/application is read-only status.
- /provider/apply redirects to /provider/application.
- provider-sign-in/provider-verify are approved-provider login, not registration capture.
- Registration needs its own OTP/session contract or an explicit extension.
- Existing identity verification must be reused: ProviderIdentityVerification, ProviderIdentityDocument, /provider/verify/[token], /api/provider/identity/upload.
- Current policy: identity verification is required before credit top-up / paid lead access, but deferrable during application. Do not call it optional; use Verify later / defer wording.
- Current customer/provider same-number linking is not supported; keep separate-number policy unless labelled as an open decision.
- More-info already exists but is freeform notes; design targeted PWA fix screens around itemized fields with notes fallback.
- Any new unauthenticated provider route under /provider must be added to proxy public paths.

Output:
Updated Markdown docs only. Do not implement UI code.
```

---

## Verification Notes

This handover is source-backed by a repo read on 2026-06-06. No code implementation was performed.
