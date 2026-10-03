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
 * Pause lever (--deactivate-inactive-nodes): a separate mode for when an
 * admin pauses an area by deactivating its LocationNode in /admin/locations.
 * It selects ACTIVE rows whose LocationNode is now inactive and deactivates
 * them, then rebuilds each affected provider's candidate-pool rows. The
 * default mode never touches active rows, so pausing needs this flag.
 *
 * Default is DRY-RUN in both modes. Nothing is written without --commit, and
 * --commit needs --admin-email so the AuditLog + AdminAuditEvent pair has a
 * real actor. Output prints ids only, never provider names or phones.
 *
 * Flags:
 *   --deactivate-inactive-nodes  pause mode (see above) instead of reactivation
 *   --providers a,b,c          restrict to these provider ids
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
 *   pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts \
 *     --deactivate-inactive-nodes                                  # dry-run the pause
 *   pnpm exec tsx --env-file=.env.local scripts/reactivate-service-areas-national.ts \
 *     --deactivate-inactive-nodes --commit --admin-email owner@plugapro.co.za
 */
import type { Prisma } from '@prisma/client'
import { db } from '../lib/db'
import { AUDIT_ENTITY } from '../lib/audit-entities'
import { rebuildCandidatePoolForProvider } from '../lib/matching/candidate-pool'

export const REACTIVATE_AUDIT_ACTION = 'provider.service_areas.reactivate_national'
export const DEACTIVATE_AUDIT_ACTION = 'provider.service_areas.deactivate_inactive_nodes'
export const PRE_ROLLOUT_MATCHING_REGION_KEYS: readonly string[] = ['jhb_west']
export const REVIEW_TOUCH_THRESHOLD_MS = 60_000
const AUDIT_REASON = 'national rollout (spec 2026-10-03)'
const DEACTIVATE_AUDIT_REASON = 'location node paused'
const DEACTIVATE_MODE = 'deactivate-inactive-nodes'
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

export type ProviderRow = { id: string; status: string; activeAreaCount: number }

export type PlannedRow = { id: string; label: string; regionKey: string | null; areaType: string; review: boolean }
export type SkippedRow = {
  id: string
  label: string
  regionKey: string | null
  reason: 'pre_rollout_region' | 'inactive_node'
}

export type ProviderPlan = {
  providerId: string
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
  technicianServiceArea: { updateMany: (args: unknown) => Promise<{ count: number }> }
  auditLog: { create: (args: unknown) => Promise<unknown> }
  adminAuditEvent: { create: (args: unknown) => Promise<unknown> }
}

type ExecuteClient = {
  $transaction: (fn: (tx: ExecuteTx) => Promise<void>) => Promise<void>
}

/** Same normalisation the old fence applied (lib/service-area-guard.ts). */
function normaliseRegionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function isPreRolloutMatchingRegion(regionKey: string | null): boolean {
  if (!regionKey) return false
  return PRE_ROLLOUT_MATCHING_REGION_KEYS.includes(normaliseRegionKey(regionKey))
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

function providerScopeFilter(scope: Scope) {
  return scope.providerIds || scope.excludeProviderIds
    ? {
        providerId: {
          ...(scope.providerIds ? { in: scope.providerIds } : {}),
          ...(scope.excludeProviderIds ? { notIn: scope.excludeProviderIds } : {}),
        },
      }
    : {}
}

/** The AuditLog + AdminAuditEvent pair crud-action.ts writes for every admin
 *  mutation; both modes write it inside the same transaction as the update. */
async function writeAuditPair(
  tx: ExecuteTx,
  input: {
    admin: AdminActor
    action: string
    reason: string
    providerId: string
    before: Prisma.InputJsonValue
    after: Prisma.InputJsonValue
    metadata: Prisma.InputJsonValue
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: input.admin.userId,
      actorRole: input.admin.role,
      action: input.action,
      entityType: AUDIT_ENTITY.PROVIDER,
      entityId: input.providerId,
      before: input.before,
      after: input.after,
      reason: input.reason,
    },
  })
  await tx.adminAuditEvent.create({
    data: {
      adminId: input.admin.id,
      action: input.action,
      entityType: AUDIT_ENTITY.PROVIDER,
      entityId: input.providerId,
      before: input.before,
      after: input.after,
      metadata: input.metadata,
    },
  })
}

