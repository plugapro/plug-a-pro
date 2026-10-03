# National Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Plug A Pro nationally — provider registration, matching and customer intake work in every active location node — by deleting the hardcoded Johannesburg fence and making `LocationNode.active` the only definition of "live".

**Architecture:** The fence lives in three places today: hardcoded region/province/city sets in `lib/service-area-guard.ts`, `TechnicianServiceArea.active` being written `false` outside `jhb_west` in `lib/provider-record.ts`, and waitlist branches in the customer web and WhatsApp intake. The plan removes each consumer's dependency on the sets first (tasks 1–20, each leaving typecheck green), then deletes the sets (task 21). Thinly mapped regions get a `REGION`-type service-area fallback, and two scripts handle data: a postcode backfill for 42 hidden taxonomy suburbs (ships in the PR) and a dry-run-first resync that re-activates existing fence-inactive rows (runs after merge with owner approval).

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma (Postgres/Supabase), Vitest (node env, globals), WhatsApp Cloud API flows, Nominatim reverse geocoding (`lib/geocoding.ts`), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-national-rollout-design.md`

## Global Constraints

- Work only in the worktree `worktrees/feat-national-rollout` on branch `feat/national-rollout` (base `origin/main` @ `4fc7e8a0`). Stage by explicit path. Never touch the main checkout or use bare `git stash`.
- Every task leaves `pnpm typecheck` green on its own. Tasks 1–20 stop importing guard symbols but never delete them; task 21 deletes them after a grep proves zero importers.
- Additive only: no Prisma schema change, no migration, no new feature flag. `launch.west_rand_pilot.*`, `lib/launch/west-rand-pilot.ts`, `lib/nudges/**`, `lib/ops-agents/**`, `lib/location-audit.ts` and `lib/location-seed.ts` required-slug checks are not modified.
- `upsertStructuredServiceAreas` keeps its signature `(client, providerId, locationNodeIds)`; it writes `active: true` for every active node and `areaType: 'REGION'` for REGION nodes.
- Region-wide coverage in matching requires `areaType === 'REGION'` on the row (both `lib/matching/filter.ts` and `lib/matching/service.ts`).
- REGION nodes are accepted as service areas only where the spec says: PWA registration (node id must equal the submitted `regionId`), WhatsApp registration "Whole <region>" row and free-text fallback, and the provider profile picker.
- PWA suburb nodes still require `postalCode IS NOT NULL`; the 42 missing taxonomy postcodes are backfilled into `lib/service-areas/postal-codes.ts` (generated file; keep its header and insertion order) and the PR is not complete while any is missing.
- Copy rules: no "West Rand first", "Gauteng only", "live for leads", "open to register", "not live yet", "Active pilot", "Currently serving" strings remain under `field-service/lib/**` or `field-service/components/**` outside the excluded pilot modules. Marketing service-policy paragraph is the exact sentence in the spec (§I).
- WhatsApp interactive lists: max 10 rows per section; the province list is 9 provinces (+ "My area isn't listed" on the customer side = 10).
- Commits: conventional `type(scope): subject`, body, then the trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG`. One commit per task minimum.
- Tests: Vitest from `field-service/` (`pnpm vitest run <path>`), synthetic phone numbers only (`+2700000000x`), never real IDs or numbers in fixtures. Marketing tests from `marketing/`.
- Production data steps (postcode seed, `reactivate-service-areas-national.ts --commit`, candidate-pool rebuild, `customer.home.notify_interest` ON) are rollout steps after merge and need owner approval; they are never run from a task.

## Review Focus

1. **WhatsApp list overflow.** A province with more than 8 cities, or a city with more than 8 regions, renders paged rows plus navigation rows plus the "My area isn't listed" row — more than Meta's 10-row cap, and the list send fails. Expected: every rendered section stays ≤ 10 rows with the not-listed row present on every page. Pinned in Task 14.
2. **Resync re-runs and REGION rows.** The owner may run `reactivate-service-areas-national.ts --commit` twice, and some fence-inactive rows are REGION-type. Expected: the second run selects nothing and writes no audit rows; an inactive REGION row with an active node is re-activated like a suburb row. Pinned in Task 4.
3. **Web booking in an empty area with the serviceability flag OFF.** If `customer.home.serviceability_v2` is ever turned off, nothing stops a request where no provider exists and it is created and expired in the same second. Expected: the zero-provider rejection fires regardless of the flag. Pinned in Task 13.
4. **Empty-area guard with an unknown category label.** A WhatsApp category label that cannot be canonicalised would count zero providers and send the customer to notify-me for a category that has supply. Expected: the guard fails open and the request is created. Pinned in Task 16.
5. **Row titles longer than 24 characters.** "Cape Town CBD & Atlantic Seaboard" and "Gqeberha / Nelson Mandela Bay" are cut mid-word by `slice(0, 24)`. Expected: titles are cut at a word boundary with an ellipsis and never end in a dangling connector. Pinned in Task 14 (helper) and Task 17 (registration flow).

---

### Task 1: Service-area rows are always active (`upsertStructuredServiceAreas`)

**Files:**
- Modify: `field-service/lib/provider-record.ts:3` (import), `:125-166` (loop body of `upsertStructuredServiceAreas`)
- Test: `field-service/__tests__/lib/provider-record-area-matchability.test.ts` (rewrite whole file)
- Test: `field-service/__tests__/lib/provider-record.test.ts:380-540` (describe title + third case)

**Interfaces:**
- Consumes: `getRegionKeyFromSlug(slug)` and nothing else from `@/lib/service-area-guard` (the gate helpers stay in that module until Part D deletes them; this task only stops importing `getRegionServiceStatus`). `normaliseLocationDisplayName` from `@/lib/location-format`.
- Produces: `upsertStructuredServiceAreas(client: ProviderRecordSyncClient, providerId: string, locationNodeIds: string[]): Promise<void>` — signature unchanged. Every processed node (the query already filters `active: true`) is written with `active: true`. A `SUBURB` node yields `{ areaType: 'SUBURB', suburbKey: <last slug segment>, regionKey: node.regionKey, label: normaliseLocationDisplayName(node.label) }`. A `REGION` node yields `{ areaType: 'REGION', suburbKey: null, regionKey: node.regionKey ?? getRegionKeyFromSlug(node.slug), label: normaliseLocationDisplayName(node.label), locationNodeId: node.id }`. Tasks 2, 4 and the Part C registration tasks rely on exactly this shape.

- [ ] **Step 1: One-time worktree setup (skip if `field-service/node_modules` exists)**

Run from `field-service/`:
```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm vitest run __tests__/lib/provider-record-area-matchability.test.ts
```
Expected: install succeeds; the existing 2 tests PASS (baseline before any change).

- [ ] **Step 2: Rewrite the matchability contract test to the national contract**

Replace the whole of `field-service/__tests__/lib/provider-record-area-matchability.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { upsertStructuredServiceAreas } from '@/lib/provider-record'

function makeClient(nodes: Array<Record<string, unknown>>) {
  const upsert = vi.fn().mockResolvedValue({})
  const client = {
    locationNode: { findMany: vi.fn().mockResolvedValue(nodes) },
    technicianServiceArea: { upsert },
  }
  return { client, upsert }
}

describe('upsertStructuredServiceAreas — national liveness contract', () => {
  it.each([
    ['jhb_north', 'gauteng__johannesburg__jhb_north__sandton', 'Sandton', 'gauteng', 'johannesburg'],
    ['jhb_west', 'gauteng__johannesburg__jhb_west__florida', 'Florida', 'gauteng', 'johannesburg'],
    ['cape_town_cbd', 'western_cape__cape_town__cape_town_cbd__sea_point', 'Sea Point', 'western_cape', 'cape_town'],
    ['kimberley', 'northern_cape__kimberley__kimberley__galeshewe', 'Galeshewe', 'northern_cape', 'kimberley'],
  ])('writes an ACTIVE SUBURB row for region %s', async (regionKey, slug, label, provinceKey, cityKey) => {
    const { client, upsert } = makeClient([
      { id: 'node-1', nodeType: 'SUBURB', slug, label, regionKey, provinceKey, cityKey },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    const suburbKey = slug.split('__').at(-1)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'node-1' } },
        create: expect.objectContaining({ active: true, areaType: 'SUBURB', regionKey, suburbKey, label, provinceKey, cityKey }),
        update: expect.objectContaining({ active: true, areaType: 'SUBURB', regionKey, suburbKey, label, provinceKey, cityKey }),
      }),
    )
  })

  it('writes an ACTIVE REGION row (areaType REGION, suburbKey null, locationNodeId = region node)', async () => {
    const { client, upsert } = makeClient([
      {
        id: 'region-1',
        nodeType: 'REGION',
        slug: 'northern_cape__kimberley__kimberley',
        label: 'Kimberley',
        regionKey: 'kimberley',
        provinceKey: 'northern_cape',
        cityKey: 'kimberley',
      },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['region-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'region-1' } },
        create: expect.objectContaining({
          active: true,
          areaType: 'REGION',
          regionKey: 'kimberley',
          suburbKey: null,
          label: 'Kimberley',
          locationNodeId: 'region-1',
        }),
        update: expect.objectContaining({ active: true, areaType: 'REGION', regionKey: 'kimberley', suburbKey: null }),
      }),
    )
  })

  it('derives regionKey from the slug when a REGION node carries no regionKey', async () => {
    const { client, upsert } = makeClient([
      {
        id: 'region-2',
        nodeType: 'REGION',
        slug: 'kwazulu_natal__durban__durban_north',
        label: 'Durban North',
        regionKey: null,
        provinceKey: 'kwazulu_natal',
        cityKey: 'durban',
      },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['region-2'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true, areaType: 'REGION', regionKey: 'durban_north' }),
      }),
    )
  })

  it('writes nothing for an empty node list', async () => {
    const { client, upsert } = makeClient([])
    await upsertStructuredServiceAreas(client as never, 'prov-1', [])
    expect(upsert).not.toHaveBeenCalled()
    expect(client.locationNode.findMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Update the three `syncProviderRecord` pilot cases in `provider-record.test.ts`**

In `field-service/__tests__/lib/provider-record.test.ts`:
- Line 380: change `describe('syncProviderRecord - pilot service-area activation', () => {` to `describe('syncProviderRecord - structured service-area activation (national)', () => {`.
- Line 381: change the title `'marks JHB West / Roodepoort structured coverage active'` to `'marks jhb_west structured coverage active'`.
- Line 484: change the title `'marks non-pilot structured coverage coming soon and inactive for matching'` to `'marks jhb_north structured coverage ACTIVE too — liveness is national'`.
- Lines 527-528: change both `active: false` to `active: true`:

```ts
    expect(client.technicianServiceArea.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true, regionKey: 'jhb_north' }),
        update: expect.objectContaining({ active: true, regionKey: 'jhb_north' }),
      }),
    )
```

- [ ] **Step 4: Run both test files to verify they fail**

Run: `pnpm vitest run __tests__/lib/provider-record-area-matchability.test.ts __tests__/lib/provider-record.test.ts`
Expected: FAIL — the `jhb_north`, `cape_town_cbd`, `kimberley` SUBURB cases, both REGION cases and the renamed `jhb_north` sync case fail with `expected ... active: true` but received `active: false`. The `jhb_west` cases and the empty-list case pass.

- [ ] **Step 5: Make every processed node active**

In `field-service/lib/provider-record.ts` change line 3 from
```ts
import { getRegionServiceStatus, getRegionKeyFromSlug } from './service-area-guard'
```
to
```ts
import { getRegionKeyFromSlug } from './service-area-guard'
```
and replace lines 125-166 (the `for (const node of nodes) { … }` loop) with:

```ts
  for (const node of nodes) {
    // SUBURB nodes get a suburbKey (last segment of slug); REGION nodes do not.
    const isSuburb = node.nodeType === 'SUBURB'
    const areaType = isSuburb ? 'SUBURB' : 'REGION'
    const suburbKey = isSuburb ? (node.slug.split('__').at(-1) ?? node.slug) : null
    const regionKey = node.regionKey ?? (node.nodeType === 'REGION' ? getRegionKeyFromSlug(node.slug) : null)
    // National liveness (spec 2026-10-03): a location is live iff its LocationNode
    // is active, and the query above already filters active nodes. Every row is
    // therefore written active. Pausing an area = deactivating its node in
    // /admin/locations + re-running scripts/reactivate-service-areas-national.ts
    // for the affected providers.
    const label = normaliseLocationDisplayName(node.label)

    await client.technicianServiceArea.upsert({
      where: {
        providerId_locationNodeId: {
          providerId,
          locationNodeId: node.id,
        },
      },
      create: {
        providerId,
        locationNodeId: node.id,
        areaType,
        label,
        provinceKey: node.provinceKey,
        cityKey: node.cityKey,
        regionKey,
        suburbKey,
        active: true,
      },
      update: {
        areaType,
        label,
        provinceKey: node.provinceKey,
        cityKey: node.cityKey,
        regionKey,
        suburbKey,
        active: true,
      },
    })
  }
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm vitest run __tests__/lib/provider-record-area-matchability.test.ts __tests__/lib/provider-record.test.ts __tests__/lib/provider-record-tsa-label-fallback.test.ts __tests__/lib/provider-record/resolve-service-area-labels.test.ts __tests__/lib/matching/readiness.test.ts && pnpm typecheck`
Expected: all PASS; typecheck clean. (`lib/matching/readiness.ts` `ACTIVE_SERVICE_AREA` and its test reference no gate symbol — `grep -n service-area-guard lib/matching/readiness.ts __tests__/lib/matching/readiness.test.ts` prints nothing — so no change there; the spec's "stays as is" is satisfied by this run.)

- [ ] **Step 7: Commit**

```bash
git add lib/provider-record.ts __tests__/lib/provider-record-area-matchability.test.ts __tests__/lib/provider-record.test.ts
git commit -m "feat(service-areas): write every structured service-area row active (national liveness)

upsertStructuredServiceAreas no longer consults the matching-region gate.
Every node it processes (already filtered active) produces an active
TechnicianServiceArea row; REGION nodes are written as REGION rows with
suburbKey null. Pausing an area is now a LocationNode.active change plus
a provider resync, not a code constant.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §C

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 2: Remove the gate from approval callers and both backfill scripts

**Files:**
- Modify: `field-service/lib/provider-application-service-areas.ts:7-11` (header comment)
- Modify: `field-service/lib/provider-auto-approve.ts:956-959` (comment)
- Modify: `field-service/app/(admin)/admin/applications/page.tsx:289-290` and `:397-398` (comments)
- Modify: `field-service/scripts/backfill-tsa-from-legacy-service-areas.ts:23` (import), `:190-207` (the `if (args.commit) { … }` block)
- Modify: `field-service/scripts/backfill-provider-service-areas.ts:8-11` (header), `:106-108` (comment)
- Test: `field-service/__tests__/lib/provider-application-service-areas.test.ts`, `field-service/__tests__/app/admin/provider-actions-matchability.test.ts` (unchanged files, re-run as the regression gate)

**Interfaces:**
- Consumes: `upsertStructuredServiceAreas` from Task 1 (always-active contract); `resolveApplicationLocationNodeIds` unchanged.
- Produces: no new symbols. After this task `grep -rn "getRegionServiceStatus\|isActiveRegion" lib/provider-*.ts scripts/backfill-*.ts "app/(admin)/admin/applications"` prints nothing. The two scripts write `active: true` for every row they create.

This task is comments plus one script branch; neither script is unit-testable as written (both run `main()` at import time against the real `db`). The verification gate is typecheck + grep + the two existing approval test files, named below.

- [ ] **Step 1: Fix the approval-path comments**

`field-service/lib/provider-application-service-areas.ts` lines 7-11, replace
```ts
// This helper resolves the LocationNode ids for a ProviderApplication at
// approval time so they can be passed through to syncProviderRecord /
// upsertStructuredServiceAreas (which applies the matching-region gate:
// nodes outside the active matching regions get INACTIVE rows — approval must
// never widen the matching fence).
```
with
```ts
// This helper resolves the LocationNode ids for a ProviderApplication at
// approval time so they can be passed through to syncProviderRecord /
// upsertStructuredServiceAreas. Since the national rollout (spec 2026-10-03)
// every active node produces an ACTIVE row — liveness is LocationNode.active,
// there is no matching-region gate.
```

`field-service/lib/provider-auto-approve.ts` lines 956-959, replace
```ts
    // PJ-01: resolve the application's structured service areas so enrichment
    // creates the TechnicianServiceArea rows matching depends on. The region
    // gate inside upsertStructuredServiceAreas keeps non-matching-region rows
    // inactive, so this never widens the matching fence. Enrichment is now
```
with
```ts
    // PJ-01: resolve the application's structured service areas so enrichment
    // creates the TechnicianServiceArea rows matching depends on. Rows are
    // active for every active LocationNode (national liveness). Enrichment is now
```

`field-service/app/(admin)/admin/applications/page.tsx` lines 289-290, replace
```ts
  // Region gating is preserved inside upsertStructuredServiceAreas: nodes
  // outside the active matching regions produce INACTIVE rows.
```
with
```ts
  // Every active LocationNode produces an ACTIVE row (national liveness,
  // spec 2026-10-03); there is no region gate inside upsertStructuredServiceAreas.
```
and lines 397-398, replace
```ts
        // PJ-01: provision matchability at approval time. The region gate in
        // upsertStructuredServiceAreas keeps non-matching-region rows inactive.
```
with
```ts
        // PJ-01: provision matchability at approval time. Rows are active for
        // every active LocationNode (national liveness).
```

- [ ] **Step 2: Drop the gate from `backfill-tsa-from-legacy-service-areas.ts`**

Line 23: replace
```ts
import { getRegionServiceStatus, getRegionKeyFromSlug } from '../lib/service-area-guard'
```
with nothing (delete the line — neither symbol is used after this step).

Lines 190-207: replace
```ts
      if (args.commit) {
        const regionKey = node.regionKey ?? getRegionKeyFromSlug(node.slug)
        const active = getRegionServiceStatus({ regionKey, slug: node.slug }) === 'active'
        await db.technicianServiceArea.upsert({
          where: { providerId_locationNodeId: { providerId, locationNodeId: node.id } },
          update: { active, label: node.label, regionKey: node.regionKey, provinceKey: node.provinceKey, cityKey: node.cityKey },
          create: {
            providerId,
            areaType: 'SUBURB',
            label: node.label,
            locationNodeId: node.id,
            regionKey: node.regionKey,
            provinceKey: node.provinceKey,
            cityKey: node.cityKey,
            active,
          },
        })
      }
```
with
```ts
      if (args.commit) {
        // National liveness (spec 2026-10-03): every active node → active row.
        await db.technicianServiceArea.upsert({
          where: { providerId_locationNodeId: { providerId, locationNodeId: node.id } },
          update: { active: true, label: node.label, regionKey: node.regionKey, provinceKey: node.provinceKey, cityKey: node.cityKey },
          create: {
            providerId,
            areaType: 'SUBURB',
            label: node.label,
            locationNodeId: node.id,
            regionKey: node.regionKey,
            provinceKey: node.provinceKey,
            cityKey: node.cityKey,
            active: true,
          },
        })
      }
```

- [ ] **Step 3: Fix the comments in `backfill-provider-service-areas.ts`**

Lines 8-11, replace
```ts
 * lib/provider-application-service-areas.ts) and creates the MISSING
 * TechnicianServiceArea rows via upsertStructuredServiceAreas, which applies
 * the matching-region gate: rows outside the active matching regions are
 * created INACTIVE. Existing TSA rows are never modified — additive only.
```
with
```ts
 * lib/provider-application-service-areas.ts) and creates the MISSING
 * TechnicianServiceArea rows via upsertStructuredServiceAreas. Rows are
 * ACTIVE for every active LocationNode (national liveness, spec 2026-10-03).
 * Existing TSA rows are never modified — additive only.
```
Lines 106-108, replace
```ts
      // upsertStructuredServiceAreas applies the region gate: rows outside the
      // active matching regions are created with active=false. Only MISSING
      // node ids are passed, so no existing row is updated.
```
with
```ts
      // upsertStructuredServiceAreas writes active rows for every active node.
      // Only MISSING node ids are passed, so no existing row is updated.
```

- [ ] **Step 4: Verify — grep, typecheck, approval regression tests**

Run from `field-service/`:
```bash
grep -rn "getRegionServiceStatus\|isActiveRegion\|matching-region gate\|non-matching-region" lib/provider-application-service-areas.ts lib/provider-auto-approve.ts "app/(admin)/admin/applications/page.tsx" scripts/backfill-tsa-from-legacy-service-areas.ts scripts/backfill-provider-service-areas.ts ; echo "grep exit=$?"
pnpm typecheck
pnpm vitest run __tests__/lib/provider-application-service-areas.test.ts __tests__/app/admin/provider-actions-matchability.test.ts
```
Expected: grep prints nothing and `grep exit=1`; typecheck clean; both test files PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provider-application-service-areas.ts lib/provider-auto-approve.ts "app/(admin)/admin/applications/page.tsx" scripts/backfill-tsa-from-legacy-service-areas.ts scripts/backfill-provider-service-areas.ts
git commit -m "refactor(service-areas): drop the matching-region gate from approval callers and backfill scripts

The legacy TSA backfill now writes active rows unconditionally; the
approval-path comments describe national liveness instead of the
jhb_west fence.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §C

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 3: `filter.ts` REGION_FALLBACK requires a REGION-type row

**Files:**
- Modify: `field-service/lib/matching/filter.ts:247-254` (Tier 2 of `providerCoversAddress`)
- Test: `field-service/__tests__/lib/matching-filter.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `filterEligibleProviders(rawCandidates: CandidatePoolEntry[], jobRequest: MatchingJobRequest & { address: MatchingAddress })` and the test file's existing `makeCandidate`, `makeJobRequest`, `setupDefaultBatchMocks`, `mockDb`.
- Produces: coverage tier semantics now identical in `lib/matching/filter.ts`, `lib/matching/service.ts` (Tier 2b) and `lib/matching-engine.ts:151-152`: `REGION_FALLBACK` only for `areaType === 'REGION'` rows whose `regionKey` equals the address's. Part C's "whole region" rows rely on this.

- [ ] **Step 1: Append the coverage-tier tests**

Append to the end of `field-service/__tests__/lib/matching-filter.test.ts`:

```ts
// ── Coverage tiers: REGION_FALLBACK needs a REGION row ────────────────────────

function makeStructuredJobRequest() {
  const base = makeJobRequest()
  return {
    ...base,
    address: {
      ...base.address,
      lat: null,
      lng: null,
      locationNodeId: 'node-sandton',
      regionKey: 'jhb_north',
      provinceKey: 'gauteng',
    },
  }
}

const SUBURB_ROW_OTHER_SUBURB_SAME_REGION = {
  providerId: 'p1',
  label: 'Rosebank',
  city: 'Johannesburg',
  active: true,
  areaType: 'SUBURB',
  lat: null,
  lng: null,
  radiusKm: null,
  locationNodeId: 'node-rosebank',
  regionKey: 'jhb_north',
}

const REGION_ROW_SAME_REGION = {
  providerId: 'p1',
  label: 'JHB North / Sandton',
  city: 'Johannesburg',
  active: true,
  areaType: 'REGION',
  lat: null,
  lng: null,
  radiusKm: null,
  locationNodeId: 'region-jhb-north',
  regionKey: 'jhb_north',
}

const SUBURB_ROW_EXACT = {
  providerId: 'p1',
  label: 'Sandton',
  city: 'Johannesburg',
  active: true,
  areaType: 'SUBURB',
  lat: null,
  lng: null,
  radiusKm: null,
  locationNodeId: 'node-sandton',
  regionKey: 'jhb_north',
}

describe('filterEligibleProviders - REGION_FALLBACK requires a REGION-type row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultBatchMocks()
    mockDb.$queryRaw
      .mockResolvedValueOnce([]) // timedOutRows
      .mockResolvedValueOnce([]) // declinedLeadRows
      .mockResolvedValueOnce([]) // dailyJobRows
  })

  it('a SUBURB row in the same region but a different suburb does NOT cover the address', async () => {
    mockDb.technicianServiceArea.findMany.mockResolvedValue([SUBURB_ROW_OTHER_SUBURB_SAME_REGION])

    const { eligible, filteredOut } = await filterEligibleProviders([makeCandidate()], makeStructuredJobRequest())

    expect(eligible).toHaveLength(0)
    expect(filteredOut.find((f) => f.providerId === 'p1')?.filteredReasonCodes).toContain('OUTSIDE_SERVICE_AREA')
  })

  it('a REGION row for the same region covers the address at tier REGION_FALLBACK', async () => {
    mockDb.technicianServiceArea.findMany.mockResolvedValue([REGION_ROW_SAME_REGION])

    const { eligible } = await filterEligibleProviders([makeCandidate()], makeStructuredJobRequest())

    expect(eligible).toHaveLength(1)
    expect(eligible[0].coverageTier).toBe('REGION_FALLBACK')
  })

  it('an exact SUBURB row wins over a REGION row (tier SUBURB_EXACT)', async () => {
    mockDb.technicianServiceArea.findMany.mockResolvedValue([REGION_ROW_SAME_REGION, SUBURB_ROW_EXACT])

    const { eligible } = await filterEligibleProviders([makeCandidate()], makeStructuredJobRequest())

    expect(eligible).toHaveLength(1)
    expect(eligible[0].coverageTier).toBe('SUBURB_EXACT')
  })

  it('an inactive REGION row for the same region does NOT cover the address', async () => {
    mockDb.technicianServiceArea.findMany.mockResolvedValue([{ ...REGION_ROW_SAME_REGION, active: false }])

    const { eligible, filteredOut } = await filterEligibleProviders([makeCandidate()], makeStructuredJobRequest())

    expect(eligible).toHaveLength(0)
    expect(filteredOut.find((f) => f.providerId === 'p1')?.filteredReasonCodes).toContain('OUTSIDE_SERVICE_AREA')
  })
})
```

- [ ] **Step 2: Run the file to verify the new block fails**

Run: `pnpm vitest run __tests__/lib/matching-filter.test.ts`
Expected: FAIL — `a SUBURB row in the same region but a different suburb does NOT cover the address` fails with `expected [ { id: 'p1', … } ] to have a length of 0 but got 1`. The other three new cases and all pre-existing cases PASS.

- [ ] **Step 3: Require the REGION type in Tier 2b**

In `field-service/lib/matching/filter.ts` replace lines 247-254
```ts
  // Tier 2 - structured path
  if (address.locationNodeId != null) {
    if (activeAreas.some((a) => a.locationNodeId === address.locationNodeId)) {
      return { covers: true, tier: 'SUBURB_EXACT' }
    }
    if (address.regionKey != null && activeAreas.some((a) => a.regionKey === address.regionKey)) {
      return { covers: true, tier: 'REGION_FALLBACK' }
    }
    return { covers: false, tier: 'NO_MATCH' }
  }
```
with
```ts
  // Tier 2 - structured path
  if (address.locationNodeId != null) {
    // Tier 2a - SUBURB_EXACT: provider has a row with matching locationNodeId
    if (activeAreas.some((a) => a.locationNodeId === address.locationNodeId)) {
      return { covers: true, tier: 'SUBURB_EXACT' }
    }
    // Tier 2b - REGION_FALLBACK: provider has an actual REGION coverage row for
    // the same region. A SUBURB row that merely carries a denormalised regionKey
    // must NOT confer region-wide coverage — otherwise a provider who configured a
    // single suburb would receive leads across the whole region. Mirrors
    // lib/matching/service.ts Tier 2b and lib/matching-engine.ts.
    if (
      address.regionKey != null &&
      activeAreas.some((a) => a.areaType === 'REGION' && a.regionKey === address.regionKey)
    ) {
      return { covers: true, tier: 'REGION_FALLBACK' }
    }
    return { covers: false, tier: 'NO_MATCH' }
  }
```

- [ ] **Step 4: Run the matching tests and typecheck**

Run: `pnpm vitest run __tests__/lib/matching-filter.test.ts __tests__/lib/matching-filter-pilot.test.ts __tests__/lib/matching-service-area.test.ts __tests__/lib/matching-orchestrator.test.ts && pnpm typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/matching/filter.ts __tests__/lib/matching-filter.test.ts
git commit -m "fix(matching): REGION_FALLBACK coverage requires a REGION-type service-area row

filter.ts granted region-wide coverage to any active row sharing the
address's regionKey, unlike service.ts and matching-engine.ts which
require areaType REGION. Align it before whole-region service areas
become selectable, so a one-suburb provider never covers a whole region.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §D

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 4: `reactivate-service-areas-national.ts` — resync existing fence-inactive rows

**Files:**
- Create: `field-service/scripts/reactivate-service-areas-national.ts`
- Test: `field-service/__tests__/scripts/reactivate-service-areas-national.test.ts`

**Interfaces:**
- Consumes: Prisma delegates `technicianServiceArea.findMany/updateMany`, `provider.findMany`, `adminUser.findUnique`, `auditLog.create`, `adminAuditEvent.create`, `$transaction(fn)`; `AUDIT_ENTITY.PROVIDER` (`'Provider'`) from `../lib/audit-entities`; `rebuildCandidatePoolForProvider(providerId: string): Promise<void>` from `../lib/matching/candidate-pool`; `db` from `../lib/db`.
- Produces (exported, unit-tested, used only by this script's `main()` and by the rollout runbook):
  - `PRE_ROLLOUT_MATCHING_REGION_KEYS: readonly string[]` = `['jhb_west']` — the only region the old gate ever wrote ACTIVE, so an inactive row there can only be a deliberate removal.
  - `REVIEW_TOUCH_THRESHOLD_MS = 60_000`
  - `isPreRolloutMatchingRegion(regionKey: string | null): boolean`
  - `needsReview(row: { createdAt: Date; updatedAt: Date }, thresholdMs?: number): boolean` — true when `updatedAt - createdAt > thresholdMs`
  - `type InactiveAreaRow = { id: string; providerId: string; label: string; regionKey: string | null; areaType: string; createdAt: Date; updatedAt: Date; locationNode: { id: string; active: boolean } | null }`
  - `type ProviderRow = { id: string; name: string; status: string; activeAreaCount: number }`
  - `type PlannedRow = { id: string; label: string; regionKey: string | null; areaType: string; review: boolean }`
  - `type SkippedRow = { id: string; label: string; regionKey: string | null; reason: 'pre_rollout_region' | 'inactive_node' }`
  - `type ProviderPlan = { providerId: string; name: string; status: string; activate: PlannedRow[]; skipped: SkippedRow[]; gainsFirstActiveRow: boolean; needsReview: boolean }`
  - `type ReactivationPlan = { providers: ProviderPlan[]; totalRows: number; totalsByRegion: Record<string, number>; providersGainingFirstActiveRow: string[]; providersNeedingReview: string[] }`
  - `planReactivation(rows: InactiveAreaRow[], providers: ProviderRow[], now?: Date): ReactivationPlan` (pure)
  - `type Scope = { providerIds: string[] | null; excludeProviderIds: string[] | null }`
  - `loadReactivationInputs(client: LoadClient, scope: Scope): Promise<{ rows: InactiveAreaRow[]; providers: ProviderRow[] }>`
  - `type AdminActor = { id: string; userId: string; role: string }`
  - `executeReactivation(input: { plan: ReactivationPlan; commit: boolean; admin: AdminActor | null; client: ExecuteClient; rebuildPool: (providerId: string) => Promise<void> }): Promise<{ committedProviders: number; committedRows: number }>`
  - `parseArgs(argv: string[]): { commit: boolean; adminEmail: string | null } & Scope`
  - `formatPlan(plan: ReactivationPlan, commit: boolean): string`
  - CLI: `pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts [--providers a,b,c] [--exclude-providers d,e] [--commit --admin-email <email>]`; audit action string `provider.service_areas.reactivate_national`.

**Selection rule (replaces the spec's label test — Part B found that the profile editor in `app/(provider)/provider/profile/actions.ts` only flips `TechnicianServiceArea.active`, so a row's label cannot tell a deliberate removal from a fence-inactive row):**
1. Candidate = `technician_service_areas` row with `active = false`, `locationNodeId` not null, whose `LocationNode.active = true`.
2. Skip every candidate whose `regionKey` is in `PRE_ROLLOUT_MATCHING_REGION_KEYS` (`jhb_west`): the fence never wrote `jhb_west` rows inactive, so such a row is a deliberate removal.
3. Re-activate every other candidate (written inactive by the fence in `lib/provider-record.ts`).
4. Mark a candidate `review` when `updatedAt` is more than 60 s after `createdAt` (touched after creation — possibly a deliberate removal, but autosync also bumps `updatedAt`, so this is information for the owner, not a filter). `--exclude-providers` lets the owner drop flagged providers before `--commit`.

**Residual risk: an out-of-fence area a provider removed via the profile editor is re-activated; they can remove it again in the profile editor.**

- [ ] **Step 1: Write the failing tests**

Create `field-service/__tests__/scripts/reactivate-service-areas-national.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  PRE_ROLLOUT_MATCHING_REGION_KEYS,
  REVIEW_TOUCH_THRESHOLD_MS,
  isPreRolloutMatchingRegion,
  needsReview,
  planReactivation,
  loadReactivationInputs,
  executeReactivation,
  parseArgs,
  type InactiveAreaRow,
  type ProviderRow,
} from '../../scripts/reactivate-service-areas-national'

const T0 = new Date('2026-07-20T10:00:00Z')
const ACTIVE_NODE = { id: 'node-sandton', active: true }
const INACTIVE_NODE = { id: 'node-paused', active: false }

function row(overrides: Partial<InactiveAreaRow> = {}): InactiveAreaRow {
  return {
    id: 'tsa-1',
    providerId: 'prov-1',
    label: 'Sandton',
    regionKey: 'jhb_north',
    areaType: 'SUBURB',
    createdAt: T0,
    updatedAt: T0,
    locationNode: ACTIVE_NODE,
    ...overrides,
  }
}

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return { id: 'prov-1', name: 'Thabo Plumbing', status: 'ACTIVE', activeAreaCount: 0, ...overrides }
}

const plus = (ms: number) => new Date(T0.getTime() + ms)

describe('constants and predicates', () => {
  it('names jhb_west as the only pre-rollout matching region', () => {
    expect(PRE_ROLLOUT_MATCHING_REGION_KEYS).toEqual(['jhb_west'])
    expect(isPreRolloutMatchingRegion('jhb_west')).toBe(true)
    expect(isPreRolloutMatchingRegion('JHB_WEST')).toBe(true)
    expect(isPreRolloutMatchingRegion('jhb_north')).toBe(false)
    expect(isPreRolloutMatchingRegion(null)).toBe(false)
  })

  it('needsReview is true only when updatedAt is more than 60 s after createdAt', () => {
    expect(REVIEW_TOUCH_THRESHOLD_MS).toBe(60_000)
    expect(needsReview({ createdAt: T0, updatedAt: T0 })).toBe(false)
    expect(needsReview({ createdAt: T0, updatedAt: plus(59_000) })).toBe(false)
    expect(needsReview({ createdAt: T0, updatedAt: plus(60_000) })).toBe(false)
    expect(needsReview({ createdAt: T0, updatedAt: plus(60_001) })).toBe(true)
  })
})

describe('planReactivation', () => {
  it('activates a jhb_north inactive row (written inactive by the fence)', () => {
    const plan = planReactivation([row()], [provider()])
    expect(plan.providers).toHaveLength(1)
    expect(plan.providers[0].activate).toEqual([
      { id: 'tsa-1', label: 'Sandton', regionKey: 'jhb_north', areaType: 'SUBURB', review: false },
    ])
    expect(plan.providers[0].skipped).toEqual([])
    expect(plan.providers[0].gainsFirstActiveRow).toBe(true)
    expect(plan.providers[0].needsReview).toBe(false)
    expect(plan.totalRows).toBe(1)
    expect(plan.totalsByRegion).toEqual({ jhb_north: 1 })
    expect(plan.providersGainingFirstActiveRow).toEqual(['prov-1'])
    expect(plan.providersNeedingReview).toEqual([])
  })

  it('skips a jhb_west inactive row as a pre-rollout-region removal', () => {
    const plan = planReactivation(
      [row({ id: 'tsa-w', label: 'Florida', regionKey: 'jhb_west', locationNode: { id: 'node-florida', active: true } })],
      [provider()],
    )
    expect(plan.providers[0].activate).toEqual([])
    expect(plan.providers[0].skipped).toEqual([
      { id: 'tsa-w', label: 'Florida', regionKey: 'jhb_west', reason: 'pre_rollout_region' },
    ])
    expect(plan.totalRows).toBe(0)
  })

  it('skips a row whose node is inactive or missing', () => {
    const plan = planReactivation(
      [
        row({ id: 'tsa-3', label: 'Sandton', locationNode: INACTIVE_NODE }),
        row({ id: 'tsa-4', label: 'Rosebank', locationNode: null }),
      ],
      [provider()],
    )
    expect(plan.providers[0].activate).toEqual([])
    expect(plan.providers[0].skipped.map((s) => s.reason)).toEqual(['inactive_node', 'inactive_node'])
  })

  it('flags review when the row was touched more than 60 s after creation, and not otherwise', () => {
    const plan = planReactivation(
      [
        row({ id: 'touched', updatedAt: plus(5 * 60_000) }),
        row({ id: 'fresh', label: 'Rosebank', updatedAt: plus(30_000) }),
      ],
      [provider()],
    )
    const byId = Object.fromEntries(plan.providers[0].activate.map((r) => [r.id, r.review]))
    expect(byId).toEqual({ touched: true, fresh: false })
    expect(plan.providers[0].needsReview).toBe(true)
    expect(plan.providersNeedingReview).toEqual(['prov-1'])
  })

  it('does not report gainsFirstActiveRow for a provider who already has an active row', () => {
    const plan = planReactivation([row()], [provider({ activeAreaCount: 2 })])
    expect(plan.providers[0].gainsFirstActiveRow).toBe(false)
    expect(plan.providersGainingFirstActiveRow).toEqual([])
  })

  it('groups rows per provider, keeps REGION rows, and sums regions across providers', () => {
    const plan = planReactivation(
      [
        row({ id: 'a', providerId: 'prov-1', label: 'Sandton', regionKey: 'jhb_north' }),
        row({ id: 'b', providerId: 'prov-2', label: 'Benoni', regionKey: 'east_rand' }),
        row({ id: 'c', providerId: 'prov-2', label: 'East Rand / Ekurhuleni', regionKey: 'east_rand', areaType: 'REGION' }),
      ],
      [provider(), provider({ id: 'prov-2', name: 'Sipho Tiling' })],
    )
    expect(plan.providers.map((p) => p.providerId)).toEqual(['prov-1', 'prov-2'])
    expect(plan.providers[1].activate.map((r) => r.areaType)).toEqual(['SUBURB', 'REGION'])
    expect(plan.totalsByRegion).toEqual({ jhb_north: 1, east_rand: 2 })
    expect(plan.totalRows).toBe(3)
  })

  it('still reports a provider whose rows are all skipped, with zero totals', () => {
    const plan = planReactivation([row({ regionKey: 'jhb_west' })], [provider()])
    expect(plan.providers).toHaveLength(1)
    expect(plan.totalRows).toBe(0)
  })
})

describe('parseArgs', () => {
  it('parses --providers, --exclude-providers, --commit and --admin-email', () => {
    expect(parseArgs(['--providers', 'a,b', '--exclude-providers', 'c', '--commit', '--admin-email', 'o@x.za'])).toEqual({
      providerIds: ['a', 'b'],
      excludeProviderIds: ['c'],
      commit: true,
      adminEmail: 'o@x.za',
    })
    expect(parseArgs([])).toEqual({ providerIds: null, excludeProviderIds: null, commit: false, adminEmail: null })
  })
})

describe('loadReactivationInputs', () => {
  const SELECT = {
    id: true,
    providerId: true,
    label: true,
    regionKey: true,
    areaType: true,
    createdAt: true,
    updatedAt: true,
    locationNode: { select: { id: true, active: true } },
  }

  function makeClient() {
    return {
      technicianServiceArea: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([row()]) // inactive candidates
          .mockResolvedValueOnce([{ providerId: 'prov-1' }, { providerId: 'prov-1' }]), // active rows
      },
      provider: {
        findMany: vi.fn().mockResolvedValue([{ id: 'prov-1', name: 'Thabo Plumbing', status: 'ACTIVE' }]),
      },
    }
  }

  it('selects inactive rows with a node for all providers by default and counts active rows', async () => {
    const client = makeClient()
    const { rows, providers } = await loadReactivationInputs(client as never, { providerIds: null, excludeProviderIds: null })
    expect(client.technicianServiceArea.findMany).toHaveBeenNthCalledWith(1, {
      where: { active: false, locationNodeId: { not: null } },
      select: SELECT,
    })
    expect(rows).toHaveLength(1)
    expect(providers).toEqual([{ id: 'prov-1', name: 'Thabo Plumbing', status: 'ACTIVE', activeAreaCount: 2 }])
  })

  it('--providers restricts the candidate query', async () => {
    const client = makeClient()
    await loadReactivationInputs(client as never, { providerIds: ['prov-1', 'prov-9'], excludeProviderIds: null })
    expect(client.technicianServiceArea.findMany).toHaveBeenNthCalledWith(1, {
      where: { active: false, locationNodeId: { not: null }, providerId: { in: ['prov-1', 'prov-9'] } },
      select: SELECT,
    })
  })

  it('--exclude-providers excludes from the candidate query', async () => {
    const client = makeClient()
    await loadReactivationInputs(client as never, { providerIds: null, excludeProviderIds: ['prov-7'] })
    expect(client.technicianServiceArea.findMany).toHaveBeenNthCalledWith(1, {
      where: { active: false, locationNodeId: { not: null }, providerId: { notIn: ['prov-7'] } },
      select: SELECT,
    })
  })

  it('combines --providers and --exclude-providers', async () => {
    const client = makeClient()
    await loadReactivationInputs(client as never, { providerIds: ['a', 'b'], excludeProviderIds: ['b'] })
    expect(client.technicianServiceArea.findMany).toHaveBeenNthCalledWith(1, {
      where: { active: false, locationNodeId: { not: null }, providerId: { in: ['a', 'b'], notIn: ['b'] } },
      select: SELECT,
    })
  })
})

describe('executeReactivation', () => {
  function makeExecClient() {
    const tx = {
      technicianServiceArea: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const client = {
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    return { client, tx }
  }
  const admin = { id: 'admin-1', userId: 'auth-user-1', role: 'OWNER' }
  const plan = planReactivation([row()], [provider()])

  it('dry-run writes nothing and rebuilds nothing', async () => {
    const { client, tx } = makeExecClient()
    const rebuildPool = vi.fn()
    const result = await executeReactivation({ plan, commit: false, admin: null, client: client as never, rebuildPool })
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(tx.technicianServiceArea.updateMany).not.toHaveBeenCalled()
    expect(rebuildPool).not.toHaveBeenCalled()
    expect(result).toEqual({ committedProviders: 0, committedRows: 0 })
  })

  it('refuses to commit without an admin actor', async () => {
    const { client } = makeExecClient()
    await expect(
      executeReactivation({ plan, commit: true, admin: null, client: client as never, rebuildPool: vi.fn() }),
    ).rejects.toThrow('--admin-email is required with --commit')
  })

  it('--commit writes active=true for the planned rows, one AuditLog + AdminAuditEvent pair per provider, and rebuilds the pool', async () => {
    const { client, tx } = makeExecClient()
    const rebuildPool = vi.fn().mockResolvedValue(undefined)
    const result = await executeReactivation({ plan, commit: true, admin, client: client as never, rebuildPool })

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.technicianServiceArea.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tsa-1'] } },
      data: { active: true },
    })
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'auth-user-1',
        actorRole: 'OWNER',
        action: 'provider.service_areas.reactivate_national',
        entityType: 'Provider',
        entityId: 'prov-1',
        before: { inactiveRowIds: ['tsa-1'] },
        after: { activeRowIds: ['tsa-1'], regionKeys: ['jhb_north'] },
      }),
    })
    expect(tx.adminAuditEvent.create).toHaveBeenCalledTimes(1)
    expect(tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: 'provider.service_areas.reactivate_national',
        entityType: 'Provider',
        entityId: 'prov-1',
        metadata: {
          script: 'reactivate-service-areas-national',
          reason: 'national rollout (spec 2026-10-03)',
          skippedPreRolloutRowIds: [],
          reviewFlaggedRowIds: [],
        },
      }),
    })
    expect(rebuildPool).toHaveBeenCalledWith('prov-1')
    expect(result).toEqual({ committedProviders: 1, committedRows: 1 })
  })

  it('skips providers with nothing to activate (e.g. only jhb_west removals)', async () => {
    const { client } = makeExecClient()
    const emptyPlan = planReactivation([row({ regionKey: 'jhb_west' })], [provider()])
    const rebuildPool = vi.fn()
    const result = await executeReactivation({ plan: emptyPlan, commit: true, admin, client: client as never, rebuildPool })
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(rebuildPool).not.toHaveBeenCalled()
    expect(result).toEqual({ committedProviders: 0, committedRows: 0 })
  })
})

describe('idempotency and REGION rows (review focus)', () => {
  type TableRow = InactiveAreaRow & { active: boolean }

  /** In-memory stand-in for the delegates the script touches, so a real
   *  load → plan → execute → load cycle runs without a database. */
  function makeInMemoryClient(seed: TableRow[]) {
    const table: TableRow[] = seed.map((r) => ({ ...r }))
    const auditLog: unknown[] = []
    const adminAuditEvent: unknown[] = []
    const tx = {
      technicianServiceArea: {
        updateMany: vi.fn(async (args: { where: { id: { in: string[] } }; data: { active: boolean } }) => {
          let count = 0
          for (const r of table) {
            if (args.where.id.in.includes(r.id)) {
              r.active = args.data.active
              count += 1
            }
          }
          return { count }
        }),
      },
      auditLog: {
        create: vi.fn(async (args: unknown) => {
          auditLog.push(args)
          return {}
        }),
      },
      adminAuditEvent: {
        create: vi.fn(async (args: unknown) => {
          adminAuditEvent.push(args)
          return {}
        }),
      },
    }
    const client = {
      technicianServiceArea: {
        findMany: vi.fn(async (args: { where: { active: boolean } }) => table.filter((r) => r.active === args.where.active)),
      },
      provider: {
        findMany: vi.fn(async () => [{ id: 'prov-1', name: 'Thabo Plumbing', status: 'ACTIVE' }]),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    }
    return { client, table, auditLog, adminAuditEvent }
  }

  const admin = { id: 'admin-1', userId: 'auth-user-1', role: 'OWNER' }
  const scope = { providerIds: null, excludeProviderIds: null }

  it('a second run after --commit selects zero candidates and writes no audit rows (idempotent)', async () => {
    const store = makeInMemoryClient([{ ...row(), active: false }])
    const rebuildPool = vi.fn().mockResolvedValue(undefined)

    const first = await loadReactivationInputs(store.client as never, scope)
    const plan1 = planReactivation(first.rows, first.providers)
    const r1 = await executeReactivation({ plan: plan1, commit: true, admin, client: store.client as never, rebuildPool })
    expect(r1).toEqual({ committedProviders: 1, committedRows: 1 })
    expect(store.table[0].active).toBe(true)
    expect(store.auditLog).toHaveLength(1)
    expect(store.adminAuditEvent).toHaveLength(1)

    const second = await loadReactivationInputs(store.client as never, scope)
    expect(second.rows).toEqual([])
    const plan2 = planReactivation(second.rows, second.providers)
    expect(plan2.providers).toEqual([])
    expect(plan2.totalRows).toBe(0)
    const r2 = await executeReactivation({ plan: plan2, commit: true, admin, client: store.client as never, rebuildPool })
    expect(r2).toEqual({ committedProviders: 0, committedRows: 0 })
    expect(store.auditLog).toHaveLength(1)
    expect(store.adminAuditEvent).toHaveLength(1)
    expect(rebuildPool).toHaveBeenCalledTimes(1)
  })

  it('re-activates an inactive REGION-type row (whole-region fallback) exactly like a SUBURB row', async () => {
    const regionRow: TableRow = {
      ...row({
        id: 'tsa-region',
        label: 'Cape Town CBD',
        regionKey: 'cape_town_cbd',
        areaType: 'REGION',
        locationNode: { id: 'node-ct-cbd', active: true },
      }),
      active: false,
    }
    const store = makeInMemoryClient([regionRow])
    const { rows, providers } = await loadReactivationInputs(store.client as never, scope)
    const plan = planReactivation(rows, providers)
    expect(plan.providers[0].activate).toEqual([
      { id: 'tsa-region', label: 'Cape Town CBD', regionKey: 'cape_town_cbd', areaType: 'REGION', review: false },
    ])
    expect(plan.providers[0].skipped).toEqual([])
    expect(plan.totalsByRegion).toEqual({ cape_town_cbd: 1 })

    const result = await executeReactivation({
      plan,
      commit: true,
      admin,
      client: store.client as never,
      rebuildPool: vi.fn().mockResolvedValue(undefined),
    })
    expect(result).toEqual({ committedProviders: 1, committedRows: 1 })
    expect(store.table[0].active).toBe(true)
    expect(store.auditLog).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `pnpm vitest run __tests__/scripts/reactivate-service-areas-national.test.ts`
Expected: FAIL with `Failed to load url ../../scripts/reactivate-service-areas-national` (module not found).

- [ ] **Step 3: Write the script**

Create `field-service/scripts/reactivate-service-areas-national.ts`:

```ts
/**
 * National rollout (spec docs/superpowers/specs/2026-10-03-national-rollout-design.md):
 * re-activate TechnicianServiceArea rows that the old jhb_west matching gate
 * (lib/provider-record.ts, removed in this PR) wrote with active=false.
 *
 * Selection rule:
 *   1. Candidate = row with active=false, locationNodeId not null, whose
 *      LocationNode is still active.
 *   2. SKIP candidates whose regionKey is in PRE_ROLLOUT_MATCHING_REGION_KEYS
 *      (jhb_west). The gate never wrote jhb_west rows inactive, so an inactive
 *      jhb_west row can only be a deliberate removal (profile editor / admin).
 *   3. Re-activate every other candidate.
 *   4. Mark "review" any candidate whose updatedAt is > 60 s after createdAt:
 *      it was touched after creation and MAY be a deliberate removal (autosync
 *      also bumps updatedAt, so this is information, not a filter). Drop such
 *      providers with --exclude-providers before --commit if in doubt.
 *
 * Residual risk: an out-of-fence area a provider removed via the profile editor
 * is re-activated; they can remove it again in the profile editor.
 * (The profile editor only flips TechnicianServiceArea.active, so no column
 * on the provider distinguishes a removal from a fence-inactive row.)
 *
 * Default is DRY-RUN. Nothing is written without --commit, and --commit needs
 * --admin-email so the AuditLog + AdminAuditEvent pair has a real actor.
 *
 * Flags:
 *   --providers a,b,c          restrict to these provider ids (also how to
 *                              resync after an admin pauses a region's node)
 *   --exclude-providers d,e    leave these providers out (review-flagged ones)
 *   --commit                   apply (one transaction per provider, then
 *                              rebuild that provider's candidate-pool rows)
 *   --admin-email <email>      AdminUser.email of the operator (with --commit)
 *
 * Env: DATABASE_URL via --env-file=.env.local (repo convention, see package.json
 * seed:test-leads); `dotenv` is not a dependency of field-service.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts
 *   pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts \
 *     --exclude-providers <ids flagged for review> --commit --admin-email owner@plugapro.co.za
 */
import type { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { AUDIT_ENTITY } from '../lib/audit-entities'
import { rebuildCandidatePoolForProvider } from '../lib/matching/candidate-pool'

export const REACTIVATE_AUDIT_ACTION = 'provider.service_areas.reactivate_national'
export const PRE_ROLLOUT_MATCHING_REGION_KEYS: readonly string[] = ['jhb_west']
export const REVIEW_TOUCH_THRESHOLD_MS = 60_000
const AUDIT_REASON = 'national rollout (spec 2026-10-03)'
const SCRIPT_NAME = 'reactivate-service-areas-national'

export type InactiveAreaRow = {
  id: string
  providerId: string
  label: string
  regionKey: string | null
  areaType: string
  createdAt: Date
  updatedAt: Date
  locationNode: { id: string; active: boolean } | null
}

export type ProviderRow = { id: string; name: string; status: string; activeAreaCount: number }

export type PlannedRow = { id: string; label: string; regionKey: string | null; areaType: string; review: boolean }
export type SkippedRow = {
  id: string
  label: string
  regionKey: string | null
  reason: 'pre_rollout_region' | 'inactive_node'
}

export type ProviderPlan = {
  providerId: string
  name: string
  status: string
  activate: PlannedRow[]
  skipped: SkippedRow[]
  gainsFirstActiveRow: boolean
  needsReview: boolean
}

export type ReactivationPlan = {
  providers: ProviderPlan[]
  totalRows: number
  totalsByRegion: Record<string, number>
  providersGainingFirstActiveRow: string[]
  providersNeedingReview: string[]
}

export type Scope = { providerIds: string[] | null; excludeProviderIds: string[] | null }
export type AdminActor = { id: string; userId: string; role: string }

type LoadClient = {
  technicianServiceArea: { findMany: (args: unknown) => Promise<unknown[]> }
  provider: { findMany: (args: unknown) => Promise<unknown[]> }
}

type ExecuteTx = {
  technicianServiceArea: { updateMany: (args: unknown) => Promise<unknown> }
  auditLog: { create: (args: unknown) => Promise<unknown> }
  adminAuditEvent: { create: (args: unknown) => Promise<unknown> }
}

type ExecuteClient = {
  $transaction: (fn: (tx: ExecuteTx) => Promise<void>) => Promise<void>
}

export function isPreRolloutMatchingRegion(regionKey: string | null): boolean {
  if (!regionKey) return false
  return PRE_ROLLOUT_MATCHING_REGION_KEYS.includes(regionKey.trim().toLowerCase())
}

export function needsReview(
  row: { createdAt: Date; updatedAt: Date },
  thresholdMs: number = REVIEW_TOUCH_THRESHOLD_MS,
): boolean {
  return row.updatedAt.getTime() - row.createdAt.getTime() > thresholdMs
}

export function planReactivation(rows: InactiveAreaRow[], providers: ProviderRow[]): ReactivationPlan {
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const rowsByProvider = new Map<string, InactiveAreaRow[]>()
  for (const r of rows) {
    const list = rowsByProvider.get(r.providerId) ?? []
    list.push(r)
    rowsByProvider.set(r.providerId, list)
  }

  const plans: ProviderPlan[] = []
  const totalsByRegion: Record<string, number> = {}
  let totalRows = 0

  for (const [providerId, providerRows] of rowsByProvider) {
    const prov = providerById.get(providerId)
    if (!prov) continue

    const plan: ProviderPlan = {
      providerId,
      name: prov.name,
      status: prov.status,
      activate: [],
      skipped: [],
      gainsFirstActiveRow: false,
      needsReview: false,
    }

    for (const r of providerRows) {
      if (!r.locationNode || !r.locationNode.active) {
        plan.skipped.push({ id: r.id, label: r.label, regionKey: r.regionKey, reason: 'inactive_node' })
        continue
      }
      if (isPreRolloutMatchingRegion(r.regionKey)) {
        plan.skipped.push({ id: r.id, label: r.label, regionKey: r.regionKey, reason: 'pre_rollout_region' })
        continue
      }
      const review = needsReview(r)
      plan.activate.push({ id: r.id, label: r.label, regionKey: r.regionKey, areaType: r.areaType, review })
      if (review) plan.needsReview = true
      const region = r.regionKey ?? '(no region)'
      totalsByRegion[region] = (totalsByRegion[region] ?? 0) + 1
      totalRows += 1
    }

    plan.gainsFirstActiveRow = plan.activate.length > 0 && prov.activeAreaCount === 0
    plans.push(plan)
  }

  return {
    providers: plans,
    totalRows,
    totalsByRegion,
    providersGainingFirstActiveRow: plans.filter((p) => p.gainsFirstActiveRow).map((p) => p.providerId),
    providersNeedingReview: plans.filter((p) => p.needsReview).map((p) => p.providerId),
  }
}

export async function loadReactivationInputs(
  client: LoadClient,
  scope: Scope,
): Promise<{ rows: InactiveAreaRow[]; providers: ProviderRow[] }> {
  const providerFilter =
    scope.providerIds || scope.excludeProviderIds
      ? {
          providerId: {
            ...(scope.providerIds ? { in: scope.providerIds } : {}),
            ...(scope.excludeProviderIds ? { notIn: scope.excludeProviderIds } : {}),
          },
        }
      : {}

  const rows = (await client.technicianServiceArea.findMany({
    where: { active: false, locationNodeId: { not: null }, ...providerFilter },
    select: {
      id: true,
      providerId: true,
      label: true,
      regionKey: true,
      areaType: true,
      createdAt: true,
      updatedAt: true,
      locationNode: { select: { id: true, active: true } },
    },
  })) as InactiveAreaRow[]

  const ids = [...new Set(rows.map((r) => r.providerId))]
  if (ids.length === 0) return { rows, providers: [] }

  const activeRows = (await client.technicianServiceArea.findMany({
    where: { providerId: { in: ids }, active: true },
    select: { providerId: true },
  })) as Array<{ providerId: string }>
  const activeCount = new Map<string, number>()
  for (const a of activeRows) activeCount.set(a.providerId, (activeCount.get(a.providerId) ?? 0) + 1)

  const providers = (await client.provider.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true },
  })) as Array<{ id: string; name: string; status: string }>

  return {
    rows,
    providers: providers.map((p) => ({ ...p, activeAreaCount: activeCount.get(p.id) ?? 0 })),
  }
}

export async function executeReactivation(input: {
  plan: ReactivationPlan
  commit: boolean
  admin: AdminActor | null
  client: ExecuteClient
  rebuildPool: (providerId: string) => Promise<void>
}): Promise<{ committedProviders: number; committedRows: number }> {
  if (!input.commit) return { committedProviders: 0, committedRows: 0 }
  if (!input.admin) throw new Error('--admin-email is required with --commit')
  const admin = input.admin

  let committedProviders = 0
  let committedRows = 0
  for (const p of input.plan.providers) {
    if (p.activate.length === 0) continue
    const rowIds = p.activate.map((r) => r.id)
    const regionKeys = [...new Set(p.activate.map((r) => r.regionKey ?? '(no region)'))]
    const before = { inactiveRowIds: rowIds } as Prisma.InputJsonValue
    const after = { activeRowIds: rowIds, regionKeys } as Prisma.InputJsonValue
    const metadata = {
      script: SCRIPT_NAME,
      reason: AUDIT_REASON,
      skippedPreRolloutRowIds: p.skipped.filter((s) => s.reason === 'pre_rollout_region').map((s) => s.id),
      reviewFlaggedRowIds: p.activate.filter((r) => r.review).map((r) => r.id),
    } as Prisma.InputJsonValue

    await input.client.$transaction(async (tx) => {
      await tx.technicianServiceArea.updateMany({
        where: { id: { in: rowIds } },
        data: { active: true },
      })
      // Same pair crud-action.ts writes for every admin mutation.
      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorRole: admin.role,
          action: REACTIVATE_AUDIT_ACTION,
          entityType: AUDIT_ENTITY.PROVIDER,
          entityId: p.providerId,
          before,
          after,
          reason: AUDIT_REASON,
        },
      })
      await tx.adminAuditEvent.create({
        data: {
          adminId: admin.id,
          action: REACTIVATE_AUDIT_ACTION,
          entityType: AUDIT_ENTITY.PROVIDER,
          entityId: p.providerId,
          before,
          after,
          metadata,
        },
      })
    })
    await input.rebuildPool(p.providerId)
    committedProviders += 1
    committedRows += rowIds.length
  }
  return { committedProviders, committedRows }
}

export function formatPlan(plan: ReactivationPlan, commit: boolean): string {
  const verb = commit ? 'activated' : 'would activate'
  const lines: string[] = []
  lines.push(`--- ${SCRIPT_NAME} --- mode=${commit ? 'COMMIT' : 'DRY-RUN'}`)
  for (const p of plan.providers) {
    lines.push(
      `\n${p.providerId}  ${p.name}  status=${p.status}  ${verb}=${p.activate.length}  skipped=${p.skipped.length}` +
        (p.gainsFirstActiveRow ? '  ★ first active row' : '') +
        (p.needsReview ? '  ⚠ REVIEW (rows touched after creation)' : ''),
    )
    for (const r of p.activate) {
      lines.push(`    + ${r.label}  (${r.regionKey ?? '-'}, ${r.areaType})${r.review ? '  ⚠ review' : ''}`)
    }
    for (const s of p.skipped) {
      const why = s.reason === 'pre_rollout_region' ? 'pre-rollout region (jhb_west) → treated as deliberate removal' : 'node inactive/missing'
      lines.push(`    · skip ${s.label}  (${s.regionKey ?? '-'})  ${why}`)
    }
  }
  lines.push('')
  lines.push('totals by region:')
  for (const [region, n] of Object.entries(plan.totalsByRegion).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${region.padEnd(20)} ${n}`)
  }
  lines.push(`rows ${verb}: ${plan.totalRows}`)
  lines.push(`providers gaining their first active row: ${plan.providersGainingFirstActiveRow.length}`)
  lines.push(`providers flagged for review: ${plan.providersNeedingReview.length}${plan.providersNeedingReview.length ? ' → ' + plan.providersNeedingReview.join(',') : ''}`)
  if (!commit) {
    lines.push('\n(dry-run; pass --commit --admin-email <email> to apply; use --exclude-providers <ids> to drop review-flagged providers)')
  }
  return lines.join('\n')
}

