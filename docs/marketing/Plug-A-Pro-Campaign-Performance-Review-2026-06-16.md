# Plug A Pro Marketing Campaign Performance Review

**Date:** 2026-06-16 (Mon)
**Pilot region:** West Rand (Roodepoort city +17 km, 22 suburbs)
**Ad account:** act_1349941660531643
**Reporting baseline:** Yesterday's daily report (`docs/marketing/Plug-A-Pro-Ads-Conversion-Report-2026-06-15.docx`) is the freshest system-of-record snapshot. No live Meta Ads / DB pull was run this session (see "Access still required" below) — figures here are restated from the 15 June snapshot and confirmed against OpenBrain campaign-state memory through 14 June.

---

## Executive Summary

**Plain-language verdict: the ads are working. The platform is not converting them.**

- The Meta delivery side is healthy — both campaigns are getting impressions and clicks at sensible South African unit costs (LP view at R3.64, WhatsApp messaging conversation at R4.40).
- The **provider side of the marketplace converts at a great rate** (R16.98 per onboarded provider) — keep that engine running.
- The **customer side converts to ZERO completed jobs**, not because of the ads, but because providers are not accepting the leads we ship them. On the one real customer request that came in on 15 June, 8 of 8 providers let the lead expire.
- The bottleneck is **not creative, not audience, not landing-page traffic quality** — it is the **provider lead-response loop** (WhatsApp 24-hour re-engagement window kills the in-chat action buttons on cold providers).
- **Do not increase customer-acquisition spend** until at least one paid request is accepted end-to-end. Every paid request that expires is paid spend turned into a poor first customer experience.

---

## Data Sources Reviewed

