# Provider PWA Registration — Wireframe Brief

**For:** UI/UX designer creating mobile-first Figma wireframes
**Surface:** Plug A Pro PWA · provider role · registration journey
**You do not need to read the codebase.** Everything required to wireframe is in this brief. Deep technical detail lives in the companion docs if you want it.
**Produced:** 6 June 2026

---

## 1. Design objective

Design the **mobile-first PWA journey that lets a tradesperson apply to become a Plug A Pro provider**, get verified, and understand their approval status — replacing today's "apply via WhatsApp" dead-end with a structured, trustworthy, resumable in-app flow.

The output is **high-fidelity mobile frames** of every frame listed in §11, covering the happy path plus key empty/error/loading/re-entry states. Use the existing Plug A Pro visual system and tokens; do not invent a new design system.

---

## 2. Target user

**Primary:** A South African tradesperson (plumber, electrician, painter, handyman, etc.), often:
- On an **entry-level Android phone**, sometimes via **WhatsApp's in-app browser**.
- On **variable/metered mobile data** — data cost matters.
- **Not highly tech-savvy** — may be wary about sharing an ID.
- Motivated by **getting paid work nearby**, sceptical of scams.

**Secondary:** A provider returning to check status or fix something requested by the review team.

---

## 3. Design principles

1. **Trust before data** — explain *why* before asking, especially for ID/selfie.
2. **One thing per screen** — short steps, clear progress.
3. **Always resumable** — leaving never loses progress.
4. **Honest about approval** — never promise leads/earnings before approval.
5. **Low-bandwidth** — lightweight screens, compress images.
6. **Plain SA English** — no jargon ("KYC", "liveness") in user-facing copy.
7. **Big, reachable targets** — 44px+, sticky bottom CTA.

---

## 4. Screen list (happy path)

0. Welcome / what you'll need
1. Mobile number + OTP (registration session, separate-number policy)
2. Basic profile
3. Services
4. Service area
5. Availability & rates
6. Identity verification (choice: Verify now / Verify later — *not* a submit gate)
7. Work evidence (optional)
8. Review & submit
9. Submitted / pending approval
10. Returning states: Draft · Pending · More info required (itemized + freeform notes fallback) · Approved (credits gated on verify) · Not approved

---

## 5. Flow diagram (text form)

```
[Entry: PWA "Become a provider"  OR  WhatsApp "Register" deep link]
   │
   ▼
(0) Welcome ─▶ (1) Mobile + OTP ─▶ (2) Profile ─▶ (3) Services ─▶ (4) Area
                                                                  │
                                                                  ▼
                              (5) Availability & rates ─▶ (6) Identity (choice)
                                                                  │
                                                                  ▼
                              (8) Review ◀── (7) Work evidence ◀── (optional)
                                   │
                                   ▼ submit (identity may still be deferred)
                              (9) Submitted / pending
                                   │
                          (admin review, async)
                                   ▼
              ┌──────────────┬───────────────┬──────────────┬───────────────┐
        Draft incomplete  Pending review  More info required   Approved      Not approved
        (resume)          (status)        (itemized + notes)   (credits      (support/reapply)
                                                                gated on
                                                                identity)

Back on every step. "Save & finish later" on every step.
Any Review section → Edit → jumps to that step → returns to Review.
Identity capture (Verify now) reuses the existing /provider/verify/[token] flow.
```

---

## 6. Key UI components (already exist — reuse, don't reinvent)

The PWA has a component kit. Wireframe with these patterns so handoff to build is 1:1:

- **AuthShell / step frame** — eyebrow + title + subtitle + back button.
- **Stepper** — segmented "Step X of 8" progress under the back row.
- **StepFooter** — sticky bottom bar holding the primary CTA (glass background).
- **Button** — primary / secondary / ghost / WhatsApp / danger variants.
- **Input / PhoneInput (ZA +27) / OTPInput.**
- **Card** — grouped field blocks and summary cards.
- **Chip / StatusPill** — category chips, status pills (status pill is non-tappable inside rows).
- **Avatar** — profile photo / gradient initials.
- **Photo grid** — 3-column upload grid (reused from the customer request flow).
- **Toast** — "Saved" / error confirmations.

