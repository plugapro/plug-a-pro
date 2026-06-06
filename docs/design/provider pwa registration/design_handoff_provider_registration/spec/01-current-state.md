# Provider PWA Registration — Current State

**Document:** As-is discovery + UX/operational gap analysis
**Surface in scope:** Plug A Pro **PWA, provider role, registration journey only**
**Out of scope:** WhatsApp provider onboarding (referenced only where it hands off into the PWA or shares backend services)
**Produced:** 6 June 2026 · **Revised:** 6 June 2026 (repo-grounded)
**Author:** Design discovery

---

## ⚠️ Read this first — basis & confidence

This discovery was originally assembled from design-workspace artefacts, then **corrected against a live read of the `field-service/` repository** (the repo that hosts the provider PWA). Where this doc previously hedged with `⚠️ CONFIRM IN CODE`, the repo-confirmed facts below now stand. Sources:

- **Live repo read** — `field-service/` routes, API handlers, Prisma schema, `proxy.ts`, WhatsApp flows, identity-verification subsystem (2026-06-06)
- **Handover** — `provider-pwa-registration-claude-design-handover.md` (repo-evidence citations per claim)
- Data-model / auth / constraints / personas / glossary spec packs
- **Working PWA prototype** in this project — the corrected registration wireframes

> **Single most important finding (holds after repo read):** there is **no in-PWA application *capture*** today. The PWA provider surface is **sign-in for already-approved providers**; new providers are still sent to **WhatsApp** ("Send *Register*"). The proposed design is a **net-new capture flow** that must slot in alongside the *existing* `/provider/application` (read-only status) and the *existing* identity-verification subsystem — not a greenfield build.

> **Key corrections vs the first draft of this doc:** (1) the provider PWA is **in `field-service/`**, not a separate repo; (2) identity verification + private document storage **already exist** and must be reused; (3) identity is **required before credit top-up, deferrable during application** — *not* required to submit; (4) provider OTP is **sign-in only**, so registration needs its own session contract; (5) same-number customer/provider linking is **not** current policy; (6) there is **no `DRAFT` status**; (7) admin more-info **exists** but is freeform; (8) the application still stores `skills[]`/`serviceAreas[]` as **strings**.

---

## 1. As-is journey summary

### What exists today

| Surface | State today |
|---|---|
| **PWA — provider sign-in** | ✅ Built. `Provider sign in` screen: phone number → OTP → provider home. Gated to **approved** providers. |
| **PWA — provider OTP verify** | ✅ Built. 6-digit code screen, shared OTP shell with customer. |
| **PWA — provider credits/wallet** | ✅ Built. Pay@ top-up flow (`screens-provider-credits.jsx`) — balance, package picker, QR, pending, success, expired, limit. |
| **PWA — provider registration / application** | ❌ **Does not exist.** The sign-in screen explicitly routes new providers off-platform: *"Not approved yet? Apply via WhatsApp: Send 'Register'."* |
| **WhatsApp — provider application** | ◻️ Out of scope here, but it is **the only current entry point** into becoming a provider. It collects the `ProviderApplication` fields. |
| **Admin — application review** | ✅ Built. Ops/Trust review the `ProviderApplication` queue ("Applications") and move providers through the status machine. |

### The current end-to-end (as-is) path for a new provider

```
Provider hears about Plug A Pro
        │
        ▼
Opens PWA → taps "I'm a service provider" → Provider sign-in screen
        │
        ▼
Has no approved profile yet → sees "Apply via WhatsApp: Send 'Register'"
        │
        ▼  (LEAVES THE PWA)
WhatsApp application flow  ◻️ out of scope
   collects: name, phone, skills[], serviceAreas[], experience,
             availability, idNumber  → creates ProviderApplication
        │
        ▼
Admin reviews application  (Ops → Trust)
   ProviderApplication: PENDING → MORE_INFO_REQUIRED → PENDING
                        or PENDING → APPROVED / REJECTED / CANCELLED
   Provider:            APPLICATION_PENDING → UNDER_REVIEW → ACTIVE
   KYC:                 NOT_STARTED → IN_PROGRESS → SUBMITTED
                        → VERIFIED / REJECTED / EXPIRED
        │
        ▼ (on approval)
Provider returns to PWA → signs in with approved number → provider home
        │
        ▼
Tops up credits (Pay@) → unlocks leads
```