function listArg(argv: string[], flag: string): string[] | null {
  const idx = argv.indexOf(flag)
  if (idx < 0 || !argv[idx + 1]) return null
  const values = argv[idx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  return values.length > 0 ? values : null
}

export function parseArgs(argv: string[]): { commit: boolean; adminEmail: string | null } & Scope {
  const emailIdx = argv.indexOf('--admin-email')
  return {
    providerIds: listArg(argv, '--providers'),
    excludeProviderIds: listArg(argv, '--exclude-providers'),
    commit: argv.includes('--commit'),
    adminEmail: emailIdx >= 0 && argv[emailIdx + 1] ? argv[emailIdx + 1] : null,
  }
}

async function resolveAdmin(email: string): Promise<AdminActor> {
  const admin = await db.adminUser.findUnique({
    where: { email },
    select: { id: true, userId: true, role: true, active: true },
  })
  if (!admin || !admin.active) throw new Error(`No active AdminUser with email ${email}`)
  return { id: admin.id, userId: admin.userId, role: admin.role }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = args.commit && args.adminEmail ? await resolveAdmin(args.adminEmail) : null
  const { rows, providers } = await loadReactivationInputs(db as unknown as LoadClient, {
    providerIds: args.providerIds,
    excludeProviderIds: args.excludeProviderIds,
  })
  const plan = planReactivation(rows, providers)
  console.log(formatPlan(plan, args.commit))
  const result = await executeReactivation({
    plan,
    commit: args.commit,
    admin,
    client: db as unknown as ExecuteClient,
    rebuildPool: rebuildCandidatePoolForProvider,
  })
  if (args.commit) {
    console.log(`\ncommitted providers=${result.committedProviders} rows=${result.committedRows}; candidate pool rebuilt per provider`)
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    })
    .finally(() => db.$disconnect())
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run __tests__/scripts/reactivate-service-areas-national.test.ts && pnpm typecheck`
Expected: 20 tests PASS; typecheck clean. (`ExecuteTx`/`LoadClient` take `unknown` args by design so the mock clients type-check; the real `db` is cast once in `main()`.)

- [ ] **Step 5: Dry-run against the local database to see the output format**

Run: `pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts`
Expected: per-provider blocks with `+ label (regionKey, areaType)` lines (and `⚠ review` where touched), `· skip … pre-rollout region (jhb_west)` lines, the `totals by region:` block, `rows would activate: N`, `providers flagged for review: K → ids`, and the `(dry-run; …)` footer. No writes. Against an empty local DB the output is just the headers and `rows would activate: 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/reactivate-service-areas-national.ts __tests__/scripts/reactivate-service-areas-national.test.ts
git commit -m "feat(scripts): reactivate-service-areas-national — dry-run-first resync of fence-inactive rows

Re-activates TechnicianServiceArea rows the jhb_west gate wrote inactive.
Skips inactive jhb_west rows (PRE_ROLLOUT_MATCHING_REGION_KEYS): the gate
never wrote those inactive, so they are deliberate removals. Flags rows
touched >60s after creation for owner review and supports
--exclude-providers. --commit requires an AdminUser actor, writes the
AuditLog + AdminAuditEvent pair per provider and rebuilds that provider's
candidate pool. Residual risk: an out-of-fence area a provider removed in
the profile editor is re-activated; they can remove it again there.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §Data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

The production run (dry-run → owner reviews region totals against the spec table and the review-flagged list → optional `--exclude-providers` → `--commit --admin-email <owner>`) is rollout step 3, not part of the PR.

### Task 5: `backfill-suburb-postcodes.ts` — fill the 42 taxonomy suburbs without a postcode

**Files:**
- Create: `field-service/scripts/backfill-suburb-postcodes.ts`
- Modify: `field-service/lib/service-areas/postal-codes.ts` (generated file, rewritten by the script; header kept)
- Test: `field-service/__tests__/scripts/backfill-suburb-postcodes.test.ts`

**Interfaces:**
- Consumes: `SA_PROVINCES`, `REGION_CITY_MAP` from `../lib/service-areas/south-africa`; `SUBURB_POSTAL_CODES: Record<string, string>` from `../lib/service-areas/postal-codes`; `locationSlugPart(value: string): string` from `../lib/location-seed` (the seed builds suburb slugs as `${provinceKey}__${cityKey}__${regionKey}__${locationSlugPart(label)}`, `lib/location-seed.ts:233-234`); `reverseGeocodeCoordinates(point: GeoPoint): Promise<ReverseGeocodeResult | null>` and types `GeoPoint`, `ReverseGeocodeResult` from `../lib/geocoding` (Nominatim, 1 req/s limit).
- Produces (exported, unit-tested):
  - `type MissingSuburb = { slug: string; label: string; point: GeoPoint }`
  - `listSuburbsMissingPostcodes(known?: Record<string, string>): MissingSuburb[]` (sorted by slug)
  - `type Geocoder = (point: GeoPoint) => Promise<ReverseGeocodeResult | null>`
  - `resolvePostcodes(missing: MissingSuburb[], geocode: Geocoder, sleep: (ms: number) => Promise<void>, sleepMs?: number): Promise<{ resolved: Record<string, string>; unresolved: string[] }>` — only 4-digit results count
  - `renderPostalCodesFile(entries: Record<string, string>, manualSlugs?: ReadonlySet<string>): string` — header + entries in the object's insertion order (the current file is NOT alphabetically sorted, so preserving order keeps the regeneration diff minimal and the round-trip exact); manual entries carry a trailing `// manual`
  - `POSTAL_CODES_PATH` (absolute path of `lib/service-areas/postal-codes.ts`)
  - CLI: `pnpm exec tsx scripts/backfill-suburb-postcodes.ts [--dry-run]`

- [ ] **Step 1: Write the failing tests**

Create `field-service/__tests__/scripts/backfill-suburb-postcodes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  listSuburbsMissingPostcodes,
  resolvePostcodes,
  renderPostalCodesFile,
  type MissingSuburb,
} from '../../scripts/backfill-suburb-postcodes'
import { SUBURB_POSTAL_CODES } from '../../lib/service-areas/postal-codes'

const noSleep = async () => {}

describe('listSuburbsMissingPostcodes', () => {
  it('returns every taxonomy suburb slug absent from the known map, sorted, with its coordinates', () => {
    const missing = listSuburbsMissingPostcodes({})
    expect(missing.length).toBeGreaterThan(200)
    expect(missing.map((m) => m.slug)).toEqual([...missing.map((m) => m.slug)].sort())
    const florida = missing.find((m) => m.slug === 'gauteng__johannesburg__jhb_west__florida')
    expect(florida).toEqual({
      slug: 'gauteng__johannesburg__jhb_west__florida',
      label: 'Florida',
      point: { lat: expect.any(Number), lng: expect.any(Number) },
    })
  })

  it('skips slugs that already have a postcode', () => {
    const missing = listSuburbsMissingPostcodes(SUBURB_POSTAL_CODES)
    expect(missing.some((m) => m.slug in SUBURB_POSTAL_CODES)).toBe(false)
    // Multi-word labels use the seed slug rule (lowercase, non-alphanumerics → "_")
    expect(missing.map((m) => m.slug)).toContain('mpumalanga__mbombela__mbombela__white_river')
  })
})

describe('resolvePostcodes', () => {
  const missing: MissingSuburb[] = [
    { slug: 'a__a__a__one', label: 'One', point: { lat: -26, lng: 28 } },
    { slug: 'a__a__a__two', label: 'Two', point: { lat: -27, lng: 29 } },
    { slug: 'a__a__a__three', label: 'Three', point: { lat: -28, lng: 30 } },
    { slug: 'a__a__a__four', label: 'Four', point: { lat: -29, lng: 31 } },
  ]

  it('keeps 4-digit postcodes, lists the rest as unresolved, and never calls the network itself', async () => {
    const geocode = vi
      .fn()
      .mockResolvedValueOnce({ street: null, suburb: 'One', city: null, province: null, postalCode: '1234' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ street: null, suburb: 'Three', city: null, province: null, postalCode: '12' })
      .mockResolvedValueOnce({ street: null, suburb: 'Four', city: null, province: null, postalCode: ' 0299 ' })
    const sleep = vi.fn(noSleep)

    const result = await resolvePostcodes(missing, geocode, sleep, 1100)

    expect(result.resolved).toEqual({ a__a__a__one: '1234', a__a__a__four: '0299' })
    expect(result.unresolved).toEqual(['a__a__a__two', 'a__a__a__three'])
    expect(geocode).toHaveBeenCalledTimes(4)
    expect(geocode).toHaveBeenNthCalledWith(1, { lat: -26, lng: 28 })
  })

  it('sleeps between calls (Nominatim 1 req/s) but not after the last one', async () => {
    const geocode = vi.fn().mockResolvedValue({ street: null, suburb: null, city: null, province: null, postalCode: '1000' })
    const sleep = vi.fn(noSleep)
    await resolvePostcodes(missing, geocode, sleep, 1100)
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(1100)
  })
})

describe('renderPostalCodesFile', () => {
  it('keeps the header, preserves insertion order and marks manual ones', () => {
    const out = renderPostalCodesFile(
      { 'z__z__z__zed': '9999', 'a__a__a__alpha': '1000', 'm__m__m__mid': '5000' },
      new Set(['m__m__m__mid']),
    )
    expect(out.startsWith('// Generated from the Plug A Pro suburb taxonomy via reverse geocoding of\n')).toBe(true)
    expect(out).toContain('export const SUBURB_POSTAL_CODES: Record<string, string> = {\n')
    const body = out.slice(out.indexOf('{\n') + 2)
    expect(body).toBe(
      '  "z__z__z__zed": "9999",\n' +
        '  "a__a__a__alpha": "1000",\n' +
        '  "m__m__m__mid": "5000", // manual\n' +
        '}\n',
    )
  })

  it('round-trips the current file content exactly when given its own entries', async () => {
    const { readFileSync } = await import('node:fs')
    const { POSTAL_CODES_PATH } = await import('../../scripts/backfill-suburb-postcodes')
    const current = readFileSync(POSTAL_CODES_PATH, 'utf8')
    const manual = new Set(
      [...current.matchAll(/^\s+"([^"]+)": "\d{4}", \/\/ manual$/gm)].map((m) => m[1]),
    )
    expect(renderPostalCodesFile(SUBURB_POSTAL_CODES, manual)).toBe(current)
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `pnpm vitest run __tests__/scripts/backfill-suburb-postcodes.test.ts`
Expected: FAIL with `Failed to load url ../../scripts/backfill-suburb-postcodes` (module not found).

- [ ] **Step 3: Write the script**

Create `field-service/scripts/backfill-suburb-postcodes.ts`:

```ts
/**
 * Backfill postcodes for taxonomy suburbs missing from
 * lib/service-areas/postal-codes.ts (spec 2026-10-03, §Data).
 *
 * Why: getSuburbs(), PWA registration validation and customer address capture
 * all require LocationNode.postalCode IS NOT NULL. Suburbs without a postcode
 * are invisible, which leaves whole regions in six provinces with nothing to
 * pick. The seed (lib/location-seed.ts) reads SUBURB_POSTAL_CODES by slug.
 *
 * How: reverse-geocode each missing suburb's curated coordinates via Nominatim
 * (lib/geocoding.ts#reverseGeocodeCoordinates), honouring its 1 req/s limit,
 * then rewrite postal-codes.ts with the union (sorted). Results that are not
 * exactly 4 digits are reported as unresolved and must be added by hand with a
 * trailing `// manual` comment (SA Post Office postcode lookup).
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-suburb-postcodes.ts            # geocode + rewrite file
 *   pnpm exec tsx scripts/backfill-suburb-postcodes.ts --dry-run  # list missing slugs only
 *
 * Production: after deploy run `pnpm exec tsx scripts/seed-locations.ts` so the
 * new postcodes land on the LocationNode rows (upsert-only; owner approves).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SA_PROVINCES, REGION_CITY_MAP } from '../lib/service-areas/south-africa'
import { SUBURB_POSTAL_CODES } from '../lib/service-areas/postal-codes'
import { locationSlugPart } from '../lib/location-seed'
import { reverseGeocodeCoordinates, type GeoPoint, type ReverseGeocodeResult } from '../lib/geocoding'

export const POSTAL_CODES_PATH = path.resolve(__dirname, '../lib/service-areas/postal-codes.ts')

const FILE_HEADER =
  '// Generated from the Plug A Pro suburb taxonomy via reverse geocoding of\n' +
  '// the curated suburb coordinates in lib/service-areas/south-africa.ts.\n' +
  '// Only postcode-backed suburb nodes are exposed in the structured customer\n' +
  '// capture flow. Nodes without a reliable postcode stay available only for\n' +
  '// legacy records and fallback matching paths.\n' +
  '\n' +
  'export const SUBURB_POSTAL_CODES: Record<string, string> = {\n'

export type MissingSuburb = { slug: string; label: string; point: GeoPoint }
export type Geocoder = (point: GeoPoint) => Promise<ReverseGeocodeResult | null>

const POSTCODE_RE = /^\d{4}$/

export function listSuburbsMissingPostcodes(known: Record<string, string> = SUBURB_POSTAL_CODES): MissingSuburb[] {
  const missing: MissingSuburb[] = []
  for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
    for (const [regionKey, region] of Object.entries(province.regions)) {
      const cityKey = REGION_CITY_MAP[regionKey].cityKey
      for (const [label, coord] of Object.entries(region.suburbs)) {
        const slug = `${provinceKey}__${cityKey}__${regionKey}__${locationSlugPart(label)}`
        if (slug in known) continue
        missing.push({ slug, label, point: { lat: coord.lat, lng: coord.lng } })
      }
    }
  }
  return missing.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function resolvePostcodes(
  missing: MissingSuburb[],
  geocode: Geocoder,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  sleepMs = 1100,
): Promise<{ resolved: Record<string, string>; unresolved: string[] }> {
  const resolved: Record<string, string> = {}
  const unresolved: string[] = []
  for (let i = 0; i < missing.length; i++) {
    const item = missing[i]
    const result = await geocode(item.point)
    const code = result?.postalCode?.trim() ?? ''
    if (POSTCODE_RE.test(code)) resolved[item.slug] = code
    else unresolved.push(item.slug)
    if (i < missing.length - 1) await sleep(sleepMs)
  }
  return { resolved, unresolved }
}

export function renderPostalCodesFile(
  entries: Record<string, string>,
  manualSlugs: ReadonlySet<string> = new Set(),
): string {
  // Insertion order on purpose: the existing file is grouped, not sorted, and
  // the round-trip test pins byte-for-byte reproduction of it.
  const lines = Object.keys(entries).map(
    (slug) => `  "${slug}": "${entries[slug]}",${manualSlugs.has(slug) ? ' // manual' : ''}`,
  )
  return `${FILE_HEADER}${lines.join('\n')}\n}\n`
}

function readManualSlugs(): Set<string> {
  const current = readFileSync(POSTAL_CODES_PATH, 'utf8')
  return new Set([...current.matchAll(/^\s+"([^"]+)": "\d{4}", \/\/ manual$/gm)].map((m) => m[1]))
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const missing = listSuburbsMissingPostcodes()
  console.log(`known=${Object.keys(SUBURB_POSTAL_CODES).length} missing=${missing.length}`)
  for (const m of missing) console.log(`  ${m.slug}`)
  if (dryRun || missing.length === 0) return

  console.log(`\nreverse-geocoding ${missing.length} suburbs via Nominatim (~${Math.ceil((missing.length * 1.1) / 60)} min)…`)
  const { resolved, unresolved } = await resolvePostcodes(missing, reverseGeocodeCoordinates)
  for (const [slug, code] of Object.entries(resolved)) console.log(`  ✓ ${slug} → ${code}`)

  // Existing entries keep their order; new ones are appended sorted by slug.
  const appended = Object.fromEntries(
    Object.entries(resolved).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  writeFileSync(POSTAL_CODES_PATH, renderPostalCodesFile({ ...SUBURB_POSTAL_CODES, ...appended }, readManualSlugs()))
  console.log(`\nwrote ${Object.keys(resolved).length} postcodes to ${path.relative(process.cwd(), POSTAL_CODES_PATH)}`)

  if (unresolved.length > 0) {
    console.log(`\nunresolved (${unresolved.length}) — look up at the SA Post Office postcode tool and add by hand with a trailing "// manual":`)
    for (const slug of unresolved) console.log(`  ✗ ${slug}`)
    process.exitCode = 2
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run __tests__/scripts/backfill-suburb-postcodes.test.ts && pnpm typecheck`
Expected: 6 tests PASS (the round-trip test proves the renderer reproduces the current file byte-for-byte before anything is regenerated); typecheck clean.

- [ ] **Step 5: Dry-run and confirm the 42 missing slugs**

Run: `pnpm exec tsx scripts/backfill-suburb-postcodes.ts --dry-run`
Expected output starts with `known=210 missing=42` followed by exactly these slugs:

```
eastern_cape__east_london__buffalo_city__beacon_bay
eastern_cape__east_london__buffalo_city__east_london
eastern_cape__east_london__buffalo_city__mdantsane
eastern_cape__east_london__buffalo_city__vincent
eastern_cape__gqeberha__gqeberha_metro__gqeberha
eastern_cape__gqeberha__gqeberha_metro__newton_park
eastern_cape__gqeberha__gqeberha_metro__port_elizabeth
eastern_cape__gqeberha__gqeberha_metro__summerstrand
eastern_cape__gqeberha__gqeberha_metro__uitenhage
eastern_cape__gqeberha__gqeberha_metro__walmer
free_state__bloemfontein__bloemfontein_mangaung__bloemfontein
free_state__bloemfontein__bloemfontein_mangaung__fichardt_park
free_state__bloemfontein__bloemfontein_mangaung__langenhoven_park
free_state__bloemfontein__bloemfontein_mangaung__mangaung
free_state__bloemfontein__bloemfontein_mangaung__universitas
gauteng__east_rand__east_rand__dunnottar
gauteng__east_rand__east_rand__heidelberg
gauteng__pretoria__pretoria_north__ga_rankuwa
limpopo__polokwane__polokwane__bendor
limpopo__polokwane__polokwane__flora_park
limpopo__polokwane__polokwane__pietersburg
limpopo__polokwane__polokwane__polokwane
limpopo__polokwane__polokwane__seshego
mpumalanga__emalahleni__emalahleni__emalahleni
mpumalanga__emalahleni__emalahleni__highveld_park
mpumalanga__emalahleni__emalahleni__reyno_ridge
mpumalanga__emalahleni__emalahleni__witbank
mpumalanga__mbombela__mbombela__mbombela
mpumalanga__mbombela__mbombela__nelspruit
mpumalanga__mbombela__mbombela__rocky_drift
mpumalanga__mbombela__mbombela__white_river
north_west__mahikeng__mahikeng__mafikeng
north_west__mahikeng__mahikeng__mahikeng
north_west__mahikeng__mahikeng__mmabatho
north_west__rustenburg__rustenburg__cashan
north_west__rustenburg__rustenburg__rustenburg
north_west__rustenburg__rustenburg__safari_gardens
north_west__rustenburg__rustenburg__tlhabane
northern_cape__kimberley__kimberley__galeshewe
northern_cape__kimberley__kimberley__hadison_park
northern_cape__kimberley__kimberley__kimberley
northern_cape__kimberley__kimberley__new_park
```

(The production table shows 44 NULL-postcode suburb nodes. The two extra are stale nodes that the current taxonomy no longer produces — `gauteng__johannesburg__jhb_west__strubensvalley` and `gauteng__pretoria__pretoria_north__ga-rankuwa` (hyphen) — so no backfill can reach them. They are already hidden from every picker by the postcode filter; leave them. Deactivating them is a follow-up, not this PR. Relatedly, `postal-codes.ts` already holds a dead key `"gauteng__pretoria__pretoria_north__ga-rankuwa": "0201"` that the seed never reads; the renderer preserves it and the backfill adds the live `ga_rankuwa` key — do not hand-edit the dead one in this PR.)

- [ ] **Step 6: Run the real backfill (network, ~50 s)**

Run: `pnpm exec tsx scripts/backfill-suburb-postcodes.ts`
Expected: one `✓ slug → NNNN` line per resolved suburb, `wrote N postcodes to lib/service-areas/postal-codes.ts`, and possibly an `unresolved (K)` list with exit code 2. Nominatim occasionally returns no `postcode` for township or CBD centroids; that is what the manual step is for.

- [ ] **Step 7: Hand-fill every unresolved slug**

For each slug printed under `unresolved`, look the suburb up on the SA Post Office postcode tool (https://www.postoffice.co.za → Tools → Postal codes; search by suburb name and town, use the **street** code, not the box code) and add a line at the end of the object in `lib/service-areas/postal-codes.ts` (just above the closing `}`):

```ts
  "northern_cape__kimberley__kimberley__galeshewe": "8345", // manual
```

(Illustrative line — use the code the lookup returns.) Then re-run `pnpm exec tsx scripts/backfill-suburb-postcodes.ts --dry-run` and confirm it prints `known=252 missing=0`. The PR is not complete while `missing` is non-zero.

- [ ] **Step 8: Verify the file, the seed counts and the round-trip**

Run from `field-service/`:
```bash
grep -c '": "' lib/service-areas/postal-codes.ts            # expected: 252
grep -c '// manual' lib/service-areas/postal-codes.ts        # expected: the number you added by hand
pnpm exec tsx scripts/backfill-suburb-postcodes.ts --dry-run # expected: known=252 missing=0
pnpm vitest run __tests__/scripts/backfill-suburb-postcodes.test.ts __tests__/lib/location-seed.test.ts __tests__/lib/location-audit.test.ts __tests__/lib/location-nodes.test.ts
pnpm typecheck && pnpm lint
```
Expected: counts as stated; all tests PASS (the round-trip test now proves the regenerated file is exactly what the renderer emits, so future runs are idempotent); typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add scripts/backfill-suburb-postcodes.ts __tests__/scripts/backfill-suburb-postcodes.test.ts lib/service-areas/postal-codes.ts
git commit -m "feat(locations): backfill postcodes for the 42 taxonomy suburbs that had none

Suburbs without a postcode are hidden from every picker (getSuburbs,
PWA validation, customer capture), which left regions in six provinces
with nothing selectable. Adds a Nominatim-backed backfill script with a
dry-run, unit-tested pure parts, and regenerates postal-codes.ts
(210 → 252 entries; hand-verified entries are marked // manual).

Production follow-up (rollout step 2, owner approves): pnpm exec tsx
scripts/seed-locations.ts to land the postcodes on LocationNode rows.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §Data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

No Task 6: `lib/matching/readiness.ts` and `__tests__/lib/matching/readiness.test.ts` reference no gate symbol, so the spec's "ACTIVE_SERVICE_AREA stays as is" is verified by the readiness test run folded into Task 1 Step 6.


### Task 7: Location options lose their status field

**Files:**
- Modify: `field-service/lib/location-nodes.ts:6-10` (guard import), `:28-40` (`RegionOption`), `:42-56` (`SuburbOption`), `:67-76` (`NodeSearchResult`), `:180-197` (`getRegions` map), `:238-253` (`getSuburbs` map), `:288-298` (`searchNodes` map), `:350-365` (`searchSuburbNodes` map)
- Delete: `field-service/lib/area-service-status.ts`, `field-service/__tests__/lib/area-service-status.test.ts`
- Modify: `field-service/components/provider/registration/ProviderRegistrationClient.tsx:192-206` (option types), `:1214-1226` (region option suffix), `:1307-1319` (West Rand caveat IIFE)
- Modify: `field-service/components/provider/ServiceAreaPicker.tsx:7` (type import), `:15-28` (status helpers + notice), `:33-34` (`idToStatus`), `:141-149` (`handleToggle`), `:157-159` (`anyNotLive`), `:198-207`, `:252-256`, `:279-283`, `:293-298`
- Modify: `field-service/components/customer/SuburbPicker.tsx:15`, `:46`, `:100-103`, `:184-188`
- Modify: `field-service/components/customer/AreaSelector.tsx:8-12`, `:18-25`, `:83-93`, `:213-241`
- Test: `field-service/__tests__/lib/location-nodes.test.ts:199` (modify), Create `field-service/__tests__/components/location-pickers-national-copy.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. `lib/service-area-guard.ts` is untouched; this task only removes `lib/location-nodes.ts`'s import of `serviceStatusForRegionKey`, `getRegionKeyFromSlug` and `RegionServiceLiveStatus` from it (another task deletes the gate symbols later; after this task nothing in `lib/location-nodes.ts` or the four picker components imports from `@/lib/service-area-guard`).
- Produces: `RegionOption`, `SuburbOption`, `NodeSearchResult` (exported from `lib/location-nodes.ts`) **without** a `serviceStatus` field — so the JSON returned by `/api/locations/regions`, `/api/locations/suburbs` and `/api/locations/search` loses the `serviceStatus` key (the route handlers pass the option objects through unchanged and need no edit). `ServiceAreaPicker`'s internal `handleToggle(id: string, label: string, checked: boolean)`. Task 10 builds on the `RegionOption`/`SuburbOption` client types defined in `ProviderRegistrationClient.tsx:193-205` as they look after this task.

- [ ] **Step 1: Write the failing source-contract test**

Create `field-service/__tests__/components/location-pickers-national-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: a location is live iff its LocationNode is active. No
// picker may render a launch-region status, and lib/location-nodes.ts must
// not stamp one. These are source-contract tests (the repo's convention for
// client components without a DOM harness — see booking-submitted-success-copy).
const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

const PICKER_FILES = [
  'components/provider/registration/ProviderRegistrationClient.tsx',
  'components/provider/ServiceAreaPicker.tsx',
  'components/customer/SuburbPicker.tsx',
  'components/customer/AreaSelector.tsx',
]

const REMOVED_PHRASES = [
  'serviceStatus',
  'area-service-status',
  'live for leads',
  'open to register',
  'not live yet',
  'Not yet active',
  'Leads go live in the West Rand first',
]

describe('location pickers carry no launch-region status (national rollout)', () => {
  it('lib/location-nodes.ts no longer stamps serviceStatus or imports the region gate', () => {
    const source = read('lib/location-nodes.ts')
    expect(source).not.toContain('serviceStatus')
    expect(source).not.toContain("from '@/lib/service-area-guard'")
  })

  it('the area-service-status helper module and its test are gone', () => {
    expect(existsSync(join(root, 'lib/area-service-status.ts'))).toBe(false)
    expect(existsSync(join(root, '__tests__/lib/area-service-status.test.ts'))).toBe(false)
  })

  it.each(PICKER_FILES)('%s renders no region-status copy', (file) => {
    const source = read(file)
    for (const phrase of REMOVED_PHRASES) {
      expect(source, `${file} still contains "${phrase}"`).not.toContain(phrase)
    }
  })

  it('ServiceAreaPicker still tells a suburb result from a region result', () => {
    const source = read('components/provider/ServiceAreaPicker.tsx')
    expect(source).toContain("result.nodeType === 'SUBURB' ? 'Suburb' : 'Region'")
  })
})
```

- [ ] **Step 2: Run the new test to verify it fails**

Run (from `field-service/`): `pnpm vitest run __tests__/components/location-pickers-national-copy.test.ts`
Expected: FAIL — `lib/location-nodes.ts no longer stamps serviceStatus` fails with `expected '...' not to contain 'serviceStatus'`; the four `renders no region-status copy` cases fail; the `area-service-status` existence assertions fail with `expected true to be false`.

- [ ] **Step 3: Update the location-nodes unit test to the new option shape**

In `field-service/__tests__/lib/location-nodes.test.ts`:

1. Delete line 199 (`        serviceStatus: 'onboarding',`) inside the `getSuburbs` → `returns only structured-capture-ready suburbs...` expected object.
2. In the `getRegions` test `resolves cityKey first, then fetches REGION nodes`, after the existing `expect(result[0]).toMatchObject({ ... suburbCount: 12 })` add:

```ts
    expect(result[0]).not.toHaveProperty('serviceStatus')
```

3. In the `searchNodes` test `returns display-normalised labels without changing the search query`, after `expect(result[0].label).toBe('Ruimsig')` add:

```ts
    expect(result[0]).not.toHaveProperty('serviceStatus')
```

Run: `pnpm vitest run __tests__/lib/location-nodes.test.ts`
Expected: FAIL — 3 tests: the `getSuburbs` `toEqual` reports an unexpected `serviceStatus: 'onboarding'` key; the two `not.toHaveProperty('serviceStatus')` assertions fail.

- [ ] **Step 4: Strip the status from `lib/location-nodes.ts`**

Replace lines 5-10 (imports) so the guard import disappears:

```ts
import { LocationNodeType, LocationNode } from '@prisma/client'
```

Replace the `RegionOption` type (lines 28-40):

```ts
export type RegionOption = {
  id: string
  slug: string
  label: string
  provinceKey: string
  cityKey: string
  regionKey: string
  lat: number | null
  lng: number | null
  radiusKm: number | null
  suburbCount?: number
}
```

Replace the `SuburbOption` type (lines 42-56):

```ts
export type SuburbOption = {
  id: string
  slug: string
  label: string
  regionLabel: string
  cityLabel: string
  provinceLabel: string
  postalCode: string
  provinceKey: string
  cityKey: string
  regionKey: string
  lat: number | null
  lng: number | null
}
```

Replace the `NodeSearchResult` type (lines 67-76):

```ts
export type NodeSearchResult = {
  id: string
  slug: string
  label: string
  nodeType: LocationNodeType
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
}
```

Replace the `getRegions` return (lines 180-197):

```ts
  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    label: formatNodeLabel(n.label),
    provinceKey: n.provinceKey ?? '',
    cityKey: n.cityKey ?? '',
    regionKey: n.regionKey ?? '',
    lat: n.lat,
    lng: n.lng,
    radiusKm: n.radiusKm,
    suburbCount: n._count.children,
  }))
```

In the `getSuburbs` return (lines 238-253) delete the line `    serviceStatus: serviceStatusForRegionKey(n.regionKey),`.

Replace the `searchNodes` return (lines 288-298):

```ts
  return nodes.map((node) => ({
    ...node,
    label: formatNodeLabel(node.label),
  }))
```

In the `searchSuburbNodes` return (lines 350-365) delete the line `    serviceStatus: serviceStatusForRegionKey(n.regionKey),`.

Run: `pnpm vitest run __tests__/lib/location-nodes.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Delete the area-service-status module and its test**

```bash
git rm field-service/lib/area-service-status.ts field-service/__tests__/lib/area-service-status.test.ts
```

(Run from the worktree root `worktrees/feat-national-rollout`.) Typecheck will now fail until Steps 6-9 remove the two component imports — that is expected.

- [ ] **Step 6: Remove status rendering from `ProviderRegistrationClient.tsx`**

Replace lines 192-193:

```ts
type RegionOption = { id: string; slug: string; label: string; provinceKey: string; cityKey: string; regionKey: string; suburbCount?: number }
```

Delete line 205 (`  serviceStatus?: ServiceStatus`) from the `SuburbOption` type.

Replace the region `<option>` mapping (lines 1214-1226, inside `<LocationSelect ariaLabel="Region" ...>`):

```tsx
                    {regions.map((region) => {
                      const baseLabel = region.suburbCount ? `${region.label} (${region.suburbCount})` : region.label
                      return (
                        <option key={region.id} value={region.id}>
                          {baseLabel}
                        </option>
                      )
                    })}
```

Delete the whole caveat IIFE (lines 1307-1319), i.e. from `              {(() => {` through `              })()}` that renders "Leads go live in the West Rand first…". The `<Field label={`Travel radius: ...`}>` that follows stays.

- [ ] **Step 7: Remove status rendering from `ServiceAreaPicker.tsx`**

Delete line 7 (`import type { RegionServiceLiveStatus } from '@/lib/service-area-guard'`).

Delete lines 15-28 (`statusSuffix`, `statusHint`, `NOT_LIVE_NOTICE`).

Delete lines 33-34 (the comment and `const [idToStatus, setIdToStatus] = useState<Record<string, RegionServiceLiveStatus>>({})`).

Replace `handleToggle` (lines 141-149):

```ts
  function handleToggle(id: string, label: string, checked: boolean) {
    if (checked) {
      setSelectedIds(prev => { const next = new Set(prev); next.add(id); return next })
      setIdToLabel(prev => ({ ...prev, [id]: label }))
    } else {
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }
```

Delete lines 157-159 (the two comment lines and `const anyNotLive = ...`).

Replace the search-result row body (lines 198-207) with:

```tsx
                <input
                  type="checkbox"
                  checked={selectedIds.has(result.id)}
                  onChange={e => handleToggle(result.id, result.label, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm">{result.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {result.nodeType === 'SUBURB' ? 'Suburb' : 'Region'}
                </span>
```

Replace the region `<option>` (lines 252-256):

```tsx
            {regions.map(region => (
              <option key={region.id} value={region.id}>
                {region.label}{region.suburbCount ? ` (${region.suburbCount})` : ''}
              </option>
            ))}
```

Replace the suburb checkbox `onChange` (line 282):

```tsx
                    onChange={e => handleToggle(suburb.id, suburb.label, e.target.checked)}
```

Delete the not-live notice block (lines 293-298): the `{/* ── Not-live notice ... */}` comment and the `{anyNotLive && (<p ...>{NOT_LIVE_NOTICE}</p>)}` JSX.

- [ ] **Step 8: Remove status rendering from `SuburbPicker.tsx`**

Delete line 15 (`import { isNotYetActive, sortAreaResultsLiveFirst } from '@/lib/area-service-status'`).

Delete line 46 (`    serviceStatus: 'coming_soon' as const,`) in `optionFromSelection`.

Replace lines 100-103 (the two comment lines and `setResults(sortAreaResultsLiveFirst(data))`) with:

```ts
      setResults(data)
