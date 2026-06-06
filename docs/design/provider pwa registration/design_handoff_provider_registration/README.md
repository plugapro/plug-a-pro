# Handoff: Provider PWA Registration

## Overview

This package implements a **net-new provider registration journey** for the Plug A Pro PWA (mobile-first, `app.plugapro.co.za`). The PWA's provider surface today is **sign-in only** for already-approved providers — new tradespeople are bounced off-platform to WhatsApp ("Send 'Register'"). This design brings the application capture journey **into the PWA**: a structured, resumable, mobile-first flow that captures profile, services, service area, availability + call-out fee, deferrable identity verification, and optional work evidence, then submits a `ProviderApplication` for admin review and shows the provider their status.

**The provider PWA lives in `field-service/`** (the same Next.js / Prisma / Supabase repo as the admin/API — it is **not** a separate repo). The backend already supports this journey: `ProviderApplication`, `Provider` status machine, `Category`, `LocationNode`, `ProviderWallet`, **and a complete identity-verification subsystem** (`ProviderIdentityVerification`, `ProviderIdentityDocument`, `/provider/verify/[token]`, `/api/provider/identity/upload`, private Supabase storage). **Reuse these — don't rebuild them.** See `spec/01-current-state.md`.

**Scope guardrail:** PWA provider-registration only. Does **not** redesign the WhatsApp onboarding journey (kept as referral + notification channel). Does **not** cover provider home / job-acceptance / credits screens (credits are post-approval **and** post-identity-verification).

---

## About the Design Files

The files in `prototype/` are **design references created in HTML/React (Babel-in-browser)** — a clickable prototype demonstrating intended look, layout, copy, and behaviour. **They are not production code to copy directly.**

Recreate these designs in the real `field-service/` codebase using its established components, auth helpers, Prisma client, routing, and styling. The prototype's inline styles and `T` theme object exist only to run without a build step.

The prototype runs inside `Plug A Pro PWA.html` (project root). Open it, choose the **"Provider · registration (NEW)"** group in the left screen picker to click through all 18 frames. It is also reachable in-flow from **Provider sign in → "Become a provider"**.

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, component structure, and interaction states are all specified. Recreate the UI faithfully using the codebase's existing component library and design tokens. Where the prototype uses a value the codebase already tokenizes (a brand color, a radius, a font), **prefer the codebase's token** — the values here (see Design Tokens) are the source of truth for what the design intends, and should match the codebase's existing Plug A Pro tokens.

---

## How to read this package

| Path | What it is |
|---|---|
| `README.md` | This file — self-sufficient implementation guide |
| `spec/00-claude-design-handover.md` | **Read first** — the repo-grounded handover that drove this revision (with code-evidence citations) |
| `spec/01-current-state.md` | As-is discovery + route/component/server/data maps + 12 UX/ops gaps (revised) |
| `spec/02-proposed-design.md` | Full screen-by-screen design: fields, validation, states, microcopy (revised, 8 steps) |
| `spec/03-wireframe-brief.md` | Frame-by-frame brief (F0–F10e) + "Frames Required" list (revised) |
| `spec/04-implementation-plan.md` | **6-phase build plan** — repo-aligned, additive only (revised) |
| `spec/05-executive-summary.md` | One-page summary + open decisions (revised) |
| `spec/06-engineering-contracts.md` | ★ **Drop-in engineering contracts** — routes, server-action signatures, component props, Zod schemas, Prisma additions, state resolver, storage, analytics, DoD per phase |
| `prototype/*.jsx` | The clickable React prototype (reference only) |

> **Read in this order:** `00-claude-design-handover.md` (why) → `04-implementation-plan.md` (when) → `06-engineering-contracts.md` (what to type). Use `01–03` and `05` as backing detail; the prototype as the visual reference.

---

## ⚠️ Repo-grounded corrections (vs the earlier draft of this package)

This package was originally based on spec packs + the prototype. A live read of `field-service/` produced these corrections, now reflected throughout:

