# West Rand customer-acquisition ad creative brief

**Status:** Draft for approval
**Author:** Phase A3 of [pre-JHB-North acquisition fixes plan](../superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md)
**Replaces:** existing WR-Broad-All creative on ad account `act_1349941660531643` (per memory `west_rand_meta_campaign` — pause the active creative; do not delete history)
**Approval gate:** preview every variant in Meta Ads Manager BEFORE publish (per memory `feedback_ad_publishing` — applies even to paused creatives)

---

## Why we are replacing the existing creative

Two weeks of WR-Broad-All running has produced:

- **0 customer signups with `firstTouchSource` stamped** in the prod database (last 14 days)
- **0 job requests with any UTM tag**
- **48 hours of no new signups, no new requests, no new dispatch activity** as of 2026-06-25
- Provider-targeted templates dominate inbound WhatsApp volume (177 `provider_onboarding_terms_cta` reads vs ≤7 customer-facing template reads in 14 days)

The most plausible diagnosis: **the live creative is recruiting providers (people who want to earn), not customers (people who need a service)**. Confirmation requires visual inspection in Ads Manager — Phase A2 of the plan.

This brief specifies the replacement: a customer-acquisition creative, properly UTM-tagged, targeting West Rand households with a concrete service-pain moment.

---

## Audience

| Dimension | Value |
|---|---|
| **Geography** | West Rand, JHB. Locations: Roodepoort, Florida, Constantia Kloof, Northgate, Ruimsig, Krugersdorp, Randfontein, Honeydew, Northriding |
| **Age** | 30–55 |
| **Gender** | All; expect skew female (household repair decisions) |
| **Interests (primary)** | Home improvement, Home repair, Geyser, Plumbing, Electrical wiring, House cleaning, Pest control, Property management |
| **Interests (secondary)** | Homeowners, Property ownership, DIY, Habitat for Humanity |
| **Behaviors** | Engaged shoppers, Mobile device users (smartphone), Recent home purchase (2y) |
| **Exclusions** | People interested in "job opportunities", "freelance work", "side hustle", "earn money from home" — these are the provider-shaped audience we're trying to AVOID overlapping with |
| **Language** | English (Portuguese localisation is a known gap per memory `project_localisation_backlog_20260619` — out of scope here; revisit Tier 2) |

---

## Variants

Three creative variants to start. Run all three in a single ad set as Meta dynamic creative — let the algorithm pick the winner over the first 7 days.

### Variant 1 — Emergency framing (geyser/plumbing)

| Field | Copy |
|---|---|
| **Headline** | Geyser leak? Plumber in 60 minutes. |
| **Primary text (top)** | Burst geyser. Blocked drain. Wet ceiling. We send a vetted plumber to your door in West Rand — average 60 minutes, paid only when the job is done. |
| **Primary text (bottom)** | No quotes to chase. No promises that don't show up. Verified providers only. |
| **CTA button** | Book Now |
| **Destination URL** | `https://app.plugapro.co.za/book/plumbing?utm_source=meta&utm_medium=cpc&utm_campaign=wr-broad-all-customer-v1&utm_content=geyser-emergency` |
| **Visual direction** | Photo: visible water damage on a ceiling OR a steady hand turning a valve. Avoid stock-photo plumbers in clean uniforms. Real-life mess. Daylight, mobile-first 1080×1350 portrait. |

### Variant 2 — Trust framing (electrician)

| Field | Copy |
|---|---|
| **Headline** | Power off again? Verified electrician, same day. |
| **Primary text (top)** | DB board tripping. Stove not coming on. Geyser element gone. Send a vetted electrician — same day, paid at the door, no cash deposit. |
| **Primary text (bottom)** | Every provider on Plug A Pro completed identity verification and a skills check before they took a job. |
| **CTA button** | Get Help |
| **Destination URL** | `https://app.plugapro.co.za/book/electrical?utm_source=meta&utm_medium=cpc&utm_campaign=wr-broad-all-customer-v1&utm_content=electrician-trust` |
| **Visual direction** | Tight crop on a clean DB-board panel, a verified-ID lanyard visible in foreground. Daylight, 1080×1350 portrait. |

### Variant 3 — Soft framing (general handyman)

| Field | Copy |
|---|---|
| **Headline** | The to-do list isn't going to fix itself. |
| **Primary text (top)** | Tap. Pick what's broken. We send someone to fix it. Verified handymen in West Rand, payment held until the job's done right. |
| **Primary text (bottom)** | No phone calls. No quotes that disappear. Just a fix. |
| **CTA button** | Start Booking |
| **Destination URL** | `https://app.plugapro.co.za?utm_source=meta&utm_medium=cpc&utm_campaign=wr-broad-all-customer-v1&utm_content=handyman-soft` |
| **Visual direction** | Mobile screenshot of the Plug A Pro service-picker (real one, not mockup) overlaid on a kitchen background. 1080×1350. |

