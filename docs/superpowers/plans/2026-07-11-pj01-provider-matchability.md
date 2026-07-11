# PJ-01 Provider Matchability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every provider-approval/activation path provision active `technician_service_areas` (TSA) rows so approved providers are actually matchable, and repair the 61 existing silently-unmatchable providers.

**Architecture:** Extract the proven label→LocationNode resolver into a shared helper; add a flag-gated label fallback inside the single choke-point `syncProviderRecord` so label-only approval paths sync TSA; persist `ProviderApplication.locationNodeIds` (additive) so future approvals carry exact IDs; route the three admin paths that bypass `syncProviderRecord` through a shared matchability step; fix and run the existing backfill for the 61.

**Tech Stack:** Next.js 16 App Router, Prisma (Postgres/Supabase), Vitest, TypeScript. Prod DB reached via Supabase Management API (see reference-db-access memory).

## Global Constraints

- Additive migrations only — no drops/renames (house rule 2).
- New behaviour ships behind flag `provider.matchability.autosync` (registry `defaultValue: false`); flipped separately after backfill verification (house rule 5).
- Admin mutations stay inside `crudAction()` (house rule 1).
- No `as any` without an adjacent TODO (house rule 7).
- Backfill `--commit` is a production write — requires explicit founder approval before running (approval boundary).
- TSA row `active` flag MUST be gated by `getRegionServiceStatus({ regionKey, slug })` (the matching-pilot gate), never hardcoded `true`.
- Spec: `docs/superpowers/specs/2026-07-11-pj01-provider-matchability-design.md`.
- Flag key type is compile-checked against `FeatureFlagKey` in `field-service/lib/feature-flags-registry.ts` — a new key MUST be added there first or `isEnabled('provider.matchability.autosync')` will not typecheck.

---

### Task 1: Register the `provider.matchability.autosync` feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts` (add key to `FEATURE_FLAGS_REGISTRY`, after the provider-nudge block ~line 28)
- Modify: `field-service/scripts/seed-flags.ts` (add the key so `pnpm tsx scripts/seed-flags.ts` seeds it OFF)

**Interfaces:**
- Produces: flag key `'provider.matchability.autosync'` usable as `isEnabled('provider.matchability.autosync')`.

- [ ] **Step 1: Add the registry entry**

In `field-service/lib/feature-flags-registry.ts`, inside `FEATURE_FLAGS_REGISTRY`, add:

```ts
  // ─── Provider matchability ───────────────────────────────────────────────────
  'provider.matchability.autosync': {
    description:
      'When ON, syncProviderRecord resolves legacy serviceAreas[] labels to LocationNodes and provisions active TSA rows on approval/activation when no locationNodeIds were supplied. Closes PJ-01 (approved-but-unmatchable). Keep OFF until the one-off backfill has been reviewed and committed. Spec: docs/superpowers/specs/2026-07-11-pj01-provider-matchability-design.md',
    owner: 'eng',
    defaultValue: false,
  },
```

- [ ] **Step 2: Typecheck to confirm the key is valid**

Run: `cd field-service && pnpm tsc --noEmit`
Expected: PASS (no new errors). This proves the key is now a valid `FeatureFlagKey`.

- [ ] **Step 3: Add to seed-flags**

In `field-service/scripts/seed-flags.ts`, add `'provider.matchability.autosync'` to the seeded key list following the existing pattern in that file (match how neighbouring keys like `'admin.crud.providers'` are seeded, `enabled: false`).

- [ ] **Step 4: Commit**

```bash
git add field-service/lib/feature-flags-registry.ts field-service/scripts/seed-flags.ts
git commit -m "feat(flags): register provider.matchability.autosync (default OFF) [PJ-01]"
```

---

### Task 2: Shared label→LocationNode resolver

**Files:**
- Create: `field-service/lib/provider-record/resolve-service-area-labels.ts`
- Test: `field-service/__tests__/lib/provider-record/resolve-service-area-labels.test.ts`
- Modify: `field-service/scripts/backfill-tsa-from-legacy-service-areas.ts` (refactor to import the helper — done in Task 6, noted here as the future consumer)

