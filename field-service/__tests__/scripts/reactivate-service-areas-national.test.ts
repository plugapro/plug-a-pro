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
  formatPlan,
  DEACTIVATE_AUDIT_ACTION,
  planDeactivation,
  loadDeactivationInputs,
  executeDeactivation,
  formatDeactivationPlan,
  type InactiveAreaRow,
  type PausedNodeAreaRow,
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
  return { id: 'prov-1', status: 'ACTIVE', activeAreaCount: 0, ...overrides }
}

const plus = (ms: number) => new Date(T0.getTime() + ms)

describe('constants and predicates', () => {
  it('names jhb_west as the only pre-rollout matching region', () => {
    expect(PRE_ROLLOUT_MATCHING_REGION_KEYS).toEqual(['jhb_west'])
    expect(isPreRolloutMatchingRegion('jhb_west')).toBe(true)
    expect(isPreRolloutMatchingRegion('JHB_WEST')).toBe(true)
    expect(isPreRolloutMatchingRegion('jhb-west')).toBe(true)
    expect(isPreRolloutMatchingRegion(' JHB West ')).toBe(true)
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
      [provider(), provider({ id: 'prov-2' })],
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
      deactivateInactiveNodes: false,
    })
    expect(parseArgs([])).toEqual({
      providerIds: null,
      excludeProviderIds: null,
      commit: false,
      adminEmail: null,
      deactivateInactiveNodes: false,
    })
  })

  it('parses --deactivate-inactive-nodes as a separate mode, with the shared flags', () => {
    expect(
      parseArgs(['--deactivate-inactive-nodes', '--providers', 'a', '--exclude-providers', 'b', '--commit', '--admin-email', 'o@x.za']),
    ).toEqual({
      providerIds: ['a'],
      excludeProviderIds: ['b'],
      commit: true,
      adminEmail: 'o@x.za',
      deactivateInactiveNodes: true,
    })
    expect(parseArgs(['--deactivate-inactive-nodes']).deactivateInactiveNodes).toBe(true)
    expect(parseArgs(['--deactivate-inactive-nodes']).commit).toBe(false)
  })

  it('fails closed on a repeated or valued --deactivate-inactive-nodes', () => {
    expect(() => parseArgs(['--deactivate-inactive-nodes', '--deactivate-inactive-nodes'])).toThrow(
      'Duplicate argument: --deactivate-inactive-nodes',
    )
    expect(() => parseArgs(['--deactivate-inactive-nodes=true'])).toThrow()
    expect(() => parseArgs(['--deactivate-inactive-node'])).toThrow('Unknown argument: --deactivate-inactive-node')
  })

  it('fails closed on --flag=value forms', () => {
    expect(() => parseArgs(['--providers=a,b', '--commit'])).toThrow()
  })

  it('fails closed on an unknown flag (singular --exclude-provider)', () => {
    expect(() => parseArgs(['--exclude-provider', 'd,e'])).toThrow('Unknown argument: --exclude-provider')
  })

  it('fails closed when a list flag value is missing (next token is a flag)', () => {
    expect(() => parseArgs(['--exclude-providers', '--commit', '--admin-email', 'o@x'])).toThrow(
      '--exclude-providers requires a value',
    )
  })

  it('fails closed when --admin-email has no value', () => {
    expect(() => parseArgs(['--commit', '--admin-email'])).toThrow('--admin-email requires a value')
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
    expect(providers).toEqual([{ id: 'prov-1', status: 'ACTIVE', activeAreaCount: 2 }])
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
      where: { id: { in: ['tsa-1'] }, active: false },
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

  it('tallies committed rows from the updateMany count, not the planned row count', async () => {
    const { client, tx } = makeExecClient()
    tx.technicianServiceArea.updateMany.mockResolvedValueOnce({ count: 0 })
    const result = await executeReactivation({
      plan,
      commit: true,
      admin,
      client: client as never,
      rebuildPool: vi.fn().mockResolvedValue(undefined),
    })
    expect(result).toEqual({ committedProviders: 1, committedRows: 0 })
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
        updateMany: vi.fn(async (args: { where: { id: { in: string[] }; active: boolean }; data: { active: boolean } }) => {
          let count = 0
          for (const r of table) {
            if (args.where.id.in.includes(r.id) && r.active === args.where.active) {
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

describe('formatPlan', () => {
  it('reports the one-row dry-run total and the dry-run footer', () => {
    const output = formatPlan(planReactivation([row()], [provider()]), false)
    expect(output).toContain('rows would activate: 1')
    expect(output).toContain(
      '(dry-run; pass --commit --admin-email <email> to apply; use --exclude-providers <ids> to drop review-flagged providers)',
    )
  })

  it('uses future tense in commit mode and omits the dry-run footer', () => {
    const output = formatPlan(planReactivation([row()], [provider()]), true)
    expect(output).toContain('rows will activate: 1')
    expect(output).not.toContain('activated')
    expect(output).not.toContain('(dry-run;')
  })

  it('prints provider ids only, never the provider name loaded from the database', async () => {
    const client = {
      technicianServiceArea: {
        findMany: vi.fn().mockResolvedValueOnce([row()]).mockResolvedValueOnce([]),
      },
      provider: {
        findMany: vi.fn().mockResolvedValue([{ id: 'prov-1', name: 'Thabo Plumbing', status: 'ACTIVE' }]),
      },
    }
    const { rows, providers } = await loadReactivationInputs(client as never, { providerIds: null, excludeProviderIds: null })
    const output = formatPlan(planReactivation(rows, providers), false)
    expect(output).toContain('prov-1')
    expect(output).not.toContain('Thabo Plumbing')
  })
})

// ── --deactivate-inactive-nodes mode (the pause lever) ──────────────────────

function pausedRow(overrides: Partial<PausedNodeAreaRow> = {}): PausedNodeAreaRow {
  return { id: 'tsa-p1', providerId: 'prov-1', locationNodeId: 'node-paused', ...overrides }
}

describe('planDeactivation', () => {
  it('groups active rows on paused nodes per provider and totals by node', () => {
    const plan = planDeactivation([
      pausedRow(),
      pausedRow({ id: 'tsa-p2', locationNodeId: 'node-paused-2' }),
      pausedRow({ id: 'tsa-p3', providerId: 'prov-2' }),
    ])
    expect(plan.providers).toEqual([
      { providerId: 'prov-1', deactivate: [{ id: 'tsa-p1', locationNodeId: 'node-paused' }, { id: 'tsa-p2', locationNodeId: 'node-paused-2' }] },
      { providerId: 'prov-2', deactivate: [{ id: 'tsa-p3', locationNodeId: 'node-paused' }] },
    ])
    expect(plan.totalRows).toBe(3)
    expect(plan.totalsByNode).toEqual({ 'node-paused': 2, 'node-paused-2': 1 })
  })

  it('returns an empty plan for no rows', () => {
    expect(planDeactivation([])).toEqual({ providers: [], totalRows: 0, totalsByNode: {} })
  })
})

describe('loadDeactivationInputs', () => {
  const SELECT = { id: true, providerId: true, locationNodeId: true }

  it('selects ACTIVE rows whose location node is inactive', async () => {
    const client = { technicianServiceArea: { findMany: vi.fn().mockResolvedValue([pausedRow()]) } }
    const rows = await loadDeactivationInputs(client as never, { providerIds: null, excludeProviderIds: null })
    expect(client.technicianServiceArea.findMany).toHaveBeenCalledWith({
      where: { active: true, locationNode: { is: { active: false } } },
      select: SELECT,
    })
    expect(rows).toEqual([pausedRow()])
  })

  it('honours --providers and --exclude-providers', async () => {
    const client = { technicianServiceArea: { findMany: vi.fn().mockResolvedValue([]) } }
    await loadDeactivationInputs(client as never, { providerIds: ['a', 'b'], excludeProviderIds: ['b'] })
    expect(client.technicianServiceArea.findMany).toHaveBeenCalledWith({
      where: { active: true, locationNode: { is: { active: false } }, providerId: { in: ['a', 'b'], notIn: ['b'] } },
      select: SELECT,
    })
  })
})

describe('executeDeactivation', () => {
  function makeExecClient(count = 1) {
    const tx = {
      technicianServiceArea: { updateMany: vi.fn().mockResolvedValue({ count }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const client = {
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    return { client, tx }
  }
  const admin = { id: 'admin-1', userId: 'auth-user-1', role: 'OWNER' }
  const plan = planDeactivation([pausedRow()])

  it('dry-run (default) writes nothing and rebuilds nothing', async () => {
    const { client, tx } = makeExecClient()
    const rebuildPool = vi.fn()
    const result = await executeDeactivation({ plan, commit: false, admin: null, client: client as never, rebuildPool })
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(tx.technicianServiceArea.updateMany).not.toHaveBeenCalled()
    expect(rebuildPool).not.toHaveBeenCalled()
    expect(result).toEqual({ committedProviders: 0, committedRows: 0 })
  })

  it('refuses to commit without an admin actor', async () => {
    const { client } = makeExecClient()
    await expect(
      executeDeactivation({ plan, commit: true, admin: null, client: client as never, rebuildPool: vi.fn() }),
    ).rejects.toThrow('--admin-email is required with --commit')
  })

  it('--commit deactivates only still-active planned rows, writes the audit pair and rebuilds the pool', async () => {
    const { client, tx } = makeExecClient()
    const rebuildPool = vi.fn().mockResolvedValue(undefined)
    const result = await executeDeactivation({ plan, commit: true, admin, client: client as never, rebuildPool })

    expect(DEACTIVATE_AUDIT_ACTION).toBe('provider.service_areas.deactivate_inactive_nodes')
    expect(tx.technicianServiceArea.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tsa-p1'] }, active: true },
      data: { active: false },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'auth-user-1',
        actorRole: 'OWNER',
        action: DEACTIVATE_AUDIT_ACTION,
        entityType: 'Provider',
        entityId: 'prov-1',
        before: { activeRowIds: ['tsa-p1'] },
        after: { inactiveRowIds: ['tsa-p1'], locationNodeIds: ['node-paused'] },
      }),
    })
    expect(tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: DEACTIVATE_AUDIT_ACTION,
        entityType: 'Provider',
        entityId: 'prov-1',
        metadata: { script: 'reactivate-service-areas-national', mode: 'deactivate-inactive-nodes', reason: 'location node paused' },
      }),
    })
    expect(rebuildPool).toHaveBeenCalledWith('prov-1')
    expect(result).toEqual({ committedProviders: 1, committedRows: 1 })
  })

  it('tallies committed rows from the updateMany count', async () => {
    const { client } = makeExecClient(0)
    const result = await executeDeactivation({
      plan,
      commit: true,
      admin,
      client: client as never,
      rebuildPool: vi.fn().mockResolvedValue(undefined),
    })
    expect(result).toEqual({ committedProviders: 1, committedRows: 0 })
  })
})

describe('formatDeactivationPlan', () => {
  it('prints ids only, the dry-run footer, and the totals', () => {
    const output = formatDeactivationPlan(planDeactivation([pausedRow()]), false)
    expect(output).toContain('mode=DRY-RUN')
    expect(output).toContain('prov-1')
    expect(output).toContain('tsa-p1')
    expect(output).toContain('node-paused')
    expect(output).toContain('rows would deactivate: 1')
    expect(output).toContain('(dry-run; pass --deactivate-inactive-nodes --commit --admin-email <email> to apply)')
  })

  it('uses future tense in commit mode and omits the dry-run footer', () => {
    const output = formatDeactivationPlan(planDeactivation([pausedRow()]), true)
    expect(output).toContain('rows will deactivate: 1')
    expect(output).not.toContain('(dry-run;')
  })
})
