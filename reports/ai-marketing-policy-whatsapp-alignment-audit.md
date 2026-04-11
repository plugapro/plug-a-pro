# Marketing, Policy & WhatsApp Alignment Audit
## Plug-A-Pro — 2026-04-11

Audited against: platform-responsibility-matrix.md, platform-copy-risk-register.md, persona-clarification-document.md, mvp-scope-prioritisation-document.md.

---

## Audit Scope

| Surface | Status |
|---|---|
| Marketing homepage & components | Audited |
| How it works, For customers, For workers pages | Audited |
| Trust & Safety page | Audited |
| FAQ page | Audited |
| Pricing page | Audited |
| About, Solutions, Contact pages | Audited |
| Terms of Service | Audited |
| Privacy Policy | Audited |
| WhatsApp message templates (all 21) | Audited |
| WhatsApp help flow (help.ts) | Audited |
| Support macros / quick replies | Not present — no structured macro library exists yet |

---

## Output 1 — Copy Audit Register

### 1.1 Prior-Session Remediation (Already Applied)

The following blocked-term instances were resolved in a prior session (see platform-copy-risk-register.md). Confirmed clean:

| Item | Surface | Resolution |
|---|---|---|
| "vetted local worker" | Hero | Removed |
| "trusted home services" | Customer home | Removed |
| "Fast. Reliable. Guaranteed." | Customer home | Removed |
| "A vetted professional arrives on time, every time." | Customer home | Removed |
| "Verified provider" badge | Profile | Reframed to trust note |
| "qualified worker nearby" | WhatsApp job-request summary | Rewritten |
| "All Plug a Pro technicians are: ID-verified, Skill-assessed…" | WhatsApp help flow | Rewritten |
| "Workers are screened before activation" | Trust page | Rewritten |
| "independent, verified service providers" | Terms | Rewritten |
| Specific blanket refund percentages/timings | Terms | Rewritten to conditional |

### 1.2 Remaining Issues Found This Audit

---

#### ISSUE-01 · for-customers/page.tsx · Protection #2

**Audience**: Customer
**Location**: `/marketing/app/(marketing)/for-customers/page.tsx`, protections section
**Original**: "Workers are reviewed before joining"
**Classification**: **Overstated**
**Why**: The TrustSafety component uses the careful, properly caveated version: "Applications are reviewed before activation — eligibility check for marketplace participation, not a promise of licensing, safety, or workmanship." The for-customers page drops the caveat, leaving "reviewed before joining" standing alone as a near-guarantee of character/competence.
**Recommended rewrite**: "Applications manually reviewed before activation"
**Add sub-note**: "This is an eligibility check, not a guarantee of licensing, safety, or workmanship. Provider profiles show what each person has submitted and recorded on Plug-A-Pro."
**Action**: Fix now.

---

#### ISSUE-02 · help.ts · Pricing FAQ

**Audience**: Customer (WhatsApp bot)
**Location**: `/field-service/lib/whatsapp-flows/help.ts`, pricing answer
**Original**: "Prices depend on the service: Plumbing from R350, Electrical from R300, Cleaning from R450, Painting from R800. You will always see the price before you confirm booking. No hidden fees."
**Classification**: **Misleading**
**Why**: Specific Rand floor prices suggest a standardised rate card that doesn't exist. Prices are provider-supplied and market-variable. A customer quoted R800 for cleaning expecting "from R450" will feel misled. These figures are unchecked estimates embedded in an automated bot response that will scale. The "no hidden fees" line implies all-inclusive quoting when extras may be quoted later.
**Recommended rewrite**:
> "Prices depend on the job size and the provider. We always send a written quote before anything starts — you approve the price before confirming. For larger or more complex jobs, we send a detailed quote first. Any extra work is quoted and approved separately before the provider continues."

**Action**: Fix now. Remove floor prices entirely until a verified rate guide exists with ops sign-off.

---

#### ISSUE-03 · solutions/page.tsx · Electrical (minor) description