**Interfaces:**
- Consumes: a client exposing `locationNode.findMany` (same shape as `ProviderRecordSyncClient['locationNode']` in `provider-record.ts:41-51`).
- Produces:
  ```ts
  export type ResolveServiceAreaLabelsResult = {
    resolvedNodeIds: string[]   // deduped LocationNode ids
    unresolved: string[]        // labels with zero label matches
    ambiguous: string[]         // labels with >1 match and no majority-region tiebreak
  }
  export async function resolveServiceAreaLabels(
    client: { locationNode: { findMany: (...args: any[]) => Promise<Array<{ id: string; label: string; slug: string; regionKey: string | null; provinceKey: string | null; cityKey: string | null }>> } },
    labels: string[],
    opts?: { nodeType?: string; preferMajorityRegion?: boolean },
  ): Promise<ResolveServiceAreaLabelsResult>
  ```

- [ ] **Step 1: Write the failing test**

```ts
// field-service/__tests__/lib/provider-record/resolve-service-area-labels.test.ts
import { describe, it, expect } from 'vitest'
import { resolveServiceAreaLabels } from '@/lib/provider-record/resolve-service-area-labels'

const NODES = [
  { id: 'n-roode', label: 'Roodepoort', slug: 'gauteng__johannesburg__jhb_west__roodepoort', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-flora', label: 'Florida', slug: 'gauteng__johannesburg__jhb_west__florida', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-sunny-w', label: 'Sunnyside', slug: 'gauteng__johannesburg__jhb_west__sunnyside', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'n-sunny-e', label: 'Sunnyside', slug: 'gauteng__ekurhuleni__ekur_east__sunnyside', regionKey: 'ekur_east', provinceKey: 'gauteng', cityKey: 'ekurhuleni' },
]
const client = { locationNode: { findMany: async () => NODES } }

describe('resolveServiceAreaLabels', () => {
  it('resolves exact labels case-insensitively and dedupes', async () => {
    const r = await resolveServiceAreaLabels(client, ['roodepoort', 'FLORIDA', 'Florida'])
    expect(r.resolvedNodeIds.sort()).toEqual(['n-flora', 'n-roode'])
    expect(r.unresolved).toEqual([])
    expect(r.ambiguous).toEqual([])
  })

  it('reports labels with no node match as unresolved', async () => {
    const r = await resolveServiceAreaLabels(client, ['Roodepoort', 'Westrand'])
    expect(r.resolvedNodeIds).toEqual(['n-roode'])
    expect(r.unresolved).toEqual(['Westrand'])
  })

  it('marks a duplicate-suburb label ambiguous without a majority region', async () => {
    const r = await resolveServiceAreaLabels(client, ['Sunnyside'])
    expect(r.resolvedNodeIds).toEqual([])
    expect(r.ambiguous).toEqual(['Sunnyside'])
  })

  it('breaks ambiguity via majority region of the other resolvable labels', async () => {
    const r = await resolveServiceAreaLabels(
      client,
      ['Roodepoort', 'Florida', 'Sunnyside'],
      { preferMajorityRegion: true },
    )
    expect(r.resolvedNodeIds.sort()).toEqual(['n-flora', 'n-roode', 'n-sunny-w'])
    expect(r.ambiguous).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record/resolve-service-area-labels.test.ts`
Expected: FAIL — cannot find module `resolve-service-area-labels`.

- [ ] **Step 3: Implement the helper**

Port the matching logic from `scripts/backfill-tsa-from-legacy-service-areas.ts:48,82-100,138-183` into the module:

