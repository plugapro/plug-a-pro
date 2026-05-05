# Plug A Pro Platform Responsibility and User Journey Sweep

Date: 2026-04-10  
Auditor: Codex marketplace-model alignment sweep

## 1. Executive Judgement

### Pre-fix judgement

Before remediation, Plug A Pro behaved mostly like a matching platform in backend mechanics, but parts of the product copy and some UI labels over-claimed trust and implied stronger provider vetting than the implementation actually supports.

The highest-risk issues were not in the core booking logic. They were in the trust language around:

- provider vetting
- safety
- qualification
- guarantee-like claims
- refund expectations
- payment semantics in launch mode

That combination created a real business-model alignment risk: the product could be read as promising more provider assurance than the platform has actually implemented.

### Post-fix judgement

After remediation, Plug A Pro is materially closer to an honest matching platform for informal and semi-formal service providers.

In accessible runtime scope, the platform now:

- positions provider information more honestly
- distinguishes platform-recorded history from provider-supplied profile data
- distinguishes provider-shared evidence from platform-recorded history
- removes unsupported public claims around vetting, guarantees, and safety
- clarifies that internal provider approval is marketplace participation review, not public competence certification
- separates offline-recorded payment follow-through from true platform checkout collection in the data model and UI

### Current overall classification

| Lens | Current assessment |
|---|---|
| Business model alignment | `Partially aligned, now materially improved` |
| Platform responsibility boundaries | `Partially aligned, now clearer` |
| User journey realism | `Partially aligned` |
| Risk and de-risking design | `Partially aligned` |
| Implementation integrity | `Mostly aligned in core lifecycle, residual model gaps remain` |

### Bottom line

Plug A Pro now behaves more like:

- a transparent matching platform with platform-recorded trust signals

and less like:

- a contractor, guarantor, certification authority, or safety underwriter

However, it still under-supports some trust-building needs because the data model and user experience for provider evidence remain fairly thin.

## 2. Scope Swept

The sweep covered:

- marketplace model and architecture docs
- provider onboarding
- provider profile trust signals
- customer request and matching flow
- quote and approval flow
- messaging and WhatsApp flows
- booking / dispatch / job lifecycle
- reviews, disputes, and complaint intake
- payments and payout semantics
- user-facing copy and implied claims across field-service and marketing surfaces

Key evidence sources included:

- `docs/architecture/marketplace-model.md`
- `field-service/prisma/schema.prisma`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/payments.ts`
- `field-service/lib/provider-trust.ts`
- `field-service/app/(customer)/providers/[id]/page.tsx`
- `field-service/app/(customer)/requests/[id]/page.tsx`
- `field-service/lib/whatsapp-flows/help.ts`
- `marketing/app/(marketing)/terms/page.tsx`
- `marketing/app/(marketing)/trust/page.tsx`

## 3. Required Questions Answered

### A. Does the platform correctly position itself as a matching platform?

`Partially, now substantially better.`

The core backend model already resembled a matching platform:

- customer request -> provider lead -> quote -> approval -> booking -> completion
- providers remain independent actors
- audit and lifecycle transitions exist

Evidence:

- `field-service/prisma/schema.prisma`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/bookings.ts`
- `field-service/lib/jobs.ts`

Misalignment existed mainly in user-facing trust language, not in the core domain flow.

### B. Does any part of the implementation accidentally imply Plug A Pro has vetted or guaranteed providers when it has not?

`Yes, pre-fix. Mostly corrected in accessible runtime scope.`

Examples corrected:

- “vetted local worker”
- “trusted home services”
- “Fast. Reliable. Guaranteed.”
- “A vetted professional arrives on time, every time.”
- “Verified provider”
- WhatsApp help copy saying technicians were “ID-verified” and “Skill-assessed”
- terms copy implying “verified service providers”

These were unsupported by implementation.

### C. Does the provider onboarding flow reflect the reality of informal workers?

`Partially aligned.`

Strengths:

- lightweight application path exists
- provider can enter profile details and receive lead eligibility after review
- model supports independent providers rather than employees

Weaknesses:

- current trust model is still coarse
- schema does not yet strongly distinguish self-declared profile fields from uploaded evidence at field level
- provider evidence structures remain limited

