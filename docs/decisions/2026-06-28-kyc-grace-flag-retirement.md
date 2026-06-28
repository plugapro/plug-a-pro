# KYC Grace Flag Retirement — Decision Brief

**Status:** Draft for ops decision · **Author:** Engineering · **Date:** 2026-06-28

The flag `matching.kyc_grace_legacy_providers` is **ON** in production. When ON, providers created before the KYC_GRACE_CUTOFF date (2026-06-11) are matchable even without a verified identity. Without this flag, matchable supply collapses to single digits. This document defines the criteria that would safely allow the flag to be turned OFF.

## TL;DR

At current verification velocity (~0.4 PASSED per day), no percentage-based retirement threshold is achievable within the pilot window. The grace flag is effectively a long-running operational dependency. Three real options:

1. **Hybrid (recommended)** — Post-cutoff providers must be 100% verified + legacy cohort ≥ 20% verified. Concrete and aligned with original cutoff intent.
2. **Time-based** — Flip OFF at pilot exit. Simple, ignores conversion data.
3. **Per-skill** — Retire grace only on skills with enough verified coverage. Needs flag plumbing that does not exist today.

## Current state (as of 2026-06-28)

### Provider snapshot
| Provider status | KYC status | Count |
|---|---|---|
| ACTIVE | NOT_STARTED | 105 |
| ACTIVE | IN_PROGRESS | 1 |
| ACTIVE | VERIFIED | **6** |
| APPLICATION_PENDING | NOT_STARTED | 28 |
| **Total ACTIVE** | | **112** |

**Verified rate among ACTIVE: 6 / 112 = 5.4%** (baseline was 1 / 89 = 1.1% on 2026-06-14).

### Onboarding pace (last 8 weeks)
| Week starting | New ACTIVE providers |
|---|---|
| 2026-05-11 | 2 |
| 2026-06-01 | 47 |
| 2026-06-08 | 45 |
| 2026-06-15 | 17 |
| 2026-06-22 | 1 |

Pace is dropping rapidly — fewer new unverified providers to manage.

### Verification activity (rows created since 2026-05-11)
| Week | NOT_STARTED | CONSENTED / mid-flow | PASSED |
|---|---|---|---|
| 2026-06-08 | 3 | 8 | 3 |
| 2026-06-15 | 73 | 5 | 3 |

The 73 NOT_STARTED `ProviderIdentityVerification` rows in the 2026-06-15 cohort correspond to providers who never engaged the flow at all. PASSED ceiling has been ~3/week — the binding constraint on retirement.

## The cohort math

Two distinct cohorts to keep separate:

