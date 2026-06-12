# HANDOFF BRIEF — Attach 4 Ads to the Paused West Rand Campaign

> **STATUS: EXECUTED 2026-06-12 (Claude Code session, not Cowork).** All 4 ads published, campaign toggle OFF.
> Ad IDs: urgent-v2 = 120246018375010243 · planned-v2-carousel = 120246019550980243 · planned-v3 = 120246022275430243 · outer-v3 = 120246022934370243.
> Deviations: CTA "Get Started" no longer exists in Meta's taxonomy → "Book now" used on all 4 ads; "auto-show best cards first" checkbox no longer exists (card order locked by disabling all Advantage+ enhancements + single-media format variations).
> Pixel fix applied same day: NEXT_PUBLIC_META_PIXEL_ID was empty in Vercel production → set to 1669029974327986 (dataset the ads track) + production redeploy.

**For:** Claude Cowork (or any operator). This brief is self-contained — no prior session context needed.
**Date:** 2026-06-12
**Source spec:** `docs/superpowers/specs/2026-06-10-west-rand-customer-acquisition-ad-plan.md` (approved GO 2026-06-09)

---

## Current state (already done — do not rebuild)

| Item | Value |
|---|---|
| Ad account | Plug A Pro — `act=1349941660531643` |
| Campaign | `PAP \| West Rand \| Customer Acquisition \| Phase 1` |
| Status | **Published, campaign toggle OFF (paused)** — must stay OFF |
| Objective / budget | Traffic · CBO R117/day |
| Ad sets | `WR-CORE-URGENT` · `WR-CORE-PLANNED` · `WR-OUTER` (all configured: geo, age 28–55, targeting) |
| Ads | **None — that is this task** |
| Pixel | "Plug a Pro" ID 989480460506154, `job_request_submitted` event live |

## The task

In Meta Ads Manager (business.facebook.com/adsmanager, account 1349941660531643), create **4 ads** inside the existing ad sets using the images in this folder. Publish. **Leave the campaign toggle OFF.** Identity for all ads: Plug A Pro Facebook Page + its connected Instagram account.

### URL template (destination for every ad/card)

```
https://app.plugapro.co.za?utm_source=facebook&utm_medium=paid&utm_campaign=wr-phase1&utm_content=<UTM-ID>
```

---

## Ad 1 — single image · ad set `WR-CORE-URGENT`

- **Ad name:** `PAP | WR-URGENT | urgent-v2 | Gate`
- **Image:** `PAP-Client Acquisition-Local Independent Ready Today Northcliff Honeydew.png`
- **Primary text:** Leaking pipe? Electrical fault? Something broken? Tell Plug A Pro what you need. We'll match you with a verified provider in your area — Northcliff, Honeydew, Florida or Randpark Ridge.
- **Headline:** Local. Verified. Ready today.
- **Description:** Book online · West Rand
- **CTA button:** Book Now
- **UTM-ID:** `urgent-v2`

## Ad 2 — carousel (4 cards) · ad set `WR-CORE-PLANNED`

- **Ad name:** `PAP | WR-PLANNED | planned-v2 | Carousel`
- **Primary text:** Your home. Your suburb. Your pro. Verified painters, cleaners, handymen and plumbers across the West Rand. Book online — describe the job and we handle the matching.
- **CTA button:** Get Started
- **UTM-ID (all cards):** `planned-v2-carousel`
- **Turn OFF** "Automatically show the best performing cards first" — card order is deliberate, CTA card last.

| Card | Image file | Card headline |
|---|---|---|
| 1 | `PAP-Client Acquisition-Painters In Your Area West Rand.png` | Painters in your area |
| 2 | `PAP-Client Acquisition-Reliable Cleaners.png` | Reliable cleaners |
| 3 | `PAP-Client Acquisition-Handyman Done Right West Rand.png` | Handyman. Done right. |
| 4 | `PAP-Client Acquisition-Book Any Service Online.png` | Book any service online |

## Ad 3 — single image · ad set `WR-CORE-PLANNED`

- **Ad name:** `PAP | WR-PLANNED | planned-v3 | Before-After`
- **Image:** `PAP-Client Acquisition-Your Home Deserves Better.png`
- **Primary text:** Less hassle. Better home. Tell Plug A Pro what needs doing. We match you with a verified local pro in the West Rand — no calls, no referrals, no guessing.
- **Headline:** Your area. Verified pros.
- **Description:** Northcliff · Honeydew · Florida
- **CTA button:** Get Started
- **UTM-ID:** `planned-v3`

## Ad 4 — single image · ad set `WR-OUTER`

- **Ad name:** `PAP | WR-OUTER | outer-v3 | Launch`
- **Image:** `PAP-Client Acquisition-Now Live West Rand.png`
- **Primary text:** Plug A Pro has launched in Constantia Kloof and Discovery. Verified painters, plumbers, handymen and cleaners — now available in your area. Book your first job online.
- **Headline:** Now live in your area.
- **Description:** Constantia Kloof · Discovery
- **CTA button:** Book Now
- **UTM-ID:** `outer-v3-launch`

---

## Notes & guardrails

1. **Do not toggle the campaign ON.** Launch (D-0) is a human decision, made separately.
2. All images are 1254×1254 square — feed-valid. No vertical variants exist; accept Meta's automatic placement adaptation.
3. The spec's 3 remaining variations (urgent-v1 dripping tap, urgent-v3 video, planned-v1 fresh paint) were **dropped by decision on 2026-06-12** — these 7 images / 4 ads are the final launch set.
4. If a validation error appears on publish, fix at ad level only — campaign and ad-set settings are approved as-is (known accepted deviations from spec: Advantage+ placements, Randburg/Roodepoort address pins, 5km OUTER radius).
5. After publish, verify: 4 ads exist under the right ad sets · each destination URL carries the correct `utm_content` · campaign still shows "Campaign off".

## After this task (separate, not part of this brief)

- D-0 launch: flip the single campaign toggle ON, monitor first 6 hours.
- Switch objective to Conversions (`job_request_submitted`) once Events Manager shows 50+ events.
- Day-7 optimisation: pause lowest-CTR creative per ad set (kill rule: CTR < 0.8%).
