# August Client Acquisition Campaign — Spec

**Status:** DRAFT for owner approval — nothing published
**Date:** 2026-08-03
**Ad account:** `act_1349941660531643` (Plug A Pro) · Pixel `1669029974327986`
**Objective:** paying customer demand in the only region we can serve, at measurable cost

---

## 1. Why this campaign is different from West Rand Phase 1

Phase 1 (June) spent R3,584 at healthy click metrics (1.57% CTR, R1.18 CPC, 1,398 LPV)
and produced **zero attributable job requests**. The post-mortem findings that shape this spec:

1. **Measurement was blind.** GA4 had (and still has) zero key events; the funnel report
   showed a 100% mid-flow drop with no way to see where. → This campaign does not launch
   until the launch gates in §7 are green.
2. **Creative was provider-flavoured.** The 2026-06-19 funnel finding: ad creative read as
   provider-targeted, so clicks were curious tradespeople, not customers. → Every August
   creative passes a "would a homeowner click this?" review, and copy never mentions
   earning, jobs, or joining.
3. **Supply couldn't serve what demand asked for.** June's matchable bench was thin and
   partially mislabelled. Today we know exactly where supply is (§2) and pin ads to it.

## 2. Geography — pin set, not radius

Customer matching is fenced to `jhb_west`. **78 of the platform's 82 matchable providers
live there.** Everywhere else has 1–2. Any impression outside the fence recruits a customer
we structurally cannot serve (the JR-C/Andries failure mode — request accepted, then dies).

Phase 1 used "Roodepoort +17km", which bleeds into Krugersdorp/Randfontein (out of fence)
and Sandton (no supply). August uses **suburb pins** (+2km each), weighted by live bench:

| Tier | Suburbs (matchable providers) |
|---|---|
| A — anchor | Northcliff (52) · Honeydew (49) · Florida (44) · Randpark Ridge (43) |
| B — core | Discovery (39) · Constantia Kloof (39) · Helderkruin (38) · Horison (36) |
| C — fill | Bromhof (35) · Little Falls (35) · Featherbrooke (35) · Allen's Nek (35) · Radiokop (33) · Kloofendal (31) · Wilgeheuwel (30) · Weltevreden Park (29) |

All 20 mapped suburbs carry full 11-category coverage, so geo does not constrain category.
**Exclusions:** explicitly exclude Krugersdorp, Randfontein, Soweto pins — out of fence.
No creative may name an out-of-fence area (the June map-image lesson).

Age 25–65+, all genders, **mobile placements only** — app.plugapro.co.za serves desktop
browsers a no-JS gate, so desktop impressions are wasted by design.

## 3. Budget and structure

| Item | Value |
|---|---|
| Monthly envelope | **R3,500** (matches the approved Phase 1 GO decision) |
| Daily | R150/day CBO, one campaign |
| Phase A (weeks 1–2) | One broad ad set over the full pin list, 5 creatives, Traffic objective optimised for landing-page views |
| Phase B (weeks 3–4) | Kill bottom creatives; if ≥50 `job_request_submitted` pixel events have accumulated (lifetime), switch objective to Conversions per the standing rule |
| Objective note | We cannot start on Conversions — the pixel has single-digit conversion history; Meta needs volume to optimise against. |

**Structural guard against the CBO monoculture problem:** the provider campaign has run
92–94% of spend into one creative for three straight weeks. For August, cap it: any creative
taking >50% of spend for 7 consecutive days gets its own ad set with a R40/day floor for the
others, or gets paused for 72h to force exploration. This is a manual weekly check via
`scripts/acquisition-weekly-snapshot.mjs` (it already flags >60% concentration).

**Kill / scale criteria (evaluated at each Monday snapshot):**
- Kill a creative: CTR < 1% after R250 spend, or CPC > R2.50 sustained.
- Kill the campaign: < 5 job requests after R1,750 (half budget) with gates green — that
  signals a funnel problem again, and more spend is waste until it's found.
- Scale +50%: cost per job request < R70 for 7 days (interim proxy for the <R35 target,
  which applies at Conversions-objective maturity).

## 4. Creative angles by category

Lead with the deep bench; every angle is a **customer problem**, never a service description.
Formats: 1:1 + 3:4 pairs (feed + Stories/Reels), matching the existing asset pipeline.

