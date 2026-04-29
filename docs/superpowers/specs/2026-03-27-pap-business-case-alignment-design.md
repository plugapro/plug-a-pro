# Plug A Pro — Business Case Alignment Design

**Date:** 2026-03-27
**Status:** Awaiting user review
**Scope:** Full strategic realignment — marketing site, domain model, app architecture, job lifecycle, anonymous communication, MVP phasing

---

## Executive Summary

Plug A Pro is a **peer-to-peer marketplace** that connects everyday South African homeowners and renters to nearby independent handymen and home-job workers for small jobs, repairs, inspections, and DIY assistance. The platform acts as the trusted intermediary for discovery, matching, lead routing, mediated communication, quote flow, booking coordination, and trust.

It is **not** a field service management SaaS sold to plumbing companies to manage their employed staff. Every surface of the current codebase — marketing copy, data model, admin flows, and pricing — reflects the wrong model. This document defines the corrected design and the work required to realign both the marketing site and the application architecture.

---

## 1. Interpretation Drift Report

### 1.1 Root cause

The platform was built with a B2B SaaS mental model: a *service company* subscribes to Plug A Pro and uses it to manage *their own* technicians, dispatch jobs, and invoice clients. This framing is structurally wrong. Plug A Pro is a marketplace where the platform itself connects two independent parties — customers and providers — and earns trust and revenue by being the intermediary.

### 1.2 Marketing site — drift by file

| File | Severity | What is wrong |
|------|----------|---------------|
| `metadata.ts` description | **Critical** | "for any business that sends skilled workers to customer homes" — explicitly positions as B2B SaaS tool |
| `Hero.tsx` | **Critical** | Label "Field service, simplified" targets B2B operators; headline "Book a technician in minutes" is ambiguous — could be marketplace but isn't framed that way |
| `HowItWorksSteps.tsx` | **Critical** | Step 2 "You dispatch the right technician / Assign a technician in one tap" — assumes platform customer owns the technicians. Step 3 "Your technician" — workers belong to the business |
| `ProblemStatement.tsx` | **Critical** | All four pain points describe a *service company managing its own staff*: "Managing field technicians", "Dispatch done over the phone". Not a customer problem, not a marketplace problem |
| `WhoItsFor.tsx` | **Critical** | "Built for any business that dispatches technicians" — addresses B2B buyers, not customers or independent workers |
| `Features.tsx` | **Critical** | "Smart Dispatch: Assign the right technician in one tap" — internal staff dispatch, not lead routing |
| `PricingCards.tsx` | **Critical** | SaaS tiers by technician headcount ("Up to 3 technicians") and job volume — B2B SaaS pricing, not marketplace commission |
| `SocialProof.tsx` | **Significant** | 100% of testimonials from business operators. Zero consumer or independent worker voices |
| `CTAStrip.tsx` | **Moderate** | "Ready to modernise your field service business?" — B2B close |
| `Nav.tsx` | **Minor** | No dual-audience navigation ("For Customers" / "For Workers") |

### 1.3 Application architecture — drift by layer

| Layer | Current assumption | Why it is wrong |
|-------|-------------------|-----------------|
| `Business` model | SaaS tenant — a plumbing company that subscribes and manages staff | Platform is not a SaaS sold to companies. There is one platform. Providers are independent. |
| `Technician` model | Employed by a Business via `businessId` FK | Providers are independent workers. They register on the platform, not under a business. |
| `Customer` model | Scoped to a Business tenant via `businessId` FK | Customers belong to the platform, not to a business. |
| `Slot` model | Business-controlled availability blocks assigned to technicians | Provider-managed availability: each provider declares their own windows |
| `admin/dispatch` page | Human admin manually assigns their owned technician to a booking | Marketplace matching: platform broadcasts leads to qualified nearby providers; providers accept or decline |
| Job notifications | Raw customer address + details sent immediately to technician | Should be mediated: platform controls what information is revealed at each stage |
| WhatsApp `ConversationData` | `customerId` scoped to business | Customer is platform-level; businessId not meaningful in marketplace |
| Pricing tiers | Per-business SaaS subscription | Marketplace monetisation: per-lead fee, commission on completed jobs, or provider subscription — not per-technician SaaS |

### 1.4 What is reusable

The following existing code is structurally sound and can be adapted rather than rewritten:

- WhatsApp conversation flow engine (`types.ts`, `booking.ts`, `registration.ts`, `status.ts`) — needs conceptual rename, logic is valid
- Job state machine (`EN_ROUTE → ARRIVED → STARTED → COMPLETED`) — usable for the execution phase post-acceptance
- Quote model — suitable for quote-based jobs
- ExtraWork approval flow — directly applicable to scope changes on a job
- Attachment/photo upload model — no changes needed
- MessageEvent, AuditLog, Rating models — reusable as-is
- WhatsApp interactive layer — reusable

