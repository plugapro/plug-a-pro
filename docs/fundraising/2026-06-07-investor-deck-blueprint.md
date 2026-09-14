# Plug A Pro — Investor Deck Blueprint v1

**Date authored:** 2026-06-07
**Purpose:** Skeleton + evidence map for the first fundraising deck.
**Tone target:** sharp South African startup founder. No corporate-speak, no hockey sticks, no "disrupt." Operating discipline visible. Risks named.
**Audience:** strategic angels and pre-seed funds — institutional VCs come in a later iteration after 30 days of cohort data.

> **For each slide:** Title · Main message · Supporting data needed · Current evidence
> · Missing evidence · Suggested visual · Confidence rating.

---

## Slide 1 — Cover

- **Title:** Plug A Pro — Field service for South Africa, on the channel South Africans already use.
- **Main message:** WhatsApp-native marketplace connecting customers to local trades. Live in production.
- **Supporting data needed:** Logo, tagline, founder name, date, contact, "raising R[X]m" line.
- **Current evidence available:** Brand identity, marketing site live, production app live. `[Proven]`
- **Missing evidence:** Quantified raising ask (Slide 16 prerequisite).
- **Suggested visual:** Phone in hand with a WhatsApp conversation thread visible — "Need a plumber in Sandton this afternoon" → provider profile → time slot. One image, no chrome.
- **Confidence:** **High**

---

## Slide 2 — The problem

- **Title:** Finding a trustworthy tradesperson in SA is broken — and the existing options haven't fixed it.
- **Main message:** Customers default to WhatsApp groups, friend referrals, and Gumtree. None of those provide accountability, scheduling, or proof of payment. Providers default to flyers and word-of-mouth — which means feast or famine, no record, no rating.
- **Supporting data needed:** 2–3 statistics on (a) SA informal-economy size in services, (b) WhatsApp penetration in SA (~95% of internet users), (c) friction in the current alternatives.
- **Current evidence available:** Anecdotal; the founder's own ethnographic observation (worth naming if it's lived experience). `[Assumption — backed by founder lived experience]`
- **Missing evidence:** A cited stat for "trade-services informal market in SA, R/yr." `[Needs more data — investor-research task]`
- **Suggested visual:** Side-by-side: "Existing flow" (WhatsApp group → 12 unread messages → no-show) vs blank space (Slide 4 fills it).
- **Confidence:** **Medium** — strong founder story, weak quantification.

---

## Slide 3 — Why now

- **Title:** Three things are now true that weren't 5 years ago.
- **Main message:**
  1. WhatsApp Cloud API made WhatsApp-native commerce technically and economically viable for small teams (pre-2023 it required BSP middlemen).
  2. South African PSPs (Peach Payments, Yoco) now offer hosted checkout SDKs that small marketplaces can integrate in days, not months.
  3. PoPI (POPIA) maturity means we can design with privacy primitives baked in from day one (vs. retrofit), which is a moat against late entrants.
- **Supporting data needed:** Meta WhatsApp Cloud API GA date (~2022), POPIA enforcement timeline, SA mobile-internet penetration figure.
- **Current evidence available:** Code uses Meta Cloud API directly (no BSP), Peach Payments PSP abstraction (`lib/payments.ts`), error handling standard with POPI-aware reference IDs (per global CLAUDE.md). `[Proven from code]`
- **Missing evidence:** External stat sourcing for the "why now" macro.
- **Suggested visual:** Three icons, single-line statements. Time-stamped if possible.
- **Confidence:** **Medium-High**

---

## Slide 4 — The Plug A Pro solution

- **Title:** WhatsApp where the customer is. PWA where the operations live. Admin where the trust gets built.
- **Main message:** A three-surface marketplace: (1) WhatsApp bot for customer + provider conversational onboarding and dispatch, (2) progressive web app for the admin, the provider profile, and structured customer flows, (3) admin operations centre for verification, dispute handling, and supply orchestration.
- **Supporting data needed:** Surface map; module inventory.
- **Current evidence available:**
  - Customer flows: `app/(client)/*`, `app/(customer)/*`, `app/requests`, `app/track`, `app/r/*`.
  - Provider flows: `app/provider/signup`, `app/(provider)/*`, `app/leads`, `app/quotes`.
  - Admin: 24 admin routes (per project CLAUDE.md inventory).
  - WhatsApp inbound: `app/api/webhooks/whatsapp/route.ts` (Meta signature verified, WAMID dedupe, async processing via `after()`).
  All live. `[Proven]`
