# JHB-Wide Provider Onboarding — Design Spec

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Sub-project:** A of 2 (this = intake/onboarding pipeline; B = provider-acquisition ad campaign, drafted in parallel, published only after A ships)

## Goal

Activate provider onboarding/registration across all five City of Johannesburg
regions (~109 suburbs already present in the location tree), while keeping
customer matching gated to the current West Rand (`jhb_west`) footprint. This is
a **supply-ahead-of-demand** move: register and fully vet providers Joburg-wide
now; switch customer transacting on region-by-region later.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| End-state | Supply ahead of demand — onboarding ON Joburg-wide, matching stays West Rand |
| Funnel depth | **Full vet + KYC now** — providers go all the way to approved + verified; held from leads only by the matching gate |
| Geographic net | The 5 CoJ metro regions: `jhb_north`, `jhb_east`, `jhb_south`, `jhb_cbd`, `jhb_west` (all suburbs) |
| West Rand District (Randfontein, Krugersdorp, Mogale, Rand West) | **Out of scope** — separate municipality, not in the tree; becomes its own future footprint |
| Acquisition | Active ad campaign wanted, but that is Sub-project B; build A first, draft B creative in parallel, publish B only after A lands |

## The behavioural contract

An out-of-`jhb_west` provider (e.g. Sandton, `jhb_north`) who registers now:

1. Completes the full application → review → KYC → approval flow. Their provider
   account is active and vetted.
2. Gets a `TechnicianServiceArea` row for their suburb with **`active = false`**.
3. Receives **zero leads** until their region is separately flipped into the
   matching set.
4. When that region enters the matching set and their provider record is
   re-synced, the area flips `active = true` and they become matchable
   immediately — no re-verification.

## Architecture

### The core change: split one shared gate into two

`field-service/lib/service-area-guard.ts` currently exposes a single active-region
set consumed by **both** customer and provider paths:

```ts
export const ACTIVE_REGION_KEYS_SET = new Set(['jhb_west'])  // shared — the problem
```

Flipping this set to all five regions would also switch customer job-requests on
Joburg-wide, violating supply-ahead-of-demand. So we split it by capability:

```ts
export const ONBOARDING_ACTIVE_REGION_KEYS = new Set([
  'jhb_north', 'jhb_east', 'jhb_south', 'jhb_cbd', 'jhb_west',
])

export const MATCHING_ACTIVE_REGION_KEYS = new Set([
  'jhb_west',   // unchanged customer-side behaviour
])
```

New predicates and gate-aware status helpers:

- `isOnboardingActiveRegion(regionKey: string): boolean`
- `isMatchingActiveRegion(regionKey: string): boolean`
- Status/label helpers (`getRegionServiceStatus`, `describeRegionServiceStatus`)
  take an explicit `gate: 'onboarding' | 'matching'` argument (default `'matching'`
  to preserve existing call sites that are customer-facing) so registration paths
  can describe onboarding-active regions as live while customer paths keep matching
  semantics.

Keep `isActiveRegion` / `ACTIVE_REGION_KEYS_SET` as thin aliases of the **matching**
set so any un-migrated caller retains today's (safe, narrow) behaviour.

### Consumer routing

Each caller reads the gate that matches its intent.

| Caller | File | Gate |
|---|---|---|
| WhatsApp registration region list | `lib/whatsapp-flows/registration.ts` (~L1295–1334) | **onboarding** |
| PWA signup service-areas | `app/provider/signup/sections/service-areas.tsx` + `app/provider/signup/actions.ts` | **onboarding** (audit — no explicit gate today) |
| Provider area matchability | `lib/provider-record.ts:128` (`isActivePilotArea` → `TechnicianServiceArea.active`) | **matching** |
| Customer booking API | `app/api/customer/bookings/route.ts` | **matching** (unchanged) |
| Customer notify-interest | `app/api/customer/notify-interest/route.ts` | **matching** (unchanged) |
| Customer job-request flow | `lib/whatsapp-flows/job-request.ts` | **matching** (unchanged) |

The single most important routing fact: `lib/provider-record.ts:128`
`isActivePilotArea` feeds only `TechnicianServiceArea.active` (lines 147, 156) —
it does **not** touch the provider's account/approval status. Pointing it at the
matching set is what makes "registered + vetted now, matchable later" work.

### Data

All five regions and their suburbs are already defined in
`lib/service-areas/south-africa.ts` (the `GAUTENG` province: `jhb_north` 22,
`jhb_cbd` 25, `jhb_south` 21, `jhb_east` 17, `jhb_west` 24 suburbs) and imported
by `lib/location-seed.ts` (`SA_PROVINCES`, `REGION_CITY_MAP`, `PROVINCE_CITIES`).
No location authoring is required.

**One data task:** verify the `jhb_north / jhb_east / jhb_south / jhb_cbd`
LocationNodes exist in production; run/confirm the seed if any are missing.

**Known data quirks (carry into the plan, do not fix here):**
- Honeydew and Northcliff appear under both `jhb_north` and `jhb_west`. Region
  selection must resolve a suburb to a single owning region deterministically.
- Some `jhb_east` / `jhb_south` entries (Germiston, Alberton, Brackenhurst) are
  geographically Ekurhuleni, grouped here by driving distance, not municipality.
  Acceptable — the grouping is directional by design.

### Copy

`ACTIVE_PILOT_REGION_LABEL` (`'JHB West / Roodepoort'`) splits into an onboarding
label (`'Johannesburg'`) and a matching label (unchanged, West Rand). Registration
confirmation for a not-yet-matching region must set honest expectations, e.g.:
"You're registered — you'll start getting leads the moment we go live in your area."

## Testing

- **Guard unit tests:** every CoJ region key returns `true` from
  `isOnboardingActiveRegion`; only `jhb_west` returns `true` from
  `isMatchingActiveRegion`; status/label helpers honour the `gate` argument.
- **Customer regression:** booking / job-request still reject non-`jhb_west`
  regions and waitlist them (matching behaviour unchanged).
- **Provider registration:** all five regions are selectable and register without
  a "coming soon" block.
- **`provider-record`:** a `jhb_north` provider sync creates a
  `TechnicianServiceArea` with `active = false`; a `jhb_west` provider gets
  `active = true`.

## Out of scope

- Customer-side Johannesburg matching (stays West Rand until a later, separate
  activation).
- West Rand District towns (Randfontein, Krugersdorp, Mogale, Rand West) — future
  footprint, needs net-new location data.
- Sub-project B — the provider-acquisition ad campaign (own spec; previews
  approved before any publish; publish only after A ships).

## Rollout / safety

- Ships behind the existing pilot flag posture; the matching gate is deliberately
  deploy-reviewed (turning on customer demand where supply is thin is the
  dangerous direction — keep it narrow and explicit).
- Additive only: no schema changes, no destructive migrations.
- Activating a region for matching later = add its key to
  `MATCHING_ACTIVE_REGION_KEYS` + re-sync affected providers (a reviewed deploy).