---

## 2. Corrected Business Model Statement

> **Plug A Pro is a marketplace that connects everyday people in South Africa to nearby independent handymen and home-job workers for small jobs, inspections, repairs, and DIY help. The platform is the trusted intermediary for matching, communication, quotes, bookings, and post-job trust.**

### Two sides of the marketplace

**Customers** — homeowners, renters, and DIYers who need affordable help for:
- Garden work, lawn care
- Fixing a leak or drip
- Painting a room or touch-ups
- Drywall patching or plastering
- Installing fixtures, shelves, or appliances
- Appliance inspection or fault-finding
- Quick plumbing (taps, toilet, blocked drain)
- Odd jobs around the house
- DIY projects started but stuck

**Providers** — independent workers including:
- Gardeners and landscapers
- Painters
- Handymen and odd-job workers
- Appliance repairers
- Plumbers (small jobs)
- Roofing helpers
- General DIY workers and installers

### What the platform solves
- **Customers:** Discovery, trust, safe contact, structured quotes, booking confidence, post-job recourse
- **Providers:** Access to demand, structured leads, professional workflow, earning opportunity
- **Platform:** Mediated trust layer, auditability, safety for both sides

### Channels
- WhatsApp — primary operating channel for intake and status
- PWA / mobile — richer experience for quotes, photos, history
- Web — acquisition, SEO, waitlist, provider onboarding

---

## 3. Updated Marketing Positioning

### 3.1 Core positioning statement

> **"The easy way to get small home jobs done. Local workers, fair quotes, safe contact."**

Secondary: *"For the handymen and skilled workers waiting outside the hardware store — we bring the jobs to you."*

### 3.2 Revised siteConfig description

```ts
description: "Find nearby handymen and home-job workers via WhatsApp. Get quotes, book help, and get the job done — safely and simply."
```

### 3.3 Hero

**Label (eyebrow):** `Local help. Real quotes. Any small job.`

**Headline:** `Get home help in minutes — not weeks`

**Subheadline:** `Plug A Pro connects you to nearby handymen and home-job workers for small repairs, odd jobs, garden work, painting, and more. Message on WhatsApp. Get matched. Get it done.`

**Secondary line (DIY angle):** `Started a DIY project and got stuck? Our workers can assess, continue, or finish it.`

**CTAs:** `Request help →` / `I want work →`

### 3.4 How It Works

**Section label:** `How Plug A Pro works`
**Section headline:** `From job to done — in a few taps`

```
01 Describe your job
   Send a message on WhatsApp, or use the app. Tell us what needs doing,
   where you are, and share a photo if helpful. Under 3 minutes.

02 Get matched to a nearby worker
   We find available, rated workers near you who do that type of job.
   You see their profile and can accept or wait for more options.

03 Agree on the price, book, done
   The worker visits to inspect if needed, or quotes directly.
   You approve before any work starts. Pay after it's done.
```

### 3.5 Problem Statement

**Wrong B2B framing to remove:** Managing field technicians, dispatch over phone, Excel invoicing, no technician location.

**Correct consumer + provider framing:**

*For customers:*
- Searching Google and not knowing who to trust
- Negotiating awkwardly in person outside the hardware store
- Paying upfront with no protection if something goes wrong
- No record, no accountability, no recourse

*For providers:*
- Skilled and ready to work, but no steady flow of jobs
- Hard to build trust with strangers
- No structured way to quote, confirm, or collect
- Sitting idle waiting for word-of-mouth

### 3.6 Who It's For (dual audience)

**For Customers section:**
- Anyone with a small home job that needs doing
- Homeowners, renters, property managers
- DIYers who need a second pair of hands or professional finish
- People who want a trustworthy local contact without the risk

Category tiles: Plumbing, Painting, Garden & Lawn, Handyman / Odd Jobs, Appliances, Electrical (minor), DIY Assistance, Roofing (minor), General Repairs

**For Workers section:**
- Independent handymen and skilled trade workers
- Gardeners, painters, plumbers, appliance repairers
- People with practical skills looking for steady local work
- Semi-formal or informal workers who need a platform to build trust and reputation

### 3.7 Trust & Safety section

Explain how Plug A Pro protects both sides:
- Your personal number is not shared by default
- All communication goes through the platform initially
- Workers are screened before approval
- Ratings and reviews build over time
- Job photos and quotes are documented on the platform
- Disputes handled through the platform, not over the phone

### 3.8 Operating Model (revised)

Remove: "Full control for your business" / "your operations team"

Replace with dual-channel description:
- **WhatsApp** — how customers describe jobs and get updates; how workers receive and respond to leads
- **App / PWA** — richer view for quotes, photos, job history, provider profiles

### 3.9 Pricing (revised)