1. **`field-service/` hosts the provider PWA** — not a separate repo.
2. **Identity verification + private document storage already exist** (`ProviderIdentityVerification`, `ProviderIdentityDocument`, `/provider/verify/[token]`, `/api/provider/identity/upload`, `lib/storage.ts`) — **reuse, do not rebuild**.
3. **Identity is required before credit top-up, deferrable during application** — not required to submit.
4. **Provider OTP is sign-in only** (`shouldCreateUser: false`) — registration needs its own session contract.
5. **Customer/provider same-number linking is not current policy** — separate-number policy for MVP.
6. **No `DRAFT` status exists** (`PENDING / MORE_INFO_REQUIRED / APPROVED / REJECTED / CANCELLED`) — draft persistence is an explicit decision.
7. **Admin "request more info" already exists** (`MORE_INFO_REQUIRED`, freeform `notes`) — don't rebuild; surface it in the PWA (itemized where possible, freeform-note fallback otherwise).
8. **`ProviderApplication` stores strings** (`skills[]`/`serviceAreas[]`) — persist canonical `Category`/`LocationNode` IDs/slugs alongside labels.
9. **`/provider/apply` redirects to `/provider/application` (status)** — do **not** repurpose it as the registration capture route.
10. **`proxy.ts` `PUBLIC_PATHS`** — any new unauthenticated registration route must be allowlisted.

---

## ⚠️ Decisions to confirm before Phase 2

From `spec/05-executive-summary.md`:

1. **Registration OTP/session contract** — new endpoint, existing endpoint extended with `intent: "registration"`, or WhatsApp deep-link token first?
2. **Identity timing** — default: deferrable during application, required before credit top-up. Flip to submit-blocking only as a policy change.
3. **Customer/provider same-number policy** — separate-number MVP (recommended), or build same-number multi-role identity?
4. **Draft persistence mechanism** — default for implementation: a separate `ProviderApplicationDraft` table. Do not add `DRAFT` to `ApplicationStatus` unless product explicitly accepts the submitted-record trade-offs.
5. **Structured location persistence** — canonical `Category.slug` / `LocationNode.id`/slug live on the draft first, then are copied to the submitted `ProviderApplication` alongside existing labels.
6. **More-info model** — keep freeform `notes` only, or add structured itemized requested fields?
7. **Route naming + proxy** — add the new route to `proxy.ts` `PUBLIC_PATHS`; don't reuse `/provider/apply`.
8. **Reapplication policy** after rejection.

---

## Screens / Views

18 frames (8 capture steps + sub-states + 5 returning states + shared sheet). Each renders in a **390px-wide mobile viewport** (verify down to ~360px). Global patterns apply to all multi-step capture screens (1–8).

### Global patterns (apply to capture steps 1–8)

- **Layout:** single column. Top region = back button (circular, 36×36) + "Step n of 8" (mono font) + "Save & exit" text button, then an **8-segment Stepper**, then a 22px/700 title + 14px/muted subtitle.
- **Sticky footer (`RegStepFooter`):** fixed to bottom, glass background (`backdrop-filter: blur(16px)`, page color at 92% alpha, 1px top inset border), holding the primary CTA full-width with a right-arrow icon. Optional secondary button (left, auto-width) and optional centered note line above.
- **No bottom nav** during registration — it's a focused flow.
- **Autosave:** every "Continue" persists the draft server-side (per the draft-persistence decision); show a subtle "Saved" toast on first save per session.
- **Validation:** on blur + on Continue; inline, specific, below the field; never block typing. Primary CTA disabled until the step's required fields are valid.
- **Loading:** the submit/continue button shows a spinner + disabled state on every server round-trip (no optimistic UI for submit).
- **A11y:** 44px+ targets, labeled inputs, visible focus ring (`--brand-purple`), status never by color alone.

---