```

Delete the badge (lines 184-188):

```tsx
                {isNotYetActive(suburb.serviceStatus) && (
                  <span className="ml-1 text-muted-foreground text-xs font-semibold">
                    · Not yet active
                  </span>
                )}
```

- [ ] **Step 9: Remove status rendering from `AreaSelector.tsx`**

Delete lines 8-12 (the `import { isNotYetActive, sortAreaResultsLiveFirst, type AreaServiceStatus } from '@/lib/area-service-status'` block).

Replace lines 18-25 (comment + `AreaSearchResult` type):

```ts
// Search results carry region context so duplicate suburb names are
// distinguishable (there are two "Northcliff" nodes — one in jhb_west, one in
// jhb_north); the region line under the label tells them apart.
type AreaSearchResult = AreaOption & {
  regionKey?: string | null
}
```

Replace the fetch mapping (lines 83-93):

```ts
      .then((data: AreaSearchResult[]) =>
        setResults(
          data.map(n => ({
            slug: n.slug,
            label: n.label,
            regionKey: n.regionKey ?? null,
          })),
        ),
      )
```

Replace the result row (lines 213-241):

```tsx
                results.map(r => {
                  const regionLabel = r.regionKey ? formatLocationSlugLabel(r.regionKey) : ''
                  return (
                    <button
                      key={r.slug}
                      type="button"
                      onClick={() => select({ slug: r.slug, label: r.label })}
                      className="w-full text-left flex items-center gap-3 px-3 py-3.5 rounded-[14px] transition-colors hover:bg-[var(--card-alt)]"
                      style={{ color: 'var(--ink)' }}
                    >
                      <MapPin size={15} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium truncate">{r.label}</span>
                        {regionLabel && (
                          <span className="block text-[12px] truncate" style={{ color: 'var(--ink-mute)' }}>
                            {regionLabel}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
```

- [ ] **Step 10: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/components/location-pickers-national-copy.test.ts __tests__/lib/location-nodes.test.ts __tests__/app/provider-registration-pwa-route.test.ts __tests__/app/customer`
Expected: PASS. (`provider-registration-pwa-route.test.ts` still finds `'No suburbs available for this region'` and the four `fetch('/api/locations/...` strings.)

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0 — no reference to `serviceStatus`, `RegionServiceLiveStatus`, `isNotYetActive` or `sortAreaResultsLiveFirst` remains.

- [ ] **Step 11: Commit**

```bash
git add field-service/lib/location-nodes.ts \
  field-service/components/provider/registration/ProviderRegistrationClient.tsx \
  field-service/components/provider/ServiceAreaPicker.tsx \
  field-service/components/customer/SuburbPicker.tsx \
  field-service/components/customer/AreaSelector.tsx \
  field-service/__tests__/lib/location-nodes.test.ts \
  field-service/__tests__/components/location-pickers-national-copy.test.ts
git commit -m "refactor(locations): drop launch-region status from location options and pickers

A location is live iff its LocationNode is active. RegionOption, SuburbOption
and NodeSearchResult lose serviceStatus; the registration client, profile
ServiceAreaPicker, customer SuburbPicker and AreaSelector stop rendering
'live for leads' / 'not live yet' / 'Not yet active' and the West Rand caveat.
lib/area-service-status.ts (live-first sort) is removed; pickers sort A-Z.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

(`git rm` from Step 5 already staged the two deletions.)

---

### Task 8: BookingFlow drops the "Not in your area yet" state

**Files:**
- Modify: `field-service/components/customer/BookingFlow.tsx:110` (`Step` union), `:202` (`waitlistedCity` state), `:710-716` (response handling), `:794` (`STEP_LABELS`), `:802-807`, `:822-826`, `:832` (header guards), `:1399-1421` (waitlisted JSX)
- Test: Create `field-service/__tests__/components/customer/booking-flow-national-intake.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. Does **not** touch `app/api/customer/bookings/route.ts` (Part C's task removes the server's `{ waitlisted: true, city }` branches). After this task the client ignores any `waitlisted` key: a response without `jobRequestId` is treated as a failed submit (`'We could not create your request. Please try again.'`) instead of a blank screen, so the two tasks can land in either order.
- Produces: `BookingFlow` `Step` type = `'address' | 'description' | 'confirm' | 'submitted'`. The `PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'` picker default at `:962` is kept on purpose (UI default, not a fence).

- [ ] **Step 1: Write the failing source-contract test**

Create `field-service/__tests__/components/customer/booking-flow-national-intake.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: the bookings API no longer waitlists customers for being
// outside Johannesburg, so BookingFlow has no "Not in your area yet" screen.
describe('BookingFlow national intake', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/customer/BookingFlow.tsx'),
    'utf8',
  )

  it('has no waitlisted step or copy', () => {
    expect(source).not.toContain("'waitlisted'")
    expect(source).not.toContain('waitlistedCity')
    expect(source).not.toContain('Not in your area yet')
    expect(source).not.toContain('Currently serving')
    expect(source).not.toContain('Area not covered')
  })

  it('treats a submit response without a jobRequestId as a failed submit', () => {
    expect(source).toContain("if (!data.jobRequestId) {")
    expect(source).toContain("throw new Error('We could not create your request. Please try again.')")
  })

  it('keeps the Gauteng picker default (a UI default, not a fence)', () => {
    expect(source).toContain("PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run __tests__/components/customer/booking-flow-national-intake.test.ts`
Expected: FAIL — `has no waitlisted step or copy` (`expected ... not to contain "'waitlisted'"`) and `treats a submit response without a jobRequestId...` (`expected ... to contain "if (!data.jobRequestId) {"`). The third test passes already.

- [ ] **Step 3: Remove the waitlisted state from `BookingFlow.tsx`**

Line 110:

```ts
type Step = 'address' | 'description' | 'confirm' | 'submitted'
```

Delete line 202 (`  const [waitlistedCity, setWaitlistedCity] = useState<string | null>(null)`).

Replace lines 710-716 (`const data = await res.json()` through the closing `}` of the `if (data.waitlisted)` block):

```ts
    const data = await res.json()

    if (!data.jobRequestId) {
      throw new Error('We could not create your request. Please try again.')
    }
```

Delete line 794 (`    waitlisted: 'Area not covered',`) from `STEP_LABELS`.

Replace the header strip's back-button wrapper (lines 802-820) by removing the `{step !== 'waitlisted' && (` / `)}` wrapper so the `<button ...>` renders unconditionally:

```tsx
          <div className="flex items-center gap-3 mb-3">
            <button
              type="button"
              onClick={() => {
                // Clear any banner so a message from a later step does not
                // linger on the step we navigate back to.
                setError(null)
                if (step === 'description') setStep('address')
                else if (step === 'confirm') setStep('description')
                else if (step === 'address') window.history.back()
              }}
              className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink)' }}
            >
              <ChevronLeft size={18} />
            </button>
```

Replace lines 822-826 (the `{step !== 'waitlisted' && (` wrapper around the "Step N of 3" eyebrow) so the eyebrow renders unconditionally:

```tsx
              <div className="text-[11px] font-bold tracking-[0.06em] uppercase" style={{ color: 'var(--brand-purple)' }}>
                {category.name} · Step {Math.max(stepIndex + 1, 1)} of 3
              </div>
```

Line 832: change `{step !== 'waitlisted' && stepIndex < 3 && (` to `{stepIndex < 3 && (`.

Delete lines 1399-1421: the `{/* ── Waitlisted ─── */}` comment and the whole `{step === 'waitlisted' && ( ... )}` block (the `MapPin size={28}` card with "Not in your area yet"). `MapPin` stays imported — it is still used at line 910.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/components/customer __tests__/app/customer __tests__/components/booking-submit-auth-gate.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0 (no unused `useState` import — `useState` is still used for the other state hooks; `waitlistedCity` has no remaining references).

- [ ] **Step 5: Commit**

```bash
git add field-service/components/customer/BookingFlow.tsx \
  field-service/__tests__/components/customer/booking-flow-national-intake.test.ts
git commit -m "feat(customer): remove the 'Not in your area yet' booking screen

The bookings API stops waitlisting customers outside Johannesburg, so the
waitlisted step, its copy ('Currently serving: Johannesburg') and the
waitlistedCity state go. A submit response without a jobRequestId now
surfaces as a retryable error instead of an empty screen.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---
### Task 9: PWA registration accepts a whole-region (REGION node) service area

**Files:**
- Modify: `field-service/lib/provider-registration/pwa-flow.ts:280-285` (`locationHierarchyError` copy), `:316-392` (`resolveCanonicalServiceAreas` lookup + per-node validation)
- Test: `field-service/__tests__/lib/provider-registration-pwa-flow.test.ts` (add a `regionRow()` fixture after `structuredSuburbRows()` at line 50, and five tests after `rejects selected suburbs that do not belong to the submitted hierarchy` at line 261)

**Interfaces:**
- Consumes: `normaliseLocationDisplayName` from `@/lib/location-format` (already imported at `pwa-flow.ts:15`); `ProviderRegistrationLocationNode` type (`pwa-flow.ts:146-168`, unchanged — `nodeType: string`, optional nested `parent`).
- Produces: `resolveCanonicalServiceAreas` (module-private, reached via `saveProviderRegistrationDraft` and `submitProviderRegistrationApplication`) now accepts `locationNodeIds` that are active `SUBURB` nodes with a postcode **or** active `REGION` nodes. For a REGION node: `node.id` must equal `input.regionId`, `node.parent` must be the CITY equal to `input.cityId`, its parent the PROVINCE equal to `input.provinceId`; the derived `serviceAreas[]` label is `normaliseLocationDisplayName(node.label)`. Error codes are unchanged; copy becomes `'Select a valid suburb or region from the list.'` (`INVALID_LOCATION_NODE`) and `'Choose a valid province, city and region combination.'` (`INVALID_LOCATION_HIERARCHY`). Task 10 (client) sends exactly this payload: `locationNodeIds: [regionId]`, `regionId`, `serviceAreas: [regionLabel]`. The downstream writer `upsertStructuredServiceAreas(tx, providerId, data.locationNodeIds)` (`pwa-flow.ts:976-977`) already maps a REGION node to `areaType: 'REGION'` and needs no change here.

- [ ] **Step 1: Add the REGION fixture and the failing tests**

In `field-service/__tests__/lib/provider-registration-pwa-flow.test.ts`, directly after the `structuredSuburbRows` function (after line 50) add:

```ts
function regionRow(overrides: { id?: string; label?: string } = {}) {
  return {
    id: overrides.id ?? 'region-jhb-central',
    nodeType: 'REGION',
    slug: 'gauteng__johannesburg__jhb_central',
    label: overrides.label ?? 'JHB Central',
    postalCode: null,
    provinceKey: 'gauteng',
    cityKey: 'johannesburg',
    regionKey: 'jhb_central',
    parent: {
      id: 'city-johannesburg',
      nodeType: 'CITY',
      label: 'Johannesburg',
      parent: {
        id: 'province-gauteng',
        nodeType: 'PROVINCE',
        label: 'Gauteng',
      },
    },
  }
}
```

Then, inside `describe('provider registration PWA flow', ...)`, directly after the test `rejects selected suburbs that do not belong to the submitted hierarchy` (ends line 261), add:

```ts
  it('accepts a whole-region selection and derives the region label', async () => {
    const client = createDraftClient()
    client.locationNode.findMany.mockResolvedValue([regionRow()])

    await saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      serviceAreas: ['typed label that must be replaced'],
      locationNodeIds: ['region-jhb-central'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      lastCompletedStep: 4,
    })

    expect(client.providerApplicationDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serviceAreas: ['JHB Central'],
        locationNodeIds: ['region-jhb-central'],
      }),
    }))
  })

  it('rejects a REGION node that is not the submitted region', async () => {
    const client = createDraftClient()
    client.locationNode.findMany.mockResolvedValue([regionRow()])

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['region-jhb-central'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-roodepoort',
      lastCompletedStep: 4,
    })).rejects.toMatchObject({
      code: 'INVALID_LOCATION_HIERARCHY',
      message: 'Choose a valid province, city and region combination.',
    })

    expect(client.providerApplicationDraft.create).not.toHaveBeenCalled()
  })

  it('still rejects a suburb without a postcode', async () => {
    const client = createDraftClient()
    client.locationNode.findMany.mockResolvedValue(
      structuredSuburbRows().map((row) => ({ ...row, postalCode: null })),
    )

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      lastCompletedStep: 4,
    })).rejects.toBeInstanceOf(ProviderRegistrationValidationError)

    expect(client.providerApplicationDraft.create).not.toHaveBeenCalled()
  })

  it('rejects CITY and PROVINCE nodes even when the lookup returns them', async () => {
    const client = createDraftClient()
    client.locationNode.findMany.mockResolvedValue([
      {
        id: 'city-johannesburg',
        nodeType: 'CITY',
        slug: 'gauteng__johannesburg',
        label: 'Johannesburg',
        postalCode: null,
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: null,
        parent: { id: 'province-gauteng', nodeType: 'PROVINCE', label: 'Gauteng' },
      },
    ])

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['city-johannesburg'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      lastCompletedStep: 4,
    })).rejects.toMatchObject({ code: 'INVALID_LOCATION_HIERARCHY' })
  })

  it('uses the suburb-or-region copy when a node id is unknown', async () => {
    const client = createDraftClient()
    client.locationNode.findMany.mockResolvedValue([])

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['ghost-node'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      lastCompletedStep: 4,
    })).rejects.toMatchObject({
      code: 'INVALID_LOCATION_NODE',
      message: 'Select a valid suburb or region from the list.',
    })
  })