- **Missing evidence:** Polished architecture diagram for the deck.
- **Suggested visual:** Triangle: WhatsApp ⟷ PWA ⟷ Admin. Data flows in the middle. Mirror the system architecture diagram in `docs/plugapro-architecture-diagrams.pdf`.
- **Confidence:** **High**

---

## Slide 5 — Product flow: WhatsApp + PWA + admin operations

- **Title:** Customer sends "I need a plumber" → 5 minutes later, a vetted provider is on the way.
- **Main message:** Walk through the canonical flow as a single timeline.
- **Supporting data needed:** Storyboard of 5–7 panels: customer WhatsApp message → bot category capture → location capture → DispatchDecision → provider WhatsApp lead → provider accept → customer notification → on-the-way → arrived → completed.
- **Current evidence available:** Every step above is a real schema state. `JobRequest.status`, `Match.providerOnTheWayAt`, `Match.providerArrivedAt`, etc. `[Proven]`
- **Missing evidence:** A real screenshot timeline from a real flow run (post-recovery, day-3 data).
- **Suggested visual:** Five mobile screenshots in a row, timestamped, with arrows. WhatsApp-green styling.
- **Confidence:** **High** (will be **Very High** once a real flow is captured).

---

## Slide 6 — Market opportunity in South Africa

- **Title:** A R[X]bn informal trades economy that has never had a digital primary surface.
- **Main message:** TAM in three layers: (1) urban household services (plumbing, electrical, garden, cleaning), (2) small commercial maintenance, (3) extension into SADC where WhatsApp-first is even more dominant.
- **Supporting data needed:** External sizing for SA household repair/maintenance spend, # of independent tradespeople, average jobs/month.
- **Current evidence available:** Nothing internal. `[Needs more data]`
- **Missing evidence:** A defensible Stats SA / GSMA / sector-report citation. Without this, the slide is hand-waving.
- **Suggested visual:** Funnel — TAM → SAM → SOM — with the bottom number being "active pilot suburbs in Gauteng × 5% market share by year 1" or similar.
- **Confidence:** **Low** — must improve before any institutional pitch.

---

## Slide 7 — Launch signals from the first two days

- **Title:** Two days in: what we shipped, what we saw, what we fixed.
- **Main message:** Honest 48-hour readout. Lead with what we *survived* (a real production incident, recovered without data loss), not with vanity counts.
- **Supporting data needed:**
  - Registrations (SQL §1.1, §1.2)
  - Applications + funnel (SQL §1.3, §1.4)
  - First job requests (SQL §4.1)
  - First matches / leads (SQL §4.4)
  - Day-zero patch count (commit log: 8 onboarding patches between 2026-06-04 and 2026-06-06)
  - DB-wipe incident framing: incident detected, recovery designed in a documented spec, executed, 86/110 attachments restored, 24 in flight, zero customer data lost. PR #39 merged.
- **Current evidence available:** All technical claims provable from git history + audit script output. `[Proven]`
- **Missing evidence:** Actual SQL pack numbers. Run the pack first; only quote what the pack returns.
- **Suggested visual:** A "Day 1 / Day 2 / Now" timeline with 4–5 markers each. Include the incident as a normal event (not hidden).
- **Confidence:** **High** for the framing, **Needs more data** for the counts.

---

## Slide 8 — Supply acquisition and provider onboarding

- **Title:** Providers join via WhatsApp in under 5 minutes. We approve in under 30.
- **Main message:** Onboarding is conversational, resumable, and SLA-bound. Pilot scoped to non-regulated trades; we'll bring KYC online for regulated trades in Phase 2.
- **Supporting data needed:**
  - Provider registrations by source (SQL §1.2)
  - Application time-to-approval distribution (SQL §1.3)
  - Approved-by-category histogram (SQL §2.1)
  - Approved-by-city heatmap (SQL §2.2)
- **Current evidence available:**
  - Resumable drafts (`ProviderApplicationDraft`, `RegistrationResumeToken`)
  - 30-min SLA codified in operating memory; tracked by `approvedAt - submittedAt`.
  - Phase 2 KYC scoping in `Plug_a_Pro_Master_Solution_Document v2.docx`
  - Day-zero onboarding patches (commits `93a35deee`, `49765b605`, `941007ae5`, `95225f7dc`). `[Proven]`
- **Missing evidence:** Actual approval-time histogram from SQL pack.
- **Suggested visual:** Onboarding wizard mock + a single big number: "Median time-to-approval (Day 2): [X] minutes".
- **Confidence:** **Medium-High** pending SQL output.