### F0 — Welcome / "What you'll need"  (`ScreenRegWelcome`)
- **Purpose:** Orient the provider, set the "reviewed before going live" expectation, list what to have ready, start the flow.
- **Layout:** Auth-shell frame (eyebrow "BECOME A PROVIDER", title "Get work near you", subtitle). Body: a brand-tinted reassurance callout ("Reviewed before you go live"), then a "What you'll need" card with 4 rows (ID/passport, selfie, work photos optional, ~5–8 min). Footer area (not sticky here): primary "Get started" → F1, helper line "Free to apply. No credits needed yet.", and a text link "Already a provider? Sign in".
- **States:** static.

### F1 — Phone  (`ScreenRegPhone`)
- **Purpose:** Confirm mobile number; **separate-number policy** (MVP) for customer-already-using-number.
- **Components:** `PhoneInput` (ZA `+27` default). A plain info callout that customer & provider profiles use separate numbers, with "See options" → F1d conflict screen. Footer note: T&Cs/Privacy.
- **Validation:** ≥ 9 digits after normalization → enables "Send code" → F1-OTP.
- **Number logic:** no account → new registration; existing **customer** → conflict screen (no automatic linking — separate-number policy); existing **provider** → sign-in / matching F10 state via resolver.

### F1-OTP — Verify code  (`ScreenRegOTP`)
- **Purpose:** Confirm number ownership for **registration** (separate session contract from sign-in OTP, which is `shouldCreateUser: false`).
- **Components:** 6-digit `OTPInput`; resend with cooldown.
- **States:** wrong code, expired code, too-many-attempts cooldown. Valid 6 digits → F2.

### F1d — Number conflict  (`ScreenRegConflict`)
- **Purpose:** Respectful explanation that provider & customer profiles need separate numbers (MVP); customer account untouched.
- **Actions:** Primary "Use a different number" → F1; secondary "Contact support" (WhatsApp).

### F2 — Basic profile  (`ScreenRegProfile`)
- **Fields:** profile photo (optional, `Avatar` with gradient-initials placeholder + "Add profile photo"), Full name (required), Business/trading name (optional), ID type (radio: SA ID / Passport — informs the identity step), Preferred contact (segmented: WhatsApp / Call / SMS, default WhatsApp).
- **Validation:** name length > 1 enables Continue.

### F3 — Services  (`ScreenRegCategory`)
- **Fields:** Main trade — **2-column grid bound to `Category`** (single-select). Secondary services — wrap of `Chip` toggles (multi). Experience — wrap of `Chip` (single). Short description — optional textarea, 300-char cap with live counter. **Persist canonical `Category` IDs/slugs on the draft, not just labels.**
- **Conditional:** category-cert/equipment info callout if applicable (informational, not blocking).

### F4 — Service area  (`ScreenRegArea`)
- **Fields:** Suburb search bound to `LocationNode`; selected areas as removable pill chips; "Suggested near you" as add-chips; **travel-radius slider** 5–50 km; optional map slot; "exact address never shown" callout.
- **Persist canonical `LocationNode` IDs/slugs alongside labels.**
- **Validation:** ≥ 1 area served enables Continue.

### F5 — Availability & rates  (`ScreenRegAvailability`)
- **Fields:** Day toggles + presets (Weekdays / Weekends / Every day); Working hours radio (Standard 7am–5pm / Extended 6am–8pm / 24-7); Emergency-availability toggle; **Call-out fee** (R, numeric) — shown to customers, needed before going live.
- **Validation:** ≥ 1 day + fee present → Continue.
- **Why this step exists:** onboarding completeness requires availability; call-out fee gates customer display.

### F6 — Identity verification (choice)  (`ScreenRegVerify`)
- **Purpose:** **A CHOICE — not a submit gate.** Per repo policy, identity is required before credit top-up, deferrable during application.
- **Layout:** Stepper at "Step 6 of 8". Two callouts: warn "Required before buying credits" + brand "Secure & private". "What's involved" checklist.
- **Footer (stacked):** primary **Verify now** → F6b; ghost **Verify later** → F7. Both submit-eligible later.