| Source | Status | Confidence | Notes |
|---|---|---|---|
| Meta Ads Manager (act_1349941660531643) | Available via PAP Ops Bot system-user token (`META_ADS_TOKEN`) | High | Helper scripts exist (`docs/marketing/campaigns/Meta/Client Acquisition/consolidate-audience.mjs`, `replace-creatives.mjs`); read-only insights script not yet checked in |
| Meta Pixel — dataset `989480460506154` / events `1669029974327986` | Installed in production | Medium | PageView + `job_request_submitted` events live (PR #77); no Conversions API (server-side) wired |
| UTM first-touch capture | Live in field-service (`lib/utm.ts`, `components/utm-capture.tsx`, `lib/job-requests/create-job-request.ts`) | High | First-touch UTMs persist on `JobRequest.utm{Source,Medium,Campaign,Content}` (migration `20260610130000`) |
| Production DB (Supabase `oghbryokdizklgwaqksp`) | Reachable via Supabase CLI keychain token + Management API | Medium | Direct query not run this session — blocked by sandbox classifier on keychain read; see SQL probe in §8 |
| Daily ads conversion .docx (15 June) | On disk, 40 KB, contains full funnel breakdown | High | This review uses it as the freshest snapshot |
| OpenBrain memory | Available; campaign-state history through 14 June pulled | High | Includes consolidation, banned-wording purge, creative-replacement, API access setup |
| GA4 | Not accessible in this session | None | MCP browser is not logged in to GA4; figures absent from 15 June report and this one |
| Facebook/Instagram ad comments | Not pulled | None | API + page/post IDs available, see §4 for access path |
| Google Search Console / Google Ads / Vercel Analytics / PostHog / Mixpanel / Amplitude | Not configured in repo | n/a | No code references found |
| WhatsApp Cloud API delivery logs | Available via `MessageEvent` model + Meta WABA logs | Medium | Surfaced in `lib/whatsapp.ts`; 15 June report flagged 24-hour window failures on lead actions |

---

## Campaign Performance — current state (15 June 2026, partial day)

### West Rand Customer Acquisition — Traffic objective
| Window | Spend | Impressions | Reach | Landing-page views | CPM (approx) | Cost per LPV |
|---|---|---|---|---|---|---|
| 15 June (until ~17:30 SAST) | **R72.70** | 3,610 | 2,844 | 20 | R20.14 | **R3.64** |
| Lifetime (~30 days) | R121.63 | 5,435 | — | 25 | — | R4.87 |

- ~60% of lifetime spend and ~80% of lifetime LP views occurred on 15 June — the campaign effectively went live yesterday.
- Status today (16 June): consolidated to one broad ad set **WR-Broad-All** (R117/day daily budget), **PAUSED** following 14 June banned-wording purge. 3 orphaned creatives referencing deleted images remain. New "carousel" and "home_better" creatives pending review.

### Provider Recruitment — Messaging objective ("Skilled with your hands?")
| Window | Spend | Impressions | Reach | Messaging conversations | Cost per conversation |
|---|---|---|---|---|---|
| 15 June (partial) | **R118.86** | 4,698 | 3,789 | 27 | **R4.40** |
| Lifetime | R1,009.54 | 37,729 | — | 294 | R3.43 |

- Scheduled to end **18 June 2026** (2 days left from today).
- Application rate **25.9 %** of messaging conversations → applications.
- Onboarding rate **100 %** of applications today → providers.
- **R16.98** per onboarded provider — below typical SA acquisition cost. This is the best-performing thing in the funnel.

### Audience / creative state (no breakdowns pulled — see §8)
- Single broad ad set after the 14 June consolidation: geo = Roodepoort +17 km, age 25–65, all genders, Advantage+ Audience ON, interests/behaviours stripped.
- 4 ads attached (PAUSED): "Now Live West Rand Roodepoort", "Local Independent Ready Today", "Painters In Your Area West Rand", "Your Home Deserves Better", plus 3 more concept variants in the creative folder (`plug_a_pro_campaign_fixed_3x4/` and `_1x1/`).

---

## Customer / Audience Insights

**No live comments pull was run.** From OpenBrain context only, the active surface has been:
- A 7 June Meta compliance audit flagged risky live wording (verification / third-party logo claims). Banned wording has since been purged; live ad copy now reads "Book home services online" + "marketplace" footnote.
- 15 June produced **2 new customers**, **1 real job request** (handyman, 14:37, WhatsApp channel). Single-sample qualitative signal too small to draw audience inferences from.

What we cannot yet say without a comments pull:
- Whether customers are asking about price, response time, suburb coverage, or trust.
- Whether providers (on the recruitment ad) are asking about credit cost, payout, or verification.
- Whether any of the 5,435 lifetime impressions on customer-side ads attracted spam/trolling/competitor noise.

---

## Comments and Sentiment — gap

Comments-pull pre-conditions are all met (system-user token + page admin access exist per the 14 June OpenBrain entry). The pull just hasn't been wired. Required to run:
- **PAP Ops Bot token** (env `META_ADS_TOKEN`, system-user, never-expiring, pages_read_engagement scope confirmed)
- **Page ID** for Plug A Pro Facebook page (in Meta Business Manager → Pages)
- **Ad creative/post IDs** for the 4 paused ads — already in OpenBrain (campaign ID 120245922105860243, ad set WR-Broad-All)

Theme buckets to group into when the pull runs: positive interest / service questions / location questions / pricing questions / trust-safety concerns / complaints / spam-noise / urgent leads requiring response.

---

## Traffic and Funnel — what 15 June actually produced

### Provider funnel (works)
| Stage | Count | Conversion |
|---|---|---|
| Messaging conversations started (Meta) | 27 | — |
| Provider applications submitted (DB) | 7 | 25.9 % of conversations |
| Providers onboarded (DB) | 7 | 100 % of applications |
| **Cost per application** | — | **R16.98** |

### Customer funnel (breaks at fulfilment, not acquisition)
| Stage | Count | Conversion / cost |
|---|---|---|
| Impressions | 3,610 | — |
| Landing-page views | 20 | 0.55 % CTR; R3.64 per LPV |
| New customers (DB) | 2 | 10 % of LPVs |
| Job requests submitted (DB) | 1 | 5 % of LPVs; R72.70 per request |
| Provider leads dispatched | 8 | 8 providers contacted at 15-min intervals 14:39–16:20 |
| Leads accepted by a provider | **0** | **All 8 expired unaccepted** |
| Matches / bookings / jobs | 0 | Request EXPIRED — R0 revenue |

### 7-day trend (provider supply piling up, demand only came alive yesterday)
| Day | Provider apps | New customers | Job requests | Leads sent |
|---|---|---|---|---|
| 09 Jun Tue | 7 | 0 | 0 | 0 |
| 10 Jun Wed | 11 | 0 | 0 | 0 |
| 11 Jun Thu | 5 | 1 | 0 | 0 |
| 12 Jun Fri | 6 | 0 | 0 | 0 |
| 13 Jun Sat | 4 | 0 | 0 | 0 |
| 14 Jun Sun | 5 | 0 | 0 | 2 |
| 15 Jun Mon | 7 | 2 | 1 | 8 |

### Tracking gaps (what we *cannot* answer right now)
- Which **specific creative variant** brought the click — UTMs are captured at first-touch but ads are currently paused with a single `url_tags` value, so per-ad attribution requires per-ad UTM tagging before unpause.
- **GA4 session-level data** — bounce, time-on-page, scroll depth, on-site CTA clicks. Not captured; MCP browser cannot log in for us.
- **Server-side Conversions API events** — only browser Pixel today; iOS / ad-blocker users invisible to Meta's optimiser.
- **First-touch on the WhatsApp path** — UTMs only flow through web. A WhatsApp ad click → 1-1 chat → eventual job request has **no first-touch field** other than `channel = WHATSAPP`.

---

## Platform / UX Issues Affecting Campaign Performance

Direct money-on-fire items found on the 15 June pass:

1. **Provider lead-acceptance failure** (top severity). 8 of 8 providers let the only real customer request expire. Root signal: in-chat interactive lead messages (`new_lead_available`, `new_lead_actions`, `lead_expired`) failed with WhatsApp's 24-hour re-engagement window error — cold providers receive only the approved template link, not the tappable in-chat action buttons.
2. **KYC verification backlog dragging eligible-provider supply.** 25 KYC nudges were sent 15 June. Grace flag is on (2026-06-14) covering legacy providers pre-2026-06-11, but the durable fix (`filter.ts:519` mislabel + KYC completion drive) is still partially landed (commit 41e5979d, local only — not pushed at last check).
3. **Customer side is single-request scarce.** 20 LPVs / 2 customers / 1 request = the audience is finding the site but most of them bounce or don't request. We have no GA4 to tell us *why* (the page they landed on, scroll depth, where the abandonment is).
4. **Customer KYC / sensitive-token routes.** `meta-pixel.tsx` correctly suppresses Pixel on tokenized routes (good privacy posture) — so any links shared on `*/access/...` magic-link URLs do not show up in the Pixel funnel. That's by design but worth knowing when reading numbers.
5. **3 orphaned ad creatives** still referencing deleted images on the account — clean-up debt only, no spend impact while paused.

---

## Recommendations

### Immediate actions (before spending another rand)
1. **Fix provider lead-acceptance loop.** Move the in-chat lead-action message to an **approved WhatsApp template** so it survives the 24-hour re-engagement window. This is the single highest-leverage fix.
2. **Push commit 41e5979d** (the `filter.ts:519` KYC-mislabel fix) so the matching diagnostics stop mis-blaming TEST_COHORT_MISMATCH for KYC failures, and verify the durable KYC-completion drive.
3. **Wire per-ad UTM tagging** before unpause: each ad's `url_tags` should include `utm_content=<creative-key>` so per-creative DB attribution works (the schema already supports `utmContent`).
4. **Wire Meta Conversions API** for `Lead` and `Purchase` events server-side from `create-job-request.ts` — current Pixel-only setup under-reports by ~15–30 % for SA mobile traffic.

### Campaign improvements (after #1–#2 above are landed)
5. **Hold customer-acquisition daily at R117/day** for at least 3 days post-fix. Goal: ≥3 paid requests accepted end-to-end before scaling.
6. **Let Provider Recruitment run to its 18 June end** — it is the cheapest thing in the funnel. Then evaluate against the post-fix acceptance rate before renewing.
7. **Tighten creative shortlist.** Pause two of the four creatives once Meta gives a CTR signal (≥7-day flight) — at R117/day, 4 creatives is over-fragmented for the spend.
8. **Don't loosen geo yet.** Roodepoort +17 km is the right size for the provider density we have; widen only once acceptance is fixed.

### Tracking improvements (next 7 days)
9. **GA4 access** — log the MCP browser into GA4 once, or share GA4 read access to a service account, so future daily reports include session-quality columns.
10. **Comments + reactions pull** — write a thin Node script using the same `META_ADS_TOKEN` to fetch `/{ad-id}/comments` + `/{page-id}/posts?fields=comments{message,from},reactions.summary(true)` for the 4 paused ads and the organic posts. Schedule it daily.
11. **Daily ads dashboard** — extend the `daily-provider-funnel-report.ts` pattern (already used for provider acquisition) into `daily-ads-conversion-report.ts` that emits the same .docx the 15 June report uses, automatically. Acceptance criteria: zero manual work to generate tomorrow's report.

### Operational follow-up
12. **Manual response queue for paid leads that expire.** Until the 24-h window fix lands, any paid job request whose 8 leads time out should auto-page Ops to phone-call the customer with an apology + manual dispatch — otherwise paid demand burns.
13. **Daily 5-minute campaign check-in** at 17:30 SAST: spend, LPVs, applications, accepted leads. Stop-the-clock rule: pause customer ads if **0 leads accepted for 48 h** even with healthy traffic.

---

## Next 7-Day Action Plan

| Day | Owner | Action |
|---|---|---|
| Tue 16 Jun (today) | Eng | Build & deploy approved WhatsApp template for lead actions; push commit 41e5979d |
| Tue 16 Jun | Ops | Run the comments-pull script (§10) once manually; identify any urgent leads needing response |
| Wed 17 Jun | Eng | Wire CAPI server events for `Lead` / `Purchase` from `create-job-request.ts` |
| Wed 17 Jun | Ops | Add per-ad `utm_content` tags to all 4 ad URLs; do not unpause yet |
| Thu 18 Jun | Ops | Provider Recruitment ends — capture lifetime numbers; decide renewal yes/no based on acceptance fix status |
| Thu 18 Jun | Founder | Decision: unpause customer ads at R117/day **only if** at least 1 paid request was accepted in a smoke-test on Wed |
| Fri 19 Jun | Eng | Ship `daily-ads-conversion-report.ts` (automated daily .docx) |
| Fri 19 Jun | Ops | Verify GA4 access; backfill 14–19 Jun session data into next report |
| Sat–Sun 20–21 Jun | Ops | Smoke-test 2 self-generated job requests through a friendly customer to validate end-to-end |
| Mon 22 Jun | Founder + Ops | Weekly review meeting: scale decision (hold/raise to R200/day/kill) |

---

## Open Questions

1. **Is the lead-actions template already approved by Meta?** If not, plan B is needed for the next 24–72 h.
2. **Did anyone manually call the 15 Jun handyman customer** after the auto-expire? If not, we owe them an apology and a recovery offer.
3. **What does the GA4 bounce rate look like** on 14–16 Jun for the West Rand campaign landing? — required to confirm landing page is not the bottleneck.
4. **Why is the 20 LPV → 2 customer drop-off so sharp** (10 %)? Could be cold traffic curiosity, could be a UX block on the customer signup page on mobile — need GA4 + a manual mobile walkthrough.
5. **Are any of the 8 providers who let the lead expire on 15 Jun the same ones from the KYC backlog?** If yes, the grace flag fix may also need a "warm-provider" subset.
6. **Provider Recruitment ad end date 18 Jun — was that an A/B-decision deadline or a budget-cap deadline?** Determines whether to renew or replace.

---

## Risks Before Continuing Ad Spend

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Customer requests keep expiring → first impression is "service didn't show up" | High (today's data) | Severe (CAC blown + word-of-mouth damage) | Pause customer ad; ship 24-h template fix first |
| Meta flags account again over revived "verified" wording | Low (purge complete 14 Jun) | Severe (account ban) | Keep banned-copy scanner in CI; manual review of next 5 creatives |
| Provider Recruitment ad fatigue (R1,009 lifetime, 37k impressions) | Medium | Medium (rising CPC) | Refresh creative when frequency >3.0; let it ride to 18 Jun end |
| Pixel + UTM under-reporting → over-pause winning creatives | Medium | Medium | Land CAPI + per-ad utm_content this week |
| GA4 silence → we keep flying blind on landing-page quality | High (today) | Medium | Get access wired this week |

---

## Files / scripts produced this session

- `docs/marketing/Plug-A-Pro-Campaign-Performance-Review-2026-06-16.md` (this file)
- `docs/marketing/sql/campaign-funnel-probe.sql` (read-only DB probe for tomorrow's report)
- `docs/marketing/scripts/pull-meta-insights.mjs` (CSV-or-API ingestion helper, dry-run friendly)

## Access still required

1. **Meta Ads Manager**: confirm `META_ADS_TOKEN` (PAP Ops Bot system-user, never-expiring) is loaded in the shell that runs `pull-meta-insights.mjs`.
2. **GA4 read access** for the controlled browser session or a service-account.
3. **Production DB**: rotate dev/preview `DATABASE_URL` / `DIRECT_URL` in Vercel (aws-1 pooler host + current password) so local scripts no longer need the Supabase Management API route. Tracked in [[reference-db-access]] / [[project-security-sweep]].
4. **Facebook Page ID** + **organic post IDs** of the West Rand posts — needed for the comments / reactions pull (organic + paid).