Remove: SaaS tiers by technician headcount

Replace with: marketplace monetisation framing appropriate to stage

*MVP / pre-launch:* Join the waitlist — no pricing shown until model is confirmed
*Or if pricing must show:* provider-facing subscription (e.g. R 149/month for unlimited leads) or customer-facing per-job service fee

### 3.10 Social Proof (revised)

Replace business-operator testimonials with:
- Customer: "I had a leaking tap fixed the same day. The worker showed up on time and the price was exactly what was quoted."
- Provider: "I get 3–4 jobs a week through the app. Before this I was just waiting outside Builders Warehouse."
- Customer: "I finally finished my deck. Started it myself, got stuck on the concrete, found someone on Plug A Pro who sorted it in two hours."

### 3.11 WhatsApp CTA

Replace generic "Get started" with:
- Primary: `Request help on WhatsApp →` (links to `https://wa.me/{number}`)
- Secondary: `Join as a worker →`

### 3.12 CTAStrip (revised)

**Headline:** `Ready to get a job done — or find work near you?`
**Body:** `Whether you need help at home or you're a skilled worker looking for steady local jobs, Plug A Pro is built for you.`
**CTAs:** `Request help →` / `Register as a worker →`

---

## 4. Updated Information Architecture

### 4.1 Navigation

```
Plug A Pro | How It Works | For Workers | Trust & Safety | FAQ | [Request Help] [Find Work]
```

Mobile: hamburger with same links plus WhatsApp CTA prominent.

### 4.2 Homepage sections (order)

1. Hero — dual CTA (request help / find work)
2. How It Works — 3 steps, customer flow primary
3. Problem Statement — dual framing (customers + workers)
4. Who It's For — two tiles: For Customers / For Workers (with job category grid under each)
5. Trust & Safety — anonymity, screening, ratings, audit trail
6. Operating Model — WhatsApp + App
7. Social Proof — customer + worker testimonials
8. CTA Strip — dual audience

### 4.3 Recommended pages

| Page | Purpose |
|------|---------|
| `/` | Homepage |
| `/how-it-works` | Detailed flow for customers |
| `/for-workers` | Provider onboarding explanation, benefits, registration CTA |
| `/trust-and-safety` | Anonymity policy, screening, dispute process |
| `/faq` | Dual-audience FAQ |
| `/request-help` | Job intake form or WhatsApp redirect |
| `/join-as-worker` | Provider registration waitlist or flow |
| `/contact` | General contact |

---

## 5. Corrected Domain Model (MVP)

### 5.1 Core entities