### F6b — Identity capture  (`ScreenRegIdentity`)
- **Implementation:** **Reuse the existing `/provider/verify/[token]` capture screens** + `/api/provider/identity/upload` + private storage. The prototype's `ScreenRegIdentity` mirrors that experience for visual reference — do **not** ship a parallel pipeline.
- **Fields:** masked ID number with reveal toggle (last 4 visible), ID document slot, selfie slot, consent + privacy link.
- **Upload states (`RegDocSlot`):** `empty` / `uploaded` / `failed` (with retry).
- **Validation:** completes verification — not application submission. Returns to F7.

### F7 — Work evidence (optional)  (`ScreenRegEvidence`)
- **Fields:** 3-column photo grid (tap to add), Certificates upload slot (→ `technicianCertifications`), References list (name + phone).
- **Footer:** primary "Continue" + secondary "Skip" (both → F8). Never a blocker.

### F8 — Review & submit  (`ScreenRegReview`)
- **Layout:** sectioned summary (Name, Main trade, Other services, Areas served, **Availability**, Work evidence). Each row has an **Edit** button.
- **Identity status block** (separate from rows): warn-toned card "Identity not verified yet · Required before buying credits" with a **Verify** button → F6b. **Does not block submit.**
- **Footer:** success-tinted "What happens next" callout.
- **Submit:** sticky CTA "Submit application" → spinner "Submitting…" → F9. Submit failure preserves the draft.

### F9 — Submitted / pending  (`ScreenRegSubmitted`)
- **Layout:** centered state screen (`RegStateScreen`) with eyebrow, title, subtitle. Body: 3-step timeline (`RegTimeline`, active = "Under review"), plain "You can't receive leads yet" gate callout, info "While you wait" callout.
- **Footer:** secondary "View application status" → F10b, ghost "Back to sign in".
- **No credits/leads UI** here.

### F10a — Returning · Draft incomplete  (`ScreenRegDraft`)
- Progress card ("5 of 8 steps done", 63% bar, "Next step"). Primary "Continue application" → resumes via resolver; ghost "Start over".

### F10b — Returning · Pending review  (`ScreenRegPending`)
- Warn-toned state screen: "We're reviewing your application", soft SLA ("1–2 working days"), timeline, no-leads-yet note. Secondary "Add work evidence"; ghost "Need help?".

### F10c — Returning · More info required  (`ScreenRegMoreInfo`)
- Uses the step-header layout. Warn callout "Requested by our team", **itemized requested fields where structured**, and a **"Note from the team" card rendering the freeform admin `notes` verbatim** (current model stores reason as a note). Rest stays read-only. Sticky "Resubmit" → F10b.

### F10d — Returning · Approved  (`ScreenRegApproved`)
- Success-toned state screen: profile summary card with "Approved" chip. **Credits are gated on identity verification.**
- **Unverified:** primary "**Verify identity to unlock credits**" → F6b; ghost "Go to dashboard". Warn callout "Credits locked — verify your identity to buy credits".
- **Verified:** primary "Set up credits" → credits screen.

### F10e — Returning · Not approved  (`ScreenRegRejected`)
- Danger-toned state screen: respectful outcome + shareable reason if any + recovery. Primary "Apply again" (if policy allows); secondary "Contact support" (WhatsApp). **Never expose internal fraud signals.**

---

## Interactions & Behavior

