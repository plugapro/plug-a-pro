# West Rand Pilot — PR1: Launch Config + Customer Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pilot-launch foundation — a TypeScript constant module describing the West Rand pilot footprint, an electrical-readiness helper, four feature flags, and pilot gates wired into customer serviceability, booking creation, quote approval, payment initialisation, and the matching filter. All gates are flag-conditional; with `launch.west_rand_pilot.enabled` OFF the customer surface is identical to baseline.

**Architecture:** Pure-constant module (no DB tables, no migration). `lib/launch/west-rand-pilot.ts` exports the canonical `WEST_RAND_PILOT` constant + three slug-membership helpers. `lib/launch/electrical-readiness.ts` exposes one async readiness probe. The existing `isAreaCategoryServiceable` in `lib/customer-serviceability.ts` becomes the master gate; four further sites (`POST /api/customer/bookings`, `lib/job-requests/create-job-request.ts`, `PATCH /api/quotes/[token]`, `initializeBookingPayment`, `lib/matching/filter.ts`) inherit the gate by calling helpers or throwing a typed error. Every gate site is wrapped in `if (!flag) return legacy(...)`.

**Tech Stack:** Next.js 16 App Router, React Server Components, Prisma, Vitest (`field-service/vitest.config.ts`), Playwright (`field-service/playwright.config.ts`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md` (v2)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `field-service/lib/launch/west-rand-pilot.ts` | Create | `WEST_RAND_PILOT` constant; `isPilotSuburbSlug`, `isPilotCategorySlug`, `isPriorityPilotSuburb` helpers. |
| `field-service/lib/launch/electrical-readiness.ts` | Create | `getElectricalReadiness()` async helper backed by `db.provider.count`. |
| `field-service/__tests__/lib/launch/west-rand-pilot.test.ts` | Create | Constant + helper unit tests. |
| `field-service/__tests__/lib/launch/electrical-readiness.test.ts` | Create | Readiness threshold + shortfall + filters. |
| `field-service/lib/feature-flags-registry.ts` | Modify | Register 4 new flags (block inserted after `customer.home.serviceability_v2` near line 240). |
| `field-service/scripts/seed-flags.ts` | Modify | Idempotent upsert of the 4 new flag rows. |
| `field-service/lib/customer-serviceability.ts` | Modify | Extend `isAreaCategoryServiceable()` (line 272) and add structured-result variant `gateAreaCategory()`. |
| `field-service/__tests__/lib/customer-serviceability.pilot.test.ts` | Create | Flag-on suburb/category gating + flag-off legacy preservation. |
| `field-service/app/api/customer/serviceability/route.ts` | Modify | When master flag ON, filter categories to allowlist and reject non-pilot suburbs. |
| `field-service/app/api/customer/bookings/route.ts` | Modify | Call shared gate; 422 on fail. |
| `field-service/__tests__/api/customer-bookings-pilot-gate.test.ts` | Create | Suburb + category gate at the API. |
| `field-service/lib/job-requests/create-job-request.ts` | Modify | Call shared gate before persistence. |
| `field-service/__tests__/lib/job-requests/create-job-request.pilot.test.ts` | Create | Deeper persistence-seam regression test. |
| `field-service/app/api/quotes/[token]/route.ts` | Modify | Re-check gate on PATCH approve; 409 on fail. |
| `field-service/__tests__/api/quotes-token-approve-pilot.test.ts` | Create | Quote pre-dating flag flip → 409. |
| `field-service/lib/payments.ts` | Modify | Add `CategoryGatedByPilotError` class; throw from `initializeBookingPayment` when gated. |
| `field-service/__tests__/lib/payments-category-gate.test.ts` | Create | Payments throws on gated category, passes through with flag OFF. |
| `field-service/lib/matching/filter.ts` | Modify | At top of `filterEligibleProviders`, return all-filtered with `reason='CATEGORY_GATED_BY_PILOT'` when job category is gated. |
| `field-service/__tests__/lib/matching-filter-pilot.test.ts` | Create | Filter drops with correct reason; non-pilot regions unaffected. |
| `field-service/__tests__/lib/electrical-canonicalization.test.ts` | Create | Label variants route to electrical slug + hit gate. |
| `field-service/e2e/pilot.spec.ts` | Create | Customer in Honeydew sees allowed categories; Sandton sees baseline; flag-OFF identical-to-baseline regression check. |

---

## Conventions assumed across tasks

- Path alias `@/` resolves to `field-service/`.
- Tests run from `field-service/` with `pnpm test <path>` (Vitest) or `pnpm exec playwright test <path>` (Playwright).
- `db` Prisma singleton imported from `@/lib/db`.
- Flag lookup helper is `getFlag(key)` from `@/lib/flags` (existing).
- Canonical category slug helper is `canonicalSlug(input)` from `@/lib/category-config`.
- All new code is additive. No deletions, no schema changes.

---

## Task 1: Add `WEST_RAND_PILOT` constant + slug helpers (TDD)

**Files:**
- Create: `field-service/__tests__/lib/launch/west-rand-pilot.test.ts`
- Create: `field-service/lib/launch/west-rand-pilot.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/launch/west-rand-pilot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  WEST_RAND_PILOT,
  isPilotSuburbSlug,
  isPilotCategorySlug,
  isPriorityPilotSuburb,
} from '@/lib/launch/west-rand-pilot'

describe('WEST_RAND_PILOT constant', () => {
  it('lists exactly the 8 launch suburbs', () => {
    expect(WEST_RAND_PILOT.activeSuburbSlugs).toHaveLength(8)
    expect(WEST_RAND_PILOT.activeSuburbSlugs).toContain('gauteng__johannesburg__jhb_west__honeydew')
    expect(WEST_RAND_PILOT.activeSuburbSlugs).toContain('gauteng__johannesburg__jhb_west__little_falls')
  })

  it('marks exactly the 4 priority suburbs', () => {
    expect(WEST_RAND_PILOT.prioritySuburbSlugs).toHaveLength(4)
    expect(WEST_RAND_PILOT.prioritySuburbSlugs).toContain('gauteng__johannesburg__jhb_west__honeydew')
    expect(WEST_RAND_PILOT.prioritySuburbSlugs).toContain('gauteng__johannesburg__jhb_west__florida')
  })

  it('every priority suburb is also an active suburb', () => {
    for (const slug of WEST_RAND_PILOT.prioritySuburbSlugs) {
      expect(WEST_RAND_PILOT.activeSuburbSlugs).toContain(slug)
    }
  })

  it('lists the 6 allowed categories and intentionally excludes electrical', () => {
    expect(WEST_RAND_PILOT.allowedCategorySlugs).toEqual(
      expect.arrayContaining(['handyman', 'painting', 'plumbing', 'tiling', 'carpentry', 'appliances'])
    )
    expect(WEST_RAND_PILOT.allowedCategorySlugs).toHaveLength(6)
    expect(WEST_RAND_PILOT.allowedCategorySlugs).not.toContain('electrical')
  })

  it('electricalThreshold is 3 (configurable 3–5)', () => {
    expect(WEST_RAND_PILOT.electricalThreshold).toBe(3)
  })
})