```

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `pnpm vitest run __tests__/lib/provider-registration-pwa-flow.test.ts`
Expected: FAIL — `accepts a whole-region selection...` rejects with `INVALID_LOCATION_HIERARCHY` (REGION node has no REGION parent); `rejects a REGION node that is not the submitted region` fails on `message` (old copy still says "region and suburb"); `uses the suburb-or-region copy...` fails on `message`. `still rejects a suburb without a postcode` and `rejects CITY and PROVINCE nodes...` already pass. All pre-existing tests pass.

- [ ] **Step 3: Implement the REGION branch in `pwa-flow.ts`**

Replace `locationHierarchyError` (lines 280-285):

```ts
function locationHierarchyError(): ProviderRegistrationValidationError {
  return new ProviderRegistrationValidationError(
    'Choose a valid province, city and region combination.',
    'INVALID_LOCATION_HIERARCHY',
  )
}
```

Replace the lookup `where` (lines 316-322) so REGION nodes are returned too:

```ts
  const nodes = await client.locationNode.findMany({
    where: {
      id: { in: locationNodeIds },
      active: true,
      OR: [
        { nodeType: 'SUBURB', postalCode: { not: null } },
        { nodeType: 'REGION' },
      ],
    },
```

(The `select` block that follows is unchanged.)

Replace the unknown-node error (lines 357-362):

```ts
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  if (nodesById.size !== locationNodeIds.length) {
    throw new ProviderRegistrationValidationError(
      'Select a valid suburb or region from the list.',
      'INVALID_LOCATION_NODE',
    )
  }
```

Replace the per-node loop (lines 364-390) with a type-aware one:

```ts
  const serviceAreas: string[] = []
  for (const locationNodeId of locationNodeIds) {
    const node = nodesById.get(locationNodeId)
    if (!node) throw locationHierarchyError()

    if (node.nodeType === 'REGION') {
      // Whole-region coverage: the node itself is the selected region; its
      // parents must be the submitted city and province.
      const city = node.parent
      const province = city?.parent
      if (!city || city.nodeType !== 'CITY' || !province || province.nodeType !== 'PROVINCE') {
        throw locationHierarchyError()
      }
      if (input.regionId && node.id !== input.regionId) throw locationHierarchyError()
      if (input.cityId && city.id !== input.cityId) throw locationHierarchyError()
      if (input.provinceId && province.id !== input.provinceId) throw locationHierarchyError()

      serviceAreas.push(normaliseLocationDisplayName(node.label))
      continue
    }

    const region = node.parent
    const city = region?.parent
    const province = city?.parent

    if (
      node.nodeType !== 'SUBURB' ||
      !node.postalCode ||
      !region ||
      region.nodeType !== 'REGION' ||
      !city ||
      city.nodeType !== 'CITY' ||
      !province ||
      province.nodeType !== 'PROVINCE'
    ) {
      throw locationHierarchyError()
    }

    if (input.regionId && region.id !== input.regionId) throw locationHierarchyError()
    if (input.cityId && city.id !== input.cityId) throw locationHierarchyError()
    if (input.provinceId && province.id !== input.provinceId) throw locationHierarchyError()

    serviceAreas.push(normaliseLocationDisplayName(node.label))
  }

  return { locationNodeIds, serviceAreas }
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/lib/provider-registration-pwa-flow.test.ts __tests__/lib/provider-registration __tests__/lib/provider-onboarding/quality-gate-off-regression.test.ts`
Expected: PASS (all).

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/provider-registration/pwa-flow.ts \
  field-service/__tests__/lib/provider-registration-pwa-flow.test.ts
git commit -m "feat(registration): accept a whole-region service area in the PWA flow

resolveCanonicalServiceAreas now accepts an active REGION node alongside
postcode-backed SUBURB nodes. A REGION node must be the submitted regionId
and sit under the submitted city and province; its label becomes the
service-area label. Error copy reads 'suburb or region'.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---

### Task 10: "Cover the whole region" option in the registration client

**Files:**
- Create: `field-service/components/provider/registration/service-area-selection.ts`
- Modify: `field-service/components/provider/registration/ProviderRegistrationClient.tsx:26` (import), `:565-592` (`selectRegion` / `toggleSuburb`), `:650-652` (step validation), `:828` (`saveAndExit` completed-step guard), `:1238-1306` (suburb list, whole-region option, selected chips)
- Test: Create `field-service/__tests__/components/provider/registration/service-area-selection.test.ts`, Create `field-service/__tests__/components/provider/registration/whole-region-option.test.ts`

**Interfaces:**
- Consumes: Task 9's server contract — `saveProviderRegistrationDraft` / `submitProviderRegistrationApplication` accept `locationNodeIds: [regionId]` with `regionId` equal to that id and derive `serviceAreas: [regionLabel]`. The client already sends `regionId: form.selectedRegionId` (`registrationPayload`, line 610). Task 7's client types `RegionOption` / `SuburbOption` (no `serviceStatus`).
- Produces: pure module `components/provider/registration/service-area-selection.ts` exporting
  - `type ServiceAreaSelection = { serviceAreas: string[]; locationNodeIds: string[] }` (index-aligned, exactly the two form fields),
  - `type AreaNode = { id: string; label: string }`,
  - `isWholeRegionSelected(selection: ServiceAreaSelection, regionId: string): boolean`,
  - `hasAnyServiceArea(selection: ServiceAreaSelection): boolean`,
  - `applyWholeRegion(selection: ServiceAreaSelection, region: AreaNode): ServiceAreaSelection`,
  - `applySuburbToggle(selection: ServiceAreaSelection, suburb: AreaNode, regionId: string): ServiceAreaSelection`,
  - `removeServiceArea(selection: ServiceAreaSelection, nodeId: string): ServiceAreaSelection`.
  The registration "area" step works on one region at a time (`selectRegion` resets the selection), so a selection is either N suburb ids or exactly one REGION id.

- [ ] **Step 1: Write the failing helper tests**

Create `field-service/__tests__/components/provider/registration/service-area-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applySuburbToggle,
  applyWholeRegion,
  hasAnyServiceArea,
  isWholeRegionSelected,
  removeServiceArea,
  type ServiceAreaSelection,
} from '@/components/provider/registration/service-area-selection'

const REGION = { id: 'region-ct-cbd', label: 'Cape Town CBD & Atlantic Seaboard' }
const SEA_POINT = { id: 'sub-sea-point', label: 'Sea Point' }
const GARDENS = { id: 'sub-gardens', label: 'Gardens' }
const EMPTY: ServiceAreaSelection = { serviceAreas: [], locationNodeIds: [] }

describe('service-area-selection (registration area step)', () => {
  it('whole region replaces any selected suburbs with the single region id and label', () => {
    const withSuburbs = applySuburbToggle(EMPTY, SEA_POINT, REGION.id)
    const result = applyWholeRegion(withSuburbs, REGION)
    expect(result).toEqual({ serviceAreas: [REGION.label], locationNodeIds: [REGION.id] })
    expect(isWholeRegionSelected(result, REGION.id)).toBe(true)
  })

  it('selecting whole region again toggles it off', () => {
    const on = applyWholeRegion(EMPTY, REGION)
    expect(applyWholeRegion(on, REGION)).toEqual(EMPTY)
  })

  it('picking a suburb clears the whole-region option for that region', () => {
    const wholeRegion = applyWholeRegion(EMPTY, REGION)
    const result = applySuburbToggle(wholeRegion, GARDENS, REGION.id)
    expect(result).toEqual({ serviceAreas: ['Gardens'], locationNodeIds: ['sub-gardens'] })
    expect(isWholeRegionSelected(result, REGION.id)).toBe(false)
  })

  it('suburb toggle adds then removes, keeping labels and ids index-aligned', () => {
    const one = applySuburbToggle(EMPTY, SEA_POINT, REGION.id)
    const two = applySuburbToggle(one, GARDENS, REGION.id)
    expect(two).toEqual({
      serviceAreas: ['Sea Point', 'Gardens'],
      locationNodeIds: ['sub-sea-point', 'sub-gardens'],
    })
    expect(applySuburbToggle(two, SEA_POINT, REGION.id)).toEqual({
      serviceAreas: ['Gardens'],
      locationNodeIds: ['sub-gardens'],
    })
  })

  it('removeServiceArea drops the matching pair and ignores unknown ids', () => {
    const two = applySuburbToggle(applySuburbToggle(EMPTY, SEA_POINT, REGION.id), GARDENS, REGION.id)
    expect(removeServiceArea(two, 'sub-gardens')).toEqual({
      serviceAreas: ['Sea Point'],
      locationNodeIds: ['sub-sea-point'],
    })
    expect(removeServiceArea(two, 'nope')).toBe(two)
  })

  it('hasAnyServiceArea is satisfied by a region id as much as by a suburb id', () => {
    expect(hasAnyServiceArea(EMPTY)).toBe(false)
    expect(hasAnyServiceArea(applyWholeRegion(EMPTY, REGION))).toBe(true)
    expect(hasAnyServiceArea(applySuburbToggle(EMPTY, SEA_POINT, REGION.id))).toBe(true)
  })

  it('isWholeRegionSelected is false for an empty region id', () => {
    expect(isWholeRegionSelected(applyWholeRegion(EMPTY, REGION), '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run __tests__/components/provider/registration/service-area-selection.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/provider/registration/service-area-selection"`.

- [ ] **Step 3: Create the pure selection module**

Create `field-service/components/provider/registration/service-area-selection.ts`:

```ts
// Pure selection logic for the provider registration "area" step.
//
// The step works on one region at a time (selectRegion resets the selection),
// so a selection is either N suburb ids or exactly one REGION id ("my suburb
// isn't listed — cover the whole region"). serviceAreas[] (labels) and
// locationNodeIds[] are index-aligned; every helper keeps them that way.

export type ServiceAreaSelection = {
  serviceAreas: string[]
  locationNodeIds: string[]
}

export type AreaNode = { id: string; label: string }

const EMPTY: ServiceAreaSelection = { serviceAreas: [], locationNodeIds: [] }

export function isWholeRegionSelected(selection: ServiceAreaSelection, regionId: string): boolean {
  return regionId !== '' && selection.locationNodeIds.includes(regionId)
}

export function hasAnyServiceArea(selection: ServiceAreaSelection): boolean {
  return selection.locationNodeIds.length > 0
}

export function removeServiceArea(selection: ServiceAreaSelection, nodeId: string): ServiceAreaSelection {
  const index = selection.locationNodeIds.indexOf(nodeId)
  if (index < 0) return selection
  return {
    serviceAreas: selection.serviceAreas.filter((_, i) => i !== index),
    locationNodeIds: selection.locationNodeIds.filter((_, i) => i !== index),
  }
}

/** Toggle whole-region coverage. On: the region replaces every suburb. Off: empty. */
export function applyWholeRegion(selection: ServiceAreaSelection, region: AreaNode): ServiceAreaSelection {
  if (isWholeRegionSelected(selection, region.id)) return EMPTY
  return { serviceAreas: [region.label], locationNodeIds: [region.id] }
}

/** Toggle one suburb. Adding a suburb switches whole-region coverage off. */
export function applySuburbToggle(
  selection: ServiceAreaSelection,
  suburb: AreaNode,
  regionId: string,
): ServiceAreaSelection {
  if (selection.locationNodeIds.includes(suburb.id)) return removeServiceArea(selection, suburb.id)
  const base = isWholeRegionSelected(selection, regionId) ? removeServiceArea(selection, regionId) : selection
  return {
    serviceAreas: [...base.serviceAreas, suburb.label],
    locationNodeIds: [...base.locationNodeIds, suburb.id],
  }
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm vitest run __tests__/components/provider/registration/service-area-selection.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing source-contract test for the client wiring**

Create `field-service/__tests__/components/provider/registration/whole-region-option.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The registration client is a 'use client' component with fetch side effects;
// the selection logic is unit-tested in service-area-selection.test.ts. This
// test pins the wiring: the option exists, uses the helpers, and the
// zero-suburb message the route test depends on is still rendered.
describe('registration area step — whole-region option', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/provider/registration/ProviderRegistrationClient.tsx'),
    'utf8',
  )

  it('imports the pure selection helpers', () => {
    expect(source).toContain("from '@/components/provider/registration/service-area-selection'")
    expect(source).toContain('applyWholeRegion(')
    expect(source).toContain('applySuburbToggle(')
    expect(source).toContain('removeServiceArea(')
    expect(source).toContain('hasAnyServiceArea(')
    expect(source).toContain('isWholeRegionSelected(')
  })

  it('renders the whole-region option with the selected region label', () => {
    expect(source).toContain("My suburb isn&apos;t listed — cover the whole {region.label}")
    expect(source).toContain('onClick={selectWholeRegion}')
    expect(source).toContain('aria-pressed={wholeRegion}')
  })

  it('validation accepts a region id and says so', () => {
    expect(source).toContain("if (currentStep === 'area' && !hasAnyServiceArea(form)) {")
    expect(source).toContain("setError('Select at least one suburb from the list, or cover the whole region.')")
    expect(source).not.toContain("form.locationNodeIds.length === 0")
  })

  it('keeps the zero-suburb message and labels the chips as areas', () => {
    expect(source).toContain('No suburbs available for this region')
    expect(source).toContain('Selected areas')
    expect(source).not.toContain('Selected suburbs')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run __tests__/components/provider/registration/whole-region-option.test.ts`
Expected: FAIL — all four tests (`expected ... to contain "from '@/components/provider/registration/service-area-selection'"`, etc.).

- [ ] **Step 7: Wire the option into `ProviderRegistrationClient.tsx`**

After line 26 (`import { EvidenceUploader } ...`) add:

```ts
import {
  applySuburbToggle,
  applyWholeRegion,
  hasAnyServiceArea,
  isWholeRegionSelected,
  removeServiceArea,
} from '@/components/provider/registration/service-area-selection'
```

Replace `toggleSuburb` (lines 575-592) with three handlers:

```ts
  function toggleSuburb(suburb: SuburbOption) {
    setForm((current) => ({
      ...current,
      ...applySuburbToggle(current, suburb, current.selectedRegionId),
    }))
    setError('')
  }

  function selectWholeRegion() {
    setForm((current) => {
      const region = regions.find((r) => r.id === current.selectedRegionId)
      if (!region) return current
      return { ...current, ...applyWholeRegion(current, region) }
    })
    setError('')
  }

  function removeArea(nodeId: string) {
    setForm((current) => ({ ...current, ...removeServiceArea(current, nodeId) }))
    setError('')
  }
```

(`RegistrationFormState` has `serviceAreas: string[]` and `locationNodeIds: string[]`, so `current` satisfies `ServiceAreaSelection` structurally and the spread writes back exactly those two fields. `selectRegion` at lines 565-573 is unchanged: switching region still clears both arrays.)

Replace the step validation (lines 650-652):

```ts
    if (currentStep === 'area' && !hasAnyServiceArea(form)) {
      setError('Select at least one suburb from the list, or cover the whole region.')
      return false
    }
```

Replace line 828 (`const completedStep = step === 'area' && form.locationNodeIds.length === 0`) with:

```ts
    const completedStep = step === 'area' && !hasAnyServiceArea(form)
```

In the "Sub-area / suburb" block, directly after the `{suburbs.length > 0 && ( <div className="grid ...">…</div> )}` suburb grid (closing at line 1282) and before the block's closing `</div>` (line 1283), insert the whole-region option:

```tsx
                  {form.selectedRegionId && !locationLoading.suburbs && (() => {
                    const region = regions.find((r) => r.id === form.selectedRegionId)
                    if (!region) return null
                    const wholeRegion = isWholeRegionSelected(form, region.id)
                    return (
                      <button
                        type="button"
                        onClick={selectWholeRegion}
                        aria-pressed={wholeRegion}
                        className={[
                          'mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                          wholeRegion
                            ? 'brand-gradient-soft text-[var(--brand-purple)] shadow-[inset_0_0_0_1.5px_var(--tone-brand-border)]'
                            : 'bg-background text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[var(--card-alt)]',
                        ].join(' ')}
                      >
                        <span>
                          <span className="block font-semibold">My suburb isn&apos;t listed — cover the whole {region.label}</span>
                          <span className="block text-[11px] text-[var(--ink-mute)]">
                            You will receive leads from anywhere in this region.
                          </span>
                        </span>
                        {wholeRegion && <Check size={17} aria-hidden />}
                      </button>
                    )
                  })()}
```

Replace the selected-chips block (lines 1285-1306) so chips remove by id and cover both suburbs and the region:

```tsx
              {form.serviceAreas.length > 0 && (
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-[var(--ink)]">Selected areas</p>
                  <div className="flex flex-wrap gap-2">
                    {form.serviceAreas.map((area, index) => {
                      const nodeId = form.locationNodeIds[index]
                      return (
                        <button
                          key={`${nodeId}-${area}`}
                          type="button"
                          onClick={() => removeArea(nodeId)}
                          aria-label={`Remove ${area}`}
                          className="rounded-full brand-gradient-soft px-3 py-1.5 text-[12px] font-semibold text-[var(--brand-purple)] shadow-[inset_0_0_0_1px_var(--tone-brand-border)]"
                        >
                          {area}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
```

The `'No suburbs available for this region'` message (line 1251-1255) stays; with the option rendered below it, a thinly mapped region is still registrable. The review step's `<SummaryRow label="Areas" value={form.serviceAreas.join(', ') || 'Missing'} />` (line 1489) already shows the region label.

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/components/provider __tests__/app/provider-registration-pwa-route.test.ts __tests__/components/location-pickers-national-copy.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0 (every imported helper is used; `Check` was already imported from `lucide-react`).

- [ ] **Step 9: Commit**

```bash
git add field-service/components/provider/registration/service-area-selection.ts \
  field-service/components/provider/registration/ProviderRegistrationClient.tsx \
  field-service/__tests__/components/provider/registration/service-area-selection.test.ts \
  field-service/__tests__/components/provider/registration/whole-region-option.test.ts
git commit -m "feat(registration): 'my suburb isn't listed — cover the whole region' option

Adds a whole-region toggle to the PWA area step for thinly mapped regions.
It stores the REGION node id (one per selection, mutually exclusive with
suburbs of that region) and the region label; selection logic lives in a
pure, unit-tested module. Validation accepts a region id.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---
### Task 11: Provider profile editor saves REGION service areas

**Files:**
- Create: `field-service/lib/provider-service-area-rows.ts`
- Modify: `field-service/app/(provider)/provider/profile/actions.ts:5` (import), `:125-175` (service-area block inside the `serviceAreasPickerRendered` branch)
- Test: Create `field-service/__tests__/lib/provider-service-area-rows.test.ts`; Modify `field-service/__tests__/provider/provider-profile-save-feedback.test.ts` (add two tests at the end of the `describe`)

**Interfaces:**
- Consumes: `getRegionKeyFromSlug(slug: string | null | undefined): string` and nothing else from `@/lib/service-area-guard` (a kept symbol per the spec); `normaliseLocationDisplayName` from `@/lib/location-format`. `components/provider/ServiceAreaPicker.tsx` already posts REGION ids from `/api/locations/search` results under the `locationNodeIds` form field (Task 7 kept that behaviour).
- Produces: `lib/provider-service-area-rows.ts` exporting
  - `type ServiceAreaNodeInput = { id: string; slug: string; label: string; nodeType: string; provinceKey: string | null; cityKey: string | null; regionKey: string | null }`,
  - `type TechnicianServiceAreaRow = { providerId: string; locationNodeId: string; areaType: 'SUBURB' | 'REGION'; label: string; provinceKey: string | null; cityKey: string | null; regionKey: string | null; suburbKey: string | null; active: true }`,
  - `class InvalidServiceAreaNodeError extends Error`,
  - `buildTechnicianServiceAreaRows(providerId: string, nodes: ServiceAreaNodeInput[]): TechnicianServiceAreaRow[]` — throws `InvalidServiceAreaNodeError` for any node that is not `SUBURB` or `REGION`.
  The profile action's `createMany` rows are built by this function; the "only SUBURB nodes are permitted" rejection is gone. Rows are written `active: true` exactly as the action already did for suburbs (the profile editor never applied the matching gate).

- [ ] **Step 1: Write the failing helper tests**

Create `field-service/__tests__/lib/provider-service-area-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildTechnicianServiceAreaRows,
  InvalidServiceAreaNodeError,
} from '@/lib/provider-service-area-rows'

const SUBURB = {
  id: 'node-sea-point',
  slug: 'western_cape__cape_town__cape_town_cbd__sea_point',
  label: 'Sea Point',
  nodeType: 'SUBURB',
  provinceKey: 'western_cape',
  cityKey: 'cape_town',
  regionKey: 'cape_town_cbd',
}

const REGION = {
  id: 'node-ct-cbd',
  slug: 'western_cape__cape_town__cape_town_cbd',
  label: 'Cape Town CBD & Atlantic Seaboard',
  nodeType: 'REGION',
  provinceKey: 'western_cape',
  cityKey: 'cape_town',
  regionKey: 'cape_town_cbd',
}

describe('buildTechnicianServiceAreaRows', () => {
  it('builds an active SUBURB row with a suburbKey', () => {
    expect(buildTechnicianServiceAreaRows('prov-1', [SUBURB])).toEqual([
      {
        providerId: 'prov-1',
        locationNodeId: 'node-sea-point',
        areaType: 'SUBURB',
        label: 'Sea Point',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'cape_town_cbd',
        suburbKey: 'sea_point',
        active: true,
      },
    ])
  })

  it('builds an active REGION row with no suburbKey', () => {
    const [row] = buildTechnicianServiceAreaRows('prov-1', [REGION])
    expect(row).toMatchObject({
      providerId: 'prov-1',
      locationNodeId: 'node-ct-cbd',
      areaType: 'REGION',
      regionKey: 'cape_town_cbd',
      suburbKey: null,
      active: true,
    })
  })

  it('derives a REGION regionKey from the slug when the node has none', () => {
    const [row] = buildTechnicianServiceAreaRows('prov-1', [{ ...REGION, regionKey: null }])
    expect(row.regionKey).toBe('cape_town_cbd')
  })

  it('rejects CITY and PROVINCE nodes', () => {
    expect(() =>
      buildTechnicianServiceAreaRows('prov-1', [
        { ...REGION, id: 'node-city', nodeType: 'CITY', slug: 'western_cape__cape_town' },
      ]),
    ).toThrow(InvalidServiceAreaNodeError)
  })

  it('returns no rows for no nodes', () => {
    expect(buildTechnicianServiceAreaRows('prov-1', [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run __tests__/lib/provider-service-area-rows.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/provider-service-area-rows"`.

- [ ] **Step 3: Create the row builder**

Create `field-service/lib/provider-service-area-rows.ts`:

```ts
// Builds TechnicianServiceArea rows for the provider self-service area picker.
//
// SUBURB rows carry a suburbKey (last slug segment). REGION rows ("cover the
// whole region") carry areaType REGION and a regionKey from the node or its
// slug. Rows are always active: liveness is a property of the location node,
// not of the row. CITY / PROVINCE nodes are never valid service areas.
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { getRegionKeyFromSlug } from '@/lib/service-area-guard'

export type ServiceAreaNodeInput = {
  id: string
  slug: string
  label: string
  nodeType: string
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
}

export type TechnicianServiceAreaRow = {
  providerId: string
  locationNodeId: string
  areaType: 'SUBURB' | 'REGION'
  label: string
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
  suburbKey: string | null
  active: true
}

export class InvalidServiceAreaNodeError extends Error {
  constructor(rejected: ServiceAreaNodeInput[]) {
    super(
      `Invalid service area selection: only SUBURB and REGION nodes are permitted. Rejected node types: ${rejected
        .map((node) => `${node.id}(${node.nodeType})`)
        .join(', ')}`,
    )
    this.name = 'InvalidServiceAreaNodeError'
  }
}

export function buildTechnicianServiceAreaRows(
  providerId: string,
  nodes: ServiceAreaNodeInput[],
): TechnicianServiceAreaRow[] {
  const rejected = nodes.filter((node) => node.nodeType !== 'SUBURB' && node.nodeType !== 'REGION')
  if (rejected.length > 0) throw new InvalidServiceAreaNodeError(rejected)

  return nodes.map((node) => {
    const isSuburb = node.nodeType === 'SUBURB'
    const derivedRegionKey = isSuburb ? null : getRegionKeyFromSlug(node.slug) || null
    return {
      providerId,
      locationNodeId: node.id,
      areaType: isSuburb ? 'SUBURB' : 'REGION',
      label: normaliseLocationDisplayName(node.label),
      provinceKey: node.provinceKey,
      cityKey: node.cityKey,
      regionKey: node.regionKey ?? derivedRegionKey,
      suburbKey: isSuburb ? (node.slug.split('__').at(-1) ?? node.slug) : null,
      active: true,
    }
  })
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm vitest run __tests__/lib/provider-service-area-rows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the failing action tests**

In `field-service/__tests__/provider/provider-profile-save-feedback.test.ts`, inside `describe('provider profile save feedback action', ...)` after the last test (`maps unique email errors to a user-safe message`, ends line 236), add:

```ts
  it('saves a whole-region (REGION node) service area instead of rejecting it', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([
      {
        id: 'region-1',
        slug: 'western_cape__cape_town__cape_town_cbd',
        label: 'Cape Town CBD & Atlantic Seaboard',
        nodeType: 'REGION',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'cape_town_cbd',
      },
    ])
    tx.technicianServiceArea.findMany.mockResolvedValue([])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'region-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.technicianServiceArea.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          providerId: 'provider-1',
          locationNodeId: 'region-1',
          areaType: 'REGION',
          regionKey: 'cape_town_cbd',
          suburbKey: null,
          active: true,
        }),
      ],
      skipDuplicates: true,
    })
  })

  it('still refuses CITY nodes submitted through the picker', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([
      {
        id: 'city-1',
        slug: 'western_cape__cape_town',
        label: 'Cape Town',
        nodeType: 'CITY',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: null,
      },
    ])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'city-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: false, error: 'Could not save your changes. Please try again.' })
    expect(tx.technicianServiceArea.createMany).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run the action tests to verify the new ones fail**

Run: `pnpm vitest run __tests__/provider/provider-profile-save-feedback.test.ts`
Expected: FAIL — `saves a whole-region (REGION node) service area...` gets `{ ok: false, error: 'Could not save your changes. Please try again.' }` (the action still throws "only SUBURB nodes are permitted"). `still refuses CITY nodes...` already passes. Pre-existing tests pass.

- [ ] **Step 7: Rewrite the service-area block in the profile action**

Replace line 5 (`import { normaliseLocationDisplayName } from '@/lib/location-format'`) with:

```ts
import { buildTechnicianServiceAreaRows } from '@/lib/provider-service-area-rows'
```

(`normaliseLocationDisplayName` had a single use in this file, inside the `createMany` data that is replaced below; leaving the import would fail `pnpm lint` as unused.)

Replace lines 125-175 (from `        if (locationNodeIds.length > 0) {` through the closing `        }` of that block, i.e. the `nodes` lookup, the SUBURB-only rejection, `existingAreas`, `toCreate`/`toUpdate`, the `updateMany` and the `createMany`) with:

```ts
        if (locationNodeIds.length > 0) {
          const nodes = await tx.locationNode.findMany({
            where: { id: { in: locationNodeIds }, active: true },
            select: { id: true, slug: true, label: true, nodeType: true, provinceKey: true, cityKey: true, regionKey: true },
          })

          // SUBURB and REGION nodes are valid service areas ("cover the whole
          // region" is a REGION row). Anything else throws before any write.
          const rows = buildTechnicianServiceAreaRows(provider.id, nodes)

          const existingAreas = await tx.technicianServiceArea.findMany({
            where: {
              providerId: provider.id,
              locationNodeId: { in: locationNodeIds },
            },
            select: { locationNodeId: true },
          })

          const existingNodeIds = new Set(existingAreas.map((area) => area.locationNodeId).filter(Boolean))
          const toCreate = rows.filter((row) => !existingNodeIds.has(row.locationNodeId))
          const toUpdate = rows.filter((row) => existingNodeIds.has(row.locationNodeId))

          if (toUpdate.length > 0) {
            await tx.technicianServiceArea.updateMany({
              where: {
                providerId: provider.id,
                locationNodeId: { in: toUpdate.map((row) => row.locationNodeId) },
              },
              data: { active: true },
            })
          }

          if (toCreate.length > 0) {
            await tx.technicianServiceArea.createMany({
              data: toCreate,
              skipDuplicates: true,
            })
          }
        }
```

The preceding `updateMany` that deactivates nodes no longer in the submission (lines 116-123) is unchanged.

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/provider/provider-profile-save-feedback.test.ts __tests__/lib/provider-service-area-rows.test.ts`
Expected: PASS (all).

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add field-service/lib/provider-service-area-rows.ts \
  "field-service/app/(provider)/provider/profile/actions.ts" \
  field-service/__tests__/lib/provider-service-area-rows.test.ts \
  field-service/__tests__/provider/provider-profile-save-feedback.test.ts
git commit -m "feat(provider-profile): allow whole-region (REGION node) service areas

The profile editor rejected REGION nodes from the ServiceAreaPicker search.
Rows are now built by lib/provider-service-area-rows.ts: SUBURB rows keep
their suburbKey, REGION rows get areaType REGION and a regionKey from the
node or slug; CITY/PROVINCE nodes are still refused.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---

### Task 12: Remove the "live in the West Rand first" copy from provider signup

**Files:**
- Modify: `field-service/app/provider/signup/confirmation/page.tsx:15-17`
- Modify: `field-service/app/provider/signup/sections/service-areas.tsx:23-25`
- Modify: `field-service/components/provider/registration/ProviderRegistrationClient.tsx:1531-1533` (the `<p>` inside the `<ScreenPanel ... title="Application received">`, between the `InfoRow` grid and `<FooterActions>`)
- Test: Create `field-service/__tests__/app/provider-signup-national-copy.test.ts`

**Interfaces:**
- Consumes: nothing. Task 7 did not touch these three sentences (its removed phrase list is `Leads go live in the West Rand first`; this one reads `We're live in the West Rand first`).
- Produces: none of `field-service/app/provider/**` or `field-service/components/provider/**` mentions the West Rand.

- [ ] **Step 1: Write the failing source-contract test**

Create `field-service/__tests__/app/provider-signup-national-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: provider-facing copy no longer promises a West Rand-first
// launch. These files carried the sentence after Task 7 removed the picker caveats.
const FILES = [
  'app/provider/signup/confirmation/page.tsx',
  'app/provider/signup/sections/service-areas.tsx',
  'components/provider/registration/ProviderRegistrationClient.tsx',
]

describe('provider signup copy is national', () => {
  it.each(FILES)('%s does not mention the West Rand launch order', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).not.toContain('West Rand')
    expect(source).not.toContain('activated the moment we go live in your area')
  })

  it('the confirmation page keeps its review-timing sentence', () => {
    const source = readFileSync(join(process.cwd(), 'app/provider/signup/confirmation/page.tsx'), 'utf8')
    expect(source).toContain('most reviews happen within one business day')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run __tests__/app/provider-signup-national-copy.test.ts`
Expected: FAIL — the three `does not mention the West Rand launch order` cases fail with `expected ... not to contain 'West Rand'`.

- [ ] **Step 3: Delete the three sentences**

`field-service/app/provider/signup/confirmation/page.tsx` — delete lines 15-17:

```tsx
      <p className="mt-3 text-xs text-muted-foreground">
        {"We're live in the West Rand first — your profile is saved and will be activated the moment we go live in your area."}
      </p>
```

`field-service/app/provider/signup/sections/service-areas.tsx` — delete lines 23-25:

```tsx
      <p className="text-xs text-muted-foreground">
        {"We're live in the West Rand first — your profile is saved and will be activated the moment we go live in your area."}
      </p>
```

`field-service/components/provider/registration/ProviderRegistrationClient.tsx` — delete lines 1531-1533 (between the `</div>` closing the `InfoRow` grid and `<FooterActions>`):

```tsx
              <p className="text-[12px] text-[var(--ink-mute)] leading-relaxed">
                {"We're live in the West Rand first — your profile is saved and will be activated the moment we go live in your area."}
              </p>
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm vitest run __tests__/app/provider-signup-national-copy.test.ts __tests__/components/location-pickers-national-copy.test.ts __tests__/app/provider-registration-pwa-route.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/provider/signup/confirmation/page.tsx \
  field-service/app/provider/signup/sections/service-areas.tsx \
  field-service/components/provider/registration/ProviderRegistrationClient.tsx \
  field-service/__tests__/app/provider-signup-national-copy.test.ts
git commit -m "chore(copy): drop 'live in the West Rand first' from provider signup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---


### Task 13: Customer web bookings route stops waitlisting by geography

**Files:**
- Modify: `field-service/app/api/customer/bookings/route.ts:23` (guard import), `:258-293` (two waitlist branches), `:326-369` (serviceability_v2 block)
- Test: `field-service/__tests__/api/customer-bookings.test.ts`
- Test: `field-service/__tests__/api/customer-bookings-preferred-provider-kyc.test.ts`

**Interfaces:**
- Consumes: `resolveAreaScopeByNodeId(nodeId): Promise<AreaScope | null>`, `countActiveProvidersFor(params: { area?: AreaScope | null; categoryTag?: string | null }): Promise<number>` and `checkPilotGate(params): Promise<{ ok: true } | { ok: false; code: 'pilot.suburb_not_supported' | 'pilot.category_not_supported' | 'pilot.electrical_disabled' }>` from `@/lib/customer-serviceability` (unchanged); `isEnabled(key, ctx?): Promise<boolean>` from `@/lib/flags`; `resolveStructuredAddressCapture(...)` from `@/lib/structured-address` (unchanged).
- Produces: `POST /api/customer/bookings` never returns `{ waitlisted: true, city }`. The route no longer imports anything from `@/lib/service-area-guard`. The zero-provider rejection (`422`, `error: 'CATEGORY_UNAVAILABLE_IN_AREA'`) now runs **regardless of** `customer.home.serviceability_v2`; the flag keeps gating only the home UI and the two other checks (`CATEGORY_UNAVAILABLE` for non-pilot tags, `AREA_UNAVAILABLE` for an unresolvable node). `components/customer/BookingFlow.tsx` still reads `data.waitlisted` until Part B removes that state; that is dead client code after this task, not a runtime error.

- [ ] **Step 1: Rewrite the guard mock and add the failing test in `__tests__/api/customer-bookings.test.ts`**

In the `vi.hoisted` block delete the three lines `mockIsInActiveServiceArea,` / `mockIsActiveRegion,` / `mockAddToServiceAreaWaitlist,` from the destructuring AND the three matching `mockIsInActiveServiceArea: vi.fn(),` / `mockIsActiveRegion: vi.fn(),` / `mockAddToServiceAreaWaitlist: vi.fn(),` entries. Delete the whole block:

```ts
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: mockIsInActiveServiceArea,
  isActiveRegion: mockIsActiveRegion,
  addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist,
}))
```

In `beforeEach` delete the two lines:

```ts
    mockIsInActiveServiceArea.mockReturnValue(true)
    mockIsActiveRegion.mockReturnValue(true)
```

Add this test as the LAST `it(...)` inside `describe('POST /api/customer/bookings', ...)`:

```ts
  it('creates a request for a Cape Town address instead of waitlisting it (national rollout)', async () => {
    mockResolveStructuredAddressCapture.mockResolvedValue({
      street: '8 Kloof Street',
      addressLine1: '8 Kloof Street',
      addressLine2: null,
      complexName: null,
      unitNumber: null,
      suburb: 'Gardens',
      region: 'Cape Town CBD & Atlantic Seaboard',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '8001',
      locationNodeId: 'node-cpt-gardens',
    })

    const formData = new FormData()
    formData.set('category', 'painting')
    formData.set('title', 'Repaint lounge')
    formData.set('addressLine1', '8 Kloof Street')
    formData.set('locationNodeId', 'node-cpt-gardens')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toHaveProperty('waitlisted')
    expect(body).toMatchObject({ jobRequestId: 'jr-1' })
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      category: 'painting',
      city: 'Cape Town',
      province: 'Western Cape',
      locationNodeId: 'node-cpt-gardens',
    }))
  })
```

- [ ] **Step 2: Run the test file to verify it fails**

Run (from `field-service/`): `pnpm vitest run __tests__/api/customer-bookings.test.ts`
Expected: FAIL. With the real guard module now in play, every request-creating test (the 10 existing ones plus the new one) receives `{ waitlisted: true, city: 'Johannesburg' }` or `{ waitlisted: true, city: 'Cape Town' }` instead of a `jobRequestId` — e.g. `expected { waitlisted: true, city: 'Cape Town' } to not have property "waitlisted"` and `expected "spy" to be called with arguments: ...` for `mockCreateJobRequest`. The two "returns 400" tests still pass.

- [ ] **Step 3: Remove the two waitlist branches and the guard import from the route**

In `app/api/customer/bookings/route.ts` delete line 23:

```ts
import { isInActiveServiceArea, isActiveRegion, addToServiceAreaWaitlist } from '@/lib/service-area-guard'
```

Replace the block from the comment `// Service area gate - capture out-of-area contacts on the waitlist` down to (and including) the second `return NextResponse.json({ waitlisted: true, city: resolvedAddress.city })` plus its closing `}` — i.e. everything between `const resolvedAddress = await resolveStructuredAddressCapture({...})` and the `// West Rand pilot gate` comment — with:

```ts
    // National rollout (spec 2026-10-03): there is no geographic fence here any
    // more. Any suburb in the location tree is accepted; the pilot gate below is
    // flag-gated (OFF) and the zero-provider guard further down still rejects an
    // area/category pair nobody serves.
    const areaScope = await resolveAreaScopeByNodeId(resolvedAddress.locationNodeId).catch(() => null)
```

Keep `const channel = await getRequestChannel()` (line 74): it is still used at line 452 for `createJobRequest`'s `source`.

- [ ] **Step 4: Confirm nothing else in the server reads `waitlisted` or the deleted import**

Run (from `field-service/`): `grep -rn "waitlisted" app lib --include='*.ts' --include='*.tsx'`
Expected: only `components/customer/BookingFlow.tsx` lines (Part B's scope) and the comment at `lib/whatsapp-flows/job-request.ts:1676` (rewritten in Task 15). No `app/api` hit.

Run: `grep -n "service-area-guard" app/api/customer/bookings/route.ts`
Expected: no output.

- [ ] **Step 5: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/api/customer-bookings.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Write the failing tests for the flag-independent zero-provider guard**

Still in `__tests__/api/customer-bookings.test.ts`, add three hoisted mocks. In the `vi.hoisted` destructuring add `mockIsEnabled,`, `mockCountActiveProvidersFor,`, `mockResolveAreaScopeByNodeId,` and in the returned object add:

```ts
  mockIsEnabled: vi.fn(),
  mockCountActiveProvidersFor: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
```

Add these two mock blocks after the `vi.mock('@/lib/storage', ...)` line (the plain-object shape mirrors `customer-bookings-preferred-provider-kyc.test.ts`, which already mocks `@/lib/flags` this way):

```ts
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/customer-serviceability', () => ({
  checkPilotGate: vi.fn().mockResolvedValue({ ok: true }),
  countActiveProvidersFor: mockCountActiveProvidersFor,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
}))
```

Add to `beforeEach` (after `mockResolveCustomerForSession.mockResolvedValue(...)`):

```ts
    // Flag OFF by default: the national rollout makes the zero-provider guard
    // independent of customer.home.serviceability_v2.
    mockIsEnabled.mockResolvedValue(false)
    mockResolveAreaScopeByNodeId.mockResolvedValue({
      node: { id: 'node-1', slug: 'gauteng__johannesburg__jhb_north__sandton', label: 'Sandton', nodeType: 'SUBURB', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_north' },
    })
    mockCountActiveProvidersFor.mockResolvedValue(3)
```

Add these two tests as the LAST tests inside `describe('POST /api/customer/bookings', ...)`:

```ts
  it('refuses a zero-provider area/category even when serviceability_v2 is OFF (national rollout)', async () => {
    mockIsEnabled.mockResolvedValue(false)
    mockCountActiveProvidersFor.mockResolvedValue(0)

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'CATEGORY_UNAVAILABLE_IN_AREA',
      category: 'plumbing',
      areaLabel: 'Sandton',
    })
    expect(mockCountActiveProvidersFor).toHaveBeenCalledWith({
      area: expect.objectContaining({ node: expect.objectContaining({ id: 'node-1' }) }),
      categoryTag: 'plumbing',
    })
    expect(mockCreateJobRequest).not.toHaveBeenCalled()
  })

  it('creates the request when at least one provider serves the area with serviceability_v2 OFF', async () => {
    mockIsEnabled.mockResolvedValue(false)
    mockCountActiveProvidersFor.mockResolvedValue(1)

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 7: Run the test file to verify the zero-provider test fails**

Run: `pnpm vitest run __tests__/api/customer-bookings.test.ts`
Expected: FAIL on exactly one test — `refuses a zero-provider area/category even when serviceability_v2 is OFF`: `expected 200 to be 422` (today the whole provider-count check sits inside `if (serviceabilityV2Enabled)`, so with the flag OFF the request is created). The other 14 pass.

- [ ] **Step 8: Un-gate the zero-provider check in the route**

In `app/api/customer/bookings/route.ts` replace the block that starts at the comment `// Serviceability v2 backend guard (customer.home.serviceability_v2):` and ends with the closing `}` of `if (serviceabilityV2Enabled) { … }` (the one that contains the `CATEGORY_UNAVAILABLE_IN_AREA` response) with:

```ts
    // Serviceability v2 backend guard (customer.home.serviceability_v2):
    // Reject unsupported (area, category) tuples here so a client bypassing the
    // home-page constrained input still cannot create a request for a service
    // we cannot fulfil. The PILOT_SKILL_TAGS check covers regulated categories
    // and stays behind the flag together with the home UI.
    const serviceabilityV2Enabled = await isEnabled('customer.home.serviceability_v2', {
      userId: session.id,
    })
    if (serviceabilityV2Enabled) {
      if (!PILOT_SKILL_TAGS.has(canonicalCategory)) {
        return NextResponse.json(
          {
            error: 'CATEGORY_UNAVAILABLE',
            message: 'We do not have this service active yet.',
            category: canonicalCategory,
          },
          { status: 422 },
        )
      }
      if (!areaScope) {
        return NextResponse.json(
          {
            error: 'AREA_UNAVAILABLE',
            message: 'We are not active in this area yet.',
            locationNodeId: resolvedAddress.locationNodeId,
          },
          { status: 422 },
        )
      }
    }

    // Zero-provider guard — NOT flag-gated (national rollout, spec 2026-10-03):
    // with the geographic fence gone this is the only thing standing between a
    // customer and a request that matching would expire on the spot. When the
    // node did not resolve (db error swallowed above) we cannot count, so we
    // fail open exactly as the pre-rollout flag-OFF path did.
    if (areaScope) {
      const activeCount = await countActiveProvidersFor({
        area: areaScope,
        categoryTag: canonicalCategory,
      })
      if (activeCount <= 0) {
        return NextResponse.json(
          {
            error: 'CATEGORY_UNAVAILABLE_IN_AREA',
            message: 'We do not have this service active in your selected area yet.',
            category: canonicalCategory,
            areaLabel: areaScope.node.label,
          },
          { status: 422 },
        )
      }
    }
```

- [ ] **Step 9: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/api/customer-bookings.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 10: Update the preferred-provider KYC test's guard mock**

In `__tests__/api/customer-bookings-preferred-provider-kyc.test.ts` delete `mockIsInActiveServiceArea,` / `mockIsActiveRegion,` / `mockAddToServiceAreaWaitlist,` from the `vi.hoisted` destructuring and their three `vi.fn()` entries; delete the block

```ts
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: mockIsInActiveServiceArea,
  isActiveRegion: mockIsActiveRegion,
  addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist,
}))
```

and delete the two `beforeEach` lines:

```ts
    mockIsInActiveServiceArea.mockReturnValue(true)
    mockIsActiveRegion.mockReturnValue(true)
```

That file does not mock `@/lib/customer-serviceability`, so the real `resolveAreaScopeByNodeId` hits the test's `db` mock (no `locationNode`), throws, is swallowed by `.catch(() => null)`, and the new zero-provider guard is skipped — identical to today's flag-OFF behaviour, so its tests need no other change.

Run: `pnpm vitest run __tests__/api/customer-bookings-preferred-provider-kyc.test.ts`
Expected: PASS (same test count as before the edit).

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0 (no unused-import error for `channel`; it is still used).

- [ ] **Step 12: Commit**

```bash
git add app/api/customer/bookings/route.ts __tests__/api/customer-bookings.test.ts __tests__/api/customer-bookings-preferred-provider-kyc.test.ts
git commit -m "feat(bookings): accept any suburb in the location tree; zero-provider guard runs flag-free

National rollout (spec 2026-10-03 §G). The web bookings route no longer
waitlists an address for being outside Johannesburg or outside jhb_west;
the response shape loses waitlisted. The CATEGORY_UNAVAILABLE_IN_AREA
rejection now runs regardless of customer.home.serviceability_v2 so an
empty area never gets a request that expires on creation. checkPilotGate
(flag OFF) and the flag-gated CATEGORY_UNAVAILABLE / AREA_UNAVAILABLE
checks are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---

### Task 14: WhatsApp request flow lists every active province, city and region

**Files:**
- Create: `field-service/lib/whatsapp-flows/list-row-title.ts`
- Modify: `field-service/lib/whatsapp-flows/job-request.ts:20-26` (guard import), `:82` (list constants), `:224-250` (`buildPagedRows`), `:258-316` (`renderProvinceList`, `renderCityList`, `renderRegionList`)
- Test: `field-service/__tests__/lib/whatsapp-flows/list-row-title.test.ts`
- Test: `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`

**Interfaces:**
- Consumes: `getProvinces(): Promise<ProvinceOption[]>`, `getCities(provinceKey?): Promise<CityOption[]>`, `getRegions(cityId): Promise<RegionOption[]>` from `@/lib/location-nodes` (unchanged); `sendList(to, body, sections: ListSection[], options)` from `@/lib/whatsapp-interactive` where `ListSection = { title?: string; rows: ListRow[] }` and `ListRow = { id: string; title: string /* ≤24 chars */; description?: string }`.
- Produces:
  - `export function listRowTitle(label: string, max = 24): string` in `lib/whatsapp-flows/list-row-title.ts`. Rule: a label of `max` characters or fewer is returned unchanged; otherwise the label is cut inside its first `max − 1` characters at the last space, any trailing connector (`/ & - – — , : ;`) is stripped, and `…` is appended, so the result is always `≤ max` characters, ends on a whole word and never on a dangling connector. **Part D's Task 17 imports this same helper for the registration flow's province/city/region rows.**
  - `buildPagedRows(items, page, idPrefix, reserveRows = 0)` in `job-request.ts` (module-private): `reserveRows` is the number of trailer rows the caller appends after the returned rows. It is taken out of the 10-row budget: the unpaged threshold becomes `10 − reserveRows` items and the page size `PAGE_SIZE − reserveRows` (7 when one trailer row is reserved), so a rendered section is never longer than 10 rows (`MAX_LIST_ROWS`).
  - Each list is ONE section (`'Provinces'` / `'Cities'` / `'Areas'`) whose last row is `AREA_NOT_LISTED_ROW` (`{ id: 'area_not_listed', title: "🔔 My area isn't listed" }`). City and region lists call `buildPagedRows(..., 1)`; the province list is unpaged (9 provinces + trailer = 10, the province handler has no `prov_prev`/`prov_next` branch). `isActiveProvince` and `isActiveCity` are no longer imported by this module (`isActiveRegion` and `isInActiveServiceArea` go in Task 15).

- [ ] **Step 1: Write the failing tests**

In `__tests__/lib/whatsapp-flows/job-request.test.ts`, inside `describe('addr_select_province', ...)`, add:

```ts
    it('lists every province from getProvinces in one "Provinces" section with the not-listed row last (national rollout)', async () => {
      const NINE_PROVINCES = [
        { id: 'prov_ec', slug: 'eastern_cape', label: 'Eastern Cape' },
        { id: 'prov_fs', slug: 'free_state', label: 'Free State' },
        { id: 'prov_gp', slug: 'gauteng', label: 'Gauteng' },
        { id: 'prov_kzn', slug: 'kwazulu_natal', label: 'KwaZulu-Natal' },
        { id: 'prov_lp', slug: 'limpopo', label: 'Limpopo' },
        { id: 'prov_mp', slug: 'mpumalanga', label: 'Mpumalanga' },
        { id: 'prov_nw', slug: 'north_west', label: 'North West' },
        { id: 'prov_nc', slug: 'northern_cape', label: 'Northern Cape' },
        { id: 'prov_wc', slug: 'western_cape', label: 'Western Cape' },
      ]
      ;(locationNodes.getProvinces as any).mockResolvedValue(NINE_PROVINCES)

      // Typed text on this step resends the province list.
      await handleJobRequestFlow(makeCtx('addr_select_province', undefined, 'hello'))

      const sections = (wa.sendList as any).mock.calls.at(-1)[2]
      expect(sections).toHaveLength(1)
      expect(sections[0].title).toBe('Provinces')
      expect(sections[0].rows.map((r: { id: string }) => r.id)).toEqual([
        'prov__eastern_cape',
        'prov__free_state',
        'prov__gauteng',
        'prov__kwazulu_natal',
        'prov__limpopo',
        'prov__mpumalanga',
        'prov__north_west',
        'prov__northern_cape',
        'prov__western_cape',
        'area_not_listed',
      ])
      // WhatsApp hard cap: 10 rows per list message.
      expect(sections[0].rows.length).toBeLessThanOrEqual(10)
    })
```

Inside `describe('addr_select_city', ...)` add:

```ts
    it('lists every city of the province in one "Cities" section with the not-listed row last (national rollout)', async () => {
      ;(locationNodes.getCities as any).mockResolvedValue(CITIES_WC)

      await handleJobRequestFlow(makeCtx('addr_select_province', 'prov__western_cape'))

      const sections = (wa.sendList as any).mock.calls.at(-1)[2]
      expect(sections).toHaveLength(1)
      expect(sections[0].title).toBe('Cities')
      expect(sections[0].rows.map((r: { id: string }) => r.id)).toEqual(['city__city_cpt', 'area_not_listed'])
    })
```

Inside `describe('addr_select_region', ...)` add:

```ts
    it('lists every region of the city in one "Areas" section with the not-listed row last (national rollout)', async () => {
      await handleJobRequestFlow(
        makeCtx('addr_select_city', 'city__city_jhb', undefined, { addrProvinceKey: 'gauteng', addrProvinceLabel: 'Gauteng', addrPage: 0 }),
      )

      const sections = (wa.sendList as any).mock.calls.at(-1)[2]
      expect(sections).toHaveLength(1)
      expect(sections[0].title).toBe('Areas')
      expect(sections[0].rows.map((r: { id: string }) => r.id)).toEqual(['rgn__rgn_north', 'rgn__rgn_south', 'area_not_listed'])
    })
```

Note: `PROVINCES` already contains `western_cape` so `prov__western_cape` resolves in the city test.

- [ ] **Step 2: Run the test file to verify the three new tests fail**

Run (from `field-service/`): `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: 3 new tests FAIL with `expected [ { title: 'Available now', … }, { title: 'Coming soon', … } ] to have a length of 1 but got 2`. All pre-existing tests still pass (the guard mocks return `true`).

- [ ] **Step 3: Rewrite the three renderers**

In `lib/whatsapp-flows/job-request.ts` change the guard import (lines 20-26) to:

```ts
import {
  isInActiveServiceArea,
  isActiveRegion,
  addToServiceAreaWaitlist,
} from '../service-area-guard'
```

Replace `renderProvinceList`, `renderCityList` and `renderRegionList` with:

```ts
async function renderProvinceList(phone: string): Promise<void> {
  const provinces = await getProvinces()
  if (provinces.length === 0) {
    // Location nodes not yet seeded - sending an empty list section fails at the Meta API level.
    // Surface the "area not listed" path so the user is captured on the waitlist.
    await sendText(
      phone,
      `📍 We're expanding our coverage soon! We don't have selectable provinces set up yet.\n\nReply *area not listed* and we'll add you to the waitlist to be notified when we launch in your area.`,
    )
    return
  }
  // National rollout: every active province is selectable. 9 provinces + the
  // not-listed row = 10 rows, which is the WhatsApp per-message list cap.
  const rows: ListRow[] = provinces.map((p) => ({ id: `prov__${p.slug}`, title: p.label.slice(0, 24) }))
  await sendList(
    phone,
    '🏙 *Select your province:*',
    [{ title: 'Provinces', rows: [...rows, AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose Province' },
  )
}

async function renderCityList(
  phone: string,
  provinceKey: string,
  provinceLabel: string,
  page: number,
): Promise<boolean> {
  const cities = await getCities(provinceKey)
  if (cities.length === 0) return false
  const { rows, totalPages } = buildPagedRows(cities, page, 'city')
  const pageNote = totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''
  await sendList(
    phone,
    `📍 *Select your city* in ${provinceLabel}${pageNote}:`,
    [{ title: 'Cities', rows: [...rows, AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose City' },
  )
  return true
}

async function renderRegionList(
  phone: string,
  cityId: string,
  cityLabel: string,
  page: number,
): Promise<boolean> {
  const regions = await getRegions(cityId)
  if (regions.length === 0) return false
  const { rows, totalPages } = buildPagedRows(regions, page, 'rgn')
  const pageNote = totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''
  await sendList(
    phone,
    `🗺 *Select your area* in ${cityLabel}${pageNote}:`,
    [{ title: 'Areas', rows: [...rows, AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose Area' },
  )
  return true
}
```

`ListRow` is already imported (`type ListRow` in the `../whatsapp-interactive` import at the top of the file).

- [ ] **Step 4: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS, all tests (previous count + 3).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0. (`isActiveProvince` / `isActiveCity` are no longer imported here; other importers are untouched.)

- [ ] **Step 6: Write the failing test for the word-boundary row title helper**

Create `__tests__/lib/whatsapp-flows/list-row-title.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listRowTitle } from '@/lib/whatsapp-flows/list-row-title'

describe('listRowTitle', () => {
  it('returns a label of exactly 24 characters unchanged', () => {
    const label = 'JHB North / Sandton Area' // 24 chars
    expect(label).toHaveLength(24)
    expect(listRowTitle(label)).toBe(label)
  })

  it('returns a short label unchanged', () => {
    expect(listRowTitle('Gauteng')).toBe('Gauteng')
  })

  it('cuts at the last word boundary that fits and never leaves a dangling connector', () => {
    // "Cape Town CBD & Atlantic Seaboard" → the 23-char head is "Cape Town CBD & Atlanti";
    // last space → "Cape Town CBD &"; dangling "&" stripped → "Cape Town CBD…".
    const out = listRowTitle('Cape Town CBD & Atlantic Seaboard')
    expect(out).toBe('Cape Town CBD…')
    expect(out.length).toBeLessThanOrEqual(24)
  })

  it('keeps an inner connector when a whole word follows it', () => {
    const out = listRowTitle('Gqeberha / Nelson Mandela Bay')
    expect(out).toBe('Gqeberha / Nelson…')
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out).not.toMatch(/[\/&\-–—,:;]…$/)
  })

  it('handles the seeded long labels within the cap and on a word boundary', () => {
    for (const label of ['East London / Buffalo City', 'Gqeberha / Nelson Mandela Bay', 'Bloemfontein / Mangaung', 'Cape Town Northern Suburbs', 'Cape Town Southern Suburbs', 'eMalahleni / Witbank', 'Mbombela / Nelspruit', 'East Rand / Ekurhuleni', 'Pretoria CBD & Central', 'JHB West / Roodepoort', 'JHB South / Soweto', 'Durban CBD & Berea']) {
      const out = listRowTitle(label)
      expect(out.length).toBeLessThanOrEqual(24)
      if (out !== label) {
        expect(out.endsWith('…')).toBe(true)
        expect(out).not.toMatch(/\s…$/)
        expect(out).not.toMatch(/[\/&\-–—,:;]…$/)
        // The kept part must be a prefix of the label ending on a whole word.
        const kept = out.slice(0, -1)
        expect(label.startsWith(kept)).toBe(true)
        expect(label.charAt(kept.length)).toMatch(/[\s\/&\-–—,:;]/)
      }
    }
  })

  it('falls back to a hard cut when a single word is longer than the cap', () => {
    const out = listRowTitle('Supercalifragilisticexpialidocious')
    expect(out).toBe('Supercalifragilisticexp…')
    expect(out).toHaveLength(24)
  })

  it('honours a custom max', () => {
    // max 20 → 19-char head "Cape Town CBD & Atl" → last space → "Cape Town CBD &" → connector stripped.
    expect(listRowTitle('Cape Town CBD & Atlantic Seaboard', 20)).toBe('Cape Town CBD…')
    expect(listRowTitle('Durban North', 20)).toBe('Durban North')
  })
})
```

- [ ] **Step 7: Run the helper test to verify it fails**

Run (from `field-service/`): `pnpm vitest run __tests__/lib/whatsapp-flows/list-row-title.test.ts`
Expected: FAIL — `Error: Failed to resolve import "@/lib/whatsapp-flows/list-row-title"` (module does not exist yet).

- [ ] **Step 8: Create the helper and use it for every list row title**

Create `lib/whatsapp-flows/list-row-title.ts`:

```ts
// WhatsApp list rows allow 24 characters per title. The curated location
// labels ("Cape Town CBD & Atlantic Seaboard", "Gqeberha / Nelson Mandela Bay")
// are longer, and a blind slice(0, 24) produces titles that end mid-word or on
// a dangling " /" / " &". Cut on a word boundary instead and mark the cut.
//
// Shared by the customer request flow (job-request.ts) and the provider
// registration flow (registration.ts).

const ELLIPSIS = '…' // one UTF-16 code unit
const DANGLING_CONNECTOR = /\s*[\/&\-–—,:;]+$/

export function listRowTitle(label: string, max = 24): string {
  if (label.length <= max) return label

  const budget = Math.max(1, max - ELLIPSIS.length)
  const head = label.slice(0, budget)
  const lastSpace = head.lastIndexOf(' ')

  let kept = lastSpace > 0 ? head.slice(0, lastSpace) : head
  kept = kept.replace(DANGLING_CONNECTOR, '').trimEnd()
  if (kept.length === 0) kept = head.trimEnd()

  return `${kept}${ELLIPSIS}`
}
```

In `lib/whatsapp-flows/job-request.ts` add, next to the other `./`/`../` imports:

```ts
import { listRowTitle } from './list-row-title'
```

In `renderProvinceList` (Step 3) change the row mapping to:

```ts
  const rows: ListRow[] = provinces.map((p) => ({ id: `prov__${p.slug}`, title: listRowTitle(p.label) }))
```

In `buildPagedRows`, replace both `title: item.label.slice(0, 24)` occurrences (the unpaged branch and the paged `rows` mapping) with `title: listRowTitle(item.label)`.

- [ ] **Step 9: Run both test files to verify they pass**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/list-row-title.test.ts __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS. (The existing pagination tests assert row ids, not titles, so the title change is behaviour-neutral for them.)

- [ ] **Step 10: Write the failing test for the 10-row cap with paging**

In `__tests__/lib/whatsapp-flows/job-request.test.ts`, inside `describe('addr_select_city', ...)`, add:

```ts
    it('keeps every paged city list within the 10-row WhatsApp cap with the not-listed row on every page (national rollout)', async () => {
      const TWELVE_CITIES = Array.from({ length: 12 }, (_, i) => ({
        id: `city_${i + 1}`,
        slug: `gauteng__city_${i + 1}`,
        label: `City ${i + 1}`,
        provinceKey: 'gauteng',
        cityKey: `city_${i + 1}`,
      }))
      ;(locationNodes.getCities as any).mockResolvedValue(TWELVE_CITIES)

      // Page 0 is rendered by the province selection.
      await handleJobRequestFlow(makeCtx('addr_select_province', 'prov__gauteng'))
      const page0 = (wa.sendList as any).mock.calls.at(-1)[2][0].rows as Array<{ id: string }>

      // Page 1 is rendered by tapping Next on the city step.
      await handleJobRequestFlow(makeCtx('addr_select_city', 'city_next', undefined, baseData))
      const page1 = (wa.sendList as any).mock.calls.at(-1)[2][0].rows as Array<{ id: string }>

      for (const rows of [page0, page1]) {
        expect(rows.length).toBeLessThanOrEqual(10)
        expect(rows.at(-1)?.id).toBe('area_not_listed')
      }
      // The not-listed row is part of the budget: 7 item slots per page, not 8.
      const cityIds = (rows: Array<{ id: string }>) => rows.map((r) => r.id).filter((id) => id.startsWith('city__'))
      expect(cityIds(page0)).toHaveLength(7)
      expect(page0.map((r) => r.id)).toContain('city_next')
      expect(cityIds(page1)).toHaveLength(5)
      expect(page1.map((r) => r.id)).toContain('city_prev')
      expect(new Set([...cityIds(page0), ...cityIds(page1)]).size).toBe(12)
    })

    it('pages a province with exactly 10 cities so the not-listed row still fits (national rollout)', async () => {
      const TEN_CITIES = Array.from({ length: 10 }, (_, i) => ({
        id: `city_${i + 1}`,
        slug: `gauteng__city_${i + 1}`,
        label: `City ${i + 1}`,
        provinceKey: 'gauteng',
        cityKey: `city_${i + 1}`,
      }))
      ;(locationNodes.getCities as any).mockResolvedValue(TEN_CITIES)

      await handleJobRequestFlow(makeCtx('addr_select_province', 'prov__gauteng'))
      const page0 = (wa.sendList as any).mock.calls.at(-1)[2][0].rows as Array<{ id: string }>

      expect(page0.length).toBeLessThanOrEqual(10)
      expect(page0.at(-1)?.id).toBe('area_not_listed')
      expect(page0.map((r) => r.id)).toContain('city_next')
    })
```

- [ ] **Step 11: Run the test file to verify the two new tests fail**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: FAIL on both new tests — `expected [ …8 ids… ] to have a length of 7 but got 8` for the 12-city case (page size is still 8), and `expected 11 to be less than or equal to 10` for the 10-city case (10 unpaged rows + the not-listed row).

- [ ] **Step 12: Reserve the trailer row inside `buildPagedRows`**

In `lib/whatsapp-flows/job-request.ts` add below `const PAGE_SIZE = 8` (line 82):

```ts
// Meta hard-caps a list message at 10 rows across all sections.
const MAX_LIST_ROWS = 10
```

Replace the whole `buildPagedRows` function (doc comment included) with:

```ts
/**
 * Slices an item list for one WhatsApp list page and appends navigation rows.
 * `reserveRows` is the number of trailer rows the caller appends after these
 * (e.g. the "My area isn't listed" row). It is taken out of the 10-row budget so
 * the rendered section never exceeds the Meta cap: the unpaged threshold becomes
 * MAX_LIST_ROWS - reserveRows and the page size PAGE_SIZE - reserveRows (7 item
 * slots + up to 2 nav rows + 1 trailer = 10).
 */
function buildPagedRows<T extends { id: string; label: string }>(
  items: T[],
  page: number,
  idPrefix: string,
  reserveRows = 0,
): { rows: ListRow[]; totalPages: number } {
  const unpagedCap = MAX_LIST_ROWS - reserveRows
  if (items.length <= unpagedCap) {
    return {
      rows: items.map((item) => ({ id: `${idPrefix}__${item.id}`, title: listRowTitle(item.label) })),
      totalPages: 1,
    }
  }

  const pageSize = PAGE_SIZE - reserveRows
  const totalPages = Math.ceil(items.length / pageSize)
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1))
  const start = clampedPage * pageSize
  const pageItems = items.slice(start, start + pageSize)
  const hasNext = start + pageSize < items.length
  const hasPrev = clampedPage > 0

  const rows: ListRow[] = pageItems.map((item) => ({
    id: `${idPrefix}__${item.id}`,
    title: listRowTitle(item.label),
  }))

  if (hasPrev) rows.push({ id: `${idPrefix}_prev`, title: '← Previous' })
  if (hasNext) rows.push({ id: `${idPrefix}_next`, title: 'Next →' })

  return { rows, totalPages }
}
```

In `renderCityList` change the call to `buildPagedRows(cities, page, 'city', 1)` and in `renderRegionList` to `buildPagedRows(regions, page, 'rgn', 1)`. `renderSuburbList` keeps `buildPagedRows(suburbs, page, 'sub')` (no trailer row; the existing "8 items + Next" pagination test stays valid).

- [ ] **Step 13: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS, all tests (Step 4 count + 2).

- [ ] **Step 14: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 15: Commit**

```bash
git add lib/whatsapp-flows/job-request.ts lib/whatsapp-flows/list-row-title.ts __tests__/lib/whatsapp-flows/job-request.test.ts __tests__/lib/whatsapp-flows/list-row-title.test.ts
git commit -m "feat(whatsapp): request flow lists every active province, city and region

National rollout (spec 2026-10-03 §H). The structured address picker no
longer filters provinces/cities/regions through the JHB fence; each list is
one neutral section with the 'My area isn't listed' row last. Row titles are
cut on a word boundary (listRowTitle) instead of slice(0, 24), and the
not-listed row is reserved inside the 10-row paging budget so a paged list
can never exceed the Meta cap.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---

### Task 15: WhatsApp request flow — neutral "not listed yet" copy, no geographic gates

**Files:**
- Modify: `field-service/lib/whatsapp-flows/job-request.ts:20-24` (guard import), `:256` (new helper next to `AREA_NOT_LISTED_ROW`), `:796-812` (province not-listed), `:849-863` (city not-listed), `:885-898` (city gate — delete), `:931-945` (region not-listed), `:966-986` (region gate — delete), `:1672-1697` (pre-create re-check), `:1930-1952` (legacy typed-city gate — delete)
- Test: `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`
- Test: `field-service/__tests__/lib/whatsapp-flows/rebook.test.ts:77-83`
- Test: `field-service/__tests__/lib/whatsapp-menu-routing.test.ts:90-96`

**Interfaces:**
- Consumes: `addToServiceAreaWaitlist(params: { phone: string; name?: string | null; category?: string | null; suburb?: string | null; city: string; province?: string | null; source: 'whatsapp' | 'pwa' | 'vodapay' }): Promise<void>` from `@/lib/service-area-guard` (unchanged, keeps being used); `resolveAreaScopeByNodeId(nodeId): Promise<AreaScope | null>` from `@/lib/customer-serviceability` (returns `null` for a missing or inactive node).
- Produces: module-private `notListedYetMessage(place: string): string`. The module imports ONLY `addToServiceAreaWaitlist` from `../service-area-guard`. The waitlist row written at the province step uses `city: 'Province not listed'` (was `'Outside Gauteng'`).

Copy note for the reviewer: the spec's template says "Reply *notify me* and we'll tell you the moment we cover it." At every one of these sites the waitlist row has ALREADY been written, and nothing in the flow handles a typed "notify me" after `nextStep: 'done'`, so that sentence would be a dead instruction. The helper below confirms the capture instead. Same intent (neutral copy + waitlist row), no dangling call to action.

- [ ] **Step 1: Rewrite the guard mock and the affected tests in `__tests__/lib/whatsapp-flows/job-request.test.ts`**

Change header comment line 4 from `//  2. City selection: filtered by province, out-of-area waitlists immediately` to `//  2. City selection: filtered by province, every city is selectable (national rollout)`.

Replace the mock block

```ts
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn().mockReturnValue(true),
  isActiveCity: vi.fn().mockReturnValue(true),
  isActiveRegion: vi.fn().mockReturnValue(true),
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

with

```ts
vi.mock('@/lib/service-area-guard', () => ({
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

Delete the two `beforeEach` lines:

```ts
    ;(serviceAreaGuard.isInActiveServiceArea as any).mockReturnValue(true)
    ;(serviceAreaGuard.isActiveRegion as any).mockReturnValue(true)
```

Replace the test `'waitlists and returns done for an out-of-area city'` (inside `describe('addr_select_city')`) with:

```ts
    it('advances to the region list for a Western Cape city (no geographic gate)', async () => {
      ;(locationNodes.getCities as any).mockResolvedValue(CITIES_WC)
      ;(locationNodes.getRegions as any).mockResolvedValue([
        { id: 'rgn_cpt_cbd', slug: 'western_cape__cape_town__cape_town_cbd', label: 'Cape Town CBD & Atlantic Seaboard', provinceKey: 'western_cape', cityKey: 'cape_town', regionKey: 'cape_town_cbd', lat: null, lng: null, radiusKm: null },
      ])

      const result = await handleJobRequestFlow(
        makeCtx('addr_select_city', 'city__city_cpt', undefined, {
          addrProvinceKey: 'western_cape',
          addrProvinceLabel: 'Western Cape',
          addrPage: 0,
          customerName: 'Sipho',
          selectedCategory: 'Plumbing',
        })
      )

      expect(result.nextStep).toBe('addr_select_region')
      expect(result.nextData).toMatchObject({ addrCityId: 'city_cpt', addrCityLabel: 'Cape Town', addrPage: 0 })
      expect(serviceAreaGuard.addToServiceAreaWaitlist).not.toHaveBeenCalled()
      expect(locationNodes.getRegions).toHaveBeenCalledWith('city_cpt')
    })

    it('"My area isn\'t listed" at the city step writes a waitlist row and sends the neutral copy', async () => {
      const result = await handleJobRequestFlow(
        makeCtx('addr_select_city', 'area_not_listed', undefined, {
          addrProvinceKey: 'western_cape',
          addrProvinceLabel: 'Western Cape',
          addrPage: 0,
          customerName: 'Sipho',
          selectedCategory: 'Plumbing',
        })
      )

      expect(result.nextStep).toBe('done')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE, city: 'Western Cape - other', province: 'Western Cape', category: 'Plumbing', source: 'whatsapp' })
      )
      const text = (wa.sendText as any).mock.calls.at(-1)[1] as string
      expect(text).toContain("We don't have *your city in Western Cape* listed yet")
      expect(text).not.toMatch(/Gauteng|Johannesburg|JHB West/)
    })
```

Inside `describe('addr_select_province')` add:

```ts
    it('"My area isn\'t listed" at the province step writes a waitlist row and sends the neutral copy', async () => {
      const result = await handleJobRequestFlow(
        makeCtx('addr_select_province', 'area_not_listed', undefined, { customerName: 'Sipho', selectedCategory: 'Painting' })
      )

      expect(result.nextStep).toBe('done')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE, city: 'Province not listed', category: 'Painting', source: 'whatsapp' })
      )
      const text = (wa.sendText as any).mock.calls.at(-1)[1] as string
      expect(text).toContain("We don't have *your province* listed yet")
      expect(text).not.toMatch(/Gauteng/)
    })
```

Delete the test `'waitlists and does not advance when the selected region is inactive (finding 95726512)'` (inside `describe('addr_select_region')`) and add in its place:

```ts
    it('"My area isn\'t listed" at the region step writes a waitlist row and sends the neutral copy', async () => {
      const result = await handleJobRequestFlow(
        makeCtx('addr_select_region', 'area_not_listed', undefined, { ...baseData, addrProvinceLabel: 'Gauteng', selectedCategory: 'Tiling' })
      )

      expect(result.nextStep).toBe('done')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE, city: 'Johannesburg', province: 'Gauteng', category: 'Tiling', source: 'whatsapp' })
      )
      const text = (wa.sendText as any).mock.calls.at(-1)[1] as string
      expect(text).toContain("We don't have *your area in Johannesburg* listed yet")
      expect(text).not.toMatch(/JHB West|Roodepoort/)
    })
```

Inside `describe('job_request_submitted - structured path')` add (uses the existing `structuredData` and the module-level mock of `resolveAreaScopeByNodeId`):

```ts
    it('submits a Durban address to createJobRequest (any province, national rollout)', async () => {
      const { resolveAreaScopeByNodeId } = await import('@/lib/customer-serviceability')
      ;(resolveAreaScopeByNodeId as any).mockResolvedValueOnce({
        node: { id: 'sub_umhlanga', slug: 'kwazulu_natal__durban__durban_north__umhlanga', label: 'Umhlanga', nodeType: 'SUBURB', provinceKey: 'kwazulu_natal', cityKey: 'durban', regionKey: 'durban_north' },
      })
      ;(structuredAddress.resolveStructuredAddressCapture as any).mockResolvedValue({
        ...resolvedAddr,
        suburb: 'Umhlanga',
        region: 'Durban North',
        city: 'Durban',
        province: 'KwaZulu-Natal',
        postalCode: '4319',
        locationNodeId: 'sub_umhlanga',
      })

      const result = await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, { ...structuredData, addrLocationNodeId: 'sub_umhlanga' })
      )

      expect(createJobRequestModule.createJobRequest).toHaveBeenCalledWith(
        expect.objectContaining({ suburb: 'Umhlanga', city: 'Durban', province: 'KwaZulu-Natal', locationNodeId: 'sub_umhlanga' }),
      )
      expect(serviceAreaGuard.addToServiceAreaWaitlist).not.toHaveBeenCalled()
      expect(result.nextStep).not.toBe('done')
    })

    it('waitlists instead of creating when the resolved node is missing or inactive (spoofed id)', async () => {
      const { resolveAreaScopeByNodeId } = await import('@/lib/customer-serviceability')
      ;(resolveAreaScopeByNodeId as any).mockResolvedValueOnce(null)

      const result = await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(result.nextStep).toBe('done')
      expect(createJobRequestModule.createJobRequest).not.toHaveBeenCalled()
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE, suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', source: 'whatsapp' })
      )
      const text = (wa.sendText as any).mock.calls.at(-1)[1] as string
      expect(text).toContain("We don't have *Sandton* listed yet")
    })
```

Inside `describe('legacy steps')` replace the two tests `'confirm_address for out-of-area city still waitlists via legacy handler'` and `'confirm_address for active city redirects to addr_select_province'` with:

```ts
    it('confirm_address always redirects to the structured picker, never waitlists (national rollout)', async () => {
      const result = await handleJobRequestFlow(
        makeCtx('confirm_address', undefined, 'Cape Town', { customerName: 'Sipho', addressSuburb: 'Sea Point' })
      )

      expect(result.nextStep).toBe('addr_select_province')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).not.toHaveBeenCalled()
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('updated'))
      expect(wa.sendList).toHaveBeenCalled()
    })
```

- [ ] **Step 2: Run the test file to verify the changed tests fail**

Run (from `field-service/`): `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: FAIL. Typical messages: `TypeError: isInActiveServiceArea is not a function` (the flow still imports the gate functions that the trimmed mock no longer provides) on the city, submit and legacy tests; `expected "spy" to be called with arguments: [ ObjectContaining{ city: 'Province not listed', … } ]` on the province not-listed test; `expected '…Plug A Pro is currently only available in *Gauteng*…' to contain "We don't have *your province* listed yet"`.

- [ ] **Step 3: Add the neutral copy helper and remove the gates in `lib/whatsapp-flows/job-request.ts`**

Change the guard import (lines 20-24) to:

```ts
import { addToServiceAreaWaitlist } from '../service-area-guard'
```

Directly below `const AREA_NOT_LISTED_ROW = …` add:

```ts
// National rollout: one neutral "not listed yet" message for every level of the
// area picker. Every caller has already written the waitlist row, so the copy
// confirms the capture instead of asking the customer to do anything else.
function notListedYetMessage(place: string): string {
  return (
    `📍 We don't have *${place}* listed yet.\n\n` +
    `We've saved your details and will WhatsApp you the moment we cover it - no action needed. 🚀`
  )
}
```

In `handleAddrSelectProvince`, replace the `area_not_listed` branch body with:

```ts
  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: 'Province not listed',
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(ctx.phone, notListedYetMessage('your province'))
    return { nextStep: 'done' }
  }
```

In `handleAddrSelectCity`, replace the `area_not_listed` branch body with:

```ts
  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: `${provinceLabel} - other`,
      province: provinceLabel,
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(ctx.phone, notListedYetMessage(`your city in ${provinceLabel}`))
    return { nextStep: 'done' }
  }
```

Still in `handleAddrSelectCity`, delete the whole block between `// ── Service area gate ─…` and `// ──────…` (the `if (!isInActiveServiceArea(selected.label)) { … return { nextStep: 'done' } }` block, including both comment rules), so that after the `if (!selected) { … }` check the code goes straight to `const ok = await renderRegionList(...)`.

In `handleAddrSelectRegion`, replace the `area_not_listed` branch body with:

```ts
  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: cityLabel,
      province: ctx.data.addrProvinceLabel ?? null,
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(ctx.phone, notListedYetMessage(`your area in ${cityLabel}`))
    return { nextStep: 'done' }
  }
```

Still in `handleAddrSelectRegion`, delete the block from the comment `// Server-side service-area gate (finding 95726512): renderRegionList only` through the closing `}` of `if (!isActiveRegion(selected.regionKey)) { … return { nextStep: 'done' } }`, so that after `if (!selected) { … }` the code goes straight to `const ok = await renderSuburbList(...)`.

In `handleJobRequestSubmitted`, replace the pre-create re-check (from the comment `// Final service-area re-check (finding 3cc92366)` through the closing `}` of its `if`) with:

```ts
      // Anti-spoofing re-check (finding 3cc92366, kept under the national
      // rollout): the node id in conversation data is untrusted. It must still
      // resolve to an ACTIVE location node; otherwise waitlist, never create.
      const submitAreaScope = await resolveAreaScopeByNodeId(resolvedAddr.locationNodeId).catch(() => null)
      if (!submitAreaScope) {
        await addToServiceAreaWaitlist({
          phone: ctx.phone,
          name: ctx.data.customerName ?? null,
          category: ctx.data.selectedCategory ?? ctx.data.category ?? category ?? null,
          suburb: resolvedAddr.suburb,
          city: resolvedAddr.city,
          province: resolvedAddr.province,
          source: 'whatsapp',
        }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
        await sendText(ctx.phone, notListedYetMessage(resolvedAddr.suburb))
        return { nextStep: 'done' }
      }
```

Replace the whole `handleLegacyConfirmAddress` function with:

```ts
async function handleLegacyConfirmAddress(ctx: FlowContext): Promise<FlowResult> {
  // National rollout: no typed-city gate. Every in-flight legacy conversation is
  // redirected to the structured picker, which accepts any suburb in the tree.
  await sendText(
    ctx.phone,
    "We've updated our address selection. Let's re-enter your address using our new area picker.",
  )
  await renderProvinceList(ctx.phone)
  return { nextStep: 'addr_select_province', nextData: { addrPage: 0 } }
}
```

- [ ] **Step 4: Confirm no gate symbol remains in the module**

Run (from `field-service/`): `grep -n "isInActiveServiceArea\|isActiveRegion\|isActiveProvince\|isActiveCity\|Outside Gauteng\|only available in\|only serving\|JHB West" lib/whatsapp-flows/job-request.ts`
Expected: no output.

- [ ] **Step 5: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Trim the stale guard mocks in the two neighbouring flow tests**

In `__tests__/lib/whatsapp-flows/rebook.test.ts` replace

```ts
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn().mockReturnValue(true),
  isActiveCity: vi.fn().mockReturnValue(true),
  isActiveRegion: vi.fn().mockReturnValue(true),
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

with

```ts
vi.mock('@/lib/service-area-guard', () => ({
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

In `__tests__/lib/whatsapp-menu-routing.test.ts` replace

```ts
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn(),
  isActiveCity: vi.fn(),
  isActiveRegion: vi.fn(),
  addToServiceAreaWaitlist: vi.fn(),
}))
```

with

```ts
vi.mock('@/lib/service-area-guard', () => ({
  addToServiceAreaWaitlist: vi.fn(),
}))
```

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/rebook.test.ts __tests__/lib/whatsapp-menu-routing.test.ts`
Expected: PASS (same counts as before).

(`__tests__/lib/registration-cancel.test.ts` also mocks `@/lib/service-area-guard`, but for the WhatsApp *registration* flow's `describeCityServiceStatus` / `describeRegionServiceStatus` / label symbols — that belongs to the registration task, not this one. Leave it.)

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/whatsapp-flows/job-request.ts __tests__/lib/whatsapp-flows/job-request.test.ts __tests__/lib/whatsapp-flows/rebook.test.ts __tests__/lib/whatsapp-menu-routing.test.ts
git commit -m "feat(whatsapp): drop the JHB gates from the request flow; neutral not-listed copy

National rollout (spec 2026-10-03 §H/§I). The city, region, submit-time and
legacy typed-city gates are gone; any suburb in the location tree creates a
request. The three 'My area isn't listed' sites share one neutral message
and still write the waitlist row. The submit-time re-check keeps only its
anti-spoofing purpose (node must resolve and be active).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

---

### Task 16: WhatsApp empty-area guard — route to notify-me instead of creating a dead request

**This task ADDS the guard.** Verified against `lib/whatsapp-flows/job-request.ts` @ main 4fc7e8a0: the `notify_me` step exists in `FlowStep` (`lib/whatsapp-flows/types.ts:45`) and `handleNotifyMe` (~`:1965`) handles it, but nothing sets `nextStep: 'notify_me'` and no button with id `notify_me` is ever sent (`grep -rn "notify_me" lib` finds only the type, the dispatcher case and the handler). Today a request in an area with zero providers is created and then expired by the orchestrator (`EMPTY_POOL` → `expireOpenJobRequest`).

**Files:**
- Modify: `field-service/lib/whatsapp-flows/job-request.ts:39` (serviceability import), new import for `canonicalizeServiceCategoryValue`, `handleJobRequestSubmitted` structured path (immediately after the anti-spoofing re-check from Task 15, before `result = await createJobRequest({`), `handleNotifyMe` (~`:1965-2010`)
- Test: `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`

**Interfaces:**
- Consumes: `countActiveProvidersFor(params: { area?: AreaScope | null; categoryTag?: string | null }): Promise<number>` from `@/lib/customer-serviceability` (bounded count, 0 when nobody serves the area for that tag); `canonicalizeServiceCategoryValue(value: string | null | undefined): { raw: string; canonical: string | null; source: 'tag' | 'label' | 'pass-through'; warning?: 'unmapped_service_category' }` from `@/lib/service-category-canonicalization` — NOTE it returns `canonical: raw` with `source: 'pass-through'` for an unmapped label, so "no canonical tag" is detected via `source === 'pass-through'`, not via `canonical == null`; `sendButtons(to, body, buttons: QuickReply[])` where `QuickReply = { id: string; title: string /* ≤20 chars */ }`; `addToServiceAreaWaitlist(...)` as in Task 15; `ConversationData.addrSuburbLabel / addrCityLabel / addrProvinceLabel / selectedCategory / category / customerName`.
- Produces: when the category label canonicalises to a tag AND the count is `0`, the flow sends two buttons (`notify_me`, `back_home`) and returns `{ nextStep: 'notify_me', nextData: { addrSuburbLabel, addrCityLabel, addrProvinceLabel } }`; `createJobRequest` is NOT called. When the label cannot be canonicalised (`source === 'pass-through'`) the guard is skipped entirely (no count lookup) and the request is created. On the `notify_me` reply, `handleNotifyMe` writes a `ServiceAreaWaitlist` row (suburb/city/province/category) before its existing customer upsert and confirmation. A thrown count lookup fails OPEN (request is created) so a serviceability outage never blocks intake.

- [ ] **Step 1: Write the failing tests**

In `__tests__/lib/whatsapp-flows/job-request.test.ts` change the `@/lib/customer-serviceability` mock to:

```ts
vi.mock('@/lib/customer-serviceability', () => ({
  // Submit-time anti-spoof re-check resolves the node; default to an active
  // node so structured submits proceed.
  resolveAreaScopeByNodeId: vi.fn().mockResolvedValue({
    node: { id: 'sub_sandton', slug: '...sandton', label: 'Sandton', nodeType: 'SUBURB', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_west' },
  }),
  // Empty-area guard: default to "someone serves this area" so existing submit
  // tests still create requests; the guard tests override to 0.
  countActiveProvidersFor: vi.fn().mockResolvedValue(5),
}))
```

Add to the imports under `import * as serviceAreaGuard from '@/lib/service-area-guard'`:

```ts
import * as serviceability from '@/lib/customer-serviceability'
```

Add to `beforeEach` (after the `isSuburbChildOfRegion` line):

```ts
    ;(serviceability.countActiveProvidersFor as any).mockResolvedValue(5)
```

Inside `describe('job_request_submitted - structured path')` add:

```ts
    it('routes to notify_me instead of creating a request when nobody serves the area for the category', async () => {
      ;(serviceability.countActiveProvidersFor as any).mockResolvedValue(0)

      const result = await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(serviceability.countActiveProvidersFor).toHaveBeenCalledWith({
        area: expect.objectContaining({ node: expect.objectContaining({ id: 'sub_sandton' }) }),
        categoryTag: 'plumbing',
      })
      expect(createJobRequestModule.createJobRequest).not.toHaveBeenCalled()
      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('*Plumbing* providers in *Sandton*'),
        [
          { id: 'notify_me', title: '🔔 Notify me' },
          { id: 'back_home', title: '🏠 Main menu' },
        ],
      )
      expect(result.nextStep).toBe('notify_me')
      expect(result.nextData).toMatchObject({ addrSuburbLabel: 'Sandton', addrCityLabel: 'Johannesburg', addrProvinceLabel: 'Gauteng' })
    })

    it('creates the request when at least one provider serves the area for the category', async () => {
      ;(serviceability.countActiveProvidersFor as any).mockResolvedValue(1)

      await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(createJobRequestModule.createJobRequest).toHaveBeenCalledTimes(1)
      expect(wa.sendButtons).not.toHaveBeenCalledWith(PHONE, expect.anything(), expect.arrayContaining([expect.objectContaining({ id: 'notify_me' })]))
    })

    it('fails open and creates the request when the provider count lookup throws', async () => {
      ;(serviceability.countActiveProvidersFor as any).mockRejectedValue(new Error('db down'))

      await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(createJobRequestModule.createJobRequest).toHaveBeenCalledTimes(1)
    })
```

Add a new `describe` block inside the outer `describe('WhatsApp job-request flow - structured address')`, after `describe('legacy steps')`:

```ts
  describe('notify_me (empty-area capture)', () => {
    const emptyAreaData = {
      customerName: 'Thabo',
      selectedCategory: 'Plumbing',
      category: 'Plumbing',
      addrSuburbLabel: 'Umhlanga',
      addrCityLabel: 'Durban',
      addrProvinceLabel: 'KwaZulu-Natal',
    }

    it('writes a waitlist row for the suburb/category and confirms', async () => {
      const result = await handleJobRequestFlow(makeCtx('notify_me', 'notify_me', undefined, emptyAreaData))

      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith({
        phone: PHONE,
        name: 'Thabo',
        category: 'Plumbing',
        suburb: 'Umhlanga',
        city: 'Durban',
        province: 'KwaZulu-Natal',
        source: 'whatsapp',
      })
      expect(db.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: PHONE } }))
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('*Plumbing*'))
      expect(result.nextStep).toBe('done')
    })

    it('back_home returns to the main menu without writing a waitlist row', async () => {
      const result = await handleJobRequestFlow(makeCtx('notify_me', 'back_home', undefined, emptyAreaData))

      expect(serviceAreaGuard.addToServiceAreaWaitlist).not.toHaveBeenCalled()
      expect(result.nextStep).toBe('welcome')
    })
  })
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run (from `field-service/`): `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: FAIL on 3 tests — `expected "spy" to be called with arguments: [ { area: …, categoryTag: 'plumbing' } ]` / `expected "spy" to not be called at all, but actually been called 1 times` (`createJobRequest`) for the zero-count test, and `expected "spy" to be called with arguments: [ { phone: …, suburb: 'Umhlanga', … } ]` for the notify_me waitlist test. The "creates the request" and "fails open" tests pass already (no guard yet) — that is expected; they pin the behaviour once the guard exists.

- [ ] **Step 3: Add the guard and the waitlist write**

In `lib/whatsapp-flows/job-request.ts` change line 39 to:

```ts
import { countActiveProvidersFor, resolveAreaScopeByNodeId } from '../customer-serviceability'
```

and add, next to the other `../` imports:

```ts
import { canonicalizeServiceCategoryValue } from '../service-category-canonicalization'
```

In `handleJobRequestSubmitted`, directly AFTER the anti-spoofing re-check block from Task 15 (`if (!submitAreaScope) { … return { nextStep: 'done' } }`) and BEFORE `result = await createJobRequest({`, insert:

```ts
      // Empty-area guard (national rollout, spec §H): never create a request that
      // matching would expire on the spot. Zero active providers for this category
      // in the resolved area → offer the notify-me capture instead. Fails OPEN on a
      // lookup error so a serviceability outage can never block intake.
      const categoryTag = canonicalizeServiceCategoryValue(category).canonical ?? category
      const activeProviderCount = await countActiveProvidersFor({
        area: submitAreaScope,
        categoryTag,
      }).catch((err) => {
        console.error('[job-request-flow] active provider count failed; failing open', { err })
        return Number.POSITIVE_INFINITY
      })
      if (activeProviderCount <= 0) {
        await sendButtons(
          ctx.phone,
          `😔 We don't have any *${ctx.data.selectedCategory ?? category}* providers in *${resolvedAddr.suburb}* yet.\n\n` +
          `We're onboarding providers across South Africa. Want us to tell you the moment one is available near you?`,
          [
            { id: 'notify_me', title: '🔔 Notify me' },
            { id: 'back_home', title: '🏠 Main menu' },
          ],
        )
        return {
          nextStep: 'notify_me',
          nextData: {
            addrSuburbLabel: resolvedAddr.suburb,
            addrCityLabel: resolvedAddr.city,
            addrProvinceLabel: resolvedAddr.province,
          },
        }
      }
```

In `handleNotifyMe`, inside the `if (ctx.reply.id === 'notify_me' || ctx.step === 'notify_me') {` branch, immediately BEFORE `const fallbackName = normalizeCustomerName(ctx.data.customerName)` (i.e. after the provider-phone early return), insert:

```ts
    // Record the demand so ops and the expansion report see where customers
    // asked for a category we cannot serve yet.
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      suburb: ctx.data.addrSuburbLabel ?? null,
      city: ctx.data.addrCityLabel ?? 'Unknown',
      province: ctx.data.addrProvinceLabel ?? null,
      source: 'whatsapp',
    }).catch((err) => console.error('[notify_me] waitlist upsert failed:', err))
```

Leave the rest of `handleNotifyMe` (customer upsert, confirmation text, `back_home` → `showMainMenu`) unchanged.

- [ ] **Step 4: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS, all tests (previous count + 5).

- [ ] **Step 5: Write the failing test for an uncanonicalisable category label**

Inside `describe('job_request_submitted - structured path')` add:

```ts
    it('skips the empty-area guard for a category label that cannot be canonicalised (never a spurious notify-me)', async () => {
      // Even with zero providers reported, an unmapped label must not trigger the guard.
      ;(serviceability.countActiveProvidersFor as any).mockResolvedValue(0)

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, {
          ...structuredData,
          selectedCategory: 'Chandelier polishing',
          category: 'Chandelier polishing',
        })
      )

      expect(serviceability.countActiveProvidersFor).not.toHaveBeenCalled()
      expect(createJobRequestModule.createJobRequest).toHaveBeenCalledTimes(1)
      expect(wa.sendButtons).not.toHaveBeenCalledWith(PHONE, expect.anything(), expect.arrayContaining([expect.objectContaining({ id: 'notify_me' })]))
    })

    it('still routes a mapped label with zero providers to notify_me', async () => {
      ;(serviceability.countActiveProvidersFor as any).mockResolvedValue(0)

      const result = await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(serviceability.countActiveProvidersFor).toHaveBeenCalledWith(expect.objectContaining({ categoryTag: 'plumbing' }))
      expect(result.nextStep).toBe('notify_me')
      expect(createJobRequestModule.createJobRequest).not.toHaveBeenCalled()
    })
```

- [ ] **Step 6: Run the test file to verify the unmapped-label test fails**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: FAIL on exactly one test — `skips the empty-area guard for a category label that cannot be canonicalised`: `expected "spy" to not be called at all, but actually been called 1 times` (`countActiveProvidersFor` was called with `categoryTag: 'Chandelier polishing'` because `canonicalizeServiceCategoryValue` passes an unmapped label through as `canonical: raw`) and `createJobRequest` was not called. The mapped-label test passes already.

- [ ] **Step 7: Skip the guard when the label has no canonical tag**

In `handleJobRequestSubmitted` replace the two lines

```ts
      const categoryTag = canonicalizeServiceCategoryValue(category).canonical ?? category
      const activeProviderCount = await countActiveProvidersFor({
        area: submitAreaScope,
        categoryTag,
      }).catch((err) => {
        console.error('[job-request-flow] active provider count failed; failing open', { err })
        return Number.POSITIVE_INFINITY
      })
```

with

```ts
      // canonicalizeServiceCategoryValue passes an UNMAPPED label through as
      // canonical=raw with source 'pass-through'. Counting providers for such a
      // label would always return 0 and send a served area to notify-me, so the
      // guard only runs for a label that resolves to a real category tag.
      const canonicalCategory = canonicalizeServiceCategoryValue(category)
      const categoryTag = canonicalCategory.source === 'pass-through' ? null : canonicalCategory.canonical
      const activeProviderCount = categoryTag
        ? await countActiveProvidersFor({
            area: submitAreaScope,
            categoryTag,
          }).catch((err) => {
            console.error('[job-request-flow] active provider count failed; failing open', { err })
            return Number.POSITIVE_INFINITY
          })
        : Number.POSITIVE_INFINITY
```

The `if (activeProviderCount <= 0) { … }` block below it is unchanged.

- [ ] **Step 8: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/job-request.test.ts`
Expected: PASS, all tests (Step 4 count + 2).

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add lib/whatsapp-flows/job-request.ts __tests__/lib/whatsapp-flows/job-request.test.ts
git commit -m "feat(whatsapp): empty-area guard — offer notify-me instead of a request that expires on creation

National rollout (spec 2026-10-03 §H). Before createJobRequest the flow counts
active providers for the resolved area + category; at zero it sends the
notify-me buttons and parks the conversation on the existing notify_me step,
which now also records the demand on the service-area waitlist. The guard
only runs for a label that canonicalises to a real category tag and fails
open on lookup errors, so it can never produce a spurious notify-me.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

<!-- review-focus-candidates-C (remaining after the four items above were folded into Tasks 13/14/16):
1. notify_me conversation state: a customer who taps Notify me after the conversation data was pruned (no addrCityLabel) writes a waitlist row with city 'Unknown'; the fallback value is untested and may pollute the waitlist report.
2. Vodapay channel: the removed waitlist branches were the only place the route set source 'vodapay' for waitlist rows; no test asserts that a VodaPay-origin request with no providers still produces any demand record (the 422 CATEGORY_UNAVAILABLE_IN_AREA carries no capture).
3. Web zero-provider guard when resolveAreaScopeByNodeId throws (db error): the guard is skipped and the request is created, then expired by matching; the fail-open path is documented but untested.
-->

### Task 17: WhatsApp registration lists every province from the location tree and drops the pilot copy

**Files:**
- Modify: `field-service/lib/whatsapp-flows/registration.ts:55-63` (guard import block, replaced by the `listRowTitle` import), `:1216-1251` (`promptArea`, `handleCollectArea`, `PROVINCE_KEY_MAP`), `:1255-1332` (`handleCollectExperience`), `:1350-1401` (`handleCollectCity`), `:1403-1427` (`showRegionList`), `:1429-1496` (`handleCollectRegion`), `:1506-1556` (`showSuburbNumberedPrompt`), `:1558-1726` (`handleCollectSuburbSelect`)
- Test: `field-service/__tests__/lib/whatsapp-flows/registration.test.ts:117-124` (location-nodes mock), `:1108-1122`, `:1138-1177`, `:1473-1497`

**Interfaces:**
- Consumes: `getProvinces(): Promise<ProvinceOption[]>` where `ProvinceOption = { id: string; slug: string; label: string }` (`lib/location-nodes.ts:14-18`, unchanged by this plan); `getCities(provinceKey?: string): Promise<CityOption[]>`; `getRegions(cityId: string): Promise<RegionOption[]>`; `getSuburbs(regionId: string): Promise<SuburbOption[]>`. Part B (Task 5) removes `serviceStatus` from `RegionOption` / `SuburbOption`; this task never reads it. `listRowTitle(label: string, max = 24): string` from `field-service/lib/whatsapp-flows/list-row-title.ts` (created in Task 14): word-boundary truncation with "…", result ≤ `max` — used for every province, city and region row title.
- Produces: province list rows with id `area__<provinceSlug>` (double underscore) and no `description`; `ConversationData.provinceKey` set from the row id; `showSuburbNumberedPrompt(phone, regionId, regionLabel, selectedLabels, selectedIds, pageOffset)` with the `regionStatus` parameter removed; `registration.ts` no longer imports anything from `../service-area-guard`. `selectedRegionStatus` is no longer written anywhere in the flow (the field itself is deleted in Task 19).

- [ ] **Step 1: Update the location-nodes mock and rewrite the three province/city/region tests to fail against the current code**

In `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` add, next to the other `@/lib/...` imports (after `import * as locationNodes from '@/lib/location-nodes'` at line 133):

```ts
import { listRowTitle } from '@/lib/whatsapp-flows/list-row-title'
```

Then replace the `vi.mock('@/lib/location-nodes', …)` block (lines 116-124) with:

```ts
// 20 fake suburbs - intentionally more than SUBURB_PAGE_SIZE to validate pagination cap.
// getProvinces returns all nine SA provinces, as the seeded location tree does.
vi.mock('@/lib/location-nodes', () => ({
  getProvinces: vi.fn().mockResolvedValue([
    { id: 'prov_ec', slug: 'eastern_cape', label: 'Eastern Cape' },
    { id: 'prov_fs', slug: 'free_state', label: 'Free State' },
    { id: 'prov_gp', slug: 'gauteng', label: 'Gauteng' },
    { id: 'prov_kzn', slug: 'kwazulu_natal', label: 'KwaZulu-Natal' },
    { id: 'prov_lp', slug: 'limpopo', label: 'Limpopo' },
    { id: 'prov_mp', slug: 'mpumalanga', label: 'Mpumalanga' },
    { id: 'prov_nw', slug: 'north_west', label: 'North West' },
    { id: 'prov_nc', slug: 'northern_cape', label: 'Northern Cape' },
    { id: 'prov_wc', slug: 'western_cape', label: 'Western Cape' },
  ]),
  getCities: vi.fn().mockResolvedValue([]),
  getRegions: vi.fn().mockResolvedValue([]),
  getSuburbs: vi.fn().mockResolvedValue(
    Array.from({ length: 20 }, (_, i) => ({ id: `sub_${i}`, label: `Suburb ${i + 1}` }))
  ),
}))
```

Replace the test `'skills_confirm with selections proceeds to area (interactive province list)'` (lines 1108-1122) with:

```ts
  it('skills_confirm with selections shows all nine provinces from the location tree', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', 'skills_confirm', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Plumbing', 'Electrical'],
      })
    )

    expect(locationNodes.getProvinces).toHaveBeenCalledTimes(1)
    expect(wa.sendList).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('province'),
      expect.any(Array),
      expect.any(Object),
    )
    const sections = (wa.sendList as any).mock.calls[0][2]
    const rows = sections[0].rows as Array<{ id: string; title: string; description?: string }>
    // WhatsApp caps a list section at 10 rows; all 9 provinces must fit in one section.
    expect(sections).toHaveLength(1)
    expect(rows).toHaveLength(9)
    expect(rows.length).toBeLessThanOrEqual(10)
    expect(rows.map((r) => r.id)).toEqual([
      'area__eastern_cape', 'area__free_state', 'area__gauteng', 'area__kwazulu_natal',
      'area__limpopo', 'area__mpumalanga', 'area__north_west', 'area__northern_cape', 'area__western_cape',
    ])
    expect(rows.every((r) => r.description === undefined)).toBe(true)
    expect(rows.find((r) => r.title === 'Other province')).toBeUndefined()
    expect(result.nextStep).toBe('reg_collect_experience')
  })
```

Replace the test `'marks only Johannesburg as active pilot in the city list'` (lines 1138-1153) with:

```ts
  it('lists the cities of the chosen province with no status descriptions and no pilot notice', async () => {
    ;(locationNodes.getCities as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'city_jhb', label: 'Johannesburg', cityKey: 'johannesburg', provinceKey: 'gauteng', slug: 'gauteng__johannesburg' },
      { id: 'city_pta', label: 'Pretoria', cityKey: 'pretoria', provinceKey: 'gauteng', slug: 'gauteng__pretoria' },
    ])

    const result = await handleRegistrationFlow({
      phone,
      step: 'reg_collect_experience' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: { type: 'list_reply' as any, id: 'area__gauteng', title: 'Gauteng' },
    })
    const rows = (wa.sendList as any).mock.calls[0][2][0].rows as Array<{ id: string; title: string; description?: string }>

    expect(locationNodes.getCities).toHaveBeenCalledWith('gauteng')
    expect(rows.map((r) => r.title)).toEqual(['Johannesburg', 'Pretoria'])
    expect(rows.every((r) => r.description === undefined)).toBe(true)
    expect(wa.sendText).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('reg_collect_city')
    expect(result.nextData?.provinceKey).toBe('gauteng')
    expect(result.nextData?.province).toBe('Gauteng')
    expect(result.nextData).not.toHaveProperty('selectedRegionStatus')
  })

  it('a non-Gauteng province proceeds to the city step without a pilot notice', async () => {
    ;(locationNodes.getCities as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'city_cpt', label: 'Cape Town', cityKey: 'cape_town', provinceKey: 'western_cape', slug: 'western_cape__cape_town' },
    ])

    const result = await handleRegistrationFlow({
      phone,
      step: 'reg_collect_experience' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: { type: 'list_reply' as any, id: 'area__western_cape', title: 'Western Cape' },
    })

    expect(locationNodes.getCities).toHaveBeenCalledWith('western_cape')
    expect(wa.sendText).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('reg_collect_city')
    expect(result.nextData?.provinceKey).toBe('western_cape')
    expect(result.nextData).not.toHaveProperty('selectedRegionStatus')
  })

  it('row titles respect the 24-char WhatsApp cap via listRowTitle; short labels are unchanged', async () => {
    ;(locationNodes.getCities as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'city_gq', label: 'Gqeberha / Nelson Mandela Bay', cityKey: 'gqeberha', provinceKey: 'eastern_cape', slug: 'eastern_cape__gqeberha' },
    ])

    // Province list first: 'Gauteng' must come through untouched.
    await handleRegistrationFlow(makeCtx('reg_collect_skills_more', 'skills_confirm', undefined, { name: 'T', skills: ['Plumbing'] }))
    const provinceRows = (wa.sendList as any).mock.calls[0][2][0].rows as Array<{ id: string; title: string }>
    expect(provinceRows.find((r) => r.id === 'area__gauteng')?.title).toBe('Gauteng')
    expect(listRowTitle('Gauteng')).toBe('Gauteng')

    // City list: the long label is truncated by the shared helper, not by slice().
    const result = await handleRegistrationFlow({
      phone,
      step: 'reg_collect_experience' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: { type: 'list_reply' as any, id: 'area__eastern_cape', title: 'Eastern Cape' },
    })
    const cityRows = (wa.sendList as any).mock.calls[1][2][0].rows as Array<{ id: string; title: string }>
    const title = cityRows[0].title
    expect(title).toBe(listRowTitle('Gqeberha / Nelson Mandela Bay'))
    expect(title.length).toBeLessThanOrEqual(24)
    expect(title.trim()).not.toMatch(/[/&]$/)
    expect(result.nextStep).toBe('reg_collect_city')
  })

  it('a reply that is not a province row re-sends the province list', async () => {
    const result = await handleRegistrationFlow(makeCtx('reg_collect_experience', undefined, 'hello'))

    expect(locationNodes.getProvinces).toHaveBeenCalledTimes(1)
    expect((wa.sendList as any).mock.calls[0][2][0].rows).toHaveLength(9)
    expect(result.nextStep).toBe('reg_collect_experience')
  })
```

Replace the test `'marks only JHB West / Roodepoort as active in Johannesburg area list'` (lines 1155-1177) with:

```ts
  it('lists regions with no status descriptions and no "leads go live first" copy', async () => {
    ;(locationNodes.getRegions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'rgn_west', label: 'JHB West / Roodepoort', regionKey: 'jhb_west', slug: 'gauteng__johannesburg__jhb_west' },
      { id: 'rgn_north', label: 'Johannesburg North', regionKey: 'jhb_north', slug: 'gauteng__johannesburg__jhb_north' },
    ])

    const result = await handleRegistrationFlow({
      phone,
      step: 'reg_collect_city' as any,
      data: { provinceKey: 'gauteng' } as any,
      flow: 'registration' as const,
      reply: { type: 'list_reply' as any, id: 'city_city_jhb', title: 'Johannesburg' },
    })
    const body: string = (wa.sendList as any).mock.calls[0][1]
    const rows = (wa.sendList as any).mock.calls[0][2][0].rows as Array<{ id: string; title: string; description?: string }>

    expect(body).toContain('Which area of *Johannesburg*')
    expect(body).not.toContain('Leads go live')
    expect(body).not.toContain('coming soon')
    expect(rows.map((r) => r.id)).toEqual(['region_rgn_west', 'region_rgn_north'])
    expect(rows.every((r) => r.description === undefined)).toBe(true)
    expect(result.nextStep).toBe('reg_collect_region')
    expect(result.nextData).not.toHaveProperty('selectedRegionStatus')
  })
```

In the describe `'registration flow - numbered bulk suburb selection'`, extend the test `'shows a numbered text list (not interactive list) after region is selected'` (lines 1473-1497) by adding, before `expect(result.nextStep)`:

```ts
    expect(locationNodes.getRegions).not.toHaveBeenCalled()
    expect(wa.sendText).not.toHaveBeenCalledWith(phone, expect.stringContaining('Coming soon area'))
    expect(result.nextData).not.toHaveProperty('selectedRegionStatus')
```

- [ ] **Step 2: Run the test file to verify the new cases fail**

Run (from `field-service/`): `pnpm vitest run __tests__/lib/whatsapp-flows/registration.test.ts`
Expected: FAIL — `'skills_confirm with selections shows all nine provinces'` fails with `expected "spy" to be called 1 times, but got 0 times` (getProvinces), `'lists the cities of the chosen province…'` fails because `getCities` is called with `'gauteng'` only via `PROVINCE_KEY_MAP` and `sendText` IS called (the pilot interstitial), `'a non-Gauteng province…'` fails on `expect(wa.sendText).not.toHaveBeenCalled()`, `'lists regions with no status descriptions…'` fails on `expect(body).not.toContain('Leads go live')`, `'row titles respect the 24-char WhatsApp cap…'` fails with `expected 'Gqeberha / Nelson Mandela Bay' to be '…'` (the current code passes `c.label` through untruncated), and the suburb-list test fails on `expect(locationNodes.getRegions).not.toHaveBeenCalled()`.

- [ ] **Step 3: Remove the guard import and rewrite the province, city and region handlers**

In `field-service/lib/whatsapp-flows/registration.ts` delete the import block (lines 55-63):

```ts
import {
  ACTIVE_PILOT_CITY_LABEL,
  ACTIVE_PILOT_REGION_LABEL,
  ONBOARDING_PILOT_REGION_LABEL,
  describeCityServiceStatus,
  describeRegionServiceStatus,
  getRegionServiceStatus,
  type ServiceAreaStatus,
} from '../service-area-guard'
```

and in its place add the shared row-title helper (created in Task 14):

```ts
import { listRowTitle } from './list-row-title'
```

Replace `promptArea`, `handleCollectArea`, the `PROVINCE_KEY_MAP` block and `handleCollectExperience` (lines 1216-1332) with:

```ts
const SUBURB_FREE_TEXT_PROMPT =
  `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`

async function promptArea(ctx: FlowContext): Promise<FlowResult> {
  try {
    const { getProvinces } = await import('@/lib/location-nodes')
    const provinces = await getProvinces()
    if (provinces.length === 0) {
      await sendText(ctx.phone, SUBURB_FREE_TEXT_PROMPT)
      return { nextStep: 'reg_collect_suburb_text' }
    }
    // WhatsApp caps a list section at 10 rows and a row title at 24 chars.
    // South Africa has nine provinces, so the tree fits one section; slice
    // defensively anyway and let listRowTitle handle the title cap.
    const rows = provinces.slice(0, 10).map((p) => ({
      id: `area__${p.slug}`,
      title: listRowTitle(p.label),
    }))

    await sendList(
      ctx.phone,
      '📍 Which province do you mainly work in?',
      [{ title: 'Provinces', rows }],
      { buttonLabel: 'Choose Province' }
    )
    return { nextStep: 'reg_collect_experience' }
  } catch {
    // Location tree unavailable - fall back to free text so registration never dead-ends.
    await sendText(ctx.phone, SUBURB_FREE_TEXT_PROMPT)
    return { nextStep: 'reg_collect_suburb_text' }
  }
}

async function handleCollectArea(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'edit_skills' || ctx.reply.id === 'skills_change') {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* - previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  return promptArea(ctx)
}

// ─── Experience and availability ──────────────────────────────────────────────

const PROVINCE_ROW_PREFIX = 'area__'

async function handleCollectExperience(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith(PROVINCE_ROW_PREFIX)) {
    return promptArea(ctx)
  }

  // The row id carries the province node slug (e.g. area__western_cape); the
  // slug doubles as provinceKey for getCities.
  const provinceKey = ctx.reply.id.slice(PROVINCE_ROW_PREFIX.length)
  const areaLabel = ctx.reply.title ?? ''

  try {
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(provinceKey)

    if (cities.length === 0) {
      // No cities seeded for this province - ask provider to type their suburb
      await sendText(ctx.phone, SUBURB_FREE_TEXT_PROMPT)
      return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey } }
    }

    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: listRowTitle(c.label),
    }))

    await sendList(
      ctx.phone,
      '🏙 Which city do you mainly work in?',
      [{ title: 'Cities', rows }],
      { buttonLabel: 'Choose City' }
    )
    return {
      nextStep: 'reg_collect_city',
      nextData: {
        serviceAreas: [areaLabel],
        province: areaLabel,
        provinceKey,
      },
    }
  } catch {
    // DB unavailable - ask provider to type their suburb
    await sendText(ctx.phone, SUBURB_FREE_TEXT_PROMPT)
    return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey } }
  }
}
```

Replace `handleCollectCity` and `showRegionList` (lines 1350-1427) with:

```ts
async function handleCollectCity(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('city_')) {
    // Re-show city list using stored provinceKey
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(ctx.data.provinceKey)
    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: listRowTitle(c.label),
    }))
    await sendList(ctx.phone, '🏙 Please choose your city:', [{ title: 'Cities', rows }], { buttonLabel: 'Choose City' })
    return { nextStep: 'reg_collect_city' }
  }

  const cityId = ctx.reply.id.replace('city_', '')
  const cityLabel = ctx.reply.title ?? ''

  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(cityId)

    if (regions.length === 0) {
      // No regions for this city - ask provider to type their suburb
      await sendText(
        ctx.phone,
        `📍 Which suburb or area of *${cityLabel}* do you mainly work in?\n\nType the suburb name (e.g. *Allen's Nek*, *Fourways*, *Rondebosch*):`,
      )
      return {
        nextStep: 'reg_collect_suburb_text',
        nextData: { city: cityLabel, cityId },
      }
    }

    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: listRowTitle(r.label),
    }))

    await sendList(
      ctx.phone,
      `🗺 Which area of *${cityLabel}* do you mainly work in?`,
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return {
      nextStep: 'reg_collect_region',
      nextData: { city: cityLabel, cityId },
    }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability', nextData: { city: cityLabel } }
  }
}

async function showRegionList(ctx: FlowContext): Promise<FlowResult> {
  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(ctx.data.cityId ?? '')
    if (regions.length === 0) {
      await sendExperiencePrompt(ctx.phone)
      return { nextStep: 'reg_collect_availability' }
    }
    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: listRowTitle(r.label),
    }))
    await sendList(
      ctx.phone,
      '🗺 Please choose an area:',
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_region' }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability' }
  }
}
```

In `handleCollectRegion` (lines 1429-1496) replace everything from `const regionLabel = ctx.reply.title ?? ''` to the end of the function with:

```ts
  const regionLabel = ctx.reply.title ?? ''

  // Drill down to suburb selection within this region (numbered text list).
  // Every active region is live for leads; there is no status to evaluate here.
  return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0)
}
```

- [ ] **Step 4: Remove the status parameter from the suburb prompt and handler**

In `showSuburbNumberedPrompt` (line 1506) delete the parameter `regionStatus: ServiceAreaStatus = 'coming_soon',` and delete every `selectedRegionStatus: regionStatus,` line inside it (three occurrences: the no-suburbs `nextData`, the main `nextData`, and the `catch` `nextData`). The no-suburbs branch keeps `locationNodeIds: [regionId], selectedRegionLabels: [regionLabel]` — that is the REGION node id attachment the spec relies on (Task 18 pins it with a test).

In `handleCollectSuburbSelect` (line 1558):
- delete the line `const selectedRegionStatus = (ctx.data.selectedRegionStatus as ServiceAreaStatus | undefined) ?? 'coming_soon'`
- delete every `selectedRegionStatus,` property line in the `nextData` objects (four occurrences: `suburb_confirm`, `done`, `all`, and the merged-selection return at the end of the function)
- remove the trailing `, selectedRegionStatus` argument from every `showSuburbNumberedPrompt(...)` call in the function (seven call sites: `suburb_confirm` empty case, `suburb_add_more`, `suburb_change`, `done` empty case, `more`, the empty-input case, and the all-invalid case).

Run `pnpm typecheck` from `field-service/` — it must report no `ServiceAreaStatus` / `selectedRegionStatus`-related errors in `registration.ts`. (`ConversationData.selectedRegionStatus` still exists until Task 19; it is simply never written now.)

- [ ] **Step 5: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/registration.test.ts`
Expected: PASS (all tests in the file, including the unchanged suburb-selection, duplicate-prevention and evidence tests).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0 (no unused-import warnings — `ServiceAreaStatus`, `ACTIVE_PILOT_*`, `describe*ServiceStatus` and `getRegionServiceStatus` are gone from the file; `listRowTitle` is imported and used).