```ts
// field-service/lib/provider-record/resolve-service-area-labels.ts
const norm = (v: string) => v.trim().toLowerCase()

type NodeRow = { id: string; label: string; slug: string; regionKey: string | null; provinceKey: string | null; cityKey: string | null }

export type ResolveServiceAreaLabelsResult = {
  resolvedNodeIds: string[]
  unresolved: string[]
  ambiguous: string[]
}

export async function resolveServiceAreaLabels(
  client: { locationNode: { findMany: (...args: any[]) => Promise<NodeRow[]> } },
  labels: string[],
  opts?: { nodeType?: string; preferMajorityRegion?: boolean },
): Promise<ResolveServiceAreaLabelsResult> {
  const nodeType = opts?.nodeType ?? 'SUBURB'
  const nodes = await client.locationNode.findMany({
    where: { active: true, nodeType },
    select: { id: true, label: true, slug: true, regionKey: true, provinceKey: true, cityKey: true },
  })
  const byLabel = new Map<string, NodeRow[]>()
  for (const n of nodes) {
    const key = norm(n.label)
    const list = byLabel.get(key) ?? []
    list.push(n)
    byLabel.set(key, list)
  }

  // majority region among unambiguous label matches (tiebreak source)
  const regionCounts = new Map<string, number>()
  for (const raw of labels) {
    const ms = byLabel.get(norm(raw)) ?? []
    if (ms.length === 1 && ms[0].regionKey) {
      regionCounts.set(ms[0].regionKey, (regionCounts.get(ms[0].regionKey) ?? 0) + 1)
    }
  }
  let majorityRegion: string | null = null
  let majorityCount = 0
  for (const [region, count] of regionCounts) {
    if (count > majorityCount) { majorityRegion = region; majorityCount = count }
  }

  const resolved = new Set<string>()
  const unresolved: string[] = []
  const ambiguous: string[] = []
  for (const raw of labels) {
    const matches = byLabel.get(norm(raw)) ?? []
    if (matches.length === 0) { unresolved.push(raw); continue }
    let node: NodeRow | null = null
    if (matches.length === 1) {
      node = matches[0]
    } else if (opts?.preferMajorityRegion && majorityRegion) {
      const sameRegion = matches.filter((m) => m.regionKey === majorityRegion)
      if (sameRegion.length === 1) node = sameRegion[0]
    }
    if (!node) { ambiguous.push(raw); continue }
    resolved.add(node.id)
  }
  return { resolvedNodeIds: [...resolved], unresolved, ambiguous }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record/resolve-service-area-labels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/provider-record/resolve-service-area-labels.ts field-service/__tests__/lib/provider-record/resolve-service-area-labels.test.ts
git commit -m "feat(provider-record): shared serviceAreas label->LocationNode resolver [PJ-01]"
```

---

### Task 3: Flag-gated label fallback inside `syncProviderRecord`

**Files:**
- Modify: `field-service/lib/provider-record.ts` (enrichment blocks at `:290-304` and `:333-347`)
- Test: `field-service/__tests__/lib/provider-record-tsa-label-fallback.test.ts`

**Interfaces:**
- Consumes: `resolveServiceAreaLabels` (Task 2); `upsertStructuredServiceAreas(client, providerId, nodeIds)` (existing `provider-record.ts:101`); `isEnabled` (already imported `provider-record.ts:8`).
- Produces: behavioural change only — no new exported signature. When flag ON and `input.locationNodeIds` is empty/absent but `input.serviceAreas` non-empty, TSA rows are synced from resolved labels.

- [ ] **Step 1: Write the failing test**

```ts
// field-service/__tests__/lib/provider-record-tsa-label-fallback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsEnabled = vi.fn()
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
// Neutralise the KYC gate so verified:true is allowed in the test.
vi.mock('@/lib/kyc-policy', () => ({ isKycRequiredForActivation: vi.fn().mockResolvedValue(false) }))

import { syncProviderRecord } from '@/lib/provider-record'

function makeClient() {
  const upserts: any[] = []
  return {
    upserts,
    provider: {
      findUnique: vi.fn().mockResolvedValue(null),           // force create path
      updateMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    technicianServiceArea: {
      upsert: vi.fn((args: any) => { upserts.push(args); return Promise.resolve({}) }),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    technicianSkill: { upsert: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
    technicianAvailability: { upsert: vi.fn().mockResolvedValue({}) },
    locationNode: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'n-roode', nodeType: 'SUBURB', label: 'Roodepoort', slug: 'gauteng__johannesburg__jhb_west__roodepoort', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
      ]),
    },
  }
}

const baseInput = {
  phone: '+27820000000', name: 'Test Provider', skills: ['plumbing'],
  serviceAreas: ['Roodepoort'], active: true, availableNow: true, verified: true,
}

describe('syncProviderRecord legacy-label TSA fallback', () => {
  beforeEach(() => { mockIsEnabled.mockReset() })

  it('creates TSA rows from serviceAreas labels when flag ON and no locationNodeIds', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const client = makeClient()
    await syncProviderRecord(client as any, baseInput)
    expect(client.technicianServiceArea.upsert).toHaveBeenCalledTimes(1)
    expect(client.upserts[0].create.locationNodeId).toBe('n-roode')
  })

  it('does NOT create TSA rows from labels when flag OFF', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const client = makeClient()
    await syncProviderRecord(client as any, baseInput)
    expect(client.technicianServiceArea.upsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record-tsa-label-fallback.test.ts`