- **Legacy (pre-cutoff)** — 89 providers created before 2026-06-11. The grace flag exempts them. Of these, 1 verified on 2026-06-14 baseline; currently 6 verified total (~5 of those 6 are legacy if we assume the 1 post-cutoff IN_PROGRESS hasn't completed yet). Verified rate in this cohort: ~7%.
- **Post-cutoff** — 14 providers created on/after 2026-06-11 plus the 28 APPLICATION_PENDING. Grace does NOT cover them. Hard KYC gate applies. Of these, **0 are verified** — they're invisible to matching today.

The hybrid retirement criterion below treats these cohorts separately because they map to different operational realities.

## Conversion velocity

PASSED count: 1 (2026-06-14 baseline) → 6 (2026-06-28). 5 new verifications across 14 days = **~0.4 PASSED per day**.

At that pace:
| Horizon | Cumulative VERIFIED (today + 0.4/day) | % of 112 ACTIVE |
|---|---|---|
| +1 month | ~18 | 16% |
| +3 months | ~42 | 38% |
| +6 months | ~78 | 70% |

**Caveat:** the in-flight re-nudge cron (PR #147, merged 2026-06-28) + verify auto-advance (PR #134) + Meta re-nudge templates (pending approval) are designed to lift conversion. If they move the needle, the curve compresses. If they don't, it doesn't.

## Threshold options

### Option A — Percentage threshold (e.g. ≥ 50% verified of ACTIVE)
- **When achievable:** ~3 months at current pace, sooner if re-nudge cron lifts conversion
- **Pros:** Clear, defensible, automatic
- **Cons:** Slow. Pilot may exit before threshold met. No mechanism if pace stalls.
- **Verdict:** Too rigid for a pilot still finding its footing.

### Option B — Hybrid (recommended)
Flip OFF when **both** are true:
1. **100% of post-cutoff providers** (ACTIVE + APPLICATION_PENDING) are VERIFIED. Currently 0 of 42. They were never grace-eligible — they just haven't completed.
2. **≥ 20% of legacy cohort** is VERIFIED (≥ 18 of 89). Currently ~5 (~6%).

Why these numbers:
- 100% post-cutoff: the cutoff was intentional. Anyone who joined after it agreed implicitly to mandatory KYC. Letting them skip indefinitely undoes the cutoff.
- 20% legacy: enough that the matchable pool doesn't collapse the moment grace flips. (Today's matchable count with grace ON ≈ 75; 20% verified legacy = 18 providers + 14+ verified post-cutoff = ~32+ matchable post-flip.)

**Estimated timeline:** 3-6 weeks if the re-nudge stack lands its expected lift; otherwise indefinite.

### Option C — Time-based (calendar deadline)
Flip OFF at a pre-announced date (e.g. end of West Rand pilot). Treats unverified providers as deactivated on that date regardless of conversion.

- **Pros:** No conditional logic. Easy to communicate to providers ("verify by date X or lose marketplace access").
- **Cons:** Could strand active providers serving real customers if conversion lags. Reputational + supply-loss risk.
- **Verdict:** Acceptable only if paired with intensive personal outreach in the final 2 weeks.

### Option D — Per-skill threshold
Retire grace per skill category (Plumbing, Electrical, Handyman, etc.) once each skill hits its own coverage floor.

- **Pros:** Most surgical. Skills with verified coverage flip; thin skills wait.
- **Cons:** Flag plumbing doesn't exist today. Would require: (a) per-skill grace flag table, (b) matching filter checks per-skill grace separately, (c) admin UI to manage skill grace state.
- **Verdict:** Right shape but not worth building unless A/B/C all fail.

## What needs to change before any flip

1. **In-flight re-nudge cron flag must be ON** (`provider.identity.verification.in_flight_renudge`). Currently OFF awaiting Meta template approval. This is the lever expected to move PASSED/week from ~3 to ~10+.
2. **KYC funnel report must be wired into ops review** (`admin.reports.kyc_funnel`, shipped today, currently OFF). Flip ON to give ops a daily readout.
3. **Per-cohort target announced** — e.g. "we will flip OFF when post-cutoff = 100% verified AND legacy ≥ 20% verified, expected mid-August".

## Recommendation

Adopt **Option B (Hybrid)** as the formal retirement criterion. Re-check weekly using `/admin/reports/kyc-funnel`. If by 2026-08-15 the legacy 20% target is not met, switch to **Option C** with a hard deadline of 2026-09-15 and personal outreach to the unverified cohort.

## Owners

- **Ops decision:** Lebogang / Shimane.
- **Code stays as-is** — no further engineering needed to ENABLE retirement; the flag flip is a one-line config change once the criteria are met.

## Reference

- Flag: `lib/feature-flags-registry.ts` — `matching.kyc_grace_legacy_providers`
- Code reading the flag: `lib/matching/kyc-grace.ts`, `lib/matching/filter.ts:349-375`
- Cutoff constant: `lib/matching/kyc-grace.ts` — `KYC_GRACE_CUTOFF = 2026-06-11`
- Funnel report: `/admin/reports/kyc-funnel` (behind `admin.reports.kyc_funnel`)
- Audit baseline: OpenBrain `audit — Mandatory provider KYC spec vs current code state (2026-06-28)`
- In-flight re-nudge cron: PR #147 (merged 2026-06-28)