- [ ] **Step 7: Commit**

```bash
git add field-service/lib/whatsapp-flows/registration.ts field-service/__tests__/lib/whatsapp-flows/registration.test.ts
git commit -m "feat(whatsapp-registration): list all provinces from the location tree; drop pilot copy

promptArea now reads getProvinces() (9 rows, within the 10-row WhatsApp
section cap) with ids area__<slug>; PROVINCE_KEY_MAP and the silent
'Other province' -> Gauteng mapping are gone. Removes the 'Pilot Phase'
interstitial, the city/region status descriptions, the 'Coming soon area'
message and the regionStatus plumbing through the suburb step. Row titles go
through the shared listRowTitle helper. The flow no longer imports
lib/service-area-guard.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §F

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 18: WhatsApp suburb step — "all" covers the whole region via a REGION node

**Files:**
- Modify: `field-service/lib/whatsapp-flows/registration.ts` (`handleCollectSuburbSelect` `rawLower === 'all'` branch and the number-parsing branch; `buildSuburbPromptText` at `:3768-3800`)
- Test: `field-service/__tests__/lib/whatsapp-flows/registration.test.ts` (describe `'registration flow - numbered bulk suburb selection'`)

**Interfaces:**
- Consumes: `showSuburbNumberedPrompt(phone, regionId, regionLabel, selectedLabels, selectedIds, pageOffset)` from Task 17; `ConversationData.locationNodeIds: string[]`, `selectedSuburbLabels: string[]`, `selectedRegionLabels: string[]` (`lib/whatsapp-flows/types.ts:266-269`).
- Produces: after a `all` reply, `nextData.locationNodeIds === [regionId]` and `nextData.selectedSuburbLabels === []`, so the submit path resolves area labels from `selectedRegionLabels` (`registration.ts:324, 2110, 2922-2924`) and the application's `serviceAreas[]` carries the region label — the same label `upsertStructuredServiceAreas` (Task 1) writes on the `areaType: 'REGION'` row. The resync script (Task 9) relies on that label equality.

- [ ] **Step 1: Write the failing tests**

In `field-service/__tests__/lib/whatsapp-flows/registration.test.ts`, inside `describe('registration flow - numbered bulk suburb selection', …)`, replace the test `'"all" selects all 20 suburbs and shows confirmation'` with:

```ts
  it('"all" covers the whole region: stores the REGION node id, not the suburb ids', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, 'all', suburbBaseData)
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Whole Sandton'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'suburb_confirm' }),
        expect.objectContaining({ id: 'suburb_change' }),
      ]),
    )
    const body: string = (wa.sendButtons as any).mock.calls[0][1]
    expect(body).toContain('including suburbs not on the list')
    expect(result.nextStep).toBe('reg_collect_suburb_select')
    expect(result.nextData?.locationNodeIds).toEqual(['rgn_test'])
    expect(result.nextData?.selectedSuburbLabels).toEqual([])
    expect(result.nextData?.selectedRegionLabels).toEqual(['Sandton'])
  })

  it('suburb_confirm after "all" proceeds with only the REGION node id', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', 'suburb_confirm', undefined, {
        ...suburbBaseData,
        locationNodeIds: ['rgn_test'],
        selectedSuburbLabels: [],
        selectedRegionLabels: ['Sandton'],
      })
    )

    expect(result.nextStep).toBe('reg_collect_availability')
    expect(result.nextData?.locationNodeIds).toEqual(['rgn_test'])
    expect(result.nextData?.selectedSuburbLabels).toEqual([])
    expect(result.nextData?.selectedRegionLabels).toEqual(['Sandton'])
  })

  it('typing suburb numbers after "all" replaces the whole-region choice (mutually exclusive)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, '2,4', {
        ...suburbBaseData,
        locationNodeIds: ['rgn_test'],
        selectedSuburbLabels: [],
      })
    )

    expect(result.nextData?.locationNodeIds).toEqual(['sub_1', 'sub_3'])
    expect(result.nextData?.selectedSuburbLabels).toEqual(['Suburb 2', 'Suburb 4'])
  })

  it('the numbered prompt tells providers to reply "all" when their suburb is not listed', async () => {
    await handleRegistrationFlow(
      makeCtx('reg_collect_region', 'region_rgn_test', undefined, { cityId: 'city_jhb' })
    )

    const body: string = (wa.sendText as any).mock.calls.at(-1)[1]
    expect(body).toContain("Reply *all* if your suburb isn't listed or you cover the whole region_rgn_test area.")
  })

  it('a region with no listed suburbs stores the REGION node id and skips to experience', async () => {
    ;(locationNodes.getSuburbs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_region', 'region_rgn_empty', undefined, { cityId: 'city_kim' })
    )

    expect(wa.sendList).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('experience'),
      expect.any(Array),
      expect.any(Object),
    )
    expect(result.nextStep).toBe('reg_collect_availability')
    expect(result.nextData?.locationNodeIds).toEqual(['rgn_empty'])
    expect(result.nextData?.selectedRegionLabels).toEqual(['region_rgn_empty'])
  })