export async function loadReactivationInputs(
  client: LoadClient,
  scope: Scope,
): Promise<{ rows: InactiveAreaRow[]; providers: ProviderRow[] }> {
  const providerFilter = providerScopeFilter(scope)

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
    select: { id: true, status: true },
  })) as Array<{ id: string; status: string }>

  return {
    rows,
    providers: providers.map((p) => ({ id: p.id, status: p.status, activeAreaCount: activeCount.get(p.id) ?? 0 })),
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

    let updated = 0
    await input.client.$transaction(async (tx) => {
      const result = await tx.technicianServiceArea.updateMany({
        where: { id: { in: rowIds }, active: false },
        data: { active: true },
      })
      updated = result.count
      await writeAuditPair(tx, {
        admin,
        action: REACTIVATE_AUDIT_ACTION,
        reason: AUDIT_REASON,
        providerId: p.providerId,
        before,
        after,
        metadata,
      })
    })
    await input.rebuildPool(p.providerId)
    committedProviders += 1
    committedRows += updated
  }
  return { committedProviders, committedRows }
}

export function formatPlan(plan: ReactivationPlan, commit: boolean): string {
  const verb = commit ? 'will activate' : 'would activate'
  const lines: string[] = []
  lines.push(`--- ${SCRIPT_NAME} --- mode=${commit ? 'COMMIT' : 'DRY-RUN'}`)
  for (const p of plan.providers) {
    lines.push(
      `\n${p.providerId}  status=${p.status}  ${verb}=${p.activate.length}  skipped=${p.skipped.length}` +
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

// ── --deactivate-inactive-nodes (pause lever) ────────────────────────────────

export type PausedNodeAreaRow = { id: string; providerId: string; locationNodeId: string }

export type DeactivationPlan = {
  providers: Array<{ providerId: string; deactivate: Array<{ id: string; locationNodeId: string }> }>
  totalRows: number
  totalsByNode: Record<string, number>
}

export function planDeactivation(rows: PausedNodeAreaRow[]): DeactivationPlan {
  const byProvider = new Map<string, Array<{ id: string; locationNodeId: string }>>()
  const totalsByNode: Record<string, number> = {}
  for (const r of rows) {
    const list = byProvider.get(r.providerId) ?? []
    list.push({ id: r.id, locationNodeId: r.locationNodeId })
    byProvider.set(r.providerId, list)
    totalsByNode[r.locationNodeId] = (totalsByNode[r.locationNodeId] ?? 0) + 1
  }
  return {
    providers: [...byProvider].map(([providerId, deactivate]) => ({ providerId, deactivate })),
    totalRows: rows.length,
    totalsByNode,
  }
}

export async function loadDeactivationInputs(
  client: Pick<LoadClient, 'technicianServiceArea'>,
  scope: Scope,
): Promise<PausedNodeAreaRow[]> {
  return (await client.technicianServiceArea.findMany({
    where: { active: true, locationNode: { is: { active: false } }, ...providerScopeFilter(scope) },
    select: { id: true, providerId: true, locationNodeId: true },
  })) as PausedNodeAreaRow[]
}

export async function executeDeactivation(input: {
  plan: DeactivationPlan
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
    if (p.deactivate.length === 0) continue
    const rowIds = p.deactivate.map((r) => r.id)
    const locationNodeIds = [...new Set(p.deactivate.map((r) => r.locationNodeId))]
    let updated = 0
    await input.client.$transaction(async (tx) => {
      const result = await tx.technicianServiceArea.updateMany({
        where: { id: { in: rowIds }, active: true },
        data: { active: false },
      })
      updated = result.count
      await writeAuditPair(tx, {
        admin,
        action: DEACTIVATE_AUDIT_ACTION,
        reason: DEACTIVATE_AUDIT_REASON,
        providerId: p.providerId,
        before: { activeRowIds: rowIds },
        after: { inactiveRowIds: rowIds, locationNodeIds },
        metadata: { script: SCRIPT_NAME, mode: DEACTIVATE_MODE, reason: DEACTIVATE_AUDIT_REASON },
      })
    })
    await input.rebuildPool(p.providerId)
    committedProviders += 1
    committedRows += updated
  }
  return { committedProviders, committedRows }
}

/** Ids only: provider id, row id, node id. Never labels, names or phones. */
export function formatDeactivationPlan(plan: DeactivationPlan, commit: boolean): string {
  const verb = commit ? 'will deactivate' : 'would deactivate'
  const lines: string[] = []
  lines.push(`--- ${SCRIPT_NAME} (${DEACTIVATE_MODE}) --- mode=${commit ? 'COMMIT' : 'DRY-RUN'}`)
  for (const p of plan.providers) {
    lines.push(`\n${p.providerId}  ${verb}=${p.deactivate.length}`)
    for (const r of p.deactivate) lines.push(`    - ${r.id}  (node ${r.locationNodeId})`)
  }
  lines.push('')
  lines.push('totals by paused node:')
  for (const [nodeId, n] of Object.entries(plan.totalsByNode).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${nodeId.padEnd(28)} ${n}`)
  }
  lines.push(`rows ${verb}: ${plan.totalRows}`)
  lines.push(`providers affected: ${plan.providers.length}`)
  if (!commit) {
    lines.push('\n(dry-run; pass --deactivate-inactive-nodes --commit --admin-email <email> to apply)')
  }
  return lines.join('\n')
}

const LIST_FLAGS = ['--providers', '--exclude-providers'] as const
const EMAIL_FLAG = '--admin-email'
const COMMIT_FLAG = '--commit'
const DEACTIVATE_FLAG = '--deactivate-inactive-nodes'
const BOOLEAN_FLAGS: readonly string[] = [COMMIT_FLAG, DEACTIVATE_FLAG]

export type ParsedArgs = { commit: boolean; adminEmail: string | null; deactivateInactiveNodes: boolean } & Scope

/** Fails closed: any unrecognised token, `--flag=value` form, repeated flag or
 *  missing value throws, so a typo can never silently widen the run's scope. */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    providerIds: null,
    excludeProviderIds: null,
    commit: false,
    adminEmail: null,
    deactivateInactiveNodes: false,
  }
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--') && token.includes('=')) {
      throw new Error(`Unsupported argument form ${token}: pass the value as a separate argument`)
    }
    const isList = (LIST_FLAGS as readonly string[]).includes(token)
    if (!BOOLEAN_FLAGS.includes(token) && token !== EMAIL_FLAG && !isList) {
      throw new Error(`Unknown argument: ${token}`)
    }
    if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`)
    seen.add(token)
    if (token === COMMIT_FLAG) {
      result.commit = true
      continue
    }
    if (token === DEACTIVATE_FLAG) {
      result.deactivateInactiveNodes = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(`${token} requires a value`)
    }
    i += 1
    if (token === EMAIL_FLAG) {
      result.adminEmail = value.trim()
      continue
    }
    const values = value.split(',').map((v) => v.trim()).filter(Boolean)
    if (values.length === 0) throw new Error(`${token} requires at least one provider id`)
    if (token === '--providers') result.providerIds = values
    else result.excludeProviderIds = values
  }
  return result
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
  if (args.commit && !args.adminEmail) throw new Error('--admin-email is required with --commit')
  const admin = args.commit && args.adminEmail ? await resolveAdmin(args.adminEmail) : null
  const scope: Scope = { providerIds: args.providerIds, excludeProviderIds: args.excludeProviderIds }

  if (args.deactivateInactiveNodes) {
    const pausedRows = await loadDeactivationInputs(db as unknown as LoadClient, scope)
    const deactivationPlan = planDeactivation(pausedRows)
    console.log(formatDeactivationPlan(deactivationPlan, args.commit))
    const result = await executeDeactivation({
      plan: deactivationPlan,
      commit: args.commit,
      admin,
      client: db as unknown as ExecuteClient,
      rebuildPool: rebuildCandidatePoolForProvider,
    })
    if (args.commit) {
      console.log(`\ncommitted providers=${result.committedProviders} rows=${result.committedRows}; candidate pool rebuilt per provider`)
    }
    return
  }

  const { rows, providers } = await loadReactivationInputs(db as unknown as LoadClient, scope)
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