**Audience**: Customer
**Location**: `/marketing/app/(marketing)/solutions/page.tsx`, Electrical category
**Original**: "Light fittings, plugs/sockets, DB board, outdoor lights, extending power"
**Classification**: **Legally risky (escalate)**
**Why**: In South Africa, DB board work, new circuits, and extending power require a registered electrician and must be certified with a Certificate of Compliance (COC) under the Occupational Health and Safety Act / SANS 10142. Listing these as general marketplace services without a compliance note exposes Plug-A-Pro to liability if a non-registered provider performs work that causes fire or injury.
**Recommended rewrite**:
> "Light fittings, plugs/sockets, fault diagnosis, outdoor lights. Note: work affecting the DB board or requiring new wiring may require a registered electrician and a Certificate of Compliance (COC) under South African law. Mention this in your job description and we'll note it in the request."

**Action**: Escalate to legal/product. Do not merge without explicit sign-off.

---

#### ISSUE-04 · about/page.tsx · "Steady flow of local jobs"

**Audience**: Provider
**Location**: `/marketing/app/(marketing)/about/page.tsx`, For workers section
**Original**: "Plug-A-Pro gives independent workers a steady flow of local jobs matched to their skills and areas they cover."
**Classification**: **Overstated**
**Why**: "Steady flow" is a volume promise. At launch, job volume is unproven. Promising steady work to providers who register in good faith — particularly informal workers who may deprioritise other income sources — creates legal exposure and trust damage when volume is low.
**Recommended rewrite**:
> "Plug-A-Pro connects independent workers with local job leads matched to their skills and service areas."

**Action**: Fix now.

---

#### ISSUE-05 · for-workers/page.tsx · Licensing compliance gap

**Audience**: Provider
**Location**: `/marketing/app/(marketing)/for-workers/page.tsx`, Who we're looking for section
**Original**: "You don't need a formal business or company registration to join. If you have practical skills and a track record of doing good work, we want to hear from you."
**Classification**: **Incomplete (creates implicit false assurance)**
**Why**: This correctly addresses the registration barrier for informal workers. But it leaves no mention that certain trade categories — especially electrical, gas, and structural work — carry licensing requirements under South African law regardless of business registration status. An informal provider who reads this may believe no compliance is required for any job type they list. The Terms state providers must hold required licences, but that's late in the journey and rarely read on mobile.
**Recommended addition after current copy**:
> "For certain job types — including electrical, gas, and structural work — South African law requires specific licences or certifications. You are responsible for knowing and holding any licences that apply to the work you offer. Plug-A-Pro records the types of work you list but does not verify your licences unless a specific check is requested."

**Action**: Fix now. Persona-relevant: the informal worker persona is most at risk of missing this.

---

#### ISSUE-06 · WhatsApp help.ts · Areas covered hardcoded

**Audience**: Customer (WhatsApp bot)
**Location**: `/field-service/lib/whatsapp-flows/help.ts`, areas answer
**Original**: Lists Johannesburg (5 suburbs), Pretoria (3 suburbs), Cape Town (2 suburbs)
**Classification**: **Operationally inaccurate (escalate)**
**Why**: The marketing site launches targeting Johannesburg and Pretoria. Cape Town is listed in the bot but not confirmed in marketing. If Cape Town is not live at launch, this creates broken customer expectations. The hardcoded suburb list will also become stale. Any suburb a customer isn't on may cause them to abandon without asking if their area qualifies.
**Recommended rewrite**:
> "We're launching in Johannesburg and Pretoria, expanding to more cities soon. Tell us your suburb and we'll check if we have providers near you. If not, we'll add you to the waitlist and let you know when we're in your area."

**Action**: Escalate to ops. Do not launch with Cape Town listed if Cape Town is not live.

---

#### ISSUE-07 · WhatsApp templates · MARKETING category operational gap

**Audience**: Provider and Customer
**Location**: `field-service/lib/messaging-templates.ts`
**Affected templates**: `job_offer` (MARKETING), `technician_welcome` (MARKETING), `quote_ready` (MARKETING)
**Classification**: **Critical operational gap (escalate)**
**Why**:
- `job_offer` is the primary mechanism for notifying providers of new work. Meta classified it as MARKETING. Providers who have not opted into marketing WhatsApp (`whatsappMarketingOptIn=true`) will silently not receive job leads. The matching engine will dispatch leads that are never delivered.
- `technician_welcome` (MARKETING) — providers who don't opt in won't receive their approval/welcome message. Onboarding breaks silently.
- `quote_ready` (MARKETING) — customers who haven't opted in won't receive their quote notification. The quote approval flow breaks silently.