```

(`makeCtx` sets `reply.title = replyId`, which is why the region label in the last two tests reads `region_rgn_test` / `region_rgn_empty`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/registration.test.ts -t "whole region|after \"all\"|not listed|no listed suburbs"`
Expected: FAIL — the `all` test fails with `expected [ 'sub_0', 'sub_1', … ] to deeply equal [ 'rgn_test' ]`; the mutual-exclusion test fails with `expected [ 'rgn_test', 'sub_1', 'sub_3' ] to deeply equal [ 'sub_1', 'sub_3' ]`; the prompt test fails because the current line reads `Reply *all* to cover the whole region_rgn_test area.`; the `suburb_confirm` and no-suburbs tests PASS already (they pin existing behaviour and must stay green).

- [ ] **Step 3: Implement the whole-region branch, the exclusivity guard and the prompt line**

In `field-service/lib/whatsapp-flows/registration.ts`, in `handleCollectSuburbSelect`, replace the `if (rawLower === 'all') { … }` block with:

```ts
  if (rawLower === 'all') {
    // Whole-region coverage: one REGION-type service-area row instead of N suburb
    // rows. The region label travels via selectedRegionLabels so the application's
    // serviceAreas[] and the TechnicianServiceArea label are the same string.
    await sendButtons(
      ctx.phone,
      `✅ *Whole ${regionLabel} selected!*\n\nYou'll be matched to jobs anywhere in ${regionLabel}, including suburbs not on the list.\n\nContinue?`,
      [
        { id: 'suburb_confirm', title: '✅ Continue' },
        { id: 'suburb_change', title: '✏️ Change' },
      ],
    )
    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId, regionLabel, suburbPage, suburbOptions,
        locationNodeIds: [regionId],
        selectedSuburbLabels: [],
        selectedRegionLabels: [regionLabel],
      },
    }
  }