Expected: FAIL — the flag-ON test finds zero upserts (fallback not implemented yet).

- [ ] **Step 3: Implement the fallback in both enrichment blocks**

At the top of the enrichment section, after `syncProviderSkills`, add a helper closure and call it in BOTH the update branch (`:290-304`) and the create branch (`:333-347`). Extract to avoid duplication:

```ts
// add near the other imports
import { resolveServiceAreaLabels } from './provider-record/resolve-service-area-labels'
const MATCHABILITY_AUTOSYNC_FLAG = 'provider.matchability.autosync' as const

// a private helper (module scope) — resolves labels when no node ids were provided
async function enrichServiceAreas(
  client: ProviderRecordSyncClient,
  providerId: string,
  input: SyncProviderRecordInput,
) {
  if (input.locationNodeIds && input.locationNodeIds.length > 0) {
    await upsertStructuredServiceAreas(client, providerId, input.locationNodeIds)
    return
  }
  if (!input.serviceAreas || input.serviceAreas.length === 0) return
  if (!client.locationNode) return
  const autosync = await isEnabled(MATCHABILITY_AUTOSYNC_FLAG)
  if (!autosync) return
  const { resolvedNodeIds, unresolved, ambiguous } = await resolveServiceAreaLabels(
    client as { locationNode: { findMany: (...a: any[]) => Promise<any[]> } },
    input.serviceAreas,
    { preferMajorityRegion: true },
  )
  if (unresolved.length || ambiguous.length) {
    console.warn(`[matchability] provider ${providerId}: unresolved=${JSON.stringify(unresolved)} ambiguous=${JSON.stringify(ambiguous)}`)
  }
  if (resolvedNodeIds.length > 0) {
    await upsertStructuredServiceAreas(client, providerId, resolvedNodeIds)
  }
}
```

Then replace the two inline `if (input.locationNodeIds …) { upsertStructuredServiceAreas … }` blocks (`:297-303` and `:340-346`) with:

```ts
      try {
        await enrichServiceAreas(client, existing.id, input)   // (create branch: use `id`)
      } catch (err) {
        throwOnEnrichmentFailure('upsertStructuredServiceAreas', err, existing.id)  // (create branch: `id`)
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record-tsa-label-fallback.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full provider-record test file to confirm no regressions**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-record`
Expected: PASS (existing tests unaffected — locationNodeIds path unchanged).

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/provider-record.ts field-service/__tests__/lib/provider-record-tsa-label-fallback.test.ts
git commit -m "feat(provider-record): flag-gated legacy-label TSA fallback in syncProviderRecord [PJ-01]"
```

---

### Task 4: Persist `ProviderApplication.locationNodeIds` (additive migration) and populate at creation

**Files:**
- Modify: `field-service/prisma/schema.prisma` (`model ProviderApplication`)
- Create: migration under `field-service/prisma/migrations/<timestamp>_provider_application_location_node_ids/migration.sql`
- Modify creation sites: `field-service/lib/whatsapp-flows/registration.ts` (~`:3126-3138`), `field-service/lib/provider-registration/pwa-flow.ts` (~`:811-825`), `field-service/lib/provider-onboarding/quality-gate-submission.ts` (~`:585-598`)
- Test: `field-service/__tests__/lib/provider-application-location-node-ids.test.ts`

**Interfaces:**
- Produces: `ProviderApplication.locationNodeIds: string[]` (default `[]`), populated at creation for structured-onboarding paths. Approval-time callers may read it (wired in Task 5's verification, and available to the reconcile/auto-approve paths).

- [ ] **Step 1: Add the schema field**

In `model ProviderApplication` (`prisma/schema.prisma`, near `serviceAreas String[] @default([])`), add:

```prisma
  locationNodeIds               String[]          @default([])
