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