```

Immediately above the comment `// ── Parse number input ───…` add:

```ts
  // Whole-region and individual suburbs are mutually exclusive per region: typing
  // suburb numbers after "all" replaces the region-wide choice.
  const wholeRegionSelected = existingIds.includes(regionId)
  const baseIds: string[] = wholeRegionSelected ? [] : existingIds
  const baseLabels: string[] = wholeRegionSelected ? [] : existingLabels
```

and in the number-parsing code that follows, change `else if (!existingIds.includes(suburb.id))` to `else if (!baseIds.includes(suburb.id))`, change `if (newIds.length === 0 && existingIds.length === 0 && invalidNums.length > 0)` to `if (newIds.length === 0 && baseIds.length === 0 && invalidNums.length > 0)`, and change

```ts
  const mergedIds = [...existingIds, ...newIds]
  const mergedLabels = [...existingLabels, ...newLabels]
```

to

```ts
  const mergedIds = [...baseIds, ...newIds]
  const mergedLabels = [...baseLabels, ...newLabels]
```

In `buildSuburbPromptText` (line ~3798) replace

```ts
  instructions.push(`Reply *all* to cover the whole ${regionLabel} area.`)
```

with

```ts
  instructions.push(`Reply *all* if your suburb isn't listed or you cover the whole ${regionLabel} area.`)
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/registration.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, then commit**