```

- [ ] **Step 2: Generate the additive migration (no data loss)**

Run: `cd field-service && pnpm prisma migrate dev --name provider_application_location_node_ids --create-only`
Then inspect the generated `migration.sql` — it MUST be a single `ALTER TABLE "ProviderApplication" ADD COLUMN "locationNodeIds" TEXT[] ...`. Confirm no `DROP`/`ALTER … TYPE` lines (house rule 2).

- [ ] **Step 3: Apply and regenerate client**

Run: `cd field-service && pnpm prisma migrate dev && pnpm prisma generate`
Expected: migration applies to the local/shadow DB; client regenerates with the new field.

- [ ] **Step 4: Write the failing test (creation persists the ids)**

```ts
// field-service/__tests__/lib/provider-application-location-node-ids.test.ts
import { describe, it, expect, vi } from 'vitest'
import { finalizeWhatsappProviderSubmission } from '@/lib/provider-onboarding/finalize-whatsapp-submission'
// Arrange a fake tx capturing providerApplication.create data; assert locationNodeIds passed through.
// (Follow the existing finalize-whatsapp-submission test harness in __tests__ for the tx mock shape.)
it('persists locationNodeIds on the created ProviderApplication', async () => {
  const created: any[] = []
  const tx = {
    providerApplication: { create: vi.fn((a: any) => { created.push(a); return Promise.resolve({ id: 'app1', ...a.data }) }), findFirst: vi.fn().mockResolvedValue(null) },
    // ...other tx models the function touches, mocked minimally
  }
  await finalizeWhatsappProviderSubmission(tx as any, { /* submitData incl locationNodeIds: ['n-1','n-2'] */ } as any)
  expect(created[0].data.locationNodeIds).toEqual(['n-1', 'n-2'])
})
```

Note to implementer: read `field-service/lib/provider-onboarding/finalize-whatsapp-submission.ts` and its existing test (if present) FIRST to match the exact `submitData` and tx shapes; the assertion is the point — `locationNodeIds` reaches `providerApplication.create`.

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-application-location-node-ids.test.ts`
Expected: FAIL — `locationNodeIds` is `undefined` on the create payload.

- [ ] **Step 6: Populate at the three creation sites**

