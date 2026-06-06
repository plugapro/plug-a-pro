# Provider PWA Registration — Proposed Design

**Document:** Proposed end-to-end design for the improved PWA provider registration journey
**Surface:** Plug A Pro PWA, provider role, mobile-first (390px design width)
**Status:** Design proposal for review — **not yet built**. Suitable for wireframing by the design team.
**Produced:** 6 June 2026
**Companion docs:** `provider-pwa-registration-current-state.md`, `provider-pwa-registration-wireframe-brief.md`

---

## Design principles (the spine of every screen)

1. **Trust before data.** Explain *why* before *what* — especially for ID and selfie. Reassurance is the conversion lever for this audience.
2. **One thing per screen.** Each step asks for one coherent chunk. No mega-forms.
3. **Always resumable.** Autosave a draft on every step. Leaving never loses progress.
4. **Honest about approval.** Never promise leads or earnings before approval. Set expectations early and at the end.
5. **Low-bandwidth by default.** Compress images client-side; works inside WhatsApp's in-app browser on entry-level Android.
6. **Plain South African English.** Short sentences. No jargon ("KYC", "liveness") in provider-facing copy.
7. **Structured capture.** Categories and areas bind to `Category` / `LocationNode`, never free text.

---

## Proposed end-to-end flow

```
Entry (PWA "Become a provider" CTA  OR  WhatsApp "Register" deep link)
        │
        ▼
 0. Welcome / what you'll need          ──────────────┐
        │                                              │ autosave draft
 1. Confirm mobile number (registration OTP/session)  │ on every step,
        │                                              │ resumable via
 2. Basic profile                                      │ deep link
        │                                              │
 3. Services (→ Category)                              │
        │                                              │
 4. Service area (→ LocationNode + radius)             │
        │                                              │
 5. Availability & rates                               │
        │                                              │
 6. Identity verification  (CHOICE: Verify now/later)  │
        │   → "Verify now" reuses /provider/verify flow  │
 7. Work evidence (optional)                           │
        │                                              │
 8. Review & submit  ←───────── edit any section ─────┘
        │
        ▼  submit → ProviderApplication: PENDING  (identity may be deferred)
 9. Submitted / pending approval
        │
        ▼  (admin review, async)
10. Returning-provider states:
      Draft incomplete · Submitted (pending) ·
      More info required (itemized + notes fallback) ·
      Approved (credits gated on verify) · Not approved
```

**Step count:** 8 numbered capture steps after the welcome screen (1–8), plus a welcome screen (0), submitted state (9), and returning states (10). Identity verification (step 6) is deferrable with **Verify later**; work evidence (step 7) is optional with **Skip for now**. **Identity verification is NOT a submit gate** — it is required before credit top-up. Aim for **~5–8 minutes** for a prepared provider.

> **Revised against `field-service/` (2026-06-06).** Three structural changes vs the first draft: (a) a new **Availability & rates** step (onboarding completeness needs availability; call-out fee gates customer display); (b) **Verification became a deferrable choice**, not a trust-critical submit gate — "Verify now / Verify later", reusing the existing IDV flow; (c) Step 1 OTP is a **separate registration session** (provider sign-in OTP is sign-in only). Same-number customer+provider linking is **out** (separate-number policy).

---

## Global patterns (apply to all steps)

- **Layout:** single column, mobile-first; sticky bottom **`StepFooter`** with the primary CTA (glass background, always reachable); back arrow top-left; **`Stepper`** under the back row showing progress (e.g. "Step 3 of 8").
- **No bottom nav** during registration — it's a focused flow.
- **Autosave:** every "Continue" persists the draft server-side (and a local fallback). A subtle "Saved" toast on first save per session.
- **Save & exit:** a ghost "Save & finish later" affordance in the header on every step → confirms the draft is saved and how to return.
- **Validation timing:** validate on blur and on Continue; never block typing. Errors are inline, specific, and below the field.
- **Loading:** Continue button shows a spinner + disabled state on every server round-trip (matches admin `SubmitButton` discipline — no optimistic UI for the submit).
- **Accessibility:** 44px+ targets, labelled inputs, visible focus ring (`--brand-purple`), no colour-only status.

---

## Screen-by-screen design notes

> Microcopy below is **suggested plain-English** copy, ready to drop into wireframes. ZA spelling. Brand tone: warm, direct, respectful.

---

### Step 0 — Welcome / "What you'll need"

**Purpose:** Explain Plug A Pro to a provider in one screen, set the review expectation, list what to have ready, and start.