- **Navigation:** linear 0→8 with back available on every step; F6 is a *choice* (Verify now / Verify later) and F7 is skippable; F8 Edit jumps to any step and returns. After submit → F9. Returning users land on F10a–e via a **state resolver** (`resolveProviderRegistrationDestination`), the provider analogue of the customer resolver.
- **Autosave & resume:** persist a `ProviderApplicationDraft` on every Continue; provide a tokenised resume deep link (distinct from the existing `/provider/handoff/[token]`) and store only a token hash server-side.
- **Identity hand-off:** F6 "Verify now" hands off to the **existing** `/provider/verify/[token]` capture flow; on return, F8 reflects status (verified / pending / unverified). Identity is **never** a submit gate.
- **Loading/error states:** every screen's states are enumerated in `spec/02-proposed-design.md` (§ "State coverage matrix"). Upload failure → inline retry + "do this later"; OTP errors; submit failure preserves draft.
- **Validation rules:** full list in `spec/02`. Use a **shared schema (e.g. Zod) on client and server** — never trust client-only.
- **Responsive:** mobile-first 360–390px; must work inside **WhatsApp's in-app browser** (camera/geolocation may be blocked → always offer file-upload / suburb-search fallback).

---

## State Management

Per the prototype each screen holds local form state; in production, lift to a **draft model** so steps share state and survive reload:

- **Draft:** `ProviderApplicationDraft` is the default Phase 1 mechanism. It keeps partially completed applications out of the submitted `ProviderApplication` status machine.
- **Session:** Supabase Auth provider session (HttpOnly `sb-access-token`); all session checks server-side. **Registration OTP/session is a separate contract** (see open decisions).
- **Step state:** current step index, per-field values, identity-status (read from existing `ProviderIdentityVerification`), per-upload status (`empty`/`uploading`/`uploaded`/`failed` + progress), validation errors.
- **Resolver inputs:** active `ProviderApplicationDraft` progress + latest `ProviderApplication.status` + `Provider.status` + existing identity/credit-gate status → which F10 screen.
- **Data needs:** `Category` list (with required-cert/equipment), `LocationNode` search, signed upload targets for evidence (separate from identity uploads).

Full server-action surface, model changes, and storage approach are in `spec/04-implementation-plan.md`.

---

## Design Tokens

Source of truth is the codebase's existing Plug A Pro tokens; these are the values the design intends (from `prototype/tokens.jsx`). Default theme = **light, "vibrant" palette, "cozy" density, base radius 16**.

**Brand (vibrant palette + gradient):**
- Pink `#FF1F8E` · Purple `#8B3FE8` · Blue `#2A78F0`
- Primary CTA gradient: `linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)`
- Soft gradient (tinted callouts/selected): same stops at ~`18`/`14`/`18` hex alpha
- "Brand purple" is the single-accent / focus-ring color: `#8B3FE8`

**Status:** success `#0F9D58` · warn `#E69900` · danger `#E5484D` · WhatsApp `#25D366` (dark `#1FAD52`) — WhatsApp green for WhatsApp affordances **only**.

**Surfaces (light / dark):**
- page `#F6F6F8` / `#0B0B10` · card `#FFFFFF` / `#15161C` · cardAlt `#F1F1F4` / `#1B1C24`
- border `#EBEBEF` / `#26272F` · borderStrong `#D9D9DE` / `#33343D`

**Text (light / dark):** ink `#0A0A0F` / `#F4F4F6` · inkMute `#6B6F76` / `#A0A0AB` · inkSoft `#9CA0A8` / `#71727B`

**Radius scale (base 16):** xs 6 · sm 10 · md 16 · lg 24 · xl 28 · pill 999

**Spacing (cozy density):** pad 16 · gap 12 · rowH 52 · cardPad 20 · sectionGap 24

**Typography:**
- UI font: **Plus Jakarta Sans** (fallback `-apple-system, system-ui, sans-serif`)
- Mono (numbers / IDs / step counters / timestamps): **DM Mono** (fallback `ui-monospace, "SF Mono", Menlo, monospace`)
- Step title 22/700 (-0.4 tracking); state-screen title 26/700 (-0.5); section label ~11.5/700 uppercase 0.4 tracking; body 14–14.5; helper/sub 12–12.5; field labels via the kit's `FieldLabel`.

The prototype also supports palette/density/dark/WhatsApp variants via a Tweaks panel — those are exploration aids; ship the defaults above unless told otherwise.

---

## Data Model (already supported by backend — reuse + additive only)