---

## Slide 9 — Demand / customer signal

- **Title:** The first jobs in.
- **Main message:** Demand shape (categories, suburbs, times) from the first 48 hours. Be very honest about volume.
- **Supporting data needed:**
  - Job requests by status (SQL §4.1)
  - Job requests by category (SQL §4.2)
  - No-match reason distribution (SQL §4.3) — including stage counts
  - Match → Booking conversion (SQL §4.4)
  - Demand vs supply heat (SQL §4.5)
- **Current evidence available:** Schema + diagnostic data structure exist. `[Proven]`
- **Missing evidence:** Numbers.
- **Suggested visual:** Two stacked bar charts side by side — left "Categories of jobs requested," right "Categories of approved providers." The gap is the operating story.
- **Confidence:** **Medium** pending SQL output.

---

## Slide 10 — Business model and pricing

- **Title:** Providers pay to unlock leads. Customers pay nothing to request.
- **Main message:** Lead-unlock credit model. Pilot grants 1 onboarding credit per provider (via `PILOT_MAY2026` voucher batch). Subsequent credits purchased in bundles. Take-rate on job completion deferred to Phase 2 — keep the friction low at launch.
- **Supporting data needed:** Credit pack pricing, expected unlocks per pack, gross-margin assumption.
- **Current evidence available:**
  - Lead-unlock mechanism implemented: `Lead` → `LeadUnlock` with `creditsCharged`, `creditTypeBreakdown`. `[Proven]`
  - Wallet + ledger: `ProviderWallet`, `WalletLedgerEntry`. `[Proven]`
  - Voucher / promo: `PromoVoucher`, `VoucherBatch`, `ProviderCampaignRedemption`. `[Proven]`
- **Missing evidence:** Public price card (`/credit-terms` route exists but content needs investor-ready snapshot). `[Needs more data]`
- **Suggested visual:** Clean price card. "1 credit = 1 lead unlock. Bundles: R[X] / 10, R[Y] / 25, R[Z] / 100." Footer: "Phase 2: optional take-rate on job completion."
- **Confidence:** **Medium**

---

## Slide 11 — Unit economics and cost-to-serve

- **Title:** What it costs us to acquire and serve a provider.
- **Main message:** Build-up of cost-per-provider-onboarded and cost-per-active-provider-per-month. Be explicit that this is **early-data + assumptions**, not measured.
- **Supporting data needed:** Per-line cost build-up:
  - WhatsApp Cloud API: utility + marketing template price per provider onboarding (Meta SA pricing).
  - Vercel + Supabase hosting allocated per active provider.
  - PSP fees per credit pack purchased.
  - Identity-verification cost per onboarding (currently disabled in pilot per memory; budget for Phase 2 with Didit).
  - Customer-acquisition spend if any (current launch is largely organic).
  - Onboarding voucher liability (1 credit per provider, value = credit cost basis).
- **Current evidence available:**
  - PSP abstraction confirms Peach as default; cost line known. `[Proven]`
  - Provider lead-unlock revenue is measurable via SQL §7.1. `[Proven once SQL runs]`
- **Missing evidence:** A real CAC number. Need 30-day data + a paid campaign to actually measure. `[Needs more data]`
- **Suggested visual:** A waterfall: Revenue per provider per month → minus WhatsApp cost → minus hosting → minus credit-grant liability → contribution margin. Honest gap: "Need 30 days of post-pilot data to lock these."
- **Confidence:** **Low** — most-honest framing is "we have the instrumentation; we lack the longitudinal data."

---

## Slide 12 — Go-to-market plan

- **Title:** Suburb-by-suburb supply-led expansion. WhatsApp groups are the channel.
- **Main message:**
  - Land 30–50 providers in 2 Gauteng suburbs (already pilot-scoped).
  - Drive demand via local WhatsApp community groups, partnership with one estate-management company, and word-of-mouth from completed jobs.
  - Expand to a third suburb only when first suburb cohort shows repeat-job behaviour.
- **Supporting data needed:** Acquisition channel mix, expected conversion per channel, partner-pipeline list.
- **Current evidence available:** Pilot already non-regulated trades, scoped. WhatsApp template infra exists for utility messages. `[Proven]`
- **Missing evidence:** Named partner pipeline. `[Needs more data]`
- **Suggested visual:** Map of SA with three pinned suburbs (current pilot pins). Side bar: "Suburb expansion criteria — only expand when cohort N suburb 1 shows X repeat-job rate."
- **Confidence:** **Medium**