---

## Banned wording (carryover from memory `west_rand_meta_campaign`)

Per the prior cleanup, do NOT use the following anywhere in headlines, primary text, button labels, or image captions. These tripped Meta's policy review in the previous campaign cycle and the spec lives in Dropbox:

- Anything implying time-bound promises Meta can fault as "guarantees" (specific wording withheld here; spec is in `Dropbox / Plug A Pro / Marketing / Meta / banned-wording-2026-05.md` — check before publishing).
- "Guaranteed" / "Promised" / similar absolutes in any form.
- Implied health claims (e.g. "cleaner" / "sanitise" / "safe" without measurable evidence — Meta treats these as health claims for some categories).
- Specific provider names or photos of identifiable individuals.

If any variant above gets flagged, drop the offending word, keep the structure.

---

## Budget + bidding

| Setting | Value |
|---|---|
| **Daily budget** | R150 (per memory funnel: 14 days at R150 = ~R2 100, statistically meaningful sample) |
| **Duration** | 14 days, then re-evaluate |
| **Bid strategy** | Lowest cost (let Meta optimise; we don't have enough data yet to bid manually) |
| **Optimisation goal** | Currently: Landing page view (until PR #145 ships custom-event Pixel firing). After PR #145 + 7 days of data: switch to Custom Conversion = `WorkflowEvent.REQUEST_SUBMITTED` via the Conversions API |
| **Frequency cap** | None at this stage |
| **Pixel** | `1043906144257872` (from memory `west_rand_meta_campaign`) — must be installed and firing on app.plugapro.co.za |

---

## Tracking + measurement

| Surface | What we track |
|---|---|
| **Meta Pixel** | `PageView` on landing, `Lead` on submit (via the existing pixel events in `field-service/lib/marketing/meta-pixel.ts` per memory) |
| **GA4** | UTM-tagged sessions, `request_started` + `request_submitted` events |
| **Server-side `WorkflowEvent`** | `REQUEST_STARTED` + `REQUEST_SUBMITTED` rows in `workflow_events` (post PR #145 merge) |
| **Database stamp** | `Customer.firstTouchSource = 'meta'`, `Customer.firstTouchCampaign = 'wr-broad-all-customer-v1'`, `Customer.firstTouchLandingPath` per touch (per existing schema columns from the Tier 1 acquisition work) |

**Validation step before scaling spend (Phase E launch gate):** Click each of the 3 destination URLs from a fresh phone on cellular data. Confirm:

1. The landing page loads (no console errors)
2. The UTM params survive any client-side route changes (BookingFlow keeps them)
3. The Meta Pixel fires (Pixel Helper extension)
4. A test signup → submit produces a row in `customers` with `firstTouchSource = 'meta'` AND a row in `job_requests` with `utmCampaign = 'wr-broad-all-customer-v1'`

If ANY of those four fail, **fix before paying for clicks**.

---

## Success criteria (Phase E gate, restated)

After 24 hours of live spend on this creative, prod must show:

- [ ] ≥ 5 customers with `firstTouchSource = 'meta'`
- [ ] ≥ 2 `JobRequest` rows with `utmCampaign = 'wr-broad-all-customer-v1'`
- [ ] ≥ 1 `WorkflowEvent` row with `eventType = 'PROVIDER_ACCEPTED'` linked back to a Meta-attributed job (joins via `Lead.jobRequestId` → `JobRequest.utmCampaign`)
- [ ] ≥ 1 paid `Booking` end-to-end from a Meta-attributed customer

Below those thresholds, do NOT proceed to JHB North launch — the funnel is leaking somewhere and we need a sharper look before scaling.

---

## Pre-publish checklist

- [ ] **Pause** the current WR-Broad-All creative in Ads Manager (do not delete — keep for historical comparison)
- [ ] Run banned-wording check against `Dropbox / Plug A Pro / Marketing / Meta / banned-wording-2026-05.md`
- [ ] Generate visual previews for each variant via Meta Ads Manager
- [ ] Send previews to user for approval (per memory `feedback_ad_publishing` — explicit visual review required before any publish, even paused)
- [ ] After approval: create new ad set "WR-Broad-All Customer v1", three creatives, R150/day budget
- [ ] Verify Pixel + UTM tracking on a fresh phone before activating spend
- [ ] Activate

---

## Out of scope (don't bundle into this brief)

- **Provider-recruitment ads.** We have 108 active providers, only 5 KYC-verified. Provider-side acquisition is a separate workstream and not the bottleneck.
- **Portuguese variants.** Localisation is tracked in memory `project_localisation_backlog_20260619` — defer to Tier 2.
- **CapeTown / Durban geo expansion.** Phase E gate must pass on West Rand before any geo broadening.
- **Video creative.** Static first; if static doesn't convert, video is the next test, not the first.