### D. Does the customer journey provide enough transparency to make an informed choice?

`Partially aligned, but still incomplete.`

Strengths:

- customer can view provider page
- reviews and completed jobs exist
- quote approval exists
- issue reporting exists

Weaknesses:

- provider evidence depth is still limited
- no richer portfolio / references / verification tiering yet
- profile trust explanation needed to offset thin evidence, and that has now been added

### E. Does the platform preserve the “see who I’m dealing with” aspect from the physical world?

`Partially.`

It now does a better job of showing:

- provider identity
- service areas
- reviews
- platform-recorded history

It still lacks stronger digital replacements for:

- seeing the worker in person
- inspecting work examples in context
- distinguishing claimed capability from evidenced capability at a more granular level

### F. Are quote, booking, messaging, and job flows aligned to a marketplace model?

`Mostly yes.`

Positive evidence:

- explicit lead acceptance flow exists
- quote approval token flow exists
- bookings move through a clear lifecycle
- technician/job status transitions exist
- customer confirmation and dispute pathways exist

Evidence:

- `field-service/lib/matching-engine.ts`
- `field-service/app/api/quotes/[token]/route.ts`
- `field-service/components/quotes/QuoteApproval.tsx`
- `field-service/lib/jobs.ts`
- `field-service/app/(customer)/bookings/[id]/page.tsx`

### G. Are payments and dispute flows aligned to what the platform can actually own?

`Partially aligned after fixes.`

Strengths:

- payment records exist
- dispute intake exists
- admin visibility exists

Weaknesses:

- launch-mode payment bypass uses `AUTHORISED` internally for a payment record that may not represent a real online PSP authorisation
- user-facing and admin-facing explanation required tightening
- terms previously overstated refund expectations compared with actual platform control

The copy and admin labels are now more honest. The domain model is still coarse.

### H. Are risk controls honest, practical, and proportionate?

`More honest now, but still basic.`

Good controls present:

- profile identity capture
- job audit trail
- quote acceptance traceability
- reviews
- dispute intake
- customer issue reporting
- platform-mediated WhatsApp and job records

Remaining weakness:

- limited evidence richness
- no first-class verification tiering
- no explicit structured separation per field between self-declared, uploaded evidence, and platform-verified

### I. Are there places where the product creates false confidence or unsafe assumptions?

`Pre-fix yes, post-fix materially reduced.`

The most important false-confidence sources were copy and labels, not the transaction engine.

### J. What must be corrected in code, copy, policy, workflow, and behaviour?

Immediate corrections completed:

- removed misleading trust language
- clarified provider trust provenance
- clarified internal review vs public verification
- corrected payment/admin labels for launch mode
- tightened terms around refund scope and provider assurance boundaries

Residual work remains in the data model, trust-signal depth, and optional verification design.

## 4. Major Findings

| Area | Pre-fix state | Post-fix state |
|---|---|---|
| Public trust language | Overstated and sometimes unsupported | Corrected in accessible runtime code |
| Provider verification semantics | Internal review could be read as public verification | Reframed as marketplace review / lead eligibility |
| Provider trust provenance | Weakly explained | Explicit trust note added |
| Payment honesty | Launch-mode records easy to misread | Admin/payment copy clarified |
| Terms posture | Some clauses implied stronger provider checks and refund certainty | Tightened to actual platform role |
| Quote and lifecycle traceability | Stronger than copy implied | Remains a relative strength |
| Evidence richness on provider profiles | Thin | Still thin; not fully remediated |

## 5. Implemented Remediations

### Copy and honesty fixes

Corrected misleading or unsupported trust claims across:

- marketing hero and landing sections
- trust and safety page
- worker acquisition page
- how-it-works page
- pricing page
- WhatsApp help flow
- customer request summary copy
- customer provider profile display
- terms and responsibility language

### Trust-signal framing fixes

Added a reusable provider trust explanation so customer-facing profile and request surfaces now explain:

- which information is supplied by the provider
- which information is provider-shared evidence
- which information is recorded by Plug A Pro through platform activity
- which things Plug A Pro does not claim unless explicitly stated

Added optional provider evidence capture and display for:

