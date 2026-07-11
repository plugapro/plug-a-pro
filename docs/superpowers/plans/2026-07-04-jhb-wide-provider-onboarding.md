# JHB-Wide Provider Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate provider registration/onboarding across all five City of Joburg regions while keeping customer matching gated to `jhb_west` (supply ahead of demand).

**Architecture:** Split the single shared active-region set in `service-area-guard.ts` into two capability sets — `ONBOARDING_ACTIVE_REGION_KEYS` (5 CoJ regions) and `MATCHING_ACTIVE_REGION_KEYS` (`jhb_west` only). Status/predicate helpers gain a `gate` argument that defaults to `'matching'`, so every existing (customer-facing) caller keeps today's narrow behaviour untouched; only the WhatsApp registration flow opts into the `'onboarding'` gate. Provider matchability is governed in one place (`provider-record.ts` `upsertStructuredServiceAreas`) which stays on the matching gate, so out-of-`jhb_west` providers register + get vetted now but their service area sits `active=false` until their region is separately switched into the matching set.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Vitest (`pnpm test` = `vitest run`), WhatsApp Cloud API flow modules.

## Global Constraints

- Additive only — no Prisma schema changes, no migrations, no renames/drops.
- The five CoJ region keys, verbatim: `jhb_north`, `jhb_east`, `jhb_south`, `jhb_cbd`, `jhb_west`.
- Matching stays `jhb_west`-only. Do NOT widen the matching set in this plan.
- Default `gate` for all guard helpers is `'matching'` — preserves customer-side behaviour for un-migrated callers.
- West Rand District towns (Randfontein, Krugersdorp, Mogale, Rand West) are OUT of scope — do not add them.
- No category changes; `allowedCategorySlugs` is untouched.
- Run tests from the `field-service/` directory.
- Branch: create `feat/jhb-wide-onboarding` off fresh `origin/main` before Task 1.

---

### Task 1: Split the activation gate in `service-area-guard.ts`

**Files:**
- Modify: `field-service/lib/service-area-guard.ts:13-86`
- Test: `field-service/__tests__/lib/service-area-guard.test.ts` (create)

**Interfaces:**
- Produces:
  - `type ServiceGate = 'onboarding' | 'matching'`
  - `ONBOARDING_ACTIVE_REGION_KEYS: Set<string>` — `{ jhb_north, jhb_east, jhb_south, jhb_cbd, jhb_west }`
  - `MATCHING_ACTIVE_REGION_KEYS: Set<string>` — `{ jhb_west }`
  - `isOnboardingActiveRegion(regionKey: string): boolean`
  - `isMatchingActiveRegion(regionKey: string): boolean`
  - `isActiveRegion(regionKey: string): boolean` — unchanged behaviour, delegates to matching
  - `getRegionServiceStatus(input: { regionKey?; slug? }, gate?: ServiceGate): ServiceAreaStatus` — gate defaults `'matching'`
  - `describeRegionServiceStatus(input: { regionKey?; slug? }, gate?: ServiceGate): string`
  - `ONBOARDING_PILOT_REGION_LABEL: string` — `'Johannesburg'`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/service-area-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isOnboardingActiveRegion,
  isMatchingActiveRegion,
  isActiveRegion,
  getRegionServiceStatus,
  describeRegionServiceStatus,
  ONBOARDING_ACTIVE_REGION_KEYS,
  MATCHING_ACTIVE_REGION_KEYS,
} from '@/lib/service-area-guard'

const COJ_REGIONS = ['jhb_north', 'jhb_east', 'jhb_south', 'jhb_cbd', 'jhb_west']