describe('slug helpers', () => {
  it('isPilotSuburbSlug returns true for active suburbs', () => {
    expect(isPilotSuburbSlug('gauteng__johannesburg__jhb_west__honeydew')).toBe(true)
  })

  it('isPilotSuburbSlug returns false for non-pilot suburbs', () => {
    expect(isPilotSuburbSlug('gauteng__johannesburg__sandton__morningside')).toBe(false)
  })

  it('isPilotSuburbSlug returns false for nullish input', () => {
    expect(isPilotSuburbSlug(null)).toBe(false)
    expect(isPilotSuburbSlug(undefined)).toBe(false)
    expect(isPilotSuburbSlug('')).toBe(false)
  })

  it('isPilotCategorySlug returns true for allowed categories', () => {
    expect(isPilotCategorySlug('plumbing')).toBe(true)
    expect(isPilotCategorySlug('appliances')).toBe(true)
  })

  it('isPilotCategorySlug returns false for electrical', () => {
    expect(isPilotCategorySlug('electrical')).toBe(false)
  })

  it('isPilotCategorySlug returns false for nullish input', () => {
    expect(isPilotCategorySlug(null)).toBe(false)
    expect(isPilotCategorySlug(undefined)).toBe(false)
  })

  it('isPriorityPilotSuburb returns true for priority suburbs only', () => {
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__honeydew')).toBe(true)
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__little_falls')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/launch/west-rand-pilot.test.ts`
Expected: FAIL — "Cannot find module '@/lib/launch/west-rand-pilot'".

- [ ] **Step 3: Implement the constant + helpers**

Create `field-service/lib/launch/west-rand-pilot.ts`:

```ts
// West Rand Pilot — launch footprint.
// Editing this file is the only way to change suburbs/categories. Intentional friction.
// Pair with feature flag `launch.west_rand_pilot.enabled` and the gates in
// lib/customer-serviceability.ts, lib/job-requests/create-job-request.ts,
// app/api/customer/bookings/route.ts, app/api/quotes/[token]/route.ts,
// lib/payments.ts, lib/matching/filter.ts.

export const WEST_RAND_PILOT = {
  key: 'west-rand-pilot',
  label: 'West Rand Pilot',
  regionKey: 'jhb_west',

  activeSuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
    'gauteng__johannesburg__jhb_west__bromhof',
    'gauteng__johannesburg__jhb_west__discovery',
    'gauteng__johannesburg__jhb_west__helderkruin',
    'gauteng__johannesburg__jhb_west__little_falls',
  ] as const,

  prioritySuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
  ] as const,

  allowedCategorySlugs: [
    'handyman',
    'painting',
    'plumbing',
    'tiling',
    'carpentry',
    'appliances',
  ] as const,

  electricalThreshold: 3,
} as const

const ACTIVE_SUBURB_SET = new Set<string>(WEST_RAND_PILOT.activeSuburbSlugs)
const PRIORITY_SUBURB_SET = new Set<string>(WEST_RAND_PILOT.prioritySuburbSlugs)
const ALLOWED_CATEGORY_SET = new Set<string>(WEST_RAND_PILOT.allowedCategorySlugs)

export function isPilotSuburbSlug(slug: string | null | undefined): boolean {
  if (!slug) return false
  return ACTIVE_SUBURB_SET.has(slug)
}

export function isPilotCategorySlug(slug: string | null | undefined): boolean {
  if (!slug) return false
  return ALLOWED_CATEGORY_SET.has(slug)
}

export function isPriorityPilotSuburb(slug: string | null | undefined): boolean {
  if (!slug) return false
  return PRIORITY_SUBURB_SET.has(slug)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/launch/west-rand-pilot.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/launch/west-rand-pilot.ts field-service/__tests__/lib/launch/west-rand-pilot.test.ts
git commit -m "feat(launch): add WEST_RAND_PILOT constant module and slug helpers"
```

---

## Task 2: Add `getElectricalReadiness()` helper (TDD)

**Files:**
- Create: `field-service/__tests__/lib/launch/electrical-readiness.test.ts`
- Create: `field-service/lib/launch/electrical-readiness.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/launch/electrical-readiness.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getElectricalReadiness } from '@/lib/launch/electrical-readiness'

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      count: vi.fn(),
    },
  },
}))

const { db } = await import('@/lib/db')

describe('getElectricalReadiness', () => {
  beforeEach(() => {
    vi.mocked(db.provider.count).mockReset()
  })

  it('reports ready=true when approved electricians meet the threshold', async () => {
    vi.mocked(db.provider.count).mockResolvedValue(3)
    const result = await getElectricalReadiness()
    expect(result).toEqual({ ready: true, approvedCount: 3, threshold: 3, shortfall: 0 })
  })

  it('reports ready=false with correct shortfall when below threshold', async () => {
    vi.mocked(db.provider.count).mockResolvedValue(1)
    const result = await getElectricalReadiness()
    expect(result).toEqual({ ready: false, approvedCount: 1, threshold: 3, shortfall: 2 })
  })

  it('reports ready=true with shortfall 0 when above threshold', async () => {
    vi.mocked(db.provider.count).mockResolvedValue(5)
    const result = await getElectricalReadiness()
    expect(result).toEqual({ ready: true, approvedCount: 5, threshold: 3, shortfall: 0 })
  })

  it('filters to status=ACTIVE, verified=true, kycStatus=VERIFIED, skill includes electrical', async () => {
    vi.mocked(db.provider.count).mockResolvedValue(0)
    await getElectricalReadiness()
    expect(db.provider.count).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        verified: true,
        kycStatus: 'VERIFIED',
        skills: { has: 'electrical' },
      },
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/launch/electrical-readiness.test.ts`
Expected: FAIL — "Cannot find module '@/lib/launch/electrical-readiness'".

- [ ] **Step 3: Implement the helper**

Create `field-service/lib/launch/electrical-readiness.ts`:

```ts
import { db } from '@/lib/db'
import { WEST_RAND_PILOT } from '@/lib/launch/west-rand-pilot'

export type ElectricalReadiness = {
  ready: boolean
  approvedCount: number
  threshold: number
  shortfall: number
}

export async function getElectricalReadiness(): Promise<ElectricalReadiness> {
  const threshold = WEST_RAND_PILOT.electricalThreshold
  const approvedCount = await db.provider.count({
    where: {
      status: 'ACTIVE',
      verified: true,
      kycStatus: 'VERIFIED',
      skills: { has: 'electrical' },
    },
  })
  const shortfall = Math.max(0, threshold - approvedCount)
  return {
    ready: approvedCount >= threshold,
    approvedCount,
    threshold,
    shortfall,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/launch/electrical-readiness.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/launch/electrical-readiness.ts field-service/__tests__/lib/launch/electrical-readiness.test.ts
git commit -m "feat(launch): add electrical readiness probe with configurable threshold"
```

---

## Task 3: Register the four launch feature flags

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts` (insert after `customer.home.serviceability_v2` entry around line 240)

- [ ] **Step 1: Open the file at the insertion point**

Open `field-service/lib/feature-flags-registry.ts`. Locate the block ending with:

```ts
  'customer.home.serviceability_v2': {
    description: 'Constrain customer PWA home search to active skills for the selected area, scope the active-providers count card to area + selected skill, and reject unsupported area/skill combinations at the request-creation API.',
    owner: 'prod',
    defaultValue: false,
  },
  // ─── Provider features ───────────────────────────────────────────────────────
```

- [ ] **Step 2: Insert four new flag entries above the Provider features divider**

Edit `field-service/lib/feature-flags-registry.ts` — between the `customer.home.serviceability_v2` entry and the `// ─── Provider features ───` divider, insert:

```ts
  // ─── West Rand pilot launch ──────────────────────────────────────────────────
  'launch.west_rand_pilot.enabled': {
    description: 'Master toggle for the West Rand pilot. When ON, customer serviceability, bookings creation, quote approval, payment initialisation, and matching filter all gate on WEST_RAND_PILOT suburb/category allowlists. OFF preserves legacy behaviour exactly.',
    owner: 'prod',
    defaultValue: false,
  },
  'launch.west_rand_pilot.electrical_gate': {
    description: 'Independent gate for the electrical readiness check. Dead in v1 because electrical is intentionally absent from allowedCategorySlugs; reserved for the future flip when electrical supply is in place.',
    owner: 'prod',
    defaultValue: false,
  },
  'launch.west_rand_pilot.readiness_report': {
    description: 'Shows /admin/launch-readiness page. Can flip on independently of the master flag so ops can validate counts before customer activation.',
    owner: 'ops',
    defaultValue: false,
  },
  'launch.west_rand_pilot.nudge_console': {
    description: 'Shows /admin/nudges page (preview + CSV export + mark-sent). No outbound Meta API. Outbound sends are performed externally by ops.',
    owner: 'ops',
    defaultValue: false,
  },
```

- [ ] **Step 3: Run the type checker**

Run: `cd field-service && pnpm tsc --noEmit`
Expected: no errors. `FeatureFlagKey` now includes the four new keys.

- [ ] **Step 4: Run flag-registry tests if any exist**

Run: `cd field-service && pnpm test feature-flags-registry`
Expected: PASS — any existing registry tests still green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/feature-flags-registry.ts
git commit -m "feat(flags): register four west-rand pilot launch flags"
```

---

## Task 4: Extend `scripts/seed-flags.ts` to upsert the new flags

**Files:**
- Modify: `field-service/scripts/seed-flags.ts`

- [ ] **Step 1: Open the seed script and locate the flag-list array**

Open `field-service/scripts/seed-flags.ts`. Find the array of flag keys it iterates over (likely a `const flagsToSeed = [...]` or a loop over `FEATURE_FLAGS_REGISTRY`). If it already loops over the entire registry, only verify defaults are correct and skip to Step 3.

- [ ] **Step 2: Add the four new keys to the seed list (only if the script uses an explicit list)**

If the script has an explicit list, add the four new flags to it:

```ts
'launch.west_rand_pilot.enabled',
'launch.west_rand_pilot.electrical_gate',
'launch.west_rand_pilot.readiness_report',
'launch.west_rand_pilot.nudge_console',
```

If the script iterates over `FEATURE_FLAGS_REGISTRY` keys directly, no change is needed.

- [ ] **Step 3: Run the seed script against a local database**

Run: `cd field-service && pnpm tsx scripts/seed-flags.ts`
Expected: stdout reports four new rows upserted (or already-present if re-run). All inserted with `enabled=false`.

- [ ] **Step 4: Verify in the database**

Run: `cd field-service && pnpm prisma studio` (or `psql`), inspect `feature_flags` table; confirm four rows with `enabled=false`.

- [ ] **Step 5: Commit**

```bash
git add field-service/scripts/seed-flags.ts
git commit -m "chore(seed): include west-rand pilot launch flags in seed-flags"
```

---

## Task 5: Extend `isAreaCategoryServiceable()` with the pilot gate (TDD)

**Files:**
- Create: `field-service/__tests__/lib/customer-serviceability.pilot.test.ts`
- Modify: `field-service/lib/customer-serviceability.ts` (function at line 272)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/customer-serviceability.pilot.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({
  getFlag: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    locationNode: { findUnique: vi.fn() },
    provider: { count: vi.fn() },
  },
}))

const { getFlag } = await import('@/lib/flags')
const { db } = await import('@/lib/db')
const { isAreaCategoryServiceable } = await import('@/lib/customer-serviceability')

const honeydewNode = {
  id: 'node-honeydew',
  slug: 'gauteng__johannesburg__jhb_west__honeydew',
  nodeType: 'SUBURB',
  provinceKey: 'gauteng',
  cityKey: 'johannesburg',
  regionKey: 'jhb_west',
  label: 'Honeydew',
}

const sandtonNode = {
  ...honeydewNode,
  id: 'node-sandton',
  slug: 'gauteng__johannesburg__sandton__morningside',
  regionKey: 'sandton',
  label: 'Morningside',
}

describe('isAreaCategoryServiceable — pilot gate', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
    vi.mocked(db.locationNode.findUnique).mockReset()
    vi.mocked(db.provider.count).mockReset()
  })

  describe('flag OFF — legacy behaviour preserved', () => {
    beforeEach(() => {
      vi.mocked(getFlag).mockImplementation(async (k: string) => false)
    })

    it('allows a Sandton suburb + plumbing tuple when providers exist (baseline)', async () => {
      vi.mocked(db.locationNode.findUnique).mockResolvedValue(sandtonNode as never)
      vi.mocked(db.provider.count).mockResolvedValue(1)
      const ok = await isAreaCategoryServiceable({
        areaSlug: sandtonNode.slug,
        categoryTag: 'plumbing',
      })
      expect(ok).toBe(true)
    })

    it('rejects when category is not in PILOT_SKILL_TAGS even with flag off', async () => {
      const ok = await isAreaCategoryServiceable({
        areaSlug: sandtonNode.slug,
        categoryTag: 'electrical',
      })
      expect(ok).toBe(false)
    })
  })

  describe('master flag ON', () => {
    beforeEach(() => {
      vi.mocked(getFlag).mockImplementation(async (k: string) =>
        k === 'launch.west_rand_pilot.enabled' ? true : false,
      )
    })

    it('allows all 8 launch suburbs with plumbing', async () => {
      vi.mocked(db.locationNode.findUnique).mockResolvedValue(honeydewNode as never)
      vi.mocked(db.provider.count).mockResolvedValue(1)
      const ok = await isAreaCategoryServiceable({
        areaSlug: honeydewNode.slug,
        categoryTag: 'plumbing',
      })
      expect(ok).toBe(true)
    })

    it('rejects a non-pilot suburb', async () => {
      vi.mocked(db.locationNode.findUnique).mockResolvedValue(sandtonNode as never)
      const ok = await isAreaCategoryServiceable({
        areaSlug: sandtonNode.slug,
        categoryTag: 'plumbing',
      })
      expect(ok).toBe(false)
    })

    it('rejects electrical even in a pilot suburb', async () => {
      vi.mocked(db.locationNode.findUnique).mockResolvedValue(honeydewNode as never)
      const ok = await isAreaCategoryServiceable({
        areaSlug: honeydewNode.slug,
        categoryTag: 'electrical',
      })
      expect(ok).toBe(false)
    })

    it('rejects a non-allowlisted category in a pilot suburb', async () => {
      vi.mocked(db.locationNode.findUnique).mockResolvedValue(honeydewNode as never)
      const ok = await isAreaCategoryServiceable({
        areaSlug: honeydewNode.slug,
        categoryTag: 'cleaning',
      })
      expect(ok).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/customer-serviceability.pilot.test.ts`
Expected: FAIL on the master-flag-ON cases — the gate isn't there yet.

- [ ] **Step 3: Add the pilot gate to `isAreaCategoryServiceable`**

Open `field-service/lib/customer-serviceability.ts`. Add imports at the top (after existing imports):

```ts
import { isPilotSuburbSlug, isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { getElectricalReadiness } from '@/lib/launch/electrical-readiness'
import { getFlag } from '@/lib/flags'
import { canonicalSlug } from '@/lib/category-config'
```

(If any are already imported, skip the duplicate.)

Replace the body of `isAreaCategoryServiceable` (around lines 272–283) with:

```ts
export async function isAreaCategoryServiceable(params: {
  areaSlug: string | null | undefined
  categoryTag: string | null | undefined
}): Promise<boolean> {
  const { areaSlug, categoryTag } = params
  if (!categoryTag) return false
  const categorySlug = canonicalSlug(categoryTag) ?? categoryTag

  const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
  if (pilotEnabled) {
    if (!isPilotSuburbSlug(areaSlug)) return false
    if (!isPilotCategorySlug(categorySlug)) return false
    if (categorySlug === 'electrical') {
      const electricalGateOn = await getFlag('launch.west_rand_pilot.electrical_gate')
      if (electricalGateOn) {
        const readiness = await getElectricalReadiness()
        if (!readiness.ready) return false
      } else {
        return false
      }
    }
  }

  if (!PILOT_SKILL_TAGS.has(categorySlug)) return false
  const area = await resolveAreaScope(areaSlug)
  if (!area) return false
  const count = await countActiveProvidersFor({ area, categoryTag: categorySlug })
  return count > 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/customer-serviceability.pilot.test.ts`
Expected: PASS — all 6 cases green. Also re-run any existing serviceability test:
Run: `cd field-service && pnpm test customer-serviceability`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/customer-serviceability.ts field-service/__tests__/lib/customer-serviceability.pilot.test.ts
git commit -m "feat(serviceability): extend isAreaCategoryServiceable with west-rand pilot gate"
```

---

## Task 6: Filter `/api/customer/serviceability` response to allowlist (TDD)

**Files:**
- Modify: `field-service/app/api/customer/serviceability/route.ts`
- Modify: existing tests if present, otherwise extend `customer-serviceability.pilot.test.ts`

- [ ] **Step 1: Read the existing route handler**

Open `field-service/app/api/customer/serviceability/route.ts`. Identify where `listServiceableCategoriesForArea(area)` is called and where the response object is built.

- [ ] **Step 2: Add the gate at the response-build site**

After `listServiceableCategoriesForArea(...)` returns, before returning the JSON response, insert:

```ts
import { getFlag } from '@/lib/flags'
import { isPilotSuburbSlug, isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
// (add to existing imports at top of file)

// inside GET handler, after categories are loaded and after we have `area`:
const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
if (pilotEnabled) {
  if (!isPilotSuburbSlug(area?.slug ?? null)) {
    return NextResponse.json(
      { code: 'pilot.suburb_not_supported', categories: [], totalActive: 0 },
      { status: 422 },
    )
  }
  // Filter categories to the pilot allowlist; electrical drops out by being absent from the list.
  categories = categories.filter((c) => isPilotCategorySlug(c.slug))
}
```

(Adjust the variable name `categories` to whatever the handler currently uses.)

- [ ] **Step 3: Add a route-level integration test**

Append to `field-service/__tests__/lib/customer-serviceability.pilot.test.ts` (or create a sibling `__tests__/api/customer-serviceability-route-pilot.test.ts` if the route is tested separately in the codebase):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
// Reuse mocks from the top of the file.

describe('GET /api/customer/serviceability — pilot gate', () => {
  // If route is tested via the handler import pattern used elsewhere in this repo,
  // mirror that pattern; otherwise omit this block and rely on Playwright in Task 13.
  it.skip('returns 422 with code pilot.suburb_not_supported for non-pilot suburb when master flag ON', () => {
    // Implemented in e2e/pilot.spec.ts (Task 13) if no handler-level test pattern exists.
  })
})
```

(The `it.skip` is acceptable here because the route is exercised end-to-end by the Playwright test in Task 13; remove only if the codebase has a Vitest pattern for route handlers.)

- [ ] **Step 4: Run any existing route tests**

Run: `cd field-service && pnpm test api/customer/serviceability`
Expected: PASS — pre-existing route tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/api/customer/serviceability/route.ts field-service/__tests__/lib/customer-serviceability.pilot.test.ts
git commit -m "feat(serviceability-api): filter response to pilot allowlist when master flag is on"
```

---

## Task 7: Gate `POST /api/customer/bookings` (TDD)

**Files:**
- Create: `field-service/__tests__/api/customer-bookings-pilot-gate.test.ts`
- Modify: `field-service/app/api/customer/bookings/route.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/api/customer-bookings-pilot-gate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ getFlag: vi.fn() }))
vi.mock('@/lib/customer-serviceability', async () => ({
  isAreaCategoryServiceable: vi.fn(),
}))

const { getFlag } = await import('@/lib/flags')
const { isAreaCategoryServiceable } = await import('@/lib/customer-serviceability')
const { POST } = await import('@/app/api/customer/bookings/route')

function buildReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/customer/bookings — pilot gate', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
    vi.mocked(isAreaCategoryServiceable).mockReset()
  })

  it('returns 422 with pilot.suburb_not_supported when gate rejects (flag ON, non-pilot suburb)', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    vi.mocked(isAreaCategoryServiceable).mockResolvedValue(false)
    const res = await POST(
      buildReq({ areaSlug: 'gauteng__johannesburg__sandton__morningside', categoryTag: 'plumbing' }) as never,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('pilot.suburb_not_supported')
  })

  it('passes through when gate accepts', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    vi.mocked(isAreaCategoryServiceable).mockResolvedValue(true)
    // The handler's downstream call will hit other mocks; assert it didn't 422.
    const res = await POST(
      buildReq({ areaSlug: 'gauteng__johannesburg__jhb_west__honeydew', categoryTag: 'plumbing' }) as never,
    )
    expect(res.status).not.toBe(422)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/api/customer-bookings-pilot-gate.test.ts`
Expected: FAIL — the route either ignores the gate or rejects with a different code.

- [ ] **Step 3: Add the gate to the route**

Open `field-service/app/api/customer/bookings/route.ts`. At the top of the `POST` handler, after parsing the body and before any other validation, insert:

```ts
import { getFlag } from '@/lib/flags'
import { isAreaCategoryServiceable } from '@/lib/customer-serviceability'
import { isPilotSuburbSlug, isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { canonicalSlug } from '@/lib/category-config'

// inside POST handler, after parsing body into { areaSlug, categoryTag, ...rest }:
const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
if (pilotEnabled) {
  const canonical = canonicalSlug(categoryTag) ?? categoryTag
  if (!isPilotSuburbSlug(areaSlug)) {
    return NextResponse.json(
      { code: 'pilot.suburb_not_supported', message: 'This suburb is not yet active in the West Rand pilot.' },
      { status: 422 },
    )
  }
  if (!isPilotCategorySlug(canonical)) {
    return NextResponse.json(
      { code: 'pilot.category_not_supported', message: 'This service category is not part of the West Rand pilot yet.' },
      { status: 422 },
    )
  }
}
const servable = await isAreaCategoryServiceable({ areaSlug, categoryTag })
if (!servable) {
  return NextResponse.json(
    { code: pilotEnabled ? 'pilot.category_not_supported' : 'unsupported-area-category' },
    { status: 422 },
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/api/customer-bookings-pilot-gate.test.ts`
Expected: PASS — both cases green.

Run also: `cd field-service && pnpm test api/customer/bookings`
Expected: existing bookings route tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/api/customer/bookings/route.ts field-service/__tests__/api/customer-bookings-pilot-gate.test.ts
git commit -m "feat(bookings-api): gate POST /api/customer/bookings on west-rand pilot allowlists"
```

---

## Task 8: Gate `createJobRequest()` at the persistence seam (TDD)

**Files:**
- Create: `field-service/__tests__/lib/job-requests/create-job-request.pilot.test.ts`
- Modify: `field-service/lib/job-requests/create-job-request.ts` (function at line 144)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/job-requests/create-job-request.pilot.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ getFlag: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: { jobRequest: { create: vi.fn() } },
}))

const { getFlag } = await import('@/lib/flags')
const { createJobRequest } = await import('@/lib/job-requests/create-job-request')

const honeydewArgs = {
  customerId: 'cust-1',
  areaSlug: 'gauteng__johannesburg__jhb_west__honeydew',
  categoryTag: 'plumbing',
  title: 'Leak',
  description: 'Under sink',
}

describe('createJobRequest — pilot gate', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
  })

  it('throws PilotCategoryNotSupportedError when category is electrical (master flag ON)', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    await expect(
      createJobRequest({ ...honeydewArgs, categoryTag: 'electrical' }),
    ).rejects.toMatchObject({ name: 'PilotCategoryNotSupportedError' })
  })

  it('throws PilotSuburbNotSupportedError for a non-pilot suburb (master flag ON)', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    await expect(
      createJobRequest({ ...honeydewArgs, areaSlug: 'gauteng__johannesburg__sandton__morningside' }),
    ).rejects.toMatchObject({ name: 'PilotSuburbNotSupportedError' })
  })

  it('does not throw when flag OFF (legacy behavior)', async () => {
    vi.mocked(getFlag).mockResolvedValue(false)
    // We mock the DB so createJobRequest can complete without persisting.
    // The assertion here is that the pilot gate didn't throw.
    await expect(
      createJobRequest({ ...honeydewArgs, categoryTag: 'electrical' }),
    ).resolves.not.toMatchObject({ name: 'PilotCategoryNotSupportedError' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/job-requests/create-job-request.pilot.test.ts`
Expected: FAIL — error classes don't exist yet.

- [ ] **Step 3: Add gate + typed errors**

Open `field-service/lib/job-requests/create-job-request.ts`. Add at the top of the file (after existing imports):

```ts
import { getFlag } from '@/lib/flags'
import { isPilotSuburbSlug, isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { canonicalSlug } from '@/lib/category-config'

export class PilotSuburbNotSupportedError extends Error {
  constructor(slug: string | null | undefined) {
    super(`Suburb not in West Rand pilot: ${slug ?? 'null'}`)
    this.name = 'PilotSuburbNotSupportedError'
  }
}

export class PilotCategoryNotSupportedError extends Error {
  constructor(slug: string) {
    super(`Category not in West Rand pilot allowlist: ${slug}`)
    this.name = 'PilotCategoryNotSupportedError'
  }
}
```

Inside `createJobRequest` (line 144), at the very top of the function body before any other logic:

```ts
const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
if (pilotEnabled) {
  const canonical = canonicalSlug(args.categoryTag) ?? args.categoryTag
  if (!isPilotSuburbSlug(args.areaSlug)) {
    throw new PilotSuburbNotSupportedError(args.areaSlug)
  }
  if (!isPilotCategorySlug(canonical)) {
    throw new PilotCategoryNotSupportedError(canonical)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/job-requests/create-job-request.pilot.test.ts`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/job-requests/create-job-request.ts field-service/__tests__/lib/job-requests/create-job-request.pilot.test.ts
git commit -m "feat(job-requests): gate createJobRequest with pilot suburb/category checks"
```

---

## Task 9: Re-check gate on `PATCH /api/quotes/[token]` approve (TDD)

**Files:**
- Create: `field-service/__tests__/api/quotes-token-approve-pilot.test.ts`
- Modify: `field-service/app/api/quotes/[token]/route.ts` (PATCH handler at line 82)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/api/quotes-token-approve-pilot.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ getFlag: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: vi.fn() },
  },
}))

const { getFlag } = await import('@/lib/flags')
const { db } = await import('@/lib/db')
const { PATCH } = await import('@/app/api/quotes/[token]/route')

const quoteWithElectricalJob = {
  id: 'q1',
  match: {
    jobRequest: {
      category: 'electrical',
      address: { suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew' },
    },
  },
}

function buildReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/quotes/tok-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/quotes/[token] — pilot re-check on approve', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
    vi.mocked(db.quote.findUnique).mockReset()
  })

  it('returns 409 pilot.category_no_longer_supported when approving a quote whose category is now gated', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    vi.mocked(db.quote.findUnique).mockResolvedValue(quoteWithElectricalJob as never)
    const res = await PATCH(buildReq({ action: 'approve' }) as never, { params: { token: 'tok-1' } } as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('pilot.category_no_longer_supported')
  })

  it('allows approval when flag OFF (legacy behaviour)', async () => {
    vi.mocked(getFlag).mockResolvedValue(false)
    vi.mocked(db.quote.findUnique).mockResolvedValue(quoteWithElectricalJob as never)
    const res = await PATCH(buildReq({ action: 'approve' }) as never, { params: { token: 'tok-1' } } as never)
    expect(res.status).not.toBe(409)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/api/quotes-token-approve-pilot.test.ts`
Expected: FAIL — the re-check isn't there.

- [ ] **Step 3: Add the re-check inside the PATCH handler**

Open `field-service/app/api/quotes/[token]/route.ts`. In the PATCH handler (line 82), after the quote is loaded and `body.action === 'approve'` is confirmed, before calling `processQuoteDecision`, insert:

```ts
import { getFlag } from '@/lib/flags'
import { isPilotSuburbSlug, isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { canonicalSlug } from '@/lib/category-config'

// inside PATCH handler, after `body.action === 'approve'` confirmed and the quote loaded:
if (body.action === 'approve') {
  const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
  if (pilotEnabled) {
    const jobReq = quoteRow.match?.jobRequest
    const canonical = jobReq?.category ? (canonicalSlug(jobReq.category) ?? jobReq.category) : null
    const suburbSlug = jobReq?.address?.suburbSlug ?? null
    if (!isPilotSuburbSlug(suburbSlug) || !canonical || !isPilotCategorySlug(canonical)) {
      return NextResponse.json(
        { code: 'pilot.category_no_longer_supported', message: 'This quote can no longer be approved under the current pilot scope.' },
        { status: 409 },
      )
    }
  }
}
```

(Adapt field accessors to whatever the actual `quoteRow` shape is — read the file once before editing.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/api/quotes-token-approve-pilot.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/api/quotes/[token]/route.ts field-service/__tests__/api/quotes-token-approve-pilot.test.ts
git commit -m "feat(quotes-api): re-check pilot gate on quote approval to catch mid-flight gating"
```

---

## Task 10: Throw `CategoryGatedByPilotError` from `initializeBookingPayment` (TDD)

**Files:**
- Create: `field-service/__tests__/lib/payments-category-gate.test.ts`
- Modify: `field-service/lib/payments.ts` (function at line 482)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/payments-category-gate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ getFlag: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
  },
}))