At each of the three `providerApplication.create({ data: { … serviceAreas … } })` sites (registration.ts, pwa-flow.ts, quality-gate-submission.ts), add `locationNodeIds: submitData.locationNodeIds ?? []` (use the local variable already holding the resolved ids at that site — the explorer confirmed each site has the array in scope).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd field-service && pnpm vitest run __tests__/lib/provider-application-location-node-ids.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add field-service/prisma/schema.prisma field-service/prisma/migrations field-service/lib/whatsapp-flows/registration.ts field-service/lib/provider-registration/pwa-flow.ts field-service/lib/provider-onboarding/quality-gate-submission.ts field-service/__tests__/lib/provider-application-location-node-ids.test.ts
git commit -m "feat(provider-application): persist locationNodeIds at creation (additive) [PJ-01]"
```

---

### Task 5: Route admin activation paths through matchability sync

**Files:**
- Modify: `field-service/app/(admin)/admin/providers/actions.ts` (`setProviderStatusAction` `:295-366`, `verifyProviderAction` `:370-412`, `updateProviderProfileAction` `:240-291`)
- Test: `field-service/__tests__/app/admin/provider-actions-matchability.test.ts`

**Interfaces:**
- Consumes: `upsertStructuredServiceAreas` + `resolveServiceAreaLabels` (Tasks 2/3), or `syncProviderRecord`. Preferred: a small local `ensureProviderMatchable(tx, providerId)` that loads the provider's `serviceAreas`/`locationNodeIds`, resolves, and calls `upsertStructuredServiceAreas` — gated by the same `provider.matchability.autosync` flag.
- Produces: after these admin actions set a provider ACTIVE/verified, active TSA rows exist (subject to region gate + flag).

- [ ] **Step 1: Write the failing test**

```ts
// asserts that after setProviderStatusAction transitions a provider to ACTIVE,
// upsertStructuredServiceAreas was invoked for that provider's resolvable serviceAreas.
// Mock @/lib/flags isEnabled -> true, mock the crudAction tx, spy on technicianServiceArea.upsert.
```

Implementer: model this on the existing `providers/actions.ts` test harness (find it under `__tests__/app/admin/`) — mock the `crudAction` transaction client, call `setProviderStatusAction` with a target status of `ACTIVE`, and assert `technicianServiceArea.upsert` was called. Add the OFF-flag counter-test (no upsert).

- [ ] **Step 2: Run to verify it fails**

Run: `cd field-service && pnpm vitest run __tests__/app/admin/provider-actions-matchability.test.ts`
Expected: FAIL — no TSA upsert happens today (raw `tx.provider.update`).

- [ ] **Step 3: Implement `ensureProviderMatchable` and call it**

Add a module-local helper in `providers/actions.ts`:

```ts
async function ensureProviderMatchable(tx: any, providerId: string) {
  if (!(await isEnabled('provider.matchability.autosync'))) return
  const p = await tx.provider.findUnique({ where: { id: providerId }, select: { serviceAreas: true } })
  if (!p || p.serviceAreas.length === 0) return
  const { resolvedNodeIds } = await resolveServiceAreaLabels(tx, p.serviceAreas, { preferMajorityRegion: true })
  if (resolvedNodeIds.length) await upsertStructuredServiceAreas(tx, providerId, resolvedNodeIds)
}
```

Call `await ensureProviderMatchable(tx, providerId)` inside the `crudAction` transaction of `setProviderStatusAction` (only when new status is `ACTIVE`) and `verifyProviderAction` (after setting verified), and in `updateProviderProfileAction` after a `serviceAreas` change. Import `isEnabled`, `resolveServiceAreaLabels`, `upsertStructuredServiceAreas`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd field-service && pnpm vitest run __tests__/app/admin/provider-actions-matchability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/\(admin\)/admin/providers/actions.ts field-service/__tests__/app/admin/provider-actions-matchability.test.ts
git commit -m "feat(admin): route provider activation paths through matchability sync [PJ-01]"
```

---

### Task 6: Fix the backfill's region gate and prepare the repair run

**Files:**
- Modify: `field-service/scripts/backfill-tsa-from-legacy-service-areas.ts` (refactor to use Task 2 helper; replace hardcoded `active: true` at `:192,201` with the region-status gate used by `upsertStructuredServiceAreas`)

**Interfaces:**
- Consumes: `resolveServiceAreaLabels` (Task 2); `getRegionServiceStatus`, `getRegionKeyFromSlug` from `@/lib/service-area-guard`.
- Produces: a dry-run report of exactly which of the 61 providers get how many TSA rows, with `active` correctly gated.

- [ ] **Step 1: Replace hardcoded `active: true` with the pilot gate**

In the upsert (`:189-203`), compute `active` the same way `upsertStructuredServiceAreas` does:

```ts
const regionKey = node.regionKey ?? getRegionKeyFromSlug(node.slug)
const active = getRegionServiceStatus({ regionKey, slug: node.slug }) === 'active'
```