| # | Category (bench) | Angle | Example hook |
|---|---|---|---|
| 1 | Handyman (42) | "The list" — the accumulating small jobs | "That cupboard door. The dripping tap. The shelf that never went up. One visit — done." |
| 2 | Painting (42) | Room-refresh before/after | "One weekend. One room. A completely different house." |
| 3 | Plumbing (23) | Fast response to small emergencies | "A leak doesn't wait for month-end. Book a plumber near you today." |
| 4 | Cleaning (23) | Once-off deep clean / move-in-move-out | "Moving in? Moving out? Book a deep clean and hand over the keys, not the scrubbing." |
| 5 | Tiling + carpentry combo (27+26) | Fix-it-properly | "Cracked tiles. Squeaky doors. Fixed properly, by someone local." |

Hold back garden/appliances (13 each) — too thin to headline; they remain bookable.

**Copy constraints (hard, from the positioning audit + Meta history):**
- NO "trusted", "verified", "vetted" — banned-wording purge, and only 2–8 KYC-verified
  providers per category exist. Sell **local + available + book online**, not vetting.
- Marketplace positioning: "independent local pros", never implying PAP employs them.
- CTA "Book now" (Meta removed "Get Started" from this account's options).
- Advantage+ creative enhancements OFF (manual check in Ads Manager — the API opt-out is
  deprecated and silently ignores the setting).
- No employment-adjacent wording anywhere — this is a customer campaign and must not need
  the EMPLOYMENT special category.

## 5. Landing and attribution

- Destination: booking entry on app.plugapro.co.za with per-ad `utm_content`, `utm_source=meta`,
  `utm_campaign=pap_client_acquisition_aug` — the JobRequest UTM columns + first-touch
  attribution capture already persist these.
- The June CTWA lesson applies: if any creative uses Click-to-WhatsApp later, referral
  attribution flows via `ctwaClid`; for August all ads land on web to keep GA4 in the loop.

## 6. Companion workstream — the cheaper half of the campaign

**The provider funnel leaks are now worth more than the ad spend.** Current backlog:
**161** drafts parked at the evidence step, **115** finished review but never submitted.

**Corrected 2026-08-03 — the "12 approvals with no service area" was NOT a bug.** Root-cause
investigation (see `provider-record.ts:128` + `service-area-guard.ts:22`) showed their TSA
rows exist and are deliberately `active=false` because the providers are **outside the
`jhb_west` matching fence** (Soweto, Sandton, Pretoria East, Tembisa, east/south JHB) — the
designed PR #168 behaviour. They are pre-positioned inventory for future region launches,
not broken records. No backfill; activating them would break the fence.

- **The real supply fix:** the provider acquisition campaign's geo (Johannesburg/Soweto/
  Sandton/Randburg +17km) recruits ~80% of its approvals outside the fence. Narrow the
  provider campaign to the same §2 pin set so its yield lands where matching operates.
  Ads Manager change, zero code.
- Converting one-third of the 276 parked drafts roughly **doubles the matchable bench**
  behind this campaign's pins.
- Priority order stands from the 2026-07-28 baseline: GA4 key events → matchability
  backfill → evidence-step fix → review-screen submit nudge.

An August demand campaign pointed at a bench that quietly doubled is a different campaign.

## 7. Launch gates — all must be green before the toggle flips

| # | Gate | Why | Status 2026-08-03 |
|---|---|---|---|
| G1 | GA4 key events configured (`job_request_submitted` at minimum) | June failed unmeasured; never again | ❌ 0 key events |
| G2 | Pixel `job_request_submitted` verified firing on prod (mobile UA) | Conversions objective depends on it | ◻ re-verify (last checked June) |
| G3 | One end-to-end test booking on prod | The booking flow has produced 6 JRs in 5 weeks; prove the rail before paying for traffic | ◻ |
| G4 | Narrow the provider campaign's geo to the §2 pin set | ~80% of provider-ad approvals currently land outside the matching fence (root-caused 2026-08-03: fence design, not a data bug) | ❌ |
| G5 | Owner approval of visual previews | Standing rule: previews before publishing, even paused | ◻ |

G1–G3 are the same work the funnel needs anyway; nothing here is campaign-only overhead.

## 8. Out of scope

- Payments/booking monetisation — Pay@ reliability branch is awaiting push/PR; bookings
  PSP has never processed a payment. August measures to `job_request_submitted`, not revenue.
- Any region outside `jhb_west` — revisit only after the matching fence moves.
- WhatsApp template sends — no new templates required for this campaign.