```
Platform (implicit — single operator, not a multi-tenant SaaS)

Customer
  id, phone (E.164), name, email?, verified, createdAt
  → has many JobRequests
  → has many Addresses
  → has many Reviews (given)

Provider (replaces Technician — no businessId FK)
  id, phone (E.164), name, bio?, avatarUrl?
  status: PENDING_REVIEW | ACTIVE | SUSPENDED
  verifiedAt?, suspendedReason?
  → has many ProviderSkills
  → has many ProviderAreas
  → has many AvailabilityWindows
  → has many Leads (received)
  → has many Reviews (received)

ProviderSkill
  providerId, categorySlug, yearsExperience?, notes?

ProviderArea
  providerId, suburb, city, province, radiusKm?

AvailabilityWindow
  providerId, dayOfWeek (0–6), startTime, endTime

ServiceCategory
  slug, name, description, iconName
  (platform-defined, not per-business)

JobRequest
  id, customerId, addressId, categorySlug
  title, description, photos[]
  urgency: FLEXIBLE | WITHIN_WEEK | URGENT
  pricingExpectation: FIXED | QUOTE_REQUIRED
  estimatedBudgetMin?, estimatedBudgetMax?
  status: OPEN | MATCHING | LEAD_SENT | ACCEPTED | INSPECTION_SCHEDULED |
          QUOTED | QUOTE_ACCEPTED | SCHEDULED | IN_PROGRESS | COMPLETED |
          CLOSED | CANCELLED | EXPIRED | DISPUTED
  createdAt, updatedAt

JobPhoto (attached to JobRequest or Job)
  id, jobRequestId?, jobId?, url, blobKey, label (before|after|description)
  uploadedByRole: customer | provider

Lead (created by matching engine per provider candidate)
  id, jobRequestId, providerId
  status: PENDING | VIEWED | ACCEPTED | DECLINED | EXPIRED
  sentAt, viewedAt, respondedAt, expiresAt

ConversationThread (platform-mediated messaging)
  id, jobRequestId, customerId, providerId
  channel: WHATSAPP | IN_APP
  status: OPEN | CLOSED
  openedAt, closedAt

Message (within a thread)
  id, threadId, senderRole: customer | provider | platform
  body, mediaUrl?, sentAt
  — personal phone numbers are never included in body

InspectionSlot
  id, jobRequestId, leadId, proposedAt, confirmedAt
  status: PROPOSED | CONFIRMED | COMPLETED | CANCELLED

Quote
  id, jobRequestId, providerId
  description, amountRand, validUntil
  status: DRAFT | SENT | ACCEPTED | DECLINED | EXPIRED
  attachments[]
  submittedAt, respondedAt

Job (execution — created when quote is accepted or for fixed-price direct booking)
  id, jobRequestId, providerId
  status: SCHEDULED | EN_ROUTE | ARRIVED | STARTED | PAUSED |
          AWAITING_APPROVAL | COMPLETED | FAILED
  scheduledFor, notes
  arrivedAt?, startedAt?, completedAt?
  → has many JobPhotos
  → has many ExtraWork
  → has many JobStatusEvents

JobStatusEvent
  id, jobId, fromStatus, toStatus, actorRole, notes, timestamp

ExtraWork
  id, jobId, description, amountRand
  status: PENDING | APPROVED | DECLINED
  approvalToken (unique), approvedAt?, declinedAt?

Payment (flexible — supports direct and platform-mediated)
  id, jobId
  method: DIRECT | PLATFORM_ESCROW | YOCO | PAYFAST | PEACH
  status: PENDING | PAID | FAILED | REFUNDED
  amountRand, paidAt?, notes?
  — method=DIRECT means customer paid worker directly (off-platform, recorded for audit)

Review
  id, jobId, reviewerRole: customer | provider
  score (1–5), comment?, createdAt
  — providers accumulate reviews visible on their profile

TrustVerification
  id, providerId
  type: ID_DOCUMENT | SELFIE | REFERENCES | BACKGROUND_CHECK
  status: PENDING | VERIFIED | FAILED
  verifiedAt?

Notification
  id, recipientRole, recipientId, channel: WHATSAPP | PUSH | IN_APP
  type (enum), body, sentAt, readAt?

AdminCase (dispute / issue)
  id, jobId, raisedBy: customer | provider
  type: DISPUTE | COMPLAINT | FRAUD | NO_SHOW
  status: OPEN | INVESTIGATING | RESOLVED | CLOSED
  description, resolution?, createdAt, resolvedAt?

AuditLog (unchanged — platform-wide)
```

### 5.2 Removed or deferred

- `Business` as SaaS tenant — **removed** (platform is single operator)
- Multi-tenancy (`businessId` FKs on Customer, Technician, Service, Booking) — **removed**
- `Slot` (business-controlled, tech-assigned) — **replaced** by `AvailabilityWindow` (provider self-managed) + `InspectionSlot`
- Platform-held escrow payment — **deferred** to Phase 2
- `PricingRule` (complex per-service pricing rules) — **deferred**; keep `pricingType` on ServiceCategory

---

## 6. Job Lifecycle State Machine

### 6.1 Primary lifecycle (quote-based job)

```
OPEN
  Customer creates JobRequest with photos, category, address, urgency
  ↓
MATCHING
  Platform runs matching: proximity + category + availability
  ↓
LEAD_SENT
  Platform sends leads to 2–4 qualified providers
  Providers see: category, suburb, urgency, job description (no personal details yet)
  ↓
ACCEPTED
  First provider accepts lead (or customer selects from multiple)
  Provider now sees: first name, suburb, address
  Customer sees: provider name, rating, photo
  ConversationThread opened (mediated)
  ↓
[Branch A — inspection required]
INSPECTION_SCHEDULED → back to QUOTED (see below)

[Branch B — direct quote]
QUOTED
  Provider submits quote with description, price, timeline
  ↓
QUOTE_ACCEPTED / QUOTE_DECLINED
  Customer approves or declines
  If declined → provider can revise or job reopens to next provider
  ↓
SCHEDULED
  Job date confirmed
  ↓
IN_PROGRESS
  Sub-states: EN_ROUTE → ARRIVED → STARTED → (PAUSED | AWAITING_APPROVAL) → COMPLETED
  ↓
COMPLETED
  Provider marks complete, uploads after-photos
  Customer receives WhatsApp: review prompt
  Review entity created (score + comment)
  ↓
CLOSED  (auto-close after 72h if no dispute raised)

[Side path]
CANCELLED (customer or provider, any time before SCHEDULED — fee rules apply later)
EXPIRED (no provider accepted within N hours)
DISPUTED (after COMPLETED or during IN_PROGRESS) → AdminCase raised
```

### 6.2 Simplified lifecycle (small direct job, no inspection needed)

```
OPEN → MATCHING → LEAD_SENT → ACCEPTED → QUOTED → QUOTE_ACCEPTED → SCHEDULED →
EN_ROUTE → ARRIVED → STARTED → COMPLETED → CLOSED
```