---

## Slide 13 — Competitive landscape

- **Title:** We're not the first to try this. We're the first WhatsApp-native, ops-first attempt.
- **Main message:** Three honest competitors: SweepSouth (cleaning-only, web-first), Kandua (broad trades, lead-list model, web-first), Helpr (mainly Cape Town, web-first). All are credible. None have a WhatsApp-native flow. None expose structured no-match diagnostics. Our differentiation is *channel* and *operational instrumentation*, not feature count.
- **Supporting data needed:** Comp table: 3 axes (channel, category coverage, business model) × 4 players incl. Plug A Pro.
- **Current evidence available:** Internal awareness of incumbents (founder knowledge). Not a market scan. `[Assumption]`
- **Missing evidence:** A defensible comp table that would survive 10 minutes of investor research. `[Needs more data — competitive scan]`
- **Suggested visual:** 2×2: x-axis "Channel (web ↔ WhatsApp)", y-axis "Category scope (single ↔ broad)". Plot the four players. Plug A Pro at upper right.
- **Confidence:** **Medium** for the positioning, **Low** for the data behind it.

---

## Slide 14 — Technology, trust, verification, and operations

- **Title:** We built the operating system for trust, not just a directory.
- **Main message:** Inventory the trust scaffolding that exists today. This is where day-1 maturity beats a flashy product.
- **Supporting data needed:** A short list (5–7 items), each with one supporting sentence.
- **Current evidence available:**
  - Admin audit log on every mutation (`AuditLog`, `AdminAuditEvent`). `[Proven]`
  - Feature-flag rollout with per-user gating. `[Proven]`
  - WhatsApp webhook signature verification + WAMID dedupe. `[Proven]`
  - Production-safe migration discipline (read-only audit script, recovery design doc, phased rollouts). `[Proven]`
  - Structured dispatch diagnostics (`noMatchReason`, `stageCounts`). `[Proven]`
  - OTP fraud-response infrastructure (per memory `project_otp_fraud_response.md`). `[Proven]`
  - POPI-aware error handling standard (per global CLAUDE.md). `[Proven]`
- **Missing evidence:** Visual rather than narrative — a one-pager architecture diagram with the trust scaffolding highlighted.
- **Suggested visual:** Architecture cube with "trust" components highlighted in WhatsApp-green.
- **Confidence:** **High**

---

## Slide 15 — Roadmap and milestones

- **Title:** Next 90 days: depth in two suburbs. Months 4–6: KYC for regulated trades. Months 7–12: SADC pilot.
- **Main message:**
  - **30 days:** drain operational gaps from this report; 100 providers across 2 suburbs; 200 job requests; first cohort retention data.
  - **60 days:** matching v2 production-grade; first paid acquisition test; admin dashboard rebuilt (per existing project plan).
  - **90 days:** KYC pilot via Didit for regulated trades (electricians, gas installers); first repeat-job rate KPI.
  - **6 months:** category management table; multi-role admin; complete BMS finance integration.
  - **12 months:** second city; SADC pilot exploration.
- **Supporting data needed:** Internal-only — the existing plan documents in `docs/superpowers/plans/` and `docs/PlugAPro-Ops-Implementation-Plan.md`.
- **Current evidence available:** Documented Phase 1 / Phase 2 onboarding model in memory; Matching v2 in active development. `[Proven]`
- **Missing evidence:** Numbers in the 30/60/90 day commitments tied to current funnel reality.
- **Suggested visual:** Horizontal swim-lane: Product / Supply / Demand / Ops / Trust. Quarters as columns.
- **Confidence:** **Medium-High**

---

## Slide 16 — Funding ask and use of funds

- **Title:** Raising R[X]m to compress the next 6 months into the next 3.
- **Main message:** Specifically, the ask buys (a) acquisition runway in the two pilot suburbs, (b) ops headcount (one part-time vetting/dispatch lead), (c) Didit KYC budget for the regulated-trades expansion, (d) a 12-month runway buffer.
- **Supporting data needed:** Concrete numbers:
  - Burn (current + planned), runway (current + planned), use-of-funds split.
  - Cost per onboarded provider × target headcount.
  - WhatsApp marketing template cost × volume.