- experience summary
- provider evidence note
- portfolio links

### Payment/responsibility fixes

Clarified that launch-mode payment records may represent offline follow-through rather than real in-platform collection.

Implemented an explicit payment collection mode split so payment records now distinguish:

- `PLATFORM_CHECKOUT`
- `OFFLINE_RECORDED`

### Internal semantics fixes

Added code comments and labels clarifying that provider approval / `verified` is:

- internal marketplace review for lead eligibility
- not a public promise of identity, licensing, safety, or workmanship

## 6. Re-sweep After Fixes

### Runtime honesty sweep

A targeted search across runtime code found no remaining occurrences of the highest-risk unsupported trust terms in accessible product code after remediation.

Terms swept included:

- vetted
- verified provider
- qualified worker
- ID-verified
- skill-assessed
- guaranteed
- trusted home services
- trusted professionals
- workers are screened

### Behavioural re-sweep

Post-fix, the product now more consistently communicates that:

- providers are independent actors
- profile details are not automatically platform-verified
- platform trust is built from records and transparency, not fake assurance
- payment and dispute expectations depend on what the platform actually handled

## 7. Residual Risks

These remain material but were not fully solvable in this pass without larger product/model changes.

### Residual 1: coarse provider verification model

`Provider.verified` still exists as a coarse boolean.

Risk:

- future developers may reuse it as a public “verified” trust badge
- it does not model different check types or evidence provenance

### Residual 2: provider evidence support is still early-stage

The platform now supports optional evidence notes and portfolio links, but still lacks richer first-class support for:

- structured references
- document-level review states
- credential-specific provenance
- category-specific evidence requirements

### Residual 3: legacy payment analytics and older records may still need cleanup

The domain model now separates offline-recorded and platform-checkout collection mode, but older records or future analytics may still need careful interpretation.

### Residual 4: customer trust depth still limited

The platform is now more honest, but honesty alone does not fully solve the “would I hire this person?” decision.

The product still needs richer optional trust signals that remain honest.

## 8. De-risking Recommendations

### Immediate launch-critical

- Replace coarse provider verification with structured review states and check types
- Introduce a first-class provenance model: self-declared / uploaded evidence / platform-reviewed / platform-recorded
- Separate offline-payment logging from real online authorisation status
- Keep all public trust copy under controlled vocabulary review

### Product honesty and trust clarity

- Add visible labels for “provider-supplied” and “platform-recorded” across provider profile sections
- Keep disclaimers contextual, not buried only in terms
- Avoid “trust theatre” badges unless each badge has real criteria

### Provider onboarding improvements

- Let providers add optional work photos, references, and credentials
- Label each clearly by provenance
- Avoid forcing formal-business assumptions for informal workers

### Customer trust-signal improvements

- show portfolio if uploaded
- show platform-recorded completed jobs count
- show customer review history
- show provider response behaviour over time if eventually supported

### WhatsApp/mobile-first improvements

- ensure trust disclaimers survive inside WhatsApp-assisted flows, not only web pages
- keep quote acceptance and scope changes traceable through linked structured actions

### Audit and dispute improvements

- make dispute evidence bundles easier to inspect
- clearly separate “platform record” from “platform judgement”

### Optional future verification programme

Only after real capability exists:

- identity check tier
- licence check tier
- credential review tier
- address or banking review tier

Each check should be date-stamped and narrowly named.

## 9. Verification Performed

Completed:

- `pnpm test` in `field-service` -> passed
- `pnpm lint` in `field-service` -> passed
- `pnpm build` in `field-service` -> passed
- `pnpm build` in `marketing` -> passed

Known unrelated issue:

- `pnpm lint` in `marketing` still fails because of pre-existing errors unrelated to this remediation pass

## 10. Final Recommendation

Plug A Pro should currently present itself as:

- a matching and coordination platform for independent service providers and customers

It should not present itself as:

- a guarantor of provider character
- a safety certifier
- a workmanship underwriter
- a blanket verifier of qualifications or licensing

The strongest current product posture is:

- honest about what the platform records
- honest about what providers claim
- clear about what the customer approved
- explicit about when the platform handled payment vs merely documented the outcome

That is the correct foundation for an informal-services marketplace.