Additive changes only (details in `spec/01` and `spec/04`). The submitted application, provider, wallet, and identity models are reused; a separate draft model is the default implementation choice:

- **`ProviderApplicationDraft`** — registration-session-owned, resumable draft with step progress, structured category/location IDs, availability, call-out fee, evidence metadata, consent state, and optional link to the final submitted application.
- **`ProviderApplication`** — submitted/admin-reviewed record: name, phone, `skills[]` labels, `serviceAreas[]` labels, experience, availability, existing `callOutFee` decimal, `idNumber` only through the existing IDV/masking posture, `status` (`PENDING / MORE_INFO_REQUIRED / APPROVED / REJECTED / CANCELLED` — **no `DRAFT`**), `notes` (freeform admin reason), `reviewedAt/By`. The submit action copies validated draft data into this record.
- **`Provider`** — status machine `APPLICATION_PENDING → UNDER_REVIEW → ACTIVE → SUSPENDED → ARCHIVED/BANNED`; `kycStatus` `NOT_STARTED → IN_PROGRESS → SUBMITTED → VERIFIED / REJECTED / EXPIRED`.
- **`ProviderIdentityVerification` + `ProviderIdentityDocument`** — **already exist; reuse**. Wired to `VerificationVendorConfig`, allowlist, consent capture, `/api/provider/identity/upload`, private storage (`lib/storage.ts`), hosted vendor start (`/provider/verify/[token]/actions.ts`).
- **`Category`** — main + secondary trade; `CategoryRequiredCertification` / `CategoryRequiredEquipment`. `ProviderCategory` (join) used after provider-record sync.
- **`LocationNode`** — service-area picker. `TechnicianServiceArea` (join) used after provider-record sync.
- **`ProviderWallet`** — **not touched during registration**. Credit purchase is gated by the **HIGH-assurance credit gate** (`lib/identity-verification/credit-gate.ts`).

**Externally-referenced columns are breaking changes** — additive only.

---

## Assets

- **Icons:** the prototype uses an inline 20×20 / 1.6-stroke line-icon set (`prototype/icons.jsx`). Map to the codebase's existing icon library; don't ship the prototype's SVGs if the app already has an icon set.
- **Fonts:** Plus Jakarta Sans + DM Mono (already used app-wide).
- **No raster image assets** are required by these screens. Identity uploads go to the **existing** private Supabase storage via the existing IDV endpoint; work-evidence uploads go to private storage via a new (or shared) signed-URL pipeline.
- **Logo:** reuse the existing `Logo`/`Wordmark` components.

---

## Files in this package

```
design_handoff_provider_registration/
├── README.md                      ← this file
├── spec/
│   ├── 00-claude-design-handover.md  repo-grounded handover (read first)
│   ├── 01-current-state.md           as-is + maps + 12 gaps (revised)
│   ├── 02-proposed-design.md         screen-by-screen: fields, validation, states, copy (revised)
│   ├── 03-wireframe-brief.md         frame-by-frame brief (F0–F10e + F-Sys) (revised)
│   ├── 04-implementation-plan.md     ★ 6-phase build plan (revised)
│   ├── 05-executive-summary.md       summary + open decisions (revised)
│   └── 06-engineering-contracts.md   ★ drop-in engineering contracts: routes, actions, props, Zod, Prisma, resolver, DoD/phase
└── prototype/                      reference React (NOT production code)
    ├── screens-provider-register.jsx        steps 0–5 + helpers (incl. Availability)
    ├── screens-provider-register-states.jsx steps 6–9 + 5 returning states + conflict screen
    ├── screens-auth.jsx                       provider sign-in entry → "Become a provider"
    ├── ui.jsx                                 shared primitives
    ├── icons.jsx                              line-icon set
    └── tokens.jsx                             theme/token builder
```

To see the prototype running: open `Plug A Pro PWA.html` in the project root → left screen picker → **"Provider · registration (NEW)"**.