### 6.3 ExtraWork sub-flow (during IN_PROGRESS)

```
Provider logs extra work → Job transitions to AWAITING_APPROVAL
Customer receives WhatsApp with description + price → Approves or Declines
If APPROVED → Job resumes (STARTED)
If DECLINED → Provider notes it, job continues without extra
```

### 6.4 Matching rules (MVP)

- Provider is ACTIVE
- Provider has matching ProviderSkill for the categorySlug
- Provider has ProviderArea covering the customer's suburb or within radius
- Provider has AvailabilityWindow overlapping customer's urgency/preference
- Provider does not have an active IN_PROGRESS job at the requested time
- Platform sends to up to 4 providers simultaneously; first to accept wins (or customer chooses)

---

## 7. Anonymous Communication Design

### 7.1 Objective

Customer's personal WhatsApp number must not be shared with a provider (and vice versa) by default. All communication flows through the platform layer until the platform decides to permit a handoff.

### 7.2 Phased approach (pragmatic)

#### Phase 1 — MVP (mediated via platform messages)

Platform sends outbound WhatsApp to each party from the Plug A Pro business number:

- To customer: "Sipho has accepted your job. You can message him through the app, or reply here."
- To provider: "New job in Bryanston: tap to view details and send a message."

All replies go to the Plug A Pro WhatsApp number and are routed via the conversation bot to the right thread. Neither party sees the other's number — they see `+27 XX XXXX XXXX (Plug A Pro)`.

Personal numbers are **never** included in message templates, notification bodies, or lead payloads at any stage.

Address is revealed in **stages**:
- Lead stage: suburb only ("Bryanston")
- Accepted stage: suburb + street name ("Smith Street, Bryanston")
- Job confirmed / en-route: full address

#### Phase 2 — Optional controlled handoff

After job completion (or at a milestone like `QUOTE_ACCEPTED`), platform can optionally send:
"You've both agreed. You can now contact each other directly if needed." — with each party's number, but only as an optional release, not the default path.

This should be a deliberate operator decision, not automatic. It helps with adoption early on without fully abandoning the platform communication layer.

#### Phase 3 — Full in-app messaging

Build in-app chat (text, photos) within the PWA. At this point WhatsApp is purely the notification + CTA layer, not the communication channel itself.

### 7.3 Risks if platform communication is bypassed too early

- No audit trail for disputes
- No ability to moderate or block bad actors
- Providers may try to take relationships off-platform to avoid fees
- Trust signal (platform as intermediary) is lost for customer

Mitigation: in T&Cs, off-platform communication before job completion voids platform protection.

---

## 8. Architecture Recommendation

### 8.1 Component overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Plug A Pro Platform                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Marketing   │  │  Customer    │  │  Provider        │  │
│  │  Website     │  │  PWA         │  │  PWA / App       │  │
│  │  (Next.js)   │  │  (Next.js)   │  │  (Next.js)       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐  │
│  │                   API Layer (Next.js Route Handlers)  │  │
│  │  /api/jobs  /api/leads  /api/quotes  /api/providers   │  │
│  │  /api/webhooks/whatsapp  /api/notifications           │  │
│  └──────┬────────────────────────────────────────────────┘  │
│         │                                                   │
│  ┌──────▼──────────────────────────────────────┐           │
│  │              Core Services                  │           │
│  │  ┌─────────────┐  ┌──────────────────────┐  │           │
│  │  │  Matching   │  │  Notification        │  │           │
│  │  │  Engine     │  │  Service             │  │           │
│  │  └─────────────┘  └──────────────────────┘  │           │
│  │  ┌─────────────┐  ┌──────────────────────┐  │           │
│  │  │  Job FSM    │  │  WhatsApp Bot        │  │           │
│  │  │  (lifecycle)│  │  (conversation flow) │  │           │
│  │  └─────────────┘  └──────────────────────┘  │           │
│  │  ┌─────────────┐  ┌──────────────────────┐  │           │
│  │  │  Trust &    │  │  Admin Console       │  │           │
│  │  │  Moderation │  │  (internal ops)      │  │           │
│  │  └─────────────┘  └──────────────────────┘  │           │
│  └──────┬──────────────────────────────────────┘           │
│         │                                                   │
│  ┌──────▼──────────────────────────────────────┐           │
│  │              Data Layer                     │           │
│  │  Neon Postgres (primary) + Vercel Blob      │           │
│  │  (photos/attachments)                       │           │
│  └─────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
         │                    │
    WhatsApp Cloud API    Push Notifications
    (Meta Business)       (Web Push)