This is not a copy issue — it is a product/infrastructure issue that copy created by implying Plug-A-Pro will reliably notify both parties. The content at every touchpoint implies real-time WhatsApp updates. If MARKETING opt-in gates those updates, the platform cannot deliver on what the copy promises.

**Required actions**:
1. Product to decide: resubmit `job_offer` with more transactional body text aiming for UTILITY classification, or establish MARKETING opt-in as a mandatory step in provider onboarding.
2. Same decision for `quote_ready` on customer side.
3. Add an explicit opt-in step to the WhatsApp onboarding flow for both parties with clear explanation that job notifications require marketing WhatsApp to be enabled.
4. Code should surface a flag if a provider or customer is missing `whatsappMarketingOptIn` before sending a MARKETING template — currently sends silently fail.

**Action**: Escalate to engineering/product immediately. This is a launch blocker.

---

#### ISSUE-08 · faq/page.tsx · Provider Q1 — compliance implication

**Audience**: Provider
**Location**: `/marketing/app/(marketing)/faq/page.tsx`, Provider Q1
**Original**: "Anyone with practical home-job skills; no registered company needed"
**Classification**: **Incomplete**
**Why**: "No registered company needed" is correctly inclusive for informal workers. But it sits next to no mention of trade licences, and immediately precedes Q2 which says "We review your application" — which could be read as: "if you pass review, you're cleared to work any job." Together these create an implicit suggestion that Plug-A-Pro's review process substitutes for individual compliance obligations.
**Recommended addition to Q1 answer**:
> "For certain job types — electrical, gas, structural work — South African law may require a licence regardless of business registration. You are responsible for holding the right credentials for the work you offer."

**Action**: Fix now. One sentence addition.

---

#### ISSUE-09 · faq/page.tsx · Customer Q6 — dispute handling language

**Audience**: Customer
**Location**: `/marketing/app/(marketing)/faq/page.tsx`, Customer Q6 "What if something goes wrong?"
**Original**: "Contact support on WhatsApp; review written quote, job history, photos"
**Classification**: **Incomplete (under-explains process)**
**Why**: The trust page has a detailed 4-step dispute process. The FAQ's answer gives the customer no sense of what happens after they raise a dispute — no timeline, no outcome framing. For first-time customers in the decision moment, this vagueness increases perceived risk.
**Recommended rewrite**:
> "Contact support on WhatsApp with a description of the issue and any photos. We'll follow up within 2 hours (business hours). We review the written quote, the job history, before/after photos, and communication records. If the issue relates to scope or price, the written record is the reference point. We aim to resolve disputes within 5 business days and will keep you updated as the process moves forward."

**Action**: Fix now.

---

#### ISSUE-10 · terms/page.tsx · Provider licence obligation — placement

**Audience**: Provider
**Location**: `/marketing/app/(marketing)/terms/page.tsx`, Section 2
**Original**: "Providers must hold required licences/certifications under South African law" — appears only in Terms, Section 2 (Eligibility)
**Classification**: **Accurate but inaccessibly placed**
**Why**: The obligation is correctly stated in Terms. But informal workers registering on mobile via WhatsApp will not read Terms before onboarding. The licensing obligation is buried behind a legal document rather than surfaced at registration. This creates both a trust-safety gap and a legal exposure gap.
**Recommended action**: Surface licence requirement inline in the for-workers page and WhatsApp onboarding flow (as noted in ISSUE-05 and ISSUE-07). The Terms language itself is correct.
**Action**: Fix in onboarding copy and for-workers page. Terms wording is fine as-is.

---

#### ISSUE-11 · PricingCards.tsx · "Pay directly to the worker on completion"

