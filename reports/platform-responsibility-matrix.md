# Plug A Pro Responsibility Matrix

Date: 2026-04-10

## 1. Matrix

| Area | Plug A Pro does | Plug A Pro facilitates | Plug A Pro records | Plug A Pro does not verify | Plug A Pro must not imply | Self-declared by provider | Optionally evidenced by provider | Actually platform-verified today |
|---|---|---|---|---|---|---|---|---|
| Provider identity and onboarding | Collects application details and stores provider account/profile records | Entry into the marketplace | Application status, profile fields, review outcome | True identity, background, intent, legal status, workmanship unless explicitly checked | “verified provider”, “safe”, “qualified”, “approved professional” as blanket claims | Name, bio, service area, trade categories, phone, profile details | Uploaded documents or examples where implemented | Internal marketplace review for lead eligibility only |
| Provider capability | Lets providers declare service categories, experience, and optional evidence notes | Customer discovery and matching | Provider profile content | Actual competence, licensing, or trade mastery | Competence guarantee | Skills, categories, years/experience narrative | Optional evidence notes, links, certificates, or references supplied by provider | None generically today |
| Trust signals | Presents profile information and platform-recorded activity | Customer evaluation of provider | Reviews, completed jobs, quote/job records | Moral character, safety, legality, suitability for every job | Platform endorsement beyond recorded facts | Bio, claims, service descriptions | References, certificates, portfolio, if supported | Platform-recorded job history and customer reviews completed on-platform |
| Matching | Uses request detail and provider availability/service fit | Connecting customer and provider | Match creation, lead status, assignment records | Whether the provider will behave properly or perform well | Guaranteed fit | Availability and offered services | None by default | Internal eligibility review + matching logic |
| Quote and scope | Supports quote generation and customer acceptance | Negotiation and agreement | Quote amount, terms, acceptance events, revisions | Fairness of provider pricing in absolute terms | “Plug A Pro priced this” unless true | Provider quote content | Photos, notes, change explanations | Acceptance trail only |
| Messaging and coordination | Provides in-platform / platform-mediated coordination flows | Customer-provider communication | Message/event records where in platform or linked WhatsApp flow | All off-platform human behaviour | Constant supervision of provider conduct | Provider replies and updates | Media, notes, issue details | Message/audit traces only where routed through platform |
| Booking lifecycle | Tracks accepted jobs through scheduled, en route, started, completion, dispute states | Service execution coordination | State changes, timestamps, audit logs | Actual physical attendance quality or safe conduct | Employer-style control over independent providers | Provider availability and actions | Arrival/completion photos | Booking/job state transitions and audit logs |
| Payment | Stores payment records where the flow is platform-handled or logged | Collection, payment follow-through, settlement visibility | Payment status, payer/payee, provider, timestamps, provider-facing payout info | Guaranteed refund, escrow protection, chargeback shielding, full recovery for offline payments | “Plug A Pro guarantees payment outcome” | Provider rates and agreed pricing | Proof-of-payment where uploaded | Platform payment record existence only; launch mode may be offline follow-through |
| Complaints and disputes | Accepts issue reports and gives admins case visibility | Resolution process between parties | Dispute records, reason, status, resolution text where added | Objective truth of every incident without evidence | Strong arbitration power beyond actual operations | Customer and provider statements | Photos, messages, documents | Case intake and case history |
| Reviews | Collects post-job customer ratings and comments | Reputation building | Review score, comment, timestamp | Absolute truth of every review | That ratings equal formal provider certification | Customer opinion | Review text | One review per eligible completed job on platform |
| Safety and risk controls | Reduces ambiguity through records, identity fields, traceability, approvals, and support entry points | Safer decision-making | Audit trail, request details, quote acceptance, issue reports | Safety itself | That risk is eliminated | Provider claims and customer instructions | Photos, access notes, optional documents | Only the existence of recorded artefacts |

## 2. Responsibility Boundary Summary

### Plug A Pro should claim

- It matches customers with nearby independent providers
- It records requests, quotes, bookings, and important job events
- It shows provider-supplied profile information and platform-recorded history
- It supports customer issue reporting and platform-side review of records

### Plug A Pro should facilitate

- provider discovery
- scope discussion
- quote review and acceptance
- booking coordination
- communication traceability
- payment follow-through where supported
- dispute intake

### Plug A Pro should record

- application records
- match / lead status
- quotes and approvals
- booking lifecycle transitions
- job completion artefacts
- reviews
- disputes
- payment record state where payment is in-platform or logged

### Plug A Pro does not verify by default

- licensing
- training
- background status
- legal compliance
- workmanship
- personal safety risk
- intent or moral character

### Plug A Pro must not imply

- provider guarantee
- safety guarantee
- competence guarantee
- licensure guarantee
- background-check guarantee
- workmanship warranty
- escrow/refund protection unless that specific payment path actually supports it

## 3. Current Verification Reality

Today, the strongest truthful platform-backed signals in accessible scope are:

- provider application reviewed for marketplace participation
- platform-recorded completed jobs
- platform-recorded customer reviews
- quote acceptance and job audit trail
- payment record state where the platform flow captured it

Today, the platform should treat the following as non-equivalent to verification:

- provider profile completion
- provider claims
- uploaded but unreviewed documents
- internal approval boolean used only for lead eligibility

## 4. Recommended Future Verification Model

If Plug A Pro later introduces real verification, it should use narrow, dated, criteria-backed labels such as:

- `Identity document reviewed`
- `Trade certificate uploaded`
- `Licence reviewed`
- `Banking details reviewed`
- `Reference checked`

Each label should include:

- who checked it
- when it was checked
- what exactly was checked
- what was not checked

The platform should avoid umbrella labels like `Verified` unless they expand to explicit sub-checks.