Run: `pnpm typecheck` — expected exit 0.

```bash
git add field-service/lib/whatsapp-flows/registration.ts field-service/__tests__/lib/whatsapp-flows/registration.test.ts
git commit -m "feat(whatsapp-registration): \"all\" covers the whole region via a REGION node

Replying 'all' in the suburb step now stores the REGION node id (one
areaType=REGION service-area row) instead of every listed suburb, and the
prompt invites it when the provider's suburb is not listed. Whole-region and
individual suburbs are mutually exclusive per region. Pins the existing
no-suburbs path that already attaches the REGION id.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §F

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 19: Remove `selectedRegionStatus` and the "coming soon" caveats from onboarding data and copy

**Files:**
- Modify: `field-service/lib/whatsapp-flows/types.ts:268`, `field-service/lib/whatsapp-conversation-state.ts:33`, `field-service/lib/provider-onboarding/quality-gate-submission.ts:386`, `field-service/lib/whatsapp-flows/registration.ts:2719` and `:3409-3416`, `field-service/lib/provider-credit-copy.ts:279-299`, `field-service/lib/whatsapp-flows/provider-journey.ts:754-778`
- Test: `field-service/__tests__/lib/provider-onboarding/quality-gate-submission.test.ts:241,1650`, `field-service/__tests__/lib/whatsapp-copy.test.ts:183`, `field-service/__tests__/lib/whatsapp-body-lint.test.ts:43`, `field-service/__tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts:199-214`, `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` (new describe)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildProviderApplicationSubmittedMessage(params: { providerName?: string | null; applicationRef: string; termsUrl?: string })` — `isComingSoonRegion` removed; `ConversationData` without `selectedRegionStatus`; the WHATSAPP quality-gate submit payload type without `selectedRegionStatus`; `pj_service_areas` lists active area labels only.

- [ ] **Step 1: Write the failing tests**

In `field-service/__tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts` replace the two tests `'includes coming-soon region note when region is not live'` and `'does not include coming-soon note for active regions'` (lines 199-214) with:

```ts
  it('never includes a coming-soon region note (every active region is live)', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Sipho',
      applicationRef: 'ZZZZ9999',
    })
    expect(msg).not.toMatch(/not live yet|coming soon/i)
    expect(msg).not.toMatch(/activated the moment/i)
  })
```

In `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` add a new describe block after the `'pj_toggle_available step'` describe (keep it inside the outer `describe('handleProviderJourneyFlow', …)`):

```ts
  describe('pj_service_areas step', () => {
    it('lists active structured areas plainly, hides inactive rows, no pilot tags', async () => {
      ;(db.provider.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        serviceAreas: ['Sandton', 'Florida'],
        technicianServiceAreas: [
          { label: 'Sandton', active: true },
          { label: 'Florida', active: false },
          { label: 'JHB North / Sandton', active: true },
        ],
      })

      const result = await handleProviderJourneyFlow(mockCtx('pj_service_areas'))

      const body: string = (wa.sendButtons as any).mock.calls[0][1]
      expect(body).toContain('📍 *Service Areas*')
      expect(body).toContain('Sandton')
      expect(body).toContain('JHB North / Sandton')
      expect(body).not.toContain('Florida')
      expect(body).not.toContain('Active pilot')
      expect(body).not.toContain('Coming soon')
      expect(body).not.toContain('status saved')
      expect(result.nextStep).toBe('pj_toggle_available')
    })

    it('falls back to legacy serviceAreas labels when no structured rows exist', async () => {
      ;(db.provider.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        serviceAreas: ['Rondebosch', 'Claremont'],
        technicianServiceAreas: [],
      })

      await handleProviderJourneyFlow(mockCtx('pj_service_areas'))

      const body: string = (wa.sendButtons as any).mock.calls[0][1]
      expect(body).toContain('Rondebosch\nClaremont')
      expect(body).not.toContain('status saved')
    })

    it('shows the empty-state line when the provider has no areas at all', async () => {
      ;(db.provider.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        serviceAreas: [],
        technicianServiceAreas: [{ label: 'Removed Area', active: false }],
      })

      await handleProviderJourneyFlow(mockCtx('pj_service_areas'))

      const body: string = (wa.sendButtons as any).mock.calls[0][1]
      expect(body).toContain('No service areas saved yet.')
      expect(body).not.toContain('Removed Area')
    })
  })
```

- [ ] **Step 2: Run the two test files to verify the new cases fail**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts`
Expected: the blueprint test PASSES already (the caveat is opt-in) — it stays as the pin; `provider-journey` FAILS: `'lists active structured areas plainly…'` with `expected '📍 *Service Areas*\n\nSandton - Active pilot\nFlorida - Coming soon…' not to contain 'Active pilot'`, the legacy test fails on `'status saved'`, the empty-state test fails because `Removed Area - Coming soon` is listed.

- [ ] **Step 3: Delete the field and the caveat**

`field-service/lib/whatsapp-flows/types.ts` — delete line 268:

```ts
  selectedRegionStatus?: 'active' | 'coming_soon'
```

`field-service/lib/whatsapp-conversation-state.ts` line 33 — change

```ts
    'selectedRegionLabels', 'selectedRegionStatus', 'selectedSuburbLabels', 'locationNodeIds',
```

to

```ts
    'selectedRegionLabels', 'selectedSuburbLabels', 'locationNodeIds',
```

`field-service/lib/provider-onboarding/quality-gate-submission.ts` — delete line 386:

```ts
    selectedRegionStatus: string | null
```

`field-service/lib/whatsapp-flows/registration.ts` — delete line 2719:

```ts
      selectedRegionStatus: ctx.data.selectedRegionStatus ?? null,
```

and at lines 3409-3416 replace

```ts
    const isComingSoonRegion = ctx.data.selectedRegionStatus === 'coming_soon'
    try {
      await sendButtons(
        ctx.phone,
        buildProviderApplicationSubmittedMessage({
          providerName: ctx.data.name,
          applicationRef: submitResult.ref,
          isComingSoonRegion,
        }),
```

with

```ts
    try {
      await sendButtons(
        ctx.phone,
        buildProviderApplicationSubmittedMessage({
          providerName: ctx.data.name,
          applicationRef: submitResult.ref,
        }),
```

`field-service/lib/provider-credit-copy.ts` — replace everything from the line `export function buildProviderApplicationSubmittedMessage(params: {` down to and including the line `    regionLine.trim(),` (lines 279-298) with:

```ts
export function buildProviderApplicationSubmittedMessage(params: {
  providerName?: string | null
  applicationRef: string
  termsUrl?: string
}) {
  void params.termsUrl // retained for callers; URL travels via the CTA follow-up, not the body
  const name = params.providerName?.trim().split(/\s+/)[0] || 'there'

  return [
    '✅ *Application submitted!*',
    '',
    `Thanks, *${name}*. We've received your Plug A Pro provider application.`,
    '',
    `Ref: *${params.applicationRef}*`,
    '',
    'We will review your details and update you here. Approval is not automatic.',
```

(the lines that follow — the `''` separators, the 'If approved…', 'Once approved…' and 'Provider credits terms…' strings, and `].filter(Boolean).join('\n')` — stay exactly as they are; `regionLine` no longer exists anywhere in the file).

`field-service/lib/whatsapp-flows/provider-journey.ts` — in `handleServiceAreas` replace

```ts
  const structuredAreas = provider.technicianServiceAreas.map(
    (area) => `${area.label} - ${area.active ? 'Active pilot' : 'Coming soon'}`,
  )
  const legacyAreas = provider.serviceAreas.map((area) => `${area} - status saved`)
  const areas = structuredAreas.length ? structuredAreas : legacyAreas
```

with

```ts
  // Every active row is live for leads; inactive rows are areas the provider or
  // an admin removed, so they are not shown.
  const structuredAreas = provider.technicianServiceAreas
    .filter((area) => area.active)
    .map((area) => area.label)
  const legacyAreas = provider.serviceAreas
  const areas = structuredAreas.length ? structuredAreas : legacyAreas
```

Then remove the now-invalid fixture properties from tests:
- `field-service/__tests__/lib/provider-onboarding/quality-gate-submission.test.ts` — delete the two lines `selectedRegionStatus: null,` (lines 241 and 1650).
- `field-service/__tests__/lib/whatsapp-copy.test.ts` — delete line 183 `isComingSoonRegion: false,`.
- `field-service/__tests__/lib/whatsapp-body-lint.test.ts` — delete line 43 `isComingSoonRegion: false,`.

- [ ] **Step 4: Run the affected tests and typecheck**

Run: `pnpm vitest run __tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts __tests__/lib/whatsapp-copy.test.ts __tests__/lib/whatsapp-body-lint.test.ts __tests__/lib/provider-onboarding/quality-gate-submission.test.ts __tests__/lib/whatsapp-flows/registration.test.ts && pnpm typecheck`
Expected: all PASS; typecheck exit 0. (If typecheck reports `Object literal may only specify known properties, and 'selectedRegionStatus' does not exist` anywhere, that file still carries the field — delete the property there too; the grep `git grep -n selectedRegionStatus -- field-service` must return nothing.)

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/whatsapp-flows/types.ts field-service/lib/whatsapp-conversation-state.ts field-service/lib/provider-onboarding/quality-gate-submission.ts field-service/lib/whatsapp-flows/registration.ts field-service/lib/provider-credit-copy.ts field-service/lib/whatsapp-flows/provider-journey.ts field-service/__tests__/lib/provider-onboarding/quality-gate-submission.test.ts field-service/__tests__/lib/whatsapp-copy.test.ts field-service/__tests__/lib/whatsapp-body-lint.test.ts field-service/__tests__/lib/whatsapp-flows/registration-onboarding-blueprint.test.ts field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts
git commit -m "refactor(onboarding): remove selectedRegionStatus and the coming-soon caveats

Deletes the selectedRegionStatus flow field (types, state whitelist, QGv2
WHATSAPP payload, submit passthrough), the isComingSoonRegion caveat in the
application-submitted message, and the 'Active pilot' / 'Coming soon' tags
in the provider WhatsApp service-areas view, which now lists active rows only.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §F, §I

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 20: Marketing service-policy coverage copy goes national

**Files:**
- Modify: `marketing/app/(marketing)/service-policy/page.tsx:16-22`
- Create: `marketing/__tests__/app/service-policy.test.ts`

**Interfaces:**
- Consumes: `scanTextForForbiddenClaims(text: string, filePath?: string): ClaimFinding[]` from `marketing/lib/marketing/claimGuard.ts` (the public-claim guard). The sentence deliberately says "independent providers" — "verified provider", "vetted" and "worker" are banned public-claim terms in `marketing/content/marketing/banned-copy.ts`; the test below proves the paragraph is clean.
- Produces: the paragraph text the spec locks, verbatim.

- [ ] **Step 1: Write the failing test**

Create `marketing/__tests__/app/service-policy.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanTextForForbiddenClaims } from "@/lib/marketing/claimGuard";

const PAGE_PATH = "app/(marketing)/service-policy/page.tsx";

async function pageSource(): Promise<string> {
  // The claim guard scans route files the same way; vitest runs with cwd = marketing/.
  return readFile(join(process.cwd(), PAGE_PATH), "utf8");
}

describe("service-policy coverage copy", () => {
  it("states national coverage in the exact approved wording", async () => {
    const src = await pageSource();
    expect(src).toContain("Plug A Pro operates across South Africa.");
    expect(src).toContain(
      "Availability depends on independent providers near you; where we have none yet, you can ask to be notified the moment one joins.",
    );
  });

  it("no longer names a single launch area or the waitlist", async () => {
    const src = await pageSource();
    expect(src).not.toMatch(/Johannesburg West|Roodepoort|currently serves|waitlist/);
  });

  it("keeps the link to the service-areas landing page", async () => {
    const src = await pageSource();
    expect(src).toContain('<Link href="/areas/johannesburg">service areas</Link>');
  });

  it("passes the public claim guard", async () => {
    const src = await pageSource();
    expect(scanTextForForbiddenClaims(src, PAGE_PATH)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `marketing/`): `pnpm vitest run __tests__/app/service-policy.test.ts`
Expected: FAIL — `'states national coverage…'` fails with `expected '…' to contain 'Plug A Pro operates across South Africa.'`; `'no longer names a single launch area…'` fails on `Johannesburg West`; the link and claim-guard tests PASS already.

- [ ] **Step 3: Replace the paragraph**

In `marketing/app/(marketing)/service-policy/page.tsx` replace lines 16-22:

```tsx
        <h2>Where we operate</h2>
        <p>
          Plug A Pro currently serves <strong>Johannesburg West / Roodepoort</strong>.
          If your address is outside this area, we add you to our waitlist and
          notify you when we launch near you. See{" "}
          <Link href="/areas/johannesburg">service areas</Link>.
        </p>
```

with (the approved sentence stays on ONE source line because the test reads the source file, not the rendered HTML):

```tsx
        <h2>Where we operate</h2>
        <p>
          Plug A Pro operates across South Africa. Availability depends on independent providers near you; where we have none yet, you can ask to be notified the moment one joins. See{" "}
          <Link href="/areas/johannesburg">service areas</Link>.
        </p>
```

(ESLint in `marketing/` has no max-line-length rule; `pnpm lint` in Step 4 confirms.)

- [ ] **Step 4: Run the marketing tests and lint**

Run: `pnpm vitest run __tests__/app/service-policy.test.ts && pnpm lint && pnpm test`
Expected: service-policy test PASS (4/4); lint exit 0; full marketing suite PASS (the claim guard suite `__tests__/marketing-claims.test.ts` does not scan this page, and `__tests__/content/area-content.test.ts` / `areas-sitemap.test.ts` are untouched).

- [ ] **Step 5: Commit**

```bash
git add "marketing/app/(marketing)/service-policy/page.tsx" marketing/__tests__/app/service-policy.test.ts
git commit -m "docs(marketing): service-policy coverage copy goes national

'Where we operate' no longer names Johannesburg West / Roodepoort or the
waitlist; it states national coverage with availability depending on
providers near the customer. Adds a source-level test that pins the wording,
the service-areas link and a clean public-claim-guard scan.

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §I

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

### Task 21 (FINAL): Delete the launch-region sets from `service-area-guard.ts`, add the no-pilot-copy guard test, open the PR

**Files:**
- Modify: `field-service/lib/service-area-guard.ts` (whole file), `field-service/__tests__/lib/service-area-guard.test.ts` (whole file), and the `vi.mock('@/lib/service-area-guard', …)` factories in `field-service/__tests__/lib/registration-cancel.test.ts:70-76`, `field-service/__tests__/lib/whatsapp-menu-routing.test.ts:90-96`, `field-service/__tests__/lib/whatsapp-flows/rebook.test.ts:77-83`, `field-service/__tests__/api/customer-bookings.test.ts:53-…`, `field-service/__tests__/api/customer-bookings-pilot-gate.test.ts:57-…`, `field-service/__tests__/api/customer-bookings-preferred-provider-kyc.test.ts:57-…`, `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts:105-…`
- Create: `field-service/__tests__/lib/no-pilot-copy.test.ts`

**Interfaces:**
- Consumes: every importer of a deleted symbol has already been rewritten by Tasks 1-20. This task is the proof.
- Produces: `lib/service-area-guard.ts` exporting exactly `normalizeLocationKey(value: string | null | undefined): string`, `getRegionKeyFromSlug(slug: string | null | undefined): string`, and `addToServiceAreaWaitlist(params: { phone: string; name?: string | null; category?: string | null; suburb?: string | null; city: string; province?: string | null; source: 'whatsapp' | 'pwa' | 'vodapay' }): Promise<void>`. `OutsideServiceAreaError` is deleted (zero callers at base `4fc7e8a0`: `git grep -n OutsideServiceAreaError -- field-service` lists only its own definition).

- [ ] **Step 1: Prove no production code still references a deleted symbol**

Run (from the worktree root):

```bash
git grep -n -E "ACTIVE_PROVINCE_SLUGS|ACTIVE_CITY_NODE_KEYS|ONBOARDING_ACTIVE_REGION_KEYS|MATCHING_ACTIVE_REGION_KEYS|ACTIVE_REGION_KEYS_SET|ONBOARDING_PILOT_REGION_LABEL|ACTIVE_PILOT_REGION_LABEL|ACTIVE_PILOT_CITY_LABEL|ServiceAreaStatus|RegionServiceLiveStatus|serviceStatusForRegionKey|getRegionServiceStatus|getCityServiceStatus|describeCityServiceStatus|describeRegionServiceStatus|ACTIVE_CITY_KEYS|isActiveProvince|isActiveCity|isOnboardingActiveRegion|isMatchingActiveRegion|isActiveRegion|isInActiveServiceArea|OutsideServiceAreaError|ServiceGate" -- field-service ':!field-service/lib/service-area-guard.ts' ':!field-service/__tests__/lib/service-area-guard.test.ts'
```

Expected: the only hits are inside `vi.mock('@/lib/service-area-guard', …)` factories in test files (at base there are seven: `__tests__/lib/registration-cancel.test.ts`, `__tests__/lib/whatsapp-menu-routing.test.ts`, `__tests__/lib/whatsapp-flows/rebook.test.ts`, `__tests__/api/customer-bookings.test.ts`, `__tests__/api/customer-bookings-pilot-gate.test.ts`, `__tests__/api/customer-bookings-preferred-provider-kyc.test.ts`, `__tests__/lib/whatsapp-flows/job-request.test.ts`; Tasks 12-16 may already have cleaned some). If any hit is in `lib/`, `app/`, `components/` or `scripts/`, STOP: an earlier task is incomplete — fix that file by its own task's instructions before continuing.

Then, in each remaining test factory, delete the keys that name a deleted symbol and keep `addToServiceAreaWaitlist` where present:

`field-service/__tests__/lib/registration-cancel.test.ts` lines 70-76 — replace

```ts
vi.mock('@/lib/service-area-guard', () => ({
  ACTIVE_PILOT_CITY_LABEL: 'Johannesburg',
  ACTIVE_PILOT_REGION_LABEL: 'JHB North',
  describeCityServiceStatus: vi.fn().mockReturnValue(''),
  describeRegionServiceStatus: vi.fn().mockReturnValue(''),
  getRegionServiceStatus: vi.fn().mockReturnValue({ available: true }),
}))
```

with

```ts
vi.mock('@/lib/service-area-guard', () => ({
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

`field-service/__tests__/lib/whatsapp-menu-routing.test.ts` lines 90-96 and `field-service/__tests__/lib/whatsapp-flows/rebook.test.ts` lines 77-83 — replace each factory with

```ts
vi.mock('@/lib/service-area-guard', () => ({
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))
```

For `customer-bookings.test.ts`, `customer-bookings-pilot-gate.test.ts`, `customer-bookings-preferred-provider-kyc.test.ts` and `job-request.test.ts`: open each `vi.mock('@/lib/service-area-guard', …)` factory, delete every property whose name is in the alternation above (typically `isInActiveServiceArea`, `isActiveProvince`, `isActiveCity`, `isActiveRegion`), keep `addToServiceAreaWaitlist`, and delete any `expect(serviceAreaGuard.isActiveRegion)…` / `mockReturnValue` lines that referenced them (in `job-request.test.ts` the `import * as serviceAreaGuard` at line 140 stays if `addToServiceAreaWaitlist` is still asserted, otherwise delete the import). Re-run the grep: expected output is empty.

- [ ] **Step 2: Rewrite the guard test to cover only the surviving helpers**

Replace the whole of `field-service/__tests__/lib/service-area-guard.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    serviceAreaWaitlist: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { db } from '@/lib/db'
import {
  normalizeLocationKey,
  getRegionKeyFromSlug,
  addToServiceAreaWaitlist,
} from '@/lib/service-area-guard'

const waitlist = db.serviceAreaWaitlist as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

describe('normalizeLocationKey', () => {
  it('lower-cases, trims and joins whitespace/hyphens with underscores', () => {
    expect(normalizeLocationKey('  JHB West ')).toBe('jhb_west')
    expect(normalizeLocationKey('Cape-Town  CBD')).toBe('cape_town_cbd')
  })

  it('returns an empty string for null, undefined and blank input', () => {
    expect(normalizeLocationKey(null)).toBe('')
    expect(normalizeLocationKey(undefined)).toBe('')
    expect(normalizeLocationKey('   ')).toBe('')
  })
})

describe('getRegionKeyFromSlug', () => {
  it('returns the last double-underscore segment of a node slug, normalised', () => {
    expect(getRegionKeyFromSlug('gauteng__johannesburg__jhb_west')).toBe('jhb_west')
    expect(getRegionKeyFromSlug('western_cape__cape_town__Cape_Town_CBD')).toBe('cape_town_cbd')
  })

  it('returns an empty string for null/undefined', () => {
    expect(getRegionKeyFromSlug(null)).toBe('')
    expect(getRegionKeyFromSlug(undefined)).toBe('')
  })
})

describe('addToServiceAreaWaitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    waitlist.findFirst.mockResolvedValue(null)
  })

  it('creates a normalised row when the phone+city pair is new', async () => {
    await addToServiceAreaWaitlist({
      phone: '+27820000001',
      name: 'Thandi',
      category: 'painting',
      suburb: 'sea point',
      city: 'cape town',
      province: 'western cape',
      source: 'whatsapp',
    })

    expect(waitlist.findFirst).toHaveBeenCalledWith({
      where: { phone: '+27820000001', city: { equals: 'Cape Town', mode: 'insensitive' } },
      select: { id: true },
    })
    expect(waitlist.update).not.toHaveBeenCalled()
    expect(waitlist.create).toHaveBeenCalledWith({
      data: {
        phone: '+27820000001',
        name: 'Thandi',
        category: 'painting',
        suburb: 'Sea Point',
        city: 'Cape Town',
        province: 'Western Cape',
        source: 'whatsapp',
      },
    })
  })

  it('updates the existing row (idempotent on phone+city, case-insensitive)', async () => {
    waitlist.findFirst.mockResolvedValue({ id: 'wl_1' })

    await addToServiceAreaWaitlist({
      phone: '+27820000001',
      category: 'garden',
      city: 'CAPE TOWN',
      source: 'pwa',
    })

    expect(waitlist.create).not.toHaveBeenCalled()
    expect(waitlist.update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: { city: 'Cape Town', category: 'garden' },
    })
  })

  it('stores null for optional fields that are omitted', async () => {
    await addToServiceAreaWaitlist({ phone: '+27820000002', city: 'Kimberley', source: 'vodapay' })

    expect(waitlist.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: null, category: null, suburb: null, province: null, source: 'vodapay' }),
    })
  })
})
```

- [ ] **Step 3: Delete the symbols — the module becomes a waitlist helper**

Replace the whole of `field-service/lib/service-area-guard.ts` with:

```ts
// ─── Service-area helpers ─────────────────────────────────────────────────────
// Liveness is no longer decided here. Since the national rollout
// (docs/superpowers/specs/2026-10-03-national-rollout-design.md) a location is
// live if and only if its LocationNode is active; pickers, registration,
// provider service-area rows and customer intake all read `LocationNode.active`.
// This module keeps the two key-normalisation helpers and the waitlist upsert
// used by the "my area isn't listed" / notify-me paths.

import { db } from './db'
import { normaliseLocationDisplayName } from './location-format'

export function normalizeLocationKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function getRegionKeyFromSlug(slug: string | null | undefined): string {
  return normalizeLocationKey(slug?.split('__').at(-1) ?? '')
}

/**
 * Upserts a record in service_area_waitlist.
 * Safe to call twice - the @@unique([phone, city]) constraint makes it idempotent.
 */
export async function addToServiceAreaWaitlist(params: {
  phone: string
  name?: string | null
  category?: string | null
  suburb?: string | null
  city: string
  province?: string | null
  source: 'whatsapp' | 'pwa' | 'vodapay'
}): Promise<void> {
  const suburb = normaliseLocationDisplayName(params.suburb) || null
  const city = normaliseLocationDisplayName(params.city)
  const province = normaliseLocationDisplayName(params.province) || null
  // Use case-insensitive findFirst so that existing rows stored with lowercase city
  // (before normalisation was introduced) are matched correctly - the @@unique([phone, city])
  // constraint is case-sensitive by default in Postgres.
  const existing = await db.serviceAreaWaitlist.findFirst({
    where: {
      phone: params.phone,
      city: { equals: city, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (existing) {
    await db.serviceAreaWaitlist.update({
      where: { id: existing.id },
      data: {
        city, // normalise the stored city on touch
        ...(params.name ? { name: params.name } : {}),
        ...(params.category ? { category: params.category } : {}),
      },
    })
  } else {
    await db.serviceAreaWaitlist.create({
      data: {
        phone: params.phone,
        name: params.name ?? null,
        category: params.category ?? null,
        suburb,
        city,
        province,
        source: params.source,
      },
    })
  }
}
```

Run: `pnpm vitest run __tests__/lib/service-area-guard.test.ts && pnpm typecheck`
Expected: PASS (7 tests); typecheck exit 0. A typecheck error of the form `Module '"@/lib/service-area-guard"' has no exported member 'X'` means Step 1's grep was not clean — go back to it.

- [ ] **Step 4: Add the no-pilot-copy guard test**

Create `field-service/__tests__/lib/no-pilot-copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Phrases that described the Johannesburg launch fence. After the national
// rollout (docs/superpowers/specs/2026-10-03-national-rollout-design.md) none
// of them may appear in provider- or customer-facing code.
const FORBIDDEN_PHRASES = [
  'West Rand first',
  'Gauteng only',
  'live for leads',
  'open to register',
  'not live yet',
  'Not yet active',
  'Active pilot',
  'Currently serving',
] as const

// Left in place by the spec ("Out of scope"): the flag-gated West Rand pilot
// allowlist and its readiness/nudge consoles, and the advisory ops agents.
const EXCLUDED_DIRS = ['lib/launch', 'lib/nudges', 'lib/ops-agents'] as const

const SCAN_ROOTS = ['lib', 'components'] as const
const SOURCE_EXT = /\.(ts|tsx)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SOURCE_EXT.test(entry)) out.push(full)
  }
  return out
}

function isExcluded(relPath: string): boolean {
  const posix = relPath.split(sep).join('/')
  return EXCLUDED_DIRS.some((d) => posix === d || posix.startsWith(`${d}/`))
}

describe('no launch-fence copy remains in lib/ or components/', () => {
  const root = process.cwd() // vitest runs from field-service/
  const files = SCAN_ROOTS.flatMap((r) => walk(join(root, r)))
    .map((f) => relative(root, f))
    .filter((f) => !isExcluded(f))

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  for (const phrase of FORBIDDEN_PHRASES) {
    it(`no file contains "${phrase}"`, () => {
      const offenders = files.filter((f) => readFileSync(join(root, f), 'utf8').includes(phrase))
      expect(offenders).toEqual([])
    })
  }
})
```

Run: `pnpm vitest run __tests__/lib/no-pilot-copy.test.ts`
Expected: PASS (9 tests). A failure lists the offending file(s) for the phrase — fix the copy in that file per the spec's §I table (it means Task 5, 6, 12, 17 or 19 missed a string), then re-run.

- [ ] **Step 5: Full verification in both packages**

Run from `field-service/`: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0, all suites PASS.

Run from `marketing/`: `pnpm lint && pnpm test`
Expected: exit 0, all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/service-area-guard.ts field-service/__tests__/lib/service-area-guard.test.ts field-service/__tests__/lib/no-pilot-copy.test.ts field-service/__tests__/lib/registration-cancel.test.ts field-service/__tests__/lib/whatsapp-menu-routing.test.ts field-service/__tests__/lib/whatsapp-flows/rebook.test.ts field-service/__tests__/api/customer-bookings.test.ts field-service/__tests__/api/customer-bookings-pilot-gate.test.ts field-service/__tests__/api/customer-bookings-preferred-provider-kyc.test.ts field-service/__tests__/lib/whatsapp-flows/job-request.test.ts
git commit -m "refactor(service-area-guard): delete the launch-region sets; liveness is LocationNode.active

Removes ACTIVE_PROVINCE_SLUGS, ACTIVE_CITY_NODE_KEYS, the onboarding/matching
region sets, the pilot labels, the status types and helpers, the free-text
city guard and the unused OutsideServiceAreaError. The module keeps
normalizeLocationKey, getRegionKeyFromSlug and addToServiceAreaWaitlist.
Adds a repo guard test that fails if any launch-fence phrase reappears in
lib/ or components/ (lib/launch, lib/nudges, lib/ops-agents excluded per spec).

Spec: docs/superpowers/specs/2026-10-03-national-rollout-design.md §A

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG"
```

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin feat/national-rollout
gh pr create --base main --head feat/national-rollout \
  --title "feat: national rollout — data-driven liveness replaces the JHB West fence" \
  --body "$(cat <<'PRBODY'
## What

Opens Plug A Pro nationally. A location is live if and only if its `LocationNode` is active; the hardcoded province / city / region sets in `lib/service-area-guard.ts` are gone.

Spec: `docs/superpowers/specs/2026-10-03-national-rollout-design.md`

## Behavioural contract

**Providers** register in any province (web or WhatsApp) with no "coming soon" wording. A provider whose suburb is not listed chooses the whole region (one `REGION`-type service-area row). Every service-area row is written `active = true`; approved providers are matchable immediately.

**Customers** are never waitlisted for being outside Johannesburg. Where an area has zero active providers for the category they get the existing "no providers yet — notify me" capture, never a request that expires on creation. "My area isn't listed" still reaches the waitlist.

**Admins** pause an area by deactivating its node in `/admin/locations`. Existing rows stay active until the resync script is re-run for that region.

## Matching

No region logic existed in matching; it reads active rows only. One alignment: `filter.ts` `REGION_FALLBACK` now requires an `areaType = 'REGION'` row, as `service.ts` already did.

## After merge (owner-approved, not in this PR)

1. Production: `pnpm tsx scripts/seed-locations.ts` (postcodes for the 44 suburbs that had none).
2. Production: `pnpm tsx scripts/reactivate-service-areas-national.ts` dry-run → review per-region totals → `--commit` → candidate-pool rebuild (88 ACTIVE providers become matchable; 71 of them currently have no active row).
3. Flip `customer.home.notify_interest` ON.
4. Deploy marketing (service-policy copy).
5. Widen Meta ads geo-targeting.

## Out of scope

National suburb dataset import; retiring the West Rand pilot flag family; marketing SEO landing areas.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NpHGuToaFrZY3BNZELgdGG
PRBODY
)"
```

Expected: `gh pr create` prints the PR URL. CI (`field-service CI`: `pnpm lint` + `pnpm test`) runs on the PR; it must be green before merge. Merging is the owner's action, not this plan's.