**Audience**: Customer
**Location**: `/marketing/components/marketing/PricingCards.tsx`
**Original**: "Pay directly to the worker on completion"
**Classification**: **Overstated / Inconsistent**
**Why**: The help.ts payment answer says "payment is arranged after quote accepted and confirmed with provider. For some jobs we may send online payment link. For others, Plug a Pro support will confirm payment method directly." The PricingCards copy implies payment always goes directly to the worker, which is inconsistent with a platform-assisted payment model and conflicts with the Terms refund policy (which distinguishes platform-processed vs direct payments).
**Recommended rewrite**:
> "Payment arranged through the platform after job completion — method confirmed with each booking."

**Action**: Fix now. Clarifies without removing conversion value.

---

#### ISSUE-12 · WhatsApp help.ts · Cancellation / refund answer

**Audience**: Customer (WhatsApp bot)
**Location**: `/field-service/lib/whatsapp-flows/help.ts`, cancellation answer
**Original**: "If online payment collected, support will review refund handling based on booking stage and payment status."
**Classification**: **Accurate but fragile — needs strengthening**
**Why**: The language is technically correct and avoids false promises. But "support will review" gives no timeline, no process signal, and no outcome framing. For an anxious customer who has paid and wants to cancel, this non-answer increases abandonment risk and support contact volume.
**Recommended rewrite**:
> "Send a cancellation request through Plug-A-Pro and we'll stop the job on platform. If you paid online, our team will review your case against the booking stage and payment method and aim to respond within 2 business hours. Refund eligibility depends on when the cancellation happens and whether work has started — we'll walk you through the options."

**Action**: Fix now.

---

## Output 2 — Corrected Copy Pack

### 2.1 for-customers/page.tsx — Protection #2

**Before**: "Workers are reviewed before joining"
**After**:
> "Applications manually reviewed before activation — an eligibility check for marketplace participation, not a guarantee of licensing, safety, or workmanship. Provider profiles show what each worker has submitted and recorded on Plug-A-Pro."

---

### 2.2 help.ts — Pricing answer

**Before**:
> "Prices depend on the service: Plumbing from R350, Electrical from R300, Cleaning from R450, Painting from R800. You will always see the price before you confirm booking. No hidden fees. For larger jobs, we will send you a quote first."

**After**:
> "Prices depend on the job and the provider. We always send a written quote before anything starts — you approve the price before confirming. Any extra work is quoted and approved separately before the provider continues."

---

### 2.3 solutions/page.tsx — Electrical category

**Before**:
> "Light fittings, plugs/sockets, DB board, outdoor lights, extending power"

**After**:
> "Light fittings, plugs/sockets, fault diagnosis, outdoor lights. Note: work affecting the DB board or requiring new wiring may need a registered electrician and a Certificate of Compliance (COC) under South African law — mention this in your job description."

---

### 2.4 about/page.tsx — Provider volume promise

**Before**:
> "Plug-A-Pro gives independent workers a steady flow of local jobs matched to their skills and areas they cover."

**After**:
> "Plug-A-Pro connects independent workers with local job leads matched to their skills and service areas."

---

### 2.5 for-workers/page.tsx — Licensing addition

Add after "You don't need a formal business or company registration to join.":
> "For electrical, gas, and structural work, South African law requires specific licences regardless of business registration. You're responsible for holding any credentials that apply to the work you offer. Plug-A-Pro records the types of work you list but does not verify your licences unless a specific check is requested."

---

### 2.6 help.ts — Areas covered

**Before**: Hardcoded list of JHB/Pretoria/Cape Town suburbs
**After**:
> "We're launching in Johannesburg and Pretoria, expanding to more cities soon. Tell us your suburb and we'll check if we have providers near you. If we're not in your area yet, we'll add you to the waitlist and let you know when we arrive."

---

### 2.7 faq/page.tsx — Provider Q1 addition

Add to end of Q1 answer:
> "For certain job types — electrical, gas, structural work — South African law may require a licence regardless of business registration. You are responsible for holding the right credentials for the work you offer."

---

### 2.8 faq/page.tsx — Customer Q6 (dispute handling)

**Before**: "Contact support on WhatsApp; review written quote, job history, photos"
**After**:
> "Contact support on WhatsApp with a description of the issue and any photos. We'll follow up within 2 hours during business hours. We review the written quote, job history, before/after photos, and communication records. If the issue is about scope or price, the written record is the reference point. We aim to resolve disputes within 5 business days."