const { getFlag } = await import('@/lib/flags')
const { db } = await import('@/lib/db')
const { initializeBookingPayment, CategoryGatedByPilotError } = await import('@/lib/payments')

const electricalBooking = {
  id: 'b1',
  match: { jobRequest: { category: 'electrical', address: { suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew' } } },
}

describe('initializeBookingPayment — pilot category gate', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
    vi.mocked(db.booking.findUnique).mockReset()
  })

  it('throws CategoryGatedByPilotError when flag ON and booking is in a gated category', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    vi.mocked(db.booking.findUnique).mockResolvedValue(electricalBooking as never)
    await expect(initializeBookingPayment({ bookingId: 'b1', amount: 100, currency: 'ZAR' } as never))
      .rejects.toBeInstanceOf(CategoryGatedByPilotError)
  })

  it('does not throw when flag OFF', async () => {
    vi.mocked(getFlag).mockResolvedValue(false)
    vi.mocked(db.booking.findUnique).mockResolvedValue(electricalBooking as never)
    await expect(initializeBookingPayment({ bookingId: 'b1', amount: 100, currency: 'ZAR' } as never))
      .resolves.not.toBeInstanceOf(CategoryGatedByPilotError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/payments-category-gate.test.ts`
Expected: FAIL — `CategoryGatedByPilotError` not exported.

- [ ] **Step 3: Add the error class and the gate**

Open `field-service/lib/payments.ts`. Near the top with other exports, add:

```ts
import { getFlag } from '@/lib/flags'
import { isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { canonicalSlug } from '@/lib/category-config'

export class CategoryGatedByPilotError extends Error {
  constructor(public categorySlug: string) {
    super(`Category gated by west-rand pilot: ${categorySlug}`)
    this.name = 'CategoryGatedByPilotError'
  }
}
```

Inside `initializeBookingPayment` (line 482), at the top of the function before any payment-provider call:

```ts
const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
if (pilotEnabled) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    select: { match: { select: { jobRequest: { select: { category: true } } } } },
  })
  const raw = booking?.match?.jobRequest?.category ?? null
  const canonical = raw ? (canonicalSlug(raw) ?? raw) : null
  if (canonical && !isPilotCategorySlug(canonical)) {
    throw new CategoryGatedByPilotError(canonical)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/payments-category-gate.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/payments.ts field-service/__tests__/lib/payments-category-gate.test.ts
git commit -m "feat(payments): throw CategoryGatedByPilotError when booking category is pilot-gated"
```

---

## Task 11: Filter matching candidates with `CATEGORY_GATED_BY_PILOT` reason (TDD)

**Files:**
- Create: `field-service/__tests__/lib/matching-filter-pilot.test.ts`
- Modify: `field-service/lib/matching/filter.ts` (function at line 282)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/matching-filter-pilot.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ getFlag: vi.fn() }))

const { getFlag } = await import('@/lib/flags')
const { filterEligibleProviders } = await import('@/lib/matching/filter')

const baseCandidate = {
  providerId: 'p1',
  // shape filled per the CandidatePoolEntry the real filter expects — fill from filter.ts
} as never

describe('filterEligibleProviders — pilot category gate', () => {
  beforeEach(() => {
    vi.mocked(getFlag).mockReset()
  })

  it('drops all candidates with reason CATEGORY_GATED_BY_PILOT when job category is gated and flag ON', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    const result = await filterEligibleProviders({
      jobRequest: { id: 'jr1', category: 'electrical' } as never,
      candidates: [baseCandidate, baseCandidate],
    } as never)
    expect(result.eligible).toHaveLength(0)
    expect(result.filtered.every((f: { reason: string }) => f.reason === 'CATEGORY_GATED_BY_PILOT')).toBe(true)
    expect(result.filtered).toHaveLength(2)
  })

  it('does not drop when category is allowed', async () => {
    vi.mocked(getFlag).mockResolvedValue(true)
    const result = await filterEligibleProviders({
      jobRequest: { id: 'jr1', category: 'plumbing' } as never,
      candidates: [baseCandidate],
    } as never)
    expect(result.filtered.every((f: { reason: string }) => f.reason === 'CATEGORY_GATED_BY_PILOT')).toBe(false)
  })

  it('does not drop when flag OFF', async () => {
    vi.mocked(getFlag).mockResolvedValue(false)
    const result = await filterEligibleProviders({
      jobRequest: { id: 'jr1', category: 'electrical' } as never,
      candidates: [baseCandidate],
    } as never)
    expect(result.filtered.every((f: { reason: string }) => f.reason === 'CATEGORY_GATED_BY_PILOT')).toBe(false)
  })
})
```

(Before running, open `lib/matching/filter.ts` and copy the actual `CandidatePoolEntry` shape into `baseCandidate` so the function doesn't throw on a missing field. Use the minimum subset required.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm test __tests__/lib/matching-filter-pilot.test.ts`
Expected: FAIL — reason `CATEGORY_GATED_BY_PILOT` not yet emitted.

- [ ] **Step 3: Add the early-drop branch**

Open `field-service/lib/matching/filter.ts`. Near the top (around the existing reason-string type union for `FilteredCandidate.reason`), add `'CATEGORY_GATED_BY_PILOT'` to the union.

Inside `filterEligibleProviders` (line 282), at the very top of the function:

```ts
import { getFlag } from '@/lib/flags'
import { isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'
import { canonicalSlug } from '@/lib/category-config'

// inside filterEligibleProviders, right after function entry:
const pilotEnabled = await getFlag('launch.west_rand_pilot.enabled')
if (pilotEnabled) {
  const raw = args.jobRequest.category ?? null
  const canonical = raw ? (canonicalSlug(raw) ?? raw) : null
  if (!canonical || !isPilotCategorySlug(canonical)) {
    return {
      eligible: [],
      filtered: args.candidates.map((c) => ({
        providerId: c.providerId,
        reason: 'CATEGORY_GATED_BY_PILOT' as const,
      })),
      nearMisses: [],
    }
  }
}
```

(Match the return shape to whatever the existing function actually returns — read the file once first.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm test __tests__/lib/matching-filter-pilot.test.ts`
Expected: PASS — all 3 cases green.

Run also: `cd field-service && pnpm test matching`
Expected: existing matching tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/matching/filter.ts field-service/__tests__/lib/matching-filter-pilot.test.ts
git commit -m "feat(matching): drop candidates with CATEGORY_GATED_BY_PILOT when job category is pilot-gated"
```

---

## Task 12: Electrical canonicalization regression test (no production change)

**Files:**
- Create: `field-service/__tests__/lib/electrical-canonicalization.test.ts`

- [ ] **Step 1: Write the test**

Create `field-service/__tests__/lib/electrical-canonicalization.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalSlug } from '@/lib/category-config'
import { isPilotCategorySlug } from '@/lib/launch/west-rand-pilot'

describe('electrical canonicalization', () => {
  const variants = ['Electrical', 'electrical', 'Electrical Repairs', 'electric', 'electrician']

  for (const v of variants) {
    it(`'${v}' canonicalizes to 'electrical'`, () => {
      const canonical = canonicalSlug(v)
      expect(canonical).toBe('electrical')
    })

    it(`'${v}' is NOT a pilot-allowed category after canonicalization`, () => {
      const canonical = canonicalSlug(v) ?? v
      expect(isPilotCategorySlug(canonical)).toBe(false)
    })
  }
})
```

- [ ] **Step 2: Run the test**

Run: `cd field-service && pnpm test __tests__/lib/electrical-canonicalization.test.ts`
Expected: PASS (or FAIL on a variant that doesn't canonicalize — in which case file a follow-up ticket and update the test to assert the actual behaviour. Do NOT change `canonicalSlug` to make the test pass; the test documents reality).

- [ ] **Step 3: If any variant doesn't canonicalize to 'electrical', annotate the test**

If e.g. "electrician" doesn't canonicalize (returns null or stays as "electrician"), change that specific assertion to:

```ts
it(`'electrician' does NOT canonicalize to electrical (documented limitation)`, () => {
  expect(canonicalSlug('electrician')).not.toBe('electrical')
})
```

and add an `it.todo('extend canonicalSlug to map electrician → electrical')` in the same file. This makes the gap visible without adding scope to PR1.

- [ ] **Step 4: Commit**

```bash
git add field-service/__tests__/lib/electrical-canonicalization.test.ts
git commit -m "test(canonicalization): document electrical label-variant coverage for the pilot gate"
```

---

## Task 13: Playwright `e2e/pilot.spec.ts` (smoke + regression)

**Files:**
- Create: `field-service/e2e/pilot.spec.ts`

- [ ] **Step 1: Read the existing smoke spec for harness conventions**

Open `field-service/e2e/smoke.spec.ts`. Note (a) how the page is opened, (b) how flags are flipped in the test environment (likely via a setup helper or env vars), (c) any auth bootstrap.

- [ ] **Step 2: Write the pilot spec**

Create `field-service/e2e/pilot.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// This spec assumes the test env has a way to flip launch.west_rand_pilot.enabled
// on/off — either via a setup helper or via env-var override. Mirror smoke.spec.ts.

test.describe('West Rand pilot — customer surface', () => {
  test('Honeydew customer sees only allowed categories (no electrical) when master flag ON', async ({ page, request }) => {
    // Arrange — flip flag on. Replace with the codebase's existing helper.
    await request.post('/api/_test/flags', { data: { 'launch.west_rand_pilot.enabled': true } }).catch(() => undefined)
    await page.goto('/?area=gauteng__johannesburg__jhb_west__honeydew')
    // Categories visible
    await expect(page.getByText(/plumbing/i)).toBeVisible()
    await expect(page.getByText(/painting/i)).toBeVisible()
    // Electrical absent
    await expect(page.getByText(/electrical/i)).toHaveCount(0)
  })

  test('Sandton (non-pilot) customer sees existing waitlist/empty-state when master flag ON', async ({ page, request }) => {
    await request.post('/api/_test/flags', { data: { 'launch.west_rand_pilot.enabled': true } }).catch(() => undefined)
    await page.goto('/?area=gauteng__johannesburg__sandton__morningside')
    // Empty-state / unsupported-area copy from the existing baseline.
    await expect(page.getByText(/not yet|waitlist|coming soon/i)).toBeVisible()
  })

  test('Flag OFF restores identical-to-baseline customer experience', async ({ page, request }) => {
    await request.post('/api/_test/flags', { data: { 'launch.west_rand_pilot.enabled': false } }).catch(() => undefined)
    await page.goto('/?area=gauteng__johannesburg__sandton__morningside')
    // Should NOT see pilot-specific error codes.
    await expect(page.getByText(/pilot\.suburb_not_supported/i)).toHaveCount(0)
  })
})
```

(If the codebase has no `/api/_test/flags` endpoint, replace those `request.post` lines with whatever flag-toggle pattern `smoke.spec.ts` uses, e.g. `process.env.E2E_FLAG_OVERRIDES` JSON.)

- [ ] **Step 3: Run the spec locally**

Run: `cd field-service && pnpm exec playwright test e2e/pilot.spec.ts`
Expected: PASS — three cases green.

- [ ] **Step 4: Run full smoke to confirm no regressions**

Run: `cd field-service && pnpm exec playwright test e2e/smoke.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/e2e/pilot.spec.ts
git commit -m "test(e2e): add pilot-gate Playwright smoke for Honeydew + Sandton + flag-off baseline"
```

---

## Self-Review Checklist (run after Task 13)

- [ ] **Spec coverage** — every PR1 line item in `docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md` §3.0/§3.3/§4.1/§4.2/§4.3/§8.1 has a task here. Verified.
- [ ] **Placeholder scan** — no `TBD`, `TODO`, "implement later", or "similar to Task N" without code in the plan.
- [ ] **Type consistency** — `PilotSuburbNotSupportedError`, `PilotCategoryNotSupportedError`, `CategoryGatedByPilotError` referenced consistently across Tasks 8, 10. `'CATEGORY_GATED_BY_PILOT'` reason string consistent in Task 11. Flag keys consistent: `launch.west_rand_pilot.enabled`, `launch.west_rand_pilot.electrical_gate`, `launch.west_rand_pilot.readiness_report`, `launch.west_rand_pilot.nudge_console`.
- [ ] **Flag-off regression coverage** — Tasks 5, 7, 8, 9, 10, 11, 13 each include a flag-OFF case asserting identical-to-baseline behaviour.
- [ ] **No schema change** — no Prisma file is modified in this plan. Confirmed.
- [ ] **Spec acceptance criteria #1–#5, #10 partial covered by this PR** — #6, #7, #8, #9, #11 land in PR2 and PR3.

---

## PR Open / Push

After Task 13's commit, push and open PR:

```bash
git push -u origin <branch>
gh pr create \
  --title "feat(launch): West Rand pilot — config + customer gates (PR1)" \
  --body "$(cat <<'EOF'
## Summary
- Adds WEST_RAND_PILOT constant module + electrical-readiness probe (no schema change).
- Registers four launch feature flags, all default OFF.
- Wires pilot suburb/category gates into customer-serviceability, bookings POST, createJobRequest, quote PATCH approve, initializeBookingPayment, and matching filter.
- All gates are flag-conditional: with launch.west_rand_pilot.enabled OFF, customer flow is byte-identical to baseline.

Spec: docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md (v2)

## Test plan
- [ ] pnpm test passes locally
- [ ] pnpm exec playwright test e2e/pilot.spec.ts passes locally
- [ ] Smoke (e2e/smoke.spec.ts) still green
- [ ] Manual: flip launch.west_rand_pilot.enabled ON in staging, confirm Honeydew narrows + Sandton returns 422; flip OFF, confirm baseline restored

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