- **Current evidence available:** Nothing concrete yet. `[Needs more data]`
- **Missing evidence:** Founder must complete a budget sheet. **This slide blocks the deck.**
- **Suggested visual:** Pie chart of use-of-funds + a sentence on what each slice produces. e.g. "30% to ops vetting → 200 providers vetted to KYC standard."
- **Confidence:** **Low** until budgeted.

---

## Slide 17 — Risks and mitigation

- **Title:** What could go wrong, and what we're doing about it.
- **Main message:** Naming risks is credibility. Five risks, each paired with a current mitigation.
- **Supporting data needed:** Risk register. Recommended five:
  1. **Supply concentration.** Mitigation: suburb-by-suburb expansion criteria; supply heat map.
  2. **WhatsApp policy / template-approval delays.** Mitigation: template registry monitoring; multi-template fallback paths.
  3. **POPIA / data-protection breach.** Mitigation: error-handling standard with reference IDs, audit log on every mutation, separated sensitive-data access logs.
  4. **PSP / banking failure.** Mitigation: PSP abstraction (Peach default, PayFast alt); manual reconciliation procedure.
  5. **Provider quality degradation at scale.** Mitigation: reliability score, complaint rate, dispute infrastructure (`LeadUnlockDispute`, `Dispute`, `Case` models), strikes counter.
- **Current evidence available:** Every mitigation listed is a real model or process in the codebase. `[Proven]`
- **Missing evidence:** None — this is the one slide where we are over-prepared rather than under.
- **Suggested visual:** Two-column table. Risks on the left, mitigations on the right. Founder voice.
- **Confidence:** **High**

---

## Slide 18 — Team / founder advantage

- **Title:** Why this team will execute this in this market.
- **Main message:** Founder's *operating* track record (Kgolaentle Holdings: AITrader, CycleDesk, MyZaca + cross-project standards / admin systems / OpenBrain memory infrastructure) signals shipping discipline and operational depth. **Not** a "first-time founder" pitch.
- **Supporting data needed:** Founder bio, 1–2 lines on each prior project, key operating principles ("error-handling standard across projects", "audit-log everything", "feature-flag everything").
- **Current evidence available:** Real artefacts across multiple repos. `[Proven]`
- **Missing evidence:** A founder narrative document. `[Needs more data — founder writes this]`
- **Suggested visual:** Founder photo, three logos (active projects), three keywords (Operations / Discipline / Distribution).
- **Confidence:** **Medium-High**

---

## Slide 19 — Closing narrative

- **Title:** Real product. Real customers. Real discipline. Honest stage.
- **Main message:** One paragraph closing. Roughly: "We're not pitching a deck. We're pitching the operating capacity to turn the next R[X]m into measurable trust in a market that hasn't had a digital primary surface. The product is live. The discipline is in the audit log. The next 90 days will prove the cohort. Either you're in for that ride, or you're the wrong partner for this stage. We respect both answers."
- **Supporting data needed:** No data; this is voice.
- **Current evidence available:** N/A.
- **Missing evidence:** N/A.
- **Suggested visual:** One sentence on a black slide. Founder contact + Calendly link below.
- **Confidence:** **High**

---

## Slide-level evidence map summary

| Slide | Confidence | Blocker before this slide is investor-ready |
|---|---|---|
| 1 Cover | High | none |
| 2 Problem | Medium | citation for SA market sizing |
| 3 Why now | Medium-High | one anchored stat |
| 4 Solution | High | none |
| 5 Product flow | High | screenshot timeline from real flow |
| 6 Market opportunity | Low | external sizing data |
| 7 Launch signals | Medium | run SQL pack, fill actuals |
| 8 Supply | Medium-High | run SQL §1, §2 |
| 9 Demand | Medium | run SQL §4 |
| 10 Business model | Medium | price card snapshot |
| 11 Unit economics | Low | 30-day cohort data |
| 12 GTM | Medium | named partner pipeline |
| 13 Competition | Medium | competitive scan |
| 14 Tech & trust | High | none |
| 15 Roadmap | Medium-High | tied to funnel reality |
| 16 Funding ask | Low | budget sheet |
| 17 Risks | High | none |
| 18 Team | Medium-High | founder bio narrative |
| 19 Closing | High | none |

**Deck-ready milestone:** Slides 1, 4, 5, 14, 17, 19 are buildable today. Slides 2, 3, 8, 9, 13, 15, 18 are buildable this week. Slides 6, 7, 10, 11, 12, 16 require either data the SQL pack will surface, founder budget work, or external research. **The deck is not investor-ready until at least Slides 7, 8, 9, 11, 16 are numerically defensible.**