---

### 2.9 PricingCards.tsx — Payment line

**Before**: "Pay directly to the worker on completion"
**After**: "Payment arranged through the platform after job completion — method confirmed with each booking."

---

### 2.10 help.ts — Cancellation answer

**Before**: "Send request through Plug a Pro and we'll stop job on platform. If online payment collected, support will review refund handling based on booking stage and payment status."
**After**:
> "Send a cancellation request through Plug-A-Pro and we'll stop the job on platform. If you paid online, our team reviews your case against the booking stage and payment method and aims to respond within 2 business hours. Refund eligibility depends on when the cancellation happens and whether work has started — we'll walk you through the options."

---

### 2.11 WhatsApp Templates — No copy changes required

All 21 templates reviewed. Template bodies are concise, role-appropriate, and do not contain blocked terms. The `job_offer`, `quote_ready`, and `technician_welcome` body text is fine — the issue (ISSUE-07) is Meta's MARKETING classification blocking delivery, not the copy itself.

---

### 2.12 WhatsApp help.ts — Providers answer (validate existing)

**Current**: "Plug a Pro shows provider profiles, completed job history, and customer ratings where records exist on platform. Profile details (skills/service areas) come from provider unless field says it was checked by Plug a Pro. We keep early quote and update flow on platform so there is written record of what was agreed."

**Assessment**: **Clean.** This is the correct framing. Accurately distinguishes provider-supplied from platform-recorded. No change needed.

---

## Output 3 — Persona Alignment Commentary

### 3.1 Informal Service Provider — the highest-risk persona for copy missteps

The platform's provider persona ranges from "solo informal worker finding gigs on WhatsApp" to "small registered SME with two employees." The marketing copy does well at welcoming informal workers ("no company registration needed"). But two gaps remain:

**Gap 1 — Licensing responsibility undersurfaced**: Informal providers may genuinely not know they need a COC for electrical work or a plumbing practitioner registration for certain jobs. "No registration needed" is true for the platform, but not true for the law. The current copy implies Plug-A-Pro's review process is the only gate, which creates risk for the provider (unlicensed work = fine or liability), the customer (unlicensed outcome = no COC), and the platform (facilitating unlicensed trade = reputational + legal exposure).

**Gap 2 — "Steady flow" is a false expectation for an early-stage marketplace**: Informal providers who reduce time on other income sources expecting steady Plug-A-Pro leads will be harmed. The corrected language (ISSUE-04) removes this risk without removing the attractive value proposition.

### 3.2 Trust-Sensitive First-Time Customer

The hero, trust page, FAQ, and HowItWorks copy are well-calibrated for this persona. The honest framing of "we reduce risk through records, not by guaranteeing the provider" is exactly right for building realistic trust with a first-time user who has been burned by informal arrangements before.

The remaining gap is **dispute resolution under-explained in FAQ** (ISSUE-09). First-time customers in the decision moment need to know that if something goes wrong, there is a real process — not just "contact support." The corrected Q6 answer provides this.

### 3.3 Busy Working Professional / Property Manager

This persona values efficiency and clear pricing. The help.ts pricing with specific Rand floors (ISSUE-02) is the most damaging gap for this persona — they will hold Plug-A-Pro accountable to those floor prices, and when a quote comes in higher, trust breaks. Removing floor prices and shifting to "you see the quote before you approve" is both safer and actually *more* appealing to this persona — they care about transparency, not an estimate.

### 3.4 Platform / Ops Role

The platform operators are exposed by:
- **MARKETING-classified templates** (ISSUE-07): Silent delivery failures. Ops teams will be unable to diagnose why providers aren't accepting leads or why customers aren't approving quotes.
- **Hardcoded area list in help.ts** (ISSUE-06): Ops need to be able to update service areas without a code deployment. Recommend moving the area list to a configurable env var or database record.

---

## Output 4 — Business Model Alignment Summary