**Where it starts:** outside the PWA (WhatsApp), or the PWA sign-in screen that bounces them to WhatsApp.
**Where it ends (for the PWA):** the provider can only *re-enter* the PWA once an admin has approved them. The PWA owns none of the application capture.

---

## 2. Route map (repo-confirmed)

> The provider PWA surfaces live **in `field-service/`**. Routes below are confirmed from the repo. Any **new** unauthenticated registration route must be added to `proxy.ts` `PUBLIC_PATHS` (provider paths `/provider`, `/technician`, `/api/provider` are protected by default).

### Provider routes that exist today

| Route | Screen | Auth | Notes |
|---|---|---|---|
| `/for-providers` | Provider acquisition / marketing | public | `app/(customer)/for-providers/page.tsx` — the public "become a provider" entry |
| `/provider-sign-in` | Provider sign-in (phone) | none → OTP | Approved providers only: "Use the mobile number linked to your **approved** profile." Sends new applicants to WhatsApp ("Send 'Register'"). |
| `/provider-verify` | OTP verify | OTP | Verifies the provider **sign-in** OTP (`shouldCreateUser: false`) |
| `/provider/application` | Application **status** (read-only) | provider session | `app/(provider)/provider/application/page.tsx` — shows the latest `ProviderApplication`; says WhatsApp is the primary application channel; no record → "apply via WhatsApp" |
| `/provider/apply` | Alias | provider session | **Redirects to `/provider/application`** — do **not** repurpose as the registration route without an intentional change |
| `/provider/handoff/[token]` | Token handoff | token | Existing provider deep-link handoff |
| `/provider/verify/[token]` | **Identity-verification PWA** | token | Existing IDV capture: consent, ID basis/identifier, document + selfie completion, hosted vendor start |
| `/api/provider/identity/upload` | Identity media upload | token-gated | Uploads ID/selfie into **private** Supabase storage (`lib/storage.ts`) |
| `/provider/credits` | Wallet / Pay@ top-up | provider session | Credit purchase is **locked** until identity verification passes the HIGH-assurance credit gate |

### Provider registration (capture) routes — **none exist**

There is no in-PWA route that **creates/edits** a `ProviderApplication`. `/provider/application` is status-only; `/provider/apply` redirects to it. This is the gap the proposed design fills — with a **new, proxy-allowlisted** route (name is an open decision; do not reuse `/provider/apply`).

### Shared / adjacent routes touched

| Route | Relevance to provider registration |
|---|---|
| `/legal`, `/legal/:slug` | Provider legal pages exist; registration must link T&Cs / privacy here. |
| `/provider/handoff/[token]`, `/provider/verify/[token]` | Existing token patterns. **Do not assume** the handoff token already solves *draft* resume — draft persistence is a separate decision. |
| `proxy.ts` `PUBLIC_PATHS` | Any unauthenticated registration route must be allowlisted here or users get redirected to provider sign-in. |

---

## 3. Component map

### Reusable PWA primitives available today (from `ui.jsx` / prototype)

These already exist and should be **reused** by any registration build — do not invent new ones:

| Component | Use for registration |
|---|---|
| `AuthShell` | Eyebrow + title + subtitle + back button frame — every step screen |
| `Button` (primary / secondary / ghost / whatsapp / danger / tinted) | CTAs |
| `Input`, `PhoneInput`, `OTPInput` | Profile fields, phone confirm, OTP |
| `FieldLabel` | Field labelling |
| `Card` (padded / raised) | Grouped field blocks, summary cards |
| `Chip` / `StatusPill` (neutral/success/warn/danger/brand/whatsapp) | Category chips, status pills (never a button-in-button) |
| `Avatar` (gradient initials / photo) | Profile photo |
| `Stepper` (1–N segmented progress) | Multi-step registration progress — **already used by the customer 5-step request flow** |
| `SectionLabel` | Eyebrow + optional action |
| `StepFooter` | Sticky-bottom CTA bar (glass) — reuse for "Continue" |
| `Toast` | Save-draft / error confirmations |
| `BottomNav` | Home-only nav; **registration should be a focused flow with no bottom nav** |

### Components that **do not exist** and registration will need