**Content:**
- Logo + one-line value prop.
- 3 short bullets: what Plug A Pro is, that providers are **reviewed before they can receive jobs**, and that it's free to apply.
- "What you'll need" checklist with icons, not emoji text: Your SA ID or passport · A selfie · Photos of past work (optional) · About 5–8 minutes.
- Primary CTA: **Get started**. Secondary: **I already have a provider account → Sign in**.

**Fields:** none.
**Validation:** none.
**Empty/loading/error:** static screen; no states.
**Microcopy:**
- Title: *"Get work near you with Plug A Pro"*
- Body: *"Plug A Pro connects skilled tradespeople with customers nearby. Apply once, get verified, and start receiving job leads in your area."*
- Reassurance: *"Every provider is reviewed before going live — this keeps customers safe and your profile trusted."*
- CTA: **Get started** · *"Free to apply. No credits needed yet."*

---

### Step 1 — Confirm mobile number (registration OTP/session)

**Purpose:** Confirm the provider's mobile number, handle returning/conflicting numbers, and establish a **registration** session.

> **Registration OTP/session is a separate contract (decision required).** The existing provider sign-in OTP is **sign-in only** (`shouldCreateUser: false`) and must not be reused as-is. Pick one: (1) a new provider-registration OTP endpoint/session; (2) the existing endpoint extended with an explicit `intent: "registration"`; or (3) a WhatsApp deep-link session token for v1. Frame as **decision required** until engineering chooses.

**Content:**
- ZA phone input (`+27` default; accept `082…`, `27…`, `+27…`).
- Explanation that this number becomes their provider login and is how customers' jobs reach them after approval.
- OTP step (6-digit) after "Send code".

**Fields:** `phone` (required), `otp` (required, 6 digits).
**Validation:**
- Phone: ≥ 9 digits after normalisation; valid ZA format.
- OTP: exactly 6 digits; server-validated; resend with cooldown. Preserve anti-enumeration behaviour (uniform "verify" response).
**Number logic (key):**
- If the number has **no account** → continue as new provider registration.
- If the number is an **existing customer** → **separate-number policy** (current WhatsApp onboarding blocks same-number provider+customer). Show the conflict screen: provider & customer profiles need different numbers; offer "use a different number" + support. *(Same-number multi-role is an open architecture decision, not MVP.)*
- If the number is an **existing provider** (any status) → route to sign-in / the matching **returning state** (Step 10), not a fresh application.
**Error states:** wrong OTP ("That code didn't match — try again"); expired OTP ("Code expired — resend"); too many attempts (cooldown + support link).
**Microcopy:**
- Title: *"What's your mobile number?"*
- Helper: *"We'll send a code to confirm it's you. This becomes your provider login."*
- Conflict note: *"That number is a customer account. For now, provider and customer profiles need separate numbers."*

---

### Step 2 — Basic profile

**Purpose:** Capture identity-level basics.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Full name | ✅ | As on ID — used for verification |
| Business / trading name | ◻️ optional | If they trade under a name |
| ID type | ✅ | SA ID / Passport (radio) — drives the identity step |
| Preferred contact method | ✅ | WhatsApp / Call / SMS (default WhatsApp) |
| Email | ◻️ optional | For receipts/notifications |
| Profile photo | ◻️ optional (recommended) | Shown to customers later; reuse `Avatar` |

**Validation:** name non-empty (2+ words encouraged, not enforced); email format if provided; contact method required.
**Error states:** inline per field.
**Empty state:** profile-photo slot shows gradient initials placeholder.
**Microcopy:**
- Title: *"Tell us who you are"*
- Name helper: *"Use your full name as it appears on your ID — it helps us verify you faster."*
- Photo helper: *"A clear photo builds trust with customers. You can add this later."*

---

### Step 3 — Services

**Purpose:** Structured capture of trade(s), bound to `Category`. **Persist canonical IDs/slugs, not just labels** (the application currently stores strings; matching/enrichment needs structured IDs).

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Main trade / category | ✅ | Single-select from `Category` (e.g. Plumbing, Electrical, Painting) |
| Secondary services | ◻️ optional | Multi-select chips, also `Category` |
| Experience level | ✅ | <1yr / 1–3 / 3–5 / 5–10 / 10+ (radio) |
| Short description | ◻️ optional | 1–2 sentences, max ~300 chars |

**Validation:** main category required; description length-capped with live counter.
**Category requirements surfacing:** if the chosen `Category` has `CategoryRequiredCertification` / `CategoryRequiredEquipment`, show an informational note: *"Plumbing may require a PIRB certificate — you can add it in the next steps or after approval."* (Informational, not a hard block at MVP.)
**Empty state:** category grid with icons; search/filter if list is long.
**Error states:** "Choose your main trade to continue."
**Microcopy:**
- Title: *"What kind of work do you do?"*
- Helper: *"Pick your main trade. You can add other services you offer too."*