**Overall verdict**: The Plug-A-Pro marketing, policy, and WhatsApp content is substantially aligned with the transparent matching-platform model. The major prior-session remediation pass removed the most dangerous trust claims. What remains are:

| Category | Status |
|---|---|
| Genuine overclaims (must fix) | 2 (ISSUE-01 for-customers #2, ISSUE-04 "steady flow") |
| Misleading specifics (must fix) | 2 (ISSUE-02 pricing, ISSUE-11 payment method) |
| Incomplete for persona reality (fix now) | 3 (ISSUE-05, ISSUE-08, ISSUE-10 — licensing obligations) |
| Operationally inconsistent (fix now) | 2 (ISSUE-06 areas, ISSUE-12 cancellation) |
| Legal escalation required | 2 (ISSUE-03 electrical COC, ISSUE-07 MARKETING templates) |

**Does the content reflect a transparent matching platform?** Mostly yes. The trust/safety page is exemplary. The hero, how-it-works, and FAQ are honest about what Plug-A-Pro does and doesn't guarantee.

**Does the content over-claim responsibility?** In two residual places yes: "Workers are reviewed before joining" (no caveat) and "steady flow of jobs" (volume promise). Both are fixable with one-line changes.

**Does the content under-support trust?** In one place: the FAQ dispute answer. Customers need to know a real process exists, not just "contact support."

**Is the content too generic for this marketplace?** No — the informal-worker framing, WhatsApp-first journey, South Africa-specific context, and consistent "independent provider" language distinguish this from generic e-commerce. The problem statement and about page are especially strong.

**Does the content reflect the WhatsApp-first, mobile-first operating reality?** Yes. The for-customers, for-workers, and FAQ pages all treat WhatsApp as the default channel, not as a feature. The onboarding page routes through WhatsApp. The How It Works page explains the WhatsApp journey step-by-step.

---

## Output 5 — Escalation List

Items requiring human decision before fix can proceed:

| # | Issue | Why it needs human decision | Owner |
|---|---|---|---|
| E1 | ISSUE-03 — Electrical/DB board/COC on solutions page | Legal liability: facilitating unlicensed electrical work carries OHS Act exposure. Need legal/compliance sign-off on what electrical jobs can be listed without a COC caveat. | Legal / Product |
| E2 | ISSUE-07 — `job_offer`, `quote_ready`, `technician_welcome` classified as MARKETING by Meta | Platform viability: MARKETING opt-in gates are likely silently blocking lead delivery and quote notifications at launch. Decision needed: resubmit with transactional body text, or make MARKETING opt-in mandatory in onboarding and surface to providers/customers explicitly. | Engineering / Product |
| E3 | ISSUE-06 — Cape Town listed in help.ts but not confirmed operational | Ops readiness: if Cape Town is not live at launch, customers who WhatsApp in expecting Cape Town service will be turned away after a bot confirms availability. Need ops to confirm live coverage before launch. | Ops |
| E4 | Dispute resolution timelines | The 2-hour follow-up and 5-business-day resolution SLAs in the FAQ rewrite are inferred from existing policy. If these are not operationally committed, they should not be published. Ops to confirm or adjust. | Ops |
| E5 | Refund eligibility scope | The cancellation and payment answers in help.ts reference a platform payment path that exists for some jobs but not all. Before specifying refund review timelines in the bot, ops needs to confirm the payment processing workflow is live and the refund policy is enforceable. Relates to gap register B1 (Peach Payments live verification). | Ops / Legal |
| E6 | Quick replies / support macros | No structured macro library exists. If support agents are handling disputes and complaints through WhatsApp without standardised responses, copy consistency and compliance risk cannot be audited. Recommend building a macro library before launch volume scales. | Ops / Support |

---

## Implementation Priority

| Priority | Items |
|---|---|
| Fix now (before go-live) | ISSUE-01, ISSUE-02, ISSUE-04, ISSUE-05, ISSUE-08, ISSUE-09, ISSUE-11, ISSUE-12 |
| Fix after escalation decision | ISSUE-03, ISSUE-07 |
| Fix after ops confirmation | ISSUE-06 |
| Structural gap (build before scale) | ISSUE-10 (onboarding compliance surfacing), E6 (macro library) |