| Missing component | Purpose | Severity |
|---|---|---|
| **Document / selfie capture** (ID/passport) | ✅ **Already exists** — reuse the IDV flow at `/provider/verify/[token]` + `/api/provider/identity/upload` (private storage). Do **not** build a parallel control. | n/a (reuse) |
| **Work-evidence gallery uploader** | Multi-photo grid (reuse customer 3-col photo grid pattern as a base) — distinct from identity upload | Medium |
| **Service-area / location picker** | Suburb/region multi-select from `LocationNode`, travel-radius slider, optional map pin | High |
| **Service-category selector** | Main category (from `Category` model) + secondary services + experience level | High |
| **Availability & rates** | Availability + call-out fee (onboarding completeness needs availability; call-out fee gates customer display) | High |
| **Review-and-submit summary** | Per-section edit affordances (customer flow's step-5 pattern is reusable) | Medium |
| **Application-status / state screens** | Submitted / More-info (itemized) / Approved / Not-approved — reconcile with existing `/provider/application` status route | High |
| **ID-number masked field** | Show last 4 only, explicit reveal (POPIA) — within the existing IDV flow | Medium |
| **Same-number conflict screen** | Customer number used for provider apply → separate-number policy message | Medium |

---

## 4. Server action / API map

> Repo-confirmed where named below. The missing PWA registration actions are proposed contracts, not existing code.

### Auth & session

| Mechanism | Detail |
|---|---|
| Auth provider | **Supabase Auth**. Provider session is separate from customer and admin sessions. |
| Session read | Server-side helpers in `field-service/lib/auth.ts`; provider pages enforce provider access through the existing provider auth path. Registration needs a separate pre-provider registration session. |
| Cookie | `sb-access-token`, **HttpOnly** — cannot be read by client JS. Session checks must be server-side. |
| Login channel | Provider sign-in OTP is phone-based and uses `shouldCreateUser: false`; registration OTP/session remains a new contract. |
| Role gating | `proxy.ts` protects provider paths by default; any unauthenticated `/provider/register` route must be explicitly allowlisted and enforce its own registration-session rules after the phone step. |

### Mutations (admin side, confirmed pattern)

| Action | Where | Notes |
|---|---|---|
| Any application status change | `crudAction()` (`field-service/lib/crud-action.ts`) | Wraps every admin mutation in a Prisma transaction; atomically writes `AuditLog` + `AdminAuditEvent`; validates role. **No optimistic UI** — every action is a server round-trip with loading state. |
| Application review | Admin "Applications" page → `ProviderApplication.status` transitions | `PENDING → MORE_INFO_REQUIRED → PENDING`, or `PENDING → APPROVED / REJECTED / CANCELLED` |
| Provider activation | `Provider.status` transitions | `APPLICATION_PENDING → UNDER_REVIEW → ACTIVE → SUSPENDED → ARCHIVED / BANNED` |
| KYC | `Provider.kycStatus` | `NOT_STARTED → IN_PROGRESS → SUBMITTED → VERIFIED / REJECTED / EXPIRED` |

### Provider-application creation (the missing piece)

There is **no PWA server action that creates or edits a `ProviderApplication` for registration capture** — today it is created from the WhatsApp flow. The proposed PWA registration server surface should draft first, then submit into `ProviderApplication: PENDING`.

### Known broken / incomplete server behaviour relevant here

- Provider-application notifications must be wired deliberately; do not assume an existing customer notification helper covers this flow.

---

## 5. Data model map

The backend already has the submitted provider-application, provider, category, location, wallet, and identity models. A PWA registration flow still needs additive draft/resume storage because `ProviderApplication` is shaped as a submitted/admin-reviewed record, not a partial draft.

### `ProviderApplication` (shown as "Applications" in admin) — the onboarding record

| Field | Type / note | Registration role |
|---|---|---|
| `id` | — | — |
| `providerId` | FK → Provider | Links application to provider record |
| `name` | string | Basic profile |
| `phone` | string | Account / contact (WhatsApp identity) |
| `skills[]` | string[] | Service categories / trades |
| `serviceAreas[]` | string[] | Service-area step |
| `experience` | string | Experience level / description |
| `availability` | string | Availability |
| `idNumber` | string ⚠️ **stored plaintext** | KYC — **POPIA gap**, must be masked in UI (last 4 only) and encrypted before GA |
| `status` | `ApplicationStatus` | `PENDING / MORE_INFO_REQUIRED / APPROVED / REJECTED / CANCELLED` (**no `DRAFT`** — draft persistence is an engineering decision) |
| `notes` | string | Admin review notes |
| `reviewedAt`, `reviewedById` | — | Admin audit |

### `Provider` (canonical `Provider`; role "technician")

Key registration-relevant fields: `id`, `name`, `phone`, `email`, `bio`, `skills[]`, `serviceAreas[]`, `status`, `kycStatus`, `verified`, `active`, `averageRating`, `completedJobsCount`. Relations include `technicianCertifications`, `technicianEquipment`, `providerWallet`.

- **`ProviderStatus` enum:** `APPLICATION_PENDING → UNDER_REVIEW → ACTIVE → (SUSPENDED) → ARCHIVED / BANNED`
- **`KycStatus` enum:** `NOT_STARTED | IN_PROGRESS | SUBMITTED | VERIFIED | REJECTED | EXPIRED`

### Supporting models

| Model | Registration role |
|---|---|
| `Category` (`id`, `slug`, `label`, `active`; relations `CategoryRequiredCertification`, `CategoryRequiredEquipment`) | **Service-category step.** Category may require certifications/equipment — registration can surface these requirements. The model **is live** (an old CLAUDE.md note saying it doesn't exist is outdated). |
| `LocationNode` (`nodeType` SUBURB/CITY/REGION/PROVINCE, `slug`, `label`, `parentId`, `lat`, `lng`, `radiusKm`, `postalCode`) | **Service-area step.** Areas served + travel radius. |
| `ProviderWallet` (`balance` integer credits, `status`) | **Not touched during registration** — credits/leads come *after* approval. Registration must not promise leads or take payment. |
| `technicianCertifications`, `technicianEquipment` | Optional certificates / equipment in the work-evidence step. |

### Fields summary for registration

- **Required (to submit an application):** name, phone (verified via registration OTP/session), main category, ≥1 service area, availability, call-out fee. *(Exact required-set is a product decision.)*
- **Identity verification:** **NOT required to submit** — required **before credit top-up / paid leads**, deferrable during application ("Verify now / Verify later"). Reuses the existing IDV subsystem; `idNumber` masked (last 4).
- **Optional:** business/trading name, email, bio/description, secondary services, experience level, travel radius, work-evidence photos, references, certificates, profile photo.
- **Address/location:** `serviceAreas[]` + canonical `LocationNode` IDs/slugs, travel radius, optional GPS pin.
- **Credit/voucher:** **untouched during onboarding** (post-approval, post-verification only).

---

## 6. External integrations touched

| Integration | Touched by PWA registration? | Detail |
|---|---|---|
| **Supabase Auth** | ✅ Yes | Provider session, OTP, HttpOnly cookie. |
| **Supabase Storage** | ✅ **Exists** | ID/selfie already upload to **private** storage via `lib/storage.ts` + `/api/provider/identity/upload` (token-gated). Registration adds only *work-evidence/certificate* uploads (separate, lower-sensitivity). |
| **Identity verification subsystem** | ✅ **Exists — reuse** | `ProviderIdentityVerification`, `ProviderIdentityDocument`, `VerificationVendorConfig`, allowlist, consent capture, hosted vendor start (`/provider/verify/[token]/actions.ts`). Registration should **compose** this, not reimplement it. A HIGH-assurance **credit gate** (`lib/identity-verification/credit-gate.ts`) blocks credit purchase until verified. |
| **WhatsApp (Cloud API)** | ◻️ Handoff only | Out of scope to redesign. Relevant *after* PWA registration: application-received and status-change notifications could use **pre-approved WhatsApp templates** (Meta approval, 24–72h lead time). `Customer.phone` / provider phone is the WABA recipient ID. |
| **Email / SMS** | ⚠️ Possible | OTP channel for **registration** is an open decision (provider sign-in OTP is sign-in only). Email optional for receipts. |
| **Payment / Pay@ / Peach** | ❌ Not during registration | Credits top-up is post-approval only. |

---

## 7. Current UX flow (step by step, as-is)

1. **Discovery → PWA.** Provider opens the PWA, taps **"I'm a service provider"** on the sign-in entry.
2. **Provider sign-in screen.** Titled *"Sign in to accept jobs"*, subtitle *"Use the mobile number linked to your approved Plug A Pro provider profile."* Phone field (ZA `+27` default) → **Send code**.
3. **Dead-end for new providers.** A footnote reads *"Not approved yet? Apply via WhatsApp: **Send 'Register'**"* with an "Open WhatsApp" button. **The PWA cannot register a new provider — it offloads to WhatsApp.**
4. **(WhatsApp, out of scope)** The application is captured and a `ProviderApplication` created.
5. **Admin review.** Ops triages the application and verification context. Application status moves through `PENDING`, `MORE_INFO_REQUIRED`, `APPROVED`, `REJECTED`, or `CANCELLED`.
6. **Return to PWA.** Once approved, the provider signs in with their number, receives OTP, lands on provider home, and can top up credits to unlock leads.

### What happens when…

| Situation | Today's behaviour |
|---|---|
| **Validation fails** (sign-in) | Inline validation on phone length only (`>= 9` digits). No registration validation exists because there's no registration. |
| **Document / selfie upload fails** | The existing token-gated IDV PWA owns ID/selfie upload failure states. There is no registration-context upload today; the proposed registration flow should hand off to the existing IDV flow rather than duplicating it. |
| **Provider exits mid-flow and returns** | **No PWA draft to return to.** A returning *unapproved* provider just sees the same "Apply via WhatsApp" dead-end. A returning *approved* provider signs in normally. |
| **OTP wrong code** | Error state on the OTP screen (`000000` triggers demo error). |
| **Link expired** | A generic "Link expired" screen exists (customer-oriented). No provider-specific expiry recovery. |

---

## 8. Known gaps & risks (current state, factual)

- **No PWA registration surface at all.** The single biggest gap. Providers cannot apply in the PWA; they're forced to WhatsApp, which fragments the funnel and gives the PWA no ownership of capture quality.
- **POPIA: `idNumber`.** Mask in UI (last 4) and keep within the existing private-storage IDV flow; encryption-at-rest is the standing compliance task.
- **Registration OTP/session.** Provider sign-in OTP is **sign-in only** (`shouldCreateUser: false`); registration needs its own session contract (open decision).
- **No `DRAFT` status.** `ApplicationStatus` has no draft value — autosave/resume needs an explicit persistence decision.
- **Same-number policy.** WhatsApp onboarding **blocks** a customer number from also being a provider; same-number multi-role is not current behaviour.
- **Application stores strings.** `skills[]`/`serviceAreas[]` are free text; structured `Category`/`LocationNode` enrichment happens only after provider-record sync.
- **`field-service/` hosts the PWA.** Routes + `proxy.ts` allowlisting must be handled there for any new public route.

---

# UX and Operational Gaps

Gaps specific to the **provider registration experience** (current or imminent). Because no PWA registration exists yet, several gaps are framed as "what will bite us the moment we build naively" — they are still actionable and severity-rated.

> **Severity key:** **High** = blocks launch or creates trust/compliance/conversion failure · **Medium** = meaningful friction or operational cost · **Low** = polish.

---

### G1 — Registration is off-platform (WhatsApp-only), so the PWA owns no capture quality
- **Issue:** New providers are bounced to WhatsApp to "Send Register". The PWA has no application flow.
- **Where:** Provider sign-in screen footnote (`screens-auth.jsx`); no `/provider/register` route.
- **Why it matters:** WhatsApp text capture is unstructured and error-prone for `skills[]`, `serviceAreas[]`, and document quality. It fragments the funnel, makes drop-off invisible, and prevents validation at capture time. Document/selfie quality over WhatsApp is unreliable (the customer blueprint already chose PWA-only for photos for exactly this reason).
- **Severity:** **High**
- **Improvement:** Build the PWA registration flow (Task 3). Keep WhatsApp as a *referral/entry* channel that deep-links into the PWA, not as the capture mechanism.

### G2 — Tradesperson on a cheap Android phone, variable LTE
- **Issue:** No mobile-optimised, low-bandwidth, resumable flow exists.
- **Where:** Whole journey (to be built).
- **Why it matters:** SA providers are often on entry-level Android in the field on metered/variable data. Large uploads, JS-heavy screens, and non-resumable forms cause abandonment and data-cost resentment.
- **Severity:** **High**
- **Improvement:** Mobile-first single-column, client-side image compression before upload, chunked/retryable uploads, autosave-as-draft on every step, works in WhatsApp in-app browser, large 44px+ targets.

### G3 — First-time, non-tech-savvy provider has no guidance or reassurance
- **Issue:** No "what you'll need", no progress sense, no plain-language explanation of review/approval.
- **Where:** No landing/welcome screen exists.
- **Why it matters:** Providers abandon when they hit an ID/selfie step unprepared, or distrust why their ID is requested. Trust is the conversion lever for this audience.
- **Severity:** **High**
- **Improvement:** Welcome screen explaining Plug A Pro, the review step, and a checklist of what to have ready (ID, selfie, optional work photos). Trust/privacy microcopy at the verification step.

### G4 — Customer/provider role confusion at the entry point
- **Issue:** A single sign-in/sign-up surface where role is chosen by a button; role has two backend sources of truth.
- **Where:** `/login` split (`screens-auth.jsx`), `proxy.ts` vs `crudAction()` role check.
- **Why it matters:** A provider who already has a *customer* account (very common — they're also consumers) can get into a confusing state. Inconsistent gating risks showing the wrong home.
- **Severity:** **High**
- **Improvement:** Detect when a number already belongs to a **customer** account and show the **separate-number policy** (current WhatsApp onboarding blocks same-number provider+customer). Same-number multi-role is a future architecture decision, not MVP behaviour.

### G5 — Low-trust / fraud risk at intake
- **Issue:** Identity verification exists but isn't surfaced in a registration context; ID number should be masked.
- **Where:** Existing IDV subsystem (`ProviderIdentityVerification`, `/provider/verify/[token]`); `ProviderApplication.idNumber`.
- **Why it matters:** Field-service marketplaces are high-fraud. Intake quality + a clear path into the existing IDV flow reduces trust/safety incidents and admin burden.
- **Severity:** **High**
- **Improvement:** Route providers into the **existing** identity-verification flow (reuse, don't rebuild); mask ID (last 4); keep clear consent copy. Frame verification as **required before credit top-up, deferrable during application**.

### G6 — Admin more-info is freeform, not itemized
- **Issue:** Admin "request more info" **already exists** (sets `MORE_INFO_REQUIRED`, reason in `notes`; resume returns to `PENDING`) — but it's freeform, with no PWA "fix exactly this" screen.
- **Where:** `admin/applications/page.tsx` (`requestMoreInfo`); `lib/provider-applications.ts` (resume).
- **Why it matters:** Freeform notes are hard for a provider to action precisely; round-trips are slow.
- **Severity:** **Medium**
- **Improvement:** Build a **targeted PWA fix screen** that renders itemized requested fields where available and falls back to the freeform `notes`; preserve all other submitted data read-only; route the provider in from the WhatsApp/SMS notification.

### G7 — No re-entry / resume after abandonment
- **Issue:** No saved draft; **no `DRAFT` status exists** in `ApplicationStatus`.
- **Where:** `ApplicationStatus` = `PENDING / MORE_INFO_REQUIRED / APPROVED / REJECTED / CANCELLED`. The existing provider handoff token should **not** be assumed to solve drafts.
- **Why it matters:** Multi-step guarantees mid-flow exits. Without resume, providers restart from zero and most won't.
- **Severity:** **High**
- **Improvement:** Add a separate `ProviderApplicationDraft` table and hash-only resume deep link; keep `ProviderApplication` for submitted/admin-reviewed records.

### G8 — Credits / leads / approval status are unexplained and easily over-promised
- **Issue:** Nothing explains that credits ≠ rand, that leads come only after approval, or what approval means.
- **Where:** Credits exist (`screens-provider-credits.jsx`) but registration doesn't set expectations; glossary warns credits are integers, never "R X".
- **Why it matters:** Over-promising leads pre-approval erodes trust and creates support load; conflating credits with rand is a known footgun.
- **Severity:** **Medium**
- **Improvement:** Pending-approval screen sets honest expectations ("you can't receive leads until approved"); defer all credit/lead UI until `Provider.status = ACTIVE`; never show credits as rand.

### G9 — Registration upload UX doesn't exist (but identity upload does)
- **Issue:** There's no *registration-context* upload UX; however **identity upload UX exists** in the token-gated verification flow and must be reused.
- **Where:** `/provider/verify/[token]` + `/api/provider/identity/upload` exist; work-evidence/certificate upload in registration does not.
- **Why it matters:** Reusing the existing identity capture avoids a parallel, divergent upload path; only the (lower-sensitivity) work-evidence uploader is genuinely new.
- **Severity:** **High**
- **Improvement:** Compose the existing IDV capture for ID/selfie; build only the work-evidence/certificate uploader (camera-first, compression, retry, "finish later" that preserves the draft).

### G10 — Application capture stores strings, not structured IDs
- **Issue:** `ProviderApplication.skills[]`/`serviceAreas[]` are free-text strings; structured `Category`/`LocationNode` enrichment only happens **after** provider-record sync.
- **Where:** `ProviderApplication` (strings) vs `Category` / `LocationNode` / `ProviderCategory` / `TechnicianServiceArea` (structured).
- **Why it matters:** If the PWA shows structured pickers but submits only labels, matching/enrichment can't use the structured data.
- **Severity:** **High**
- **Improvement:** Structured pickers bound to `Category` and `LocationNode`; **persist both display labels and canonical IDs/slugs** on the draft/application so matching and enrichment work pre- and post-approval.

### G11 — Mobile performance & in-app-browser constraints
- **Issue:** No performance budget; must work in WhatsApp's in-app browser.
- **Where:** PWA-wide (no LCP/CLS/TTI targets in specs).
- **Why it matters:** Many providers arrive via a WhatsApp link → in-app browser (limited APIs, no install). Heavy JS / uncompressed images fail there.
- **Severity:** **Medium**
- **Improvement:** Set a performance budget; server-render where possible; test the whole flow inside WhatsApp's in-app browser; progressive enhancement for camera/file APIs.

### G12 — POPIA / privacy posture is reactive
- **Issue:** Plaintext ID, no documented consent capture, no data-minimisation framing.
- **Where:** Schema TODO; no consent UI in registration (doesn't exist).
- **Why it matters:** Collecting ID + selfie is special personal information under POPIA §26. Getting consent, masking, retention, and access right is a legal requirement, not a nicety.
- **Severity:** **High**
- **Improvement:** Explicit consent checkbox with link to provider privacy page; mask ID; private storage with admin-only signed access; document retention; plan field encryption before GA.

---

## What is PWA-only vs what touches WhatsApp (clear statement)

| Concern | PWA-only | Touches WhatsApp |
|---|---|---|
| Application capture (proposed) | ✅ PWA owns it (Task 3) | WhatsApp may *refer in* via a deep link only |
| Document / selfie / work-evidence upload | ✅ PWA-only (reliability) | ❌ never over WhatsApp |
| Phone OTP | ✅ PWA performs it | ⚠️ OTP *channel* may be WhatsApp or SMS (unconfirmed) |
| Admin review | ✅ Admin console | ❌ |
| Status notifications (received / approved / more-info / rejected) | Triggered by PWA/admin events | ✅ Delivered via WhatsApp template (and/or SMS/email) — **post-registration touchpoint only** |
| Resume-draft entry | ✅ PWA screens | ✅ Deep link may be delivered via WhatsApp |
| Credits / leads | ✅ PWA (post-approval) | ❌ not in registration |

**Scope guardrail:** This pack does **not** redesign the WhatsApp provider onboarding journey. It only defines the PWA registration journey and the *post-PWA* notification touchpoints that hand back to WhatsApp/SMS/email.

---

## Screenshots

Easy to generate from this project's prototype (the live provider screens):

- **Provider sign-in (current dead-end):** `Plug A Pro PWA.html` → Screens picker → provider sign-in (`ScreenProviderSignIn`). Shows the "Apply via WhatsApp: Send 'Register'" footnote — *the* evidence that no PWA registration exists.
- **Provider OTP verify:** same picker → OTP with `role: 'provider'`.
- **Provider credits/wallet:** `ScreenProviderCredits` and the Pay@ QR/pending/success/expired states.

Reference images already in the workspace: `uploads/04-provider-sign-in.png`, `uploads/05-provider-verify-otp.png`, `uploads/02-providers.png` (admin providers list).

**Should be screenshotted manually (not in this workspace):**
- The **WhatsApp** "Register" application flow (out of scope to redesign, but useful as the as-is baseline).
- The **admin Applications** review screen against live data.
- The PWA running **inside WhatsApp's in-app browser** on a real low-end Android device.