describe('service-area-guard gate split', () => {
  it('onboarding set contains all five CoJ regions', () => {
    for (const key of COJ_REGIONS) expect(isOnboardingActiveRegion(key)).toBe(true)
    expect(ONBOARDING_ACTIVE_REGION_KEYS.size).toBe(5)
  })

  it('matching set contains only jhb_west', () => {
    expect(isMatchingActiveRegion('jhb_west')).toBe(true)
    for (const key of ['jhb_north', 'jhb_east', 'jhb_south', 'jhb_cbd']) {
      expect(isMatchingActiveRegion(key)).toBe(false)
    }
    expect(MATCHING_ACTIVE_REGION_KEYS.size).toBe(1)
  })

  it('isActiveRegion keeps legacy (matching) behaviour', () => {
    expect(isActiveRegion('jhb_west')).toBe(true)
    expect(isActiveRegion('jhb_north')).toBe(false)
  })

  it('getRegionServiceStatus defaults to the matching gate', () => {
    expect(getRegionServiceStatus({ regionKey: 'jhb_north' })).toBe('coming_soon')
    expect(getRegionServiceStatus({ regionKey: 'jhb_west' })).toBe('active')
  })

  it('getRegionServiceStatus honours the onboarding gate', () => {
    expect(getRegionServiceStatus({ regionKey: 'jhb_north' }, 'onboarding')).toBe('active')
    expect(getRegionServiceStatus({ regionKey: 'jhb_south' }, 'onboarding')).toBe('active')
  })

  it('describeRegionServiceStatus copy differs by gate', () => {
    expect(describeRegionServiceStatus({ regionKey: 'jhb_north' }, 'onboarding')).toContain('Open for registration')
    expect(describeRegionServiceStatus({ regionKey: 'jhb_west' }, 'matching')).toContain('Active pilot')
    expect(describeRegionServiceStatus({ regionKey: 'jhb_north' }, 'matching')).toContain('Coming soon')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd field-service && pnpm vitest run __tests__/lib/service-area-guard.test.ts`
Expected: FAIL — `isOnboardingActiveRegion` / `ONBOARDING_ACTIVE_REGION_KEYS` not exported.

- [ ] **Step 3: Write minimal implementation**

In `field-service/lib/service-area-guard.ts`, replace the region-gate block (lines 21-25 and the predicate/status helpers) with:

```ts
export type ServiceGate = 'onboarding' | 'matching'

// Providers may register across all five City of Joburg regions.
export const ONBOARDING_ACTIVE_REGION_KEYS = new Set([
  'jhb_north',
  'jhb_east',
  'jhb_south',
  'jhb_cbd',
  'jhb_west',
])

// Customers may only transact where verified supply exists. Keep this narrow.
export const MATCHING_ACTIVE_REGION_KEYS = new Set([
  'jhb_west',
])

// Back-compat: existing callers of ACTIVE_REGION_KEYS_SET / isActiveRegion keep
// the narrow (matching) behaviour they had before the split.
export const ACTIVE_REGION_KEYS_SET = MATCHING_ACTIVE_REGION_KEYS

export const ONBOARDING_PILOT_REGION_LABEL = 'Johannesburg'
```

Update the predicate + status helpers (currently around lines 38-86):

```ts
export function getRegionServiceStatus(
  input: { regionKey?: string | null; slug?: string | null },
  gate: ServiceGate = 'matching',
): ServiceAreaStatus {
  const regionKey = normalizeLocationKey(input.regionKey) || getRegionKeyFromSlug(input.slug)
  const active =
    gate === 'onboarding' ? isOnboardingActiveRegion(regionKey) : isMatchingActiveRegion(regionKey)
  return active ? 'active' : 'coming_soon'
}

export function describeRegionServiceStatus(
  input: { regionKey?: string | null; slug?: string | null },
  gate: ServiceGate = 'matching',
): string {
  const status = getRegionServiceStatus(input, gate)
  if (status !== 'active') return '🔜 Coming soon - register now'
  return gate === 'onboarding' ? '🟢 Open for registration' : '🟢 Active pilot'
}

export function isOnboardingActiveRegion(regionKey: string): boolean {
  return ONBOARDING_ACTIVE_REGION_KEYS.has(regionKey.toLowerCase())
}

export function isMatchingActiveRegion(regionKey: string): boolean {
  return MATCHING_ACTIVE_REGION_KEYS.has(regionKey.toLowerCase())
}

export function isActiveRegion(regionKey: string): boolean {
  // Legacy alias — customer-side callers depend on matching (narrow) semantics.
  return isMatchingActiveRegion(regionKey)
}
```

Leave `ACTIVE_PILOT_REGION_LABEL`, `ACTIVE_PILOT_CITY_LABEL`, `describeCityServiceStatus`, `ACTIVE_CITY_NODE_KEYS`, and all `isActiveCity`/`isInActiveServiceArea`/`addToServiceAreaWaitlist` logic unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd field-service && pnpm vitest run __tests__/lib/service-area-guard.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/service-area-guard.ts field-service/__tests__/lib/service-area-guard.test.ts
git commit -m "feat(service-area): split onboarding vs matching region gates"
```

---

### Task 2: Route the WhatsApp registration flow to the onboarding gate + honest copy

**Files:**
- Modify: `field-service/lib/whatsapp-flows/registration.ts` (lines 55-61 imports; 1164, 1209, 1334, 1340, 1366, 1408)
- Test: (regression) existing `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` and the Task 1 guard test cover behaviour; no new flow test — see note.

**Interfaces:**
- Consumes (from Task 1): `getRegionServiceStatus(input, 'onboarding')`, `describeRegionServiceStatus(input, 'onboarding')`, `ONBOARDING_PILOT_REGION_LABEL`.

**Note on testing:** `registration.ts` exports only `handleRegistrationFlow`; the region step handler is internal and only reachable by driving the full flow through the heavy DB/media mock harness. The onboarding decision this task delegates to is fully unit-tested in Task 1. This task's edits are type-checked call-site swaps; correctness is guarded by Task 1's tests + the existing registration regression suite. Do not add a bespoke flow test.

- [ ] **Step 1: Update the import block**

In `field-service/lib/whatsapp-flows/registration.ts` (import from `../service-area-guard`, lines ~55-61), add `ONBOARDING_PILOT_REGION_LABEL` to the existing import list. Keep `ACTIVE_PILOT_REGION_LABEL`, `ACTIVE_PILOT_CITY_LABEL`, `describeRegionServiceStatus`, `getRegionServiceStatus`, `describeCityServiceStatus`.

- [ ] **Step 2: Route the two region-row renderers to the onboarding gate**

At line 1334 and line 1366, change:

```ts
description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }),
```

to:

```ts
description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }, 'onboarding'),
```

- [ ] **Step 3: Route the selected-region status decision to the onboarding gate**

At line ~1408, change:

```ts
regionStatus = getRegionServiceStatus({
  regionKey: selectedRegion?.regionKey,
  slug: selectedRegion?.slug,
})
```

to:

```ts
regionStatus = getRegionServiceStatus({
  regionKey: selectedRegion?.regionKey,
  slug: selectedRegion?.slug,
}, 'onboarding')
```

- [ ] **Step 4: Update the two "Gauteng" area rows and the city-active header copy**

At lines 1164 and 1209, change the description that reads
``description: `🟢 Active pilot - ${ACTIVE_PILOT_REGION_LABEL}` `` to:

```ts
description: `🟢 Onboarding across ${ONBOARDING_PILOT_REGION_LABEL}`,
```

At line ~1340, replace the `cityIsActive` header string:

```ts
`🗺 Which area of *${cityLabel}* do you mainly work in?\n\nOnly *${ACTIVE_PILOT_REGION_LABEL}* is live for leads right now. Other areas are still welcome to register.`
```

with:

```ts
`🗺 Which area of *${cityLabel}* do you mainly work in?\n\nWe're onboarding providers across all of *${ONBOARDING_PILOT_REGION_LABEL}*. Leads go live in *${ACTIVE_PILOT_REGION_LABEL}* first — pick your area and we'll notify you the moment we open leads there.`
```

- [ ] **Step 5: Run the registration regression suite + guard tests + typecheck**

Run: `cd field-service && pnpm vitest run __tests__/lib/whatsapp-flows/ __tests__/lib/service-area-guard.test.ts && pnpm exec tsc --noEmit`
Expected: PASS — existing registration tests still green; guard tests green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/whatsapp-flows/registration.ts
git commit -m "feat(registration): open provider onboarding across all JHB regions"
```

---

### Task 3: Lock provider matchability to the matching gate (the supply-held-ready contract)

**Files:**
- Modify: `field-service/lib/provider-record.ts:128`
- Test: `field-service/__tests__/lib/provider-record-area-matchability.test.ts` (create)

**Interfaces:**
- Consumes (from Task 1): `getRegionServiceStatus(input, 'matching')`.
- Consumes (existing): `upsertStructuredServiceAreas(client, providerId, locationNodeIds)` — queries `client.locationNode.findMany` then `client.technicianServiceArea.upsert` per node, writing `active` from `isActivePilotArea`.

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/provider-record-area-matchability.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { upsertStructuredServiceAreas } from '@/lib/provider-record'

function makeClient(node: Record<string, unknown>) {
  const upsert = vi.fn().mockResolvedValue({})
  const client = {
    locationNode: { findMany: vi.fn().mockResolvedValue([node]) },
    technicianServiceArea: { upsert },
  }
  return { client, upsert }
}

const BASE = {
  id: 'node-1',
  nodeType: 'SUBURB',
  provinceKey: 'gauteng',
  cityKey: 'johannesburg',
  label: 'Test Suburb',
}

describe('upsertStructuredServiceAreas matchability contract', () => {
  it('creates a jhb_north area with active=false (registered, held from leads)', async () => {
    const { client, upsert } = makeClient({
      ...BASE,
      slug: 'gauteng__johannesburg__jhb_north__sandton',
      regionKey: 'jhb_north',
      label: 'Sandton',
    })
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: false }),
        update: expect.objectContaining({ active: false }),
      }),
    )
  })

  it('creates a jhb_west area with active=true (matchable now)', async () => {
    const { client, upsert } = makeClient({
      ...BASE,
      slug: 'gauteng__johannesburg__jhb_west__florida',
      regionKey: 'jhb_west',
      label: 'Florida',
    })
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify current behaviour (should already PASS, then we lock it explicit)**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record-area-matchability.test.ts`
Expected: PASS — `getRegionServiceStatus` defaults to matching, so jhb_north is already `active=false`. This test now guards against regression when the gate is made explicit and against any future default change.

- [ ] **Step 3: Make the matching gate explicit at the call site**

In `field-service/lib/provider-record.ts:128`, change:

```ts
const isActivePilotArea = getRegionServiceStatus({ regionKey, slug: node.slug }) === 'active'
```

to:

```ts
// Matchability follows the MATCHING gate only: a provider in an onboarding-open
// but not-yet-matching region (e.g. jhb_north) is registered + vetted now, but
// their service area stays inactive until that region enters the matching set.
const isActivePilotArea =
  getRegionServiceStatus({ regionKey, slug: node.slug }, 'matching') === 'active'
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record-area-matchability.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/provider-record.ts field-service/__tests__/lib/provider-record-area-matchability.test.ts
git commit -m "test(provider-record): lock area matchability to the matching gate"
```

---

### Task 4: Verify (and seed if missing) LocationNodes for all five JHB regions

**Files:**
- Reference: `field-service/lib/service-areas/south-africa.ts` (GAUTENG — all 5 regions + suburbs already defined)
- Reference: `field-service/lib/location-seed.ts` (imports `SA_PROVINCES, REGION_CITY_MAP, PROVINCE_CITIES`)
- Reference: `field-service/scripts/seed-locations.ts` (runner)

**Note:** No location authoring — the data already exists in `south-africa.ts`. This task confirms the `jhb_north / jhb_east / jhb_south / jhb_cbd` LocationNodes exist in the target database and seeds them if absent. Registration region/suburb pickers read these nodes via `lib/location-nodes.ts` (`getRegions`, `getSuburbs`), so missing nodes would silently drop a region from the picker.

- [ ] **Step 1: Verify current node coverage per region**

Run (requires a working `DATABASE_URL`):
```bash
cd field-service && pnpm tsx -e "import {db} from './lib/db'; (async()=>{const r=await db.locationNode.groupBy({by:['regionKey'],where:{nodeType:'SUBURB',cityKey:'johannesburg'},_count:true}); console.log(r); process.exit(0)})()"
```
Expected: rows for `jhb_north`, `jhb_east`, `jhb_south`, `jhb_cbd`, `jhb_west` with non-zero counts.

- [ ] **Step 2: If any of the five regions is missing or zero, run the location seed**

Run: `cd field-service && pnpm tsx scripts/seed-locations.ts`
Expected: seed completes; re-running Step 1 now shows all five regions populated. (The seed is idempotent/additive; it aborts rather than shrinking node count — see `location-seed.ts:108`.)

- [ ] **Step 3: Confirm the registration picker surfaces all five regions**

Run:
```bash
cd field-service && pnpm tsx -e "import {getRegions} from './lib/location-nodes'; (async()=>{const c=await import('./lib/location-nodes'); const cities=await c.getCities('gauteng'); const jhb=cities.find(x=>x.cityKey==='johannesburg'); const regions=await getRegions(jhb.id); console.log(regions.map(r=>r.regionKey)); process.exit(0)})()"
```
Expected: array includes `jhb_north`, `jhb_east`, `jhb_south`, `jhb_cbd`, `jhb_west`.

- [ ] **Step 4: Commit (only if seed files/data changed; otherwise record verification in the PR description)**

```bash
git commit --allow-empty -m "chore(locations): verify all five JHB regions seeded for onboarding"
```

---

## Self-Review

**Spec coverage:**
- Gate split (`ONBOARDING_ACTIVE_REGION_KEYS` vs `MATCHING_ACTIVE_REGION_KEYS`, predicates, gate-aware helpers, default `'matching'`) → Task 1. ✅
- Consumer routing: registration → onboarding (Task 2); provider-record matchability → matching (Task 3); customer callers unchanged via `isActiveRegion`/default-matching (Task 1 back-compat alias, no edits needed). ✅
- LocationNode verification/seed for 5 regions → Task 4. ✅
- Copy split (`ONBOARDING_PILOT_REGION_LABEL`, registration header) → Task 1 (label) + Task 2 (copy). ✅
- Supply-held-ready contract test (jhb_north → active=false) → Task 3. ✅
- Additive only, no schema changes → honoured (no Prisma edits). ✅
- Out of scope (customer JHB matching, West Rand District, ad campaign) → untouched. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows runnable code + exact command + expected result.

**Type consistency:** `getRegionServiceStatus(input, gate?)` and `describeRegionServiceStatus(input, gate?)` signatures match across Tasks 1-3; `ServiceGate`, `ONBOARDING_ACTIVE_REGION_KEYS`, `MATCHING_ACTIVE_REGION_KEYS`, `ONBOARDING_PILOT_REGION_LABEL`, `isOnboardingActiveRegion`, `isMatchingActiveRegion` used consistently. `upsertStructuredServiceAreas(client, providerId, locationNodeIds)` matches the real export.

**Known consumer note:** customer callers (`api/customer/bookings/route.ts:280`, `lib/whatsapp-flows/job-request.ts:306,971,1680`) call `isActiveRegion(...)`, which Task 1 keeps as a matching alias — so they require zero edits and retain identical behaviour. This is intentional and covered by the Task 1 `isActiveRegion` back-compat test.