---

### Step 4 — Service area

**Purpose:** Where they work, bound to `LocationNode`; travel radius.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Base location / suburb | ✅ | `LocationNode` (SUBURB), with search |
| Areas served | ✅ | Multi-select suburbs/regions from `LocationNode` |
| Travel radius | ◻️ optional | Slider (e.g. 5–50 km) around base |
| Map pin | ◻️ optional | If supported — drop a pin for base location |

**Validation:** at least one served area required; radius within bounds. **Persist `LocationNode` IDs/slugs alongside display labels.**
**Map note:** optional GPS capture; degrade gracefully where the in-app browser blocks geolocation (fall back to suburb search).
**Empty state:** "Search for your suburb to begin."
**Error states:** "Add at least one area you can work in."
**Microcopy:**
- Title: *"Where do you work?"*
- Helper: *"Choose the areas you can travel to. We'll only send you jobs in these areas."*
- Privacy note: *"Your exact address is never shown to customers."*

---

### Step 5 — Availability & rates

**Purpose:** Capture when the provider works and their call-out fee. Onboarding completeness requires availability; the **call-out fee gates customer display** (so capture it before review / mark as needed before going live).

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Days available | ✅ | Day toggles + quick presets (Weekdays / Weekends / Every day) |
| Working hours | ✅ | Standard / Extended / 24-7 (radio) |
| Emergency availability | ◻️ optional | After-hours call-outs (toggle) |
| Call-out fee | ✅ | Rand amount; shown to customers; needed before profile goes live |

**Validation:** ≥ 1 day; call-out fee present (numeric).
**Microcopy:**
- Title: *"When can you work?"*
- Helper: *"This helps us match you to jobs at the right times. You can change it anytime."*
- Fee note: *"Shown to customers. Needed before your profile can go live — you can refine it later."*

---

### Step 6 — Identity verification (choice — *not a submit gate*)

**Purpose:** Offer identity verification **now or later**. Per repo policy, verification is **required before buying credits / paid lead access**, but is **deferrable during application** — it does **not** block submitting. Reuse the **existing** identity-verification flow (`/provider/verify/[token]`, `ProviderIdentityVerification` / `ProviderIdentityDocument`, `/api/provider/identity/upload`, private storage, consent capture).

> If product decides identity must be **submit-blocking**, this becomes a required step and the implementation plan must change the current completeness policy, admin expectations, and funnel copy. Default (recommended): deferrable.

**Screen = a choice, with two actions:**
- Primary: **Verify now** → hands off to the existing IDV flow (ID/passport number masked, document, selfie, consent).
- Secondary: **Verify later** → continue to the next step; application can still be submitted.
- Copy: *"Required before you can buy credits and unlock paid lead access."*

**Identity capture (when "Verify now") — fields:**
| Field | Required | Notes |
|---|---|---|
| ID / passport number | ✅ | **Masked input**; shown as last 4; never echoed in plaintext |
| ID / passport document | ✅ | Camera-first capture or file upload |
| Selfie | ✅ | Front-camera capture; retry; optional liveness via vendor |
| Consent | ✅ | Agree to identity verification + privacy policy |

**Why-first pattern:** a short reassurance block **above** the inputs: who sees it, why, stored securely (reuses the existing secure flow).
**Validation:** within the capture, ID number format (SA ID 13-digit checksum / passport pattern); document present and legible; selfie captured; consent ticked. *(These gate completing verification — not submitting the application.)*
**Upload behaviour:** client-side compression; chunked/retryable upload; per-file progress; clear failure with **Retry** and a **"Do this later"** escape that keeps the rest of the draft.
**Error states:**
- Upload failed: *"Upload didn't finish — check your signal and try again."* + Retry.
- Blurry/too small: *"That photo is hard to read. Take it again in good light."*
- ID mismatch (if IDV automated): *"We couldn't match your selfie to your ID. You can retry or our team will review it manually."* (never a hard reject in-flow).
**Privacy / trust microcopy:**
- Title: *"Verify your identity"*
- Reassurance: *"We ask for your ID and a selfie to keep customers and providers safe. Your documents are stored securely and only seen by our verification team — never by customers."*
- Consent: *"I agree to Plug A Pro verifying my identity and I've read the Privacy Policy."* (links to provider privacy page in `/legal`).

---

### Step 7 — Work evidence (optional)