and use `active` in both `create` and `update` instead of the literal `true`. (Keep the script's own label-matching OR swap it for `resolveServiceAreaLabels` — reuse to keep one source of truth; the per-node region/keys still come from the matched node.)

- [ ] **Step 2: Typecheck**

Run: `cd field-service && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Dry-run against production (READ-ONLY — no `--commit`)**

Run (dry-run is the default; prints would-create counts):
`cd field-service && pnpm tsx scripts/backfill-tsa-from-legacy-service-areas.ts --prefer-majority-region`
Expected: reports ~59 providers with `wouldCreate > 0`, plus the 2 known free-text providers showing `noMatch` (the comma-blob and "Westrand").

- [ ] **Step 4: Commit the script fix (NOT a data change)**

```bash
git add field-service/scripts/backfill-tsa-from-legacy-service-areas.ts
git commit -m "fix(backfill): gate backfilled TSA active flag on region pilot status [PJ-01]"
```

- [ ] **Step 5: STOP — surface the dry-run report to the founder for approval before `--commit`**

Do not run `--commit`. Present the dry-run summary (per-provider would-create counts + the 2 flagged free-text providers) and get explicit approval. The `--commit` run is the production write.

---

### Task 7: Thin matchability readiness on admin provider detail

**Files:**
- Modify: `field-service/app/(admin)/admin/technicians/[id]/page.tsx` (existing `admin.providers.legacy_tsa_warning` banner ~`:316-333`)
- Test: extend the page's existing test if present, else a focused unit test on the readiness derivation.

**Interfaces:**
- Consumes: the provider's `technicianServiceAreas` (already loaded on the detail page).
- Produces: a visible "Matchable: Yes/No — N active service areas" line; when zero active rows AND non-empty `serviceAreas`, show "Legacy areas not provisioned — run matchability sync".

- [ ] **Step 1: Compute readiness**

Derive `const activeTsaCount = provider.technicianServiceAreas.filter(a => a.active).length` and `const isMatchable = activeTsaCount > 0`. If the page doesn't already select `active` on TSA rows, add it to the query `select`.

- [ ] **Step 2: Render the indicator**

Near the existing banner, render the Yes/No + count. Reuse existing badge components (`components/ui/badge`).

- [ ] **Step 3: Typecheck + build the page**

Run: `cd field-service && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add field-service/app/\(admin\)/admin/technicians/\[id\]/page.tsx
git commit -m "feat(admin): show provider matchability readiness on detail page [PJ-01]"
```

---

### Task 8: Full regression + flag-flip readiness

- [ ] **Step 1: Run the full unit suite**

Run: `cd field-service && pnpm test`
Expected: all pass (baseline was 5,164 passing). Investigate any new failure before proceeding.

- [ ] **Step 2: Lint**

Run: `cd field-service && pnpm lint`
Expected: clean.

- [ ] **Step 3: Summarise flip sequence for the founder**

Document (in the PR body) the go-live order: (1) merge with flag OFF; (2) run backfill `--commit` after approval; (3) verify prod `active+verified with zero active TSA AND resolvable serviceAreas == 0`; (4) flip `provider.matchability.autosync` ON so future approvals self-provision; (5) re-run the prod audit query to confirm the matchable count rose from 74.

---

## Self-Review

**Spec coverage:**
- §3.1 shared resolver → Task 2 ✓
- §3.2 syncProviderRecord label fallback (flag-gated) → Task 3 ✓ (flag registered Task 1)
- §3.3 persist locationNodeIds (additive) + populate 3 sites → Task 4 ✓
- §3.4 route admin H/I/J → Task 5 ✓
- §3.5 backfill region-gate fix + gated run → Task 6 ✓
- §3.6 thin readiness UI → Task 7 ✓
- §4 testing (TDD per task) + §6 success criteria verification → Task 8 ✓

**Placeholder scan:** Tasks 4 & 5 tests intentionally defer exact tx-mock shape to the implementer with a concrete assertion target named (the `locationNodeIds`/`upsert` call) — this is a real harness-matching instruction, not a vague "add tests". All code steps show actual code.

**Type consistency:** `resolveServiceAreaLabels` signature + `ResolveServiceAreaLabelsResult` used identically in Tasks 2/3/5/6. Flag key string `'provider.matchability.autosync'` identical in Tasks 1/3/5. `upsertStructuredServiceAreas(client, providerId, nodeIds)` matches existing `provider-record.ts:101`.

**Note on ordering:** Task 3 (label fallback) delivers the closure of A/B/C/D/K on its own; Task 4 (persist ids) is the robustness layer for future exact-id approvals. Either can merge independently behind the OFF flag.