**New patterns to design (don't exist yet):** service-area picker (suburb search + radius slider + optional map), work-evidence/certificate uploader, application-status banners, and identity status blocks. ID/selfie capture is visually referenced only where needed; production reuses the existing `/provider/verify/[token]` IDV flow.

---

## 7. Required content per screen

| Screen | Must contain |
|---|---|
| 0 Welcome | Value prop, "reviewed before going live" note, "what you'll need" checklist, time estimate, primary CTA, "already have an account" link |
| 1 Mobile + OTP | ZA phone input, why-we-ask helper, OTP entry, resend, **separate-number conflict screen** if the number is already a customer (separate-number policy for MVP) |
| 2 Profile | Full name, ID type (SA ID/Passport), preferred contact; optional business name, email, photo |
| 3 Services | Main trade (single), secondary services (multi), experience level, optional short description; persist Category id/slug not just label; surface category cert/equipment note if applicable |
| 4 Area | Base suburb search, areas served (multi), travel radius, optional map pin, "exact address never shown" note; persist LocationNode ids/slugs |
| 5 Availability & rates | Day toggles + presets (Weekdays/Weekends/Every day), working hours (Standard/Extended/24-7), emergency-availability toggle, call-out fee (R), needed-before-live note |
| 6 Identity (choice) | Reassurance + "required before buying credits" callout, primary **Verify now** → existing IDV flow, secondary **Verify later** → continue |
| 6 Identity (capture, when Verify now) | Reassurance block, masked ID number with reveal, ID document slot, selfie slot, consent + privacy link — reuses existing IDV components |
| 7 Work evidence | Photo grid (optional), references (optional), certificates (optional), prominent Skip |
| 8 Review | Sectioned summary with per-section Edit; **identity status block** ("not verified yet · required before buying credits" → Verify) that does **not** block submit; "what happens next" footer; T&Cs consent; Submit |
| 9 Submitted | Calm confirmation, status timeline, what's next, "while you wait" suggestions, NO credits/leads, support link |
| 10 States | Draft (resume + % done), Pending (status), More info (itemized fields + freeform note fallback), Approved (credits gated on verify), Not approved (respectful + support) |

---

## 8. Recommended page hierarchy

```
/provider/register            → resolver entry (routes to correct step/state)
/provider/register/welcome     (0)
/provider/register/phone       (1)
/provider/register/profile     (2)
/provider/register/services    (3)
/provider/register/area        (4)
/provider/register/availability(5)
/provider/register/verify      (6 — choice; "Verify now" hands off to /provider/verify/[token])
/provider/register/evidence    (7)
/provider/register/review      (8)
/provider/register/submitted   (9)
/provider/register/status      (10 — pending / more-info / approved / rejected, resolver-driven)
/provider/handoff/:token       (existing handoff)
```
*(Indicative paths only; engineering decides the final route names. Any new public route must be added to `proxy.ts` `PUBLIC_PATHS`. **Do not** reuse `/provider/apply` — it redirects to `/provider/application` status today.)*

---

## 9. Mobile-first layout guidance

- **Design width:** 390px (iPhone-class); verify down to ~360px (common Android).
- **Single column**, generous vertical rhythm, one primary action per screen.
- **Sticky bottom CTA** (StepFooter) — never make the user scroll to find Continue.
- **Stepper at the top** under the back row, on every multi-step screen.
- **Thumb-zone:** primary actions in the lower third; back/secondary up top.
- **Targets:** 44px minimum; inputs comfortable for big fingers.
- **In-app browser:** assume no install prompt, possible no-camera/geolocation permission; always offer a fallback (file upload instead of camera; suburb search instead of map).
- **Keyboard:** numeric keypad for phone/OTP/ID; avoid layout jumps when keyboard opens.

**Design system (already defined — apply, don't redesign):**
- Type: **Plus Jakarta Sans** (UI), **DM Mono** (numbers/IDs/timestamps).
- Brand: Pink `#FF1F8E`, Purple `#8B3FE8`, Blue `#2A78F0`, brand gradient for primary CTAs; WhatsApp green `#25D366` for WhatsApp affordances **only**.
- Radii: 10 / 16 / 24 / 28 / pill (default body 16px). Ship **cozy** density.
- Status colours: success `#0F9D58`, warn `#E69900`, danger `#E5484D`.

---

## 10. Accessibility considerations

- Labelled inputs (visible labels, not placeholder-only).
- Visible focus state (purple ring); never rely on colour alone for status — pair with icon/text.
- Contrast AA for body text on background.
- Error messages programmatically tied to fields and specific in wording.
- 44px+ targets; spacing between tappable items.
- Respect reduced-motion (no essential info conveyed only via animation).
- Captions/labels for camera steps so screen-reader users know what's being captured.

---

## 11. Trust & reassurance points (design these explicitly)

- Welcome: "reviewed before going live" framed as a *customer-safety* benefit (not a barrier).
- **Identity step (6) framed as a CHOICE:** "required before buying credits and unlocking paid leads" — not framed as required to submit. Capture screen retains the "why we ask / who sees it / stored securely / never shown to customers" block.
- Area: "your exact address is never shown to customers".
- Submitted: honest expectation — "you can't receive leads until approved".
- Consent: plain-language checkbox linking to the provider privacy page.
- No dark patterns: Skip is always visible where a step is optional or deferrable.

---

## 12. Where the provider may need help

- **ID/selfie step** (highest friction) — provide examples of a good photo, good-light tip, and a "do this later" escape that preserves the draft.
- **Service-area picker** — suburb search must be forgiving (typos, common names); offer "use my location" with graceful fallback.
- **Category requirements** — if a trade needs a certificate, explain it without blocking the MVP.
- **Resuming** — make "where you left off" obvious on return.
- A persistent **"Need help?"** link to support/WhatsApp on heavier steps.

---

## 13. Where admin review status must be made visible

- **Submitted (9)** and **Pending (10)** screens: clear "under review" status, no false promises.
- **More info required (10):** the *specific* items requested where structured, plus the **freeform admin note** verbatim (current model stores reason as a freeform note).
- **Approved (10):** unmistakable, with the next action — **credits gated on identity verification** (if unverified → "Verify identity to unlock credits"; if verified → "Set up credits / Find jobs").
- **Not approved (10):** respectful, with a recovery path where allowed.
- Status should also be reflected if the provider lands on the home/sign-in surface before approval (don't show a job dashboard to an unapproved provider).

---

## 14. What NOT to design yet

- ❌ The WhatsApp onboarding journey (out of scope — only the deep link *into* the PWA).
- ❌ Credit purchase / Pay@ top-up screens (exist separately; post-approval *and* post-identity-verification).
- ❌ Provider home / job-acceptance / lead-browsing screens (separate surface).
- ❌ Admin review screens (admin console is a separate workstream; "request more info" already exists).
- ❌ A new design system (reuse the existing one).
- ❌ A parallel identity-verification flow — reuse the existing `/provider/verify/[token]` capture screens; do **not** redesign them here.
- ❌ Same-number customer/provider identity linking — separate-number policy is the MVP.
- ❌ Marketing/landing site at `/`.

---

## Frames Required in Figma

Create each frame at 390px width. For multi-state screens, create the base frame plus the listed state variants.

---

### F0 — Welcome / What you'll need
- **Purpose:** Orient the provider; set the review expectation; start the flow.
- **Primary action:** Get started.
- **Secondary action:** Sign in (existing provider).
- **Important content:** value prop, "reviewed before going live", what-you'll-need checklist, time estimate.
- **Edge cases:** none (static).

### F1 — Phone entry
- **Purpose:** Capture & confirm mobile number for registration.
- **Primary action:** Send code.
- **Secondary action:** Back.
- **Important content:** ZA phone input, why-we-ask helper, T&Cs/Privacy footer note.
- **Edge cases:** invalid number inline error; **variant F1b** = "number is a customer account" → routes to F1d Number conflict.

### F1c — OTP verify
- **Purpose:** Confirm number ownership for registration (separate from sign-in OTP semantics).
- **Primary action:** Verify & continue.
- **Secondary action:** Resend code / change number.
- **Important content:** 6-digit OTP, resend cooldown.
- **Edge cases:** wrong code, expired code, too-many-attempts cooldown.

### F1d — Number conflict (separate-number policy)
- **Purpose:** Tell a customer-numbered applicant that provider & customer profiles need separate numbers (MVP policy).
- **Primary action:** Use a different number → F1.
- **Secondary action:** Contact support (WhatsApp).
- **Important content:** Respectful explanation, customer account stays untouched, support escape hatch.

### F2 — Basic profile
- **Purpose:** Capture identity basics.
- **Primary action:** Continue.
- **Secondary action:** Save & finish later.
- **Important content:** name, ID type, preferred contact; optional business name, email, photo.
- **Edge cases:** empty-required inline errors; photo empty state (gradient initials).

### F3 — Services
- **Purpose:** Structured trade selection (persist Category ids/slugs, not just labels).
- **Primary action:** Continue.
- **Secondary action:** Back / Save & finish later.
- **Important content:** main category grid, secondary chips, experience radio, optional description w/ counter.
- **Edge cases:** category-requirement info note; long category list → search; no-main-selected error.

### F4 — Service area
- **Purpose:** Where they work + radius.
- **Primary action:** Continue.
- **Secondary action:** Back.
- **Important content:** base suburb search, areas-served multi-select, radius slider, optional map pin, privacy note.
- **Edge cases:** geolocation blocked → fallback to search; no-area-selected error; **variant F4b** = map permission denied.

### F5 — Availability & rates
- **Purpose:** Capture days, working-hours window, emergency availability, and call-out fee.
- **Primary action:** Continue.
- **Secondary action:** Back.
- **Important content:** day toggles + presets (Weekdays/Weekends/Every day), Standard/Extended/24-7 radio, emergency toggle, R-call-out fee input, "needed before going live" note.
- **Edge cases:** no day selected; empty fee; very-low/very-high fee guidance.

### F6 — Identity verification (choice)
- **Purpose:** Offer identity verification *now or later* — not a submit gate.
- **Primary action:** Verify now → hands off to existing IDV (F6b).
- **Secondary action:** Verify later → continue to F7.
- **Important content:** "required before buying credits" warn note, "secure & private" reassurance, "what's involved" checklist.
- **Edge cases:** none for the choice itself; the IDV flow owns its own edge cases.

### F6b — Identity verification (capture; existing IDV flow)
- **Purpose:** Capture ID/passport, document, selfie, consent. **Reuse the existing `/provider/verify/[token]` screens** — do not redesign them here.
- **Primary action:** Submit verification → returns to registration F7.
- **Secondary action:** Verify later (preserves draft) → F7.
- **Important content:** reassurance block, masked ID number, ID document slot, selfie slot, consent + privacy link.
- **Edge cases:** **F6b-i** upload-in-progress, **F6b-ii** upload failed + retry, **F6b-iii** blurry/too-small, **F6b-iv** camera permission denied → file upload fallback, **F6b-v** IDV mismatch (vendor) → retry / manual review.

### F7 — Work evidence (optional)
- **Purpose:** Optional proof of work.
- **Primary action:** Continue.
- **Secondary action:** Skip for now.
- **Important content:** photo grid, references, certificates.
- **Edge cases:** empty state with skip; per-upload retry.

### F8 — Review & submit
- **Purpose:** Final summary + submit. Identity may still be deferred.
- **Primary action:** Submit application.
- **Secondary action:** Edit (per section).
- **Important content:** sectioned summary (Profile/Services/Area/Availability/Evidence), per-section Edit, **identity status block** with Verify CTA (not a submit gate), "what happens next" footer, T&Cs consent.
- **Edge cases:** **F8b** incomplete-required flagged section; **F8c** submit loading; **F8d** submit failed (draft preserved).

### F9 — Submitted / pending approval
- **Purpose:** Confirm + set honest expectations.
- **Primary action:** (none required) / Add work evidence.
- **Secondary action:** Contact support.
- **Important content:** received status, timeline, what's next, "while you wait", explicit no-leads-until-approved gate.
- **Edge cases:** none (terminal state).

### F10a — Returning: Draft incomplete
- **Purpose:** Resume an unfinished application.
- **Primary action:** Continue application.
- **Secondary action:** Start over (confirm) / Sign out.
- **Important content:** % complete ("5 of 8 steps done"), next step, what's saved.
- **Edge cases:** very old draft → "still relevant?" prompt.

### F10b — Returning: Pending review
- **Purpose:** Show status while waiting.
- **Primary action:** Add work evidence.
- **Secondary action:** Contact support.
- **Important content:** "under review", expected next step, timeline.

### F10c — Returning: More info required
- **Purpose:** Show what the team requested. Render **itemized requested fields** where structured, and **the admin's freeform note** verbatim as fallback (current model stores reason as a note).
- **Primary action:** Update and resubmit.
- **Secondary action:** Contact support.
- **Important content:** itemized items + "Note from the team" card; rest read-only.
- **Edge cases:** multiple items requested; re-upload failure; only-note case (no itemized fields).

### F10d — Returning: Approved
- **Purpose:** Celebrate + route to the right next step. **Credits are gated on identity verification.**
- **Primary action (unverified):** Verify identity to unlock credits → F6b. **Primary action (verified):** Set up credits / Find jobs.
- **Secondary action:** Go to dashboard / View profile.
- **Important content:** approved confirmation, profile summary, credit-gate warn callout if unverified.

### F10e — Returning: Not approved
- **Purpose:** Respectful outcome + recovery.
- **Primary action:** Contact support (or Reapply if allowed).
- **Secondary action:** Sign out.
- **Important content:** outcome, shareable reason if any, next steps. **Never** expose internal fraud signals.

### F-Sys — Shared states sheet
- **Purpose:** One frame collecting reusable states for consistency: "Saved" toast, generic error toast, full-screen loading, "link expired / resume" screen, empty-photo slot, masked-ID field, upload-progress chip, identity-status block, separate-number conflict block.
- **Notes:** these are referenced by multiple frames — design once.