```

### 8.2 Component responsibilities

**Marketing Website** (`marketing/`)
- SEO + acquisition for both customers and providers
- Waitlist / early access capture
- WhatsApp entry CTA
- Provider registration landing page

**Customer PWA** (`field-service/app/(customer)/` — refactored)
- Job request creation with photos
- View matched providers
- Accept/reject quotes
- Track job live status
- Review and history

**Provider PWA** (`field-service/app/(technician)/` → renamed `(provider)/`)
- Lead inbox — accept/decline
- Structured messaging through platform
- Submit quotes with photos
- Job execution controls (status, photo upload, extra work)
- Profile and reputation view

**Admin Console** (`field-service/app/(admin)/`)
- Provider application review and approval
- Job request oversight
- Dispute management
- Matching engine configuration
- Moderation tools
- Operational dashboards

**Matching Engine** (`field-service/lib/matching.ts` — new)
- Triggered on JobRequest creation
- Queries providers by: skill category, service area, availability, active status
- Ranks by: proximity, trust score, recent activity
- Creates `Lead` records and fires notifications

**WhatsApp Bot** (`field-service/lib/whatsapp-flows/` — adapts existing)
- Customer intake (keep existing booking flow structure, reframe)
- Provider lead response (keep `tech_job_view`, `tech_job_confirm_accept/decline`)
- Job status updates (keep existing)
- Mediated message relay (new: route in-thread messages between parties)

**Job FSM** (`field-service/lib/jobs.ts` — adapts existing)
- Keep core state machine and audit trail
- Extend with pre-execution states (MATCHING, LEAD_SENT, ACCEPTED, QUOTED, etc.)
- Notification side effects updated for marketplace context

**Identity & Trust Layer**
- Provider onboarding verification
- Trust score computation (reviews + job completion rate + tenure)
- Fraud and abuse controls

**Notification Service**
- WhatsApp outbound (existing `whatsapp.ts` + `whatsapp-bot.ts`)
- Web push (existing `push.ts`)
- Route per channel preference + fallback

### 8.3 MVP scope vs later phase

| Feature | MVP | Later |
|---------|-----|-------|
| Customer job request via WhatsApp | ✅ | |
| Customer job request via web/app | ✅ | |
| Provider onboarding via WhatsApp | ✅ | |
| Proximity + skill matching | ✅ | |
| Lead routing (4 providers max) | ✅ | |
| Lead accept/decline via WhatsApp | ✅ | |
| Platform-mediated messaging (Phase 1) | ✅ | |
| Quote flow (WhatsApp + app) | ✅ | |
| Inspection slot scheduling | ✅ | |
| Job execution status tracking | ✅ | |
| Photo upload (before/after) | ✅ | |
| Extra work approval | ✅ | |
| Direct payment recording | ✅ | |
| Provider profile + reviews | ✅ | |
| Admin console (review, moderation, oversight) | ✅ | |
| Basic trust score | ✅ | |
| Platform-held escrow / payment | | Phase 2 |
| Automated dispute resolution | | Phase 2 |
| In-app chat (Phase 3 comms) | | Phase 2 |
| Richer fraud detection (ML) | | Phase 3 |
| Subscription / monetisation | | Phase 2 |
| Advanced ranking and recommendation | | Phase 3 |
| Multilingual (Zulu, Afrikaans) | | Phase 2 |
| Retailer / location activation | | Phase 3 |
| Provider performance analytics | | Phase 2 |
| Background check integration | | Phase 2 |

---

## 9. MVP vs Later Phases — Roadmap

### Phase 0 — Foundation (now)
- Fix marketing site messaging and IA
- Update architecture documents and domain model
- Remove B2B SaaS framing from all surfaces

### Phase 1 — MVP Launch
**Customer side:**
- Job request intake (WhatsApp + web form)
- Match and lead broadcast
- Provider selection (customer confirms or first-accept)
- Quote review and approval
- Job tracking + notifications
- Post-job review

**Provider side:**
- WhatsApp or web registration
- Profile: skills, areas, availability
- Lead inbox (accept/decline)
- Quote submission
- Job execution controls
- Rating accumulation

**Platform:**
- Matching engine (proximity + skill)
- Mediated communication (Phase 1 — WhatsApp relay)
- Admin console: provider review, job oversight, dispute intake
- Audit trail throughout

**Monetisation at MVP:** hold on visible pricing; capture all early users free to validate the model; introduce provider subscription or per-lead fee post-validation

### Phase 2 — Growth
- Platform-held payment / escrow
- In-app messaging (moving comms on-platform)
- Automated dispute flow
- Subscription tiers for providers
- Provider verification (ID, background check)
- Enhanced trust scoring
- Analytics for providers ("your conversion rate", "top job types")

### Phase 3 — Scale
- Retailer / hardware hub activation strategy
- Advanced matching (ML ranking)
- Multilingual
- Corporate / property manager accounts
- Referral and loyalty mechanics

---

## 10. Interpretation Drift — Architecture Gap Analysis Table

| Current assumption | Source location | Why wrong | Corrected marketplace design |
|-------------------|-----------------|-----------|------------------------------|
| `Business` is a SaaS tenant | `schema.prisma` | Platform is not sold to businesses | Remove multi-tenancy; platform is single operator |
| `Technician.businessId` | `schema.prisma` | Workers are independent | `Provider` has no businessId; scoped to platform |
| `Customer.businessId` | `schema.prisma` | Customers belong to platform | Remove businessId FK from Customer |
| `admin/dispatch` manual assignment | `app/(admin)/admin/dispatch/page.tsx` | Dispatch implies owned workforce | Replace with lead management: broadcast → accept |
| `Slot` (business-assigned, per-tech) | `schema.prisma` | Business controls slot allocation | Provider self-manages `AvailabilityWindow` |
| Raw customer phone in notify functions | `lib/jobs.ts`, `lib/whatsapp-bot.ts` | Exposes personal number immediately | Mediated comms: suburb at lead stage, address staged |
| `ConversationData.customerId` scoped to business | `lib/whatsapp-flows/types.ts` | Customer is platform-level | Remove businessId from conversation context |
| Pricing tiers by technician headcount | `marketing/components/marketing/PricingCards.tsx` | SaaS model | Marketplace monetisation (deferred from MVP display) |
| Testimonials from business operators | `marketing/components/marketing/SocialProof.tsx` | Wrong audience | Consumer + provider testimonials |
| "Built for any business that dispatches" | `marketing/components/marketing/WhoItsFor.tsx` | Wrong audience | Dual consumer + provider framing |
| "You dispatch the right technician" | `marketing/components/marketing/HowItWorksSteps.tsx` | Dispatch implies owned staff | "Get matched. Accept. Done." customer-led flow |
| "Managing field technicians..." | `marketing/components/marketing/ProblemStatement.tsx` | B2B problem framing | Consumer + provider problem framing |
| "Modernise your field service business" | `marketing/components/marketing/CTAStrip.tsx` | B2B CTA | Dual-audience CTA |
| `admin/technicians/` pages | `app/(admin)/admin/technicians/` | "Technicians" = owned staff | Rename to `providers/`, reflect independence |

---

## 11. Implementation Backlog

### Stream A — Marketing Site (marketing/)

| # | Task | Priority |
|---|------|----------|
| A1 | Update `siteConfig.description` to marketplace framing | High |
| A2 | Rewrite `Hero.tsx` — new headline, subheadline, DIY line, dual CTAs | High |
| A3 | Rewrite `ProblemStatement.tsx` — dual consumer/provider problem | High |
| A4 | Rewrite `WhoItsFor.tsx` — dual audience sections, remove "business dispatches" | High |
| A5 | Rewrite `HowItWorksSteps.tsx` — 3 steps from customer perspective | High |
| A6 | Rewrite `OperatingModel.tsx` — marketplace operating model | High |
| A7 | Rewrite `Features.tsx` — marketplace features (matching, trust, mediated comms) | High |
| A8 | Rewrite `SocialProof.tsx` — consumer + provider testimonials | High |
| A9 | Rewrite `CTAStrip.tsx` — dual-audience CTA | High |
| A10 | Update `Nav.tsx` — add "For Workers", "Trust & Safety", dual CTAs | High |
| A11 | Add `TrustSafety` component — anonymity, screening, ratings explanation | High |
| A12 | Update `/faq` — dual-audience FAQ | Medium |
| A13 | Update `/how-it-works` — detailed customer flow | Medium |
| A14 | Create `/for-workers` page — provider onboarding explanation | Medium |
| A15 | Update `/solutions` → `/services` — job categories as marketplace | Medium |
| A16 | Remove `/pricing` page or replace with "join free" for MVP | Medium |

### Stream B — Backend / Schema (field-service/)

| # | Task | Priority |
|---|------|----------|
| B1 | Rename `Technician` → `Provider` in schema; drop `businessId` FK | High |
| B2 | Remove `businessId` from `Customer`; make platform-scoped | High |
| B3 | Remove `Business` model or rename to `Operator` (single platform record) | High |
| B4 | Replace `Slot` with `AvailabilityWindow` on Provider | High |
| B5 | Add `Lead` model with status FSM | High |
| B6 | Extend `JobRequest` as first-class entity (replace Booking as primary intake) | High |
| B7 | Add `ConversationThread` + `Message` models for mediated comms | High |
| B8 | Extend Job FSM with pre-execution states (matching → accepted → quoted) | High |
| B9 | Add `TrustVerification` model | Medium |
| B10 | Add `AdminCase` (dispute) model | Medium |
| B11 | Remove raw phone from lead notification payloads | High |
| B12 | Update `ConversationData` types — remove businessId scope | High |
| B13 | Write `matching.ts` — proximity + skill + availability query | High |
| B14 | Update WhatsApp flows to reflect marketplace context (lead accept, not dispatch) | High |
| B15 | Migrate admin `/technicians` → `/providers` | Medium |
| B16 | Update `admin/dispatch` → `admin/leads` | Medium |

### Stream C — Customer PWA (field-service/app/(customer)/)

| # | Task | Priority |
|---|------|----------|
| C1 | Replace `BookingFlow` with `JobRequestFlow` (category, photos, urgency, address) | High |
| C2 | Add matched provider view (accept / compare) | High |
| C3 | Quote review and approval screen | High |
| C4 | Job live tracking with status timeline | Medium |
| C5 | Review submission after job completion | Medium |

### Stream D — Provider PWA (field-service/app/(technician)/ → (provider)/)

| # | Task | Priority |
|---|------|----------|
| D1 | Lead inbox — list of pending leads with accept/decline | High |
| D2 | Lead detail — suburb, category, description (no personal number) | High |
| D3 | Quote submission form | High |
| D4 | Job execution controls (same as current technician flow) | Medium |
| D5 | Provider profile page — skills, areas, rating, bio | Medium |

### Stream E — WhatsApp Flows

| # | Task | Priority |
|---|------|----------|
| E1 | Customer intake: job request via WhatsApp (adapt existing booking flow) | High |
| E2 | Provider lead notification + accept/decline via WhatsApp | High |
| E3 | Mediated message relay — route replies between parties | High |
| E4 | Quote notification to customer via WhatsApp | High |
| E5 | Job status updates (en route, arrived, completed) | Medium |
| E6 | Post-job review prompt | Medium |

### Stream F — Admin Console

| # | Task | Priority |
|---|------|----------|
| F1 | Provider application review (approve/reject) | High |
| F2 | Job request oversight (open jobs, matched leads, status) | High |
| F3 | Dispute / AdminCase intake and management | Medium |
| F4 | Matching engine config (category-to-area rules) | Medium |
| F5 | Operational dashboard (active jobs, lead acceptance rate, review scores) | Medium |

---

## 12. Final Deliverables Checklist

- [x] Interpretation drift report (Section 1)
- [x] Corrected business model statement (Section 2)
- [x] Updated marketing messaging and IA (Sections 3–4)
- [x] Architecture gap analysis table (Section 10)
- [x] Corrected MVP domain model (Section 5)
- [x] Marketplace job lifecycle / state machine (Section 6)
- [x] Anonymous communication design (Section 7)
- [x] Architecture recommendation with diagram (Section 8)
- [x] MVP vs later-phase roadmap (Section 9)
- [x] Concrete implementation backlog (Section 11)

---

## 13. Summary

### What was wrong
Every surface of Plug A Pro was designed as a B2B field service management SaaS sold to plumbing and electrical contracting businesses to manage their own employed staff. The business model it was designed for does not match the actual product.

### What the corrected model is
A peer-to-peer marketplace connecting South African homeowners and DIYers to independent local handymen and home-job workers. The platform is the trust layer, the communication layer, the matching engine, and the accountability layer — not a SaaS tool for service companies.

### What the architecture should look like
- No multi-tenancy (no `businessId` on Customer or Provider)
- `Provider` replaces `Technician` — independent, self-registered, platform-scoped
- `JobRequest` as the primary intake entity, not `Booking`
- `Lead` as the matching artefact — broadcast to providers, accept/decline
- `ConversationThread` for mediated communication
- Matching engine triggered on job creation
- WhatsApp as primary operating channel — intake, lead response, quotes, status
- Admin console focused on moderation and platform health, not dispatch

### What to build first
Stream A (marketing rewrite) can start immediately. Stream B (schema) should be planned carefully as a migration. Streams C, D, E, F follow from the schema being stable.

### Root cause → Clues → Fix → Result
**Root cause:** The product was specified or built with a B2B FSM SaaS template in mind rather than a marketplace architecture. Every entity has a `businessId` FK, every admin action assumes an internal manager dispatching owned staff, and every marketing message addresses a business buyer, not a consumer or independent worker.

**Clues:** `Technician.businessId`, `Customer.businessId`, `admin/dispatch` manual assignment, "Built for any business that dispatches technicians", SaaS pricing by technician headcount, all testimonials from "Operations Managers" and "Admin Managers".

**Fix:** Remove multi-tenant SaaS assumptions from schema. Introduce `Provider` (independent), `JobRequest` (customer intake), `Lead` (matching artefact), `ConversationThread` (mediated comms). Rewrite all marketing copy to dual-audience marketplace framing.

**Result:** A platform that makes it immediately clear to any engineer, designer, or content writer that this is a marketplace — not a workforce dispatch tool — and cannot be confused with one again.