**Purpose:** Let providers strengthen their profile with proof of work. Entirely optional — never a blocker.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Photos of previous work | ◻️ optional | Multi-photo grid (reuse customer 3-col photo pattern), up to ~6 |
| References | ◻️ optional | Name + phone, repeatable (1–3) |
| Certificates | ◻️ optional | Upload (maps to `technicianCertifications`) |

**Validation:** none required; if a reference phone is entered, validate format.
**Empty state:** friendly "Add photos of jobs you're proud of — this helps customers choose you." with a **Skip for now** CTA.
**Error states:** per-upload retry (same as the identity capture).
**Microcopy:**
- Title: *"Show your work (optional)"*
- Helper: *"Photos and references help you win more jobs once you're approved. You can add these now or later."*
- Skip: **Skip for now**

---

### Step 8 — Review & submit

**Purpose:** Single summary of everything, with per-section edit, and an honest "what happens next". **Identity may be deferred** — submission is allowed without it.

**Content:** Sectioned summary (Profile · Services · Area · Availability & rates · Work evidence), each with an **Edit** affordance. A separate **identity status** block: if not yet verified, show *"Identity not verified yet · required before buying credits"* with a **Verify** action — but it does **not** block submit. If verified, show ID as last-4 + "verified".
**Fields:** T&Cs acceptance.
**Validation:** required capture steps complete (profile, services, area, availability/rates); identity is **not** a submit requirement. Missing required items flag their section with "Finish this to submit".
**"What happens next" footer:** *we review → you get a message → if approved you can verify (if you haven't), set up credits, and receive leads.*
**Loading:** Submit shows spinner; on success → Step 9.
**Error states:** submit failure → "Couldn't submit — your details are saved. Try again." (draft preserved).
**Microcopy:**
- Title: *"Check your details"*
- Submit CTA: **Submit application**
- Footer: *"What happens next: our team reviews your application, we'll message you on WhatsApp with the result, and once you're approved you can verify your identity, top up credits, and start receiving job leads."*

---

### Step 9 — Submitted / pending approval

**Purpose:** Confirm submission, explain review, give the provider something useful to do while waiting, and avoid over-promising.

**Content:**
- Success confirmation (not celebratory-overblown — calm and credible).
- Clear status: *"Application received — under review."*
- What happens next + (soft) expected timeframe if available.
- "While you wait" suggestions: complete optional work evidence, read the provider guide, save the app to home screen.
- **No credit purchase, no lead browsing** — explicitly gated until approval.
- Secondary: contact support; sign out.
**States:** this is itself a state screen; no inputs.
**Microcopy:**
- Title: *"Application received"*
- Body: *"Thanks, [name]. Our team is reviewing your details. We'll message you on WhatsApp as soon as there's an update."*
- Honest gate: *"You can't receive job leads until your application is approved — we'll let you know the moment you're live."*
- While-you-wait: *"In the meantime, you can add photos of your work to strengthen your profile."*

---

### Step 10 — Returning-provider states

When a provider returns (signs in, or taps a deep link), the **state resolver** routes them to the correct screen based on `ProviderApplication.status` + `Provider.status`. Five states:

| State | Trigger | Screen | Primary action | Microcopy |
|---|---|---|---|---|
| **Draft incomplete** | Active `ProviderApplicationDraft`, not yet submitted | Resume screen showing % complete + which step is next | **Continue application** | *"Welcome back — your application is saved. Pick up where you left off."* |
| **Submitted — pending review** | `ApplicationStatus: PENDING` | Status screen | View status / Add work evidence | *"Your application is under review. We'll message you on WhatsApp with the result."* |
| **More info required** | `ApplicationStatus: MORE_INFO_REQUIRED` (admin sets it; reason in `notes`) | Targeted fix screen | **Update and resubmit** | *"We need one more thing to finish your review. Update it and resubmit — everything else is saved."* |
| **Approved** | `Provider.status: ACTIVE` | Welcome-aboard screen; **credits gated on identity verification** | **Verify identity to unlock credits** (if unverified) / Find jobs | *"You're approved. Verify your identity to buy credits and start receiving paid leads."* |
| **Not approved** | `ApplicationStatus: REJECTED` | Respectful outcome + next steps | Contact support / Reapply (if allowed) | *"We're not able to approve your application right now. If you think this is a mistake, contact our team."* |

**Design notes for state screens:**
- **More info required** should render **itemized** requested fields where available and **fall back to the freeform admin `notes`** (current model stores a freeform reason). Pre-open the flagged items; keep the rest read-only.
- **Approved** must reflect the **credit gate**: an approved-but-unverified provider can't buy credits until they complete the existing identity flow.
- **Not approved** must be respectful and non-dead-end where policy allows reapplication; never expose internal fraud signals.

---

## Field list per screen (consolidated)

| Step | Required | Optional |
|---|---|---|
| 0 Welcome | — | — |
| 1 Phone | phone, otp (registration session) | — |
| 2 Profile | full name, ID type, preferred contact | business name, email, profile photo |
| 3 Services | main category (+ canonical id), experience level | secondary services, description |
| 4 Area | base location, ≥1 area served (+ LocationNode ids) | travel radius, map pin |
| 5 Availability & rates | ≥1 day, working hours, call-out fee | emergency availability |
| 6 Identity | *(deferrable)* — if Verify now: ID number, document, selfie, consent | — |
| 7 Work evidence | — | work photos, references, certificates |
| 8 Review | T&Cs confirm | — |

*Identity (Step 6) is **not** required to submit — it's required before credit top-up.*

---

## Validation rules summary

- **Phone:** normalised ZA format; OTP 6 digits, resend cooldown, attempt cap.
- **Name:** non-empty; trim; encourage full name.
- **Email:** RFC-ish format only if provided.
- **ID number:** SA ID → 13 digits + Luhn check + date plausibility; Passport → alphanumeric pattern. Masked display.
- **Documents/selfie:** present, min resolution/size, max file size (post-compression), accepted MIME types; retry on failure.
- **Category:** main category required; description ≤ ~300 chars.
- **Area:** ≥ 1 served `LocationNode`; radius within min/max.
- **Consent/T&Cs:** provider terms acceptance is required before application submit. Identity-verification consent is separate and required only when the provider chooses **Verify now**.

---

## State coverage matrix (every screen)

| State | Where it appears |
|---|---|
| **Empty** | Photo/profile-photo slots, area search, work-evidence grid → friendly prompts + skip |
| **Loading** | OTP send/verify, every Continue (server save), uploads (progress), Submit |
| **Success** | "Saved" toast on draft save; Step 9 submitted; Step 10 approved |
| **Error** | Inline field errors; upload failure + retry; OTP errors; submit failure (draft preserved) |
| **Re-entry** | Step 10 five states via resolver |

---

## Admin dependency points

These are where the provider experience depends on admin/backend action — call them out in design so status is always honest:

1. **Review trigger:** submitting creates/updates `ProviderApplication: PENDING`; appears in admin Applications queue.
2. **Status transitions:** admin moves `PENDING → APPROVED / REJECTED / MORE_INFO_REQUIRED`; provider `APPLICATION_PENDING → UNDER_REVIEW → ACTIVE`. All via `crudAction()` (audited).
3. **More-info request:** admin action **already exists** (`requestMoreInfo` → `MORE_INFO_REQUIRED`, reason in `notes`; resume returns to `PENDING`). The gap is an **itemized** PWA fix screen + better routing from the notification — not the action itself.
4. **Credit gate:** the PWA gates credit purchase on **identity verification** (HIGH-assurance credit gate), not merely on `Provider.status = ACTIVE`.
5. **ID masking / access:** admin sees full ID only on explicit reveal; documents live in the existing private storage with signed access.

---

## WhatsApp / email notification touchpoints (post-registration only)

> Not a redesign of WhatsApp onboarding — these are the *outbound* messages triggered **after** PWA events. All WhatsApp messages use **pre-approved templates** (Meta approval, 24–72h lead time). Provide SMS/email fallback where a template isn't ready.

| Event | Channel(s) | Message intent |
|---|---|---|
| Application submitted | WhatsApp (template) + optional email | "We've received your application — under review." |
| More info required | WhatsApp (template) | "We need one more thing — tap to update." (deep link to More-info state) |
| Approved | WhatsApp (template) | "You're approved — you can now receive leads." (deep link to provider home) |
| Not approved | WhatsApp (template) | Respectful outcome + support contact. |
| Draft abandoned (nudge, optional) | WhatsApp/SMS | "Your application is saved — finish in a few minutes." (deep link to resume) |

Each deep link is a **tokenised resume/handoff URL** (provider analogue of `customerAccessToken` / `/client/handoff/:token`).

---

## What this design deliberately does **not** do (MVP guardrails)

- Does **not** take payment or sell credits during registration.
- Does **not** promise leads, earnings, or a job count before approval.
- Does **not** redesign WhatsApp onboarding — only the PWA flow + outbound notifications.
- Does **not** require automated IDV — it composes the existing manual and hosted-vendor identity subsystem, including Didit where enabled.
- Does **not** introduce new provider, identity, wallet, category, or location models. It does introduce additive draft/resume storage by default because `ProviderApplication` remains the submitted/admin-reviewed record.
