export const dynamic = 'force-dynamic'

import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Audit Log', noIndex: true })

type SearchParams = Record<string, string | string[] | undefined>
type UnifiedAuditRow = {
  id: string
  action: string
  entityType: string
  entityId: string
  actorName: string
  actorRole: string | null
  before: unknown
  after: unknown
  source: 'audit_logs' | 'admin_audit_events'
  timestamp: Date
}

const PAGE_SIZE = 50

function toText(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined
  }
  return undefined
}

function toPageNumber(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  if (parsed < 1) return 1
  if (parsed > 1000) return 1000
  return Math.floor(parsed)
}

function dateRangeParams(dateText?: string, isEnd = false) {
  if (!dateText) return undefined
  const date = new Date(`${dateText}T${isEnd ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function mergeQueryParams(params: SearchParams, extras: Record<string, string | undefined>) {
  const search = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(params)) {
    const normalized = toText(rawValue)
    if (normalized) search.set(key, normalized)
  }

  for (const [key, value] of Object.entries(extras)) {
    if (value) {
      search.set(key, value)
    } else {
      search.delete(key)
    }
  }

  const query = search.toString()
  return query ? `/admin/audit-log?${query}` : '/admin/audit-log'
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // viewAuditLog capability is restricted to ADMIN/OWNER (see
  // lib/ops-dashboard/permissions.ts). Lower-privileged OPS/FINANCE/TRUST
  // admins must not browse audit metadata.
  const actor = await requireRole(['ADMIN', 'OWNER'])
  const resolved = await searchParams

  const entityTypeFilter = toText(resolved.entityType)
  const actionFilter = toText(resolved.action)
  const fromDate = toText(resolved.from)
  const toDate = toText(resolved.to)
  const page = toPageNumber(toText(resolved.page))
  const skip = Math.max(0, (page - 1) * PAGE_SIZE)
  const pageCap = page * PAGE_SIZE

  const auditWhere: Prisma.AuditLogWhereInput = {
    entityType: entityTypeFilter || undefined,
    action: actionFilter || undefined,
    timestamp: {
      gte: dateRangeParams(fromDate),
      lte: dateRangeParams(toDate, true),
    },
  }

  const adminWhere: Prisma.AdminAuditEventWhereInput = {
    entityType: entityTypeFilter || undefined,
    action: actionFilter || undefined,
    timestamp: {
      gte: dateRangeParams(fromDate),
      lte: dateRangeParams(toDate, true),
    },
  }

  const [
    auditRows,
    adminRows,
    auditCount,
    adminCount,
    optionRows,
    actionRows,
  ] = await Promise.all([
    db.auditLog.findMany({
      where: auditWhere,
      orderBy: { timestamp: 'desc' },
      skip: 0,
      take: pageCap,
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        timestamp: true,
      },
    }),
    db.adminAuditEvent.findMany({
      where: adminWhere,
      orderBy: { timestamp: 'desc' },
      skip: 0,
      take: pageCap,
      include: {
        admin: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    db.auditLog.count({ where: auditWhere }),
    db.adminAuditEvent.count({ where: adminWhere }),
    db.auditLog.groupBy({
      by: ['entityType'],
      _count: { _all: true },
      orderBy: { entityType: 'asc' },
    }),
    db.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { action: 'asc' },
    }),
  ])

  const adminAuditActorIds = [...new Set(auditRows.map((row) => row.actorId).filter(Boolean))]
  const auditActorRows = adminAuditActorIds.length
    ? await db.adminUser.findMany({
        where: { id: { in: adminAuditActorIds } },
        select: { id: true, name: true, email: true },
      })
    : []

  const adminAuditActorById = new Map(
    auditActorRows.map((row) => [row.id, row]),
  )

  const options = [
    ...new Set([...optionRows.map((row) => row.entityType), ...adminRows.map((row) => row.entityType)]),
  ].sort((a, b) => a.localeCompare(b))

  const actionOptions = [
    ...new Set([...actionRows.map((row) => row.action), ...adminRows.map((row) => row.action)]),
  ].sort((a, b) => a.localeCompare(b))

  const unifiedRows: UnifiedAuditRow[] = [
    ...auditRows.map((entry) => {
      const actorRecord = adminAuditActorById.get(entry.actorId)
      return {
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorRole: entry.actorRole,
        actorName: actorRecord ? `${actorRecord.name} (${actorRecord.email})` : entry.actorId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        source: 'audit_logs' as const,
        timestamp: entry.timestamp,
      }
    }),
    ...adminRows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorRole: null,
      actorName: `${entry.admin.name} (${entry.admin.email})`,
      before: entry.before ?? null,
      after: entry.after ?? null,
      source: 'admin_audit_events' as const,
      timestamp: entry.timestamp,
    })),
  ].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())

  const pageRows = unifiedRows.slice(skip, skip + PAGE_SIZE)
  const totalRows = auditCount + adminCount
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const firstRow = totalRows === 0 ? 0 : skip + 1
  const lastRow = Math.min(skip + PAGE_SIZE, totalRows)
  const canViewPayload = actor.adminRole === 'OWNER'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Ops, user and admin activity history.</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {firstRow}-{lastRow} of {totalRows}
        </p>
      </div>

      <form className="rounded-xl border border-border/70 bg-card p-4" method="get">
        <input type="hidden" name="page" value="1" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs uppercase text-muted-foreground">Entity</span>
            <select
              name="entityType"
              defaultValue={entityTypeFilter ?? ''}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">All entity types</option>
              {options.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase text-muted-foreground">Action</span>
            <select
              name="action"
              defaultValue={actionFilter ?? ''}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase text-muted-foreground">From</span>
            <input
              name="from"
              type="date"
              defaultValue={fromDate}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase text-muted-foreground">To</span>
            <input
              name="to"
              type="date"
              defaultValue={toDate}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-md border px-3 py-1.5 text-sm" type="submit">
            Apply
          </button>
          <Link
            href="/admin/audit-log"
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Clear
          </Link>
        </div>
      </form>

      <div className="rounded-xl border border-border/70 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Source</th>
              {canViewPayload ? <th className="px-3 py-2">Before</th> : null}
              {canViewPayload ? <th className="px-3 py-2">After</th> : null}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground text-sm" colSpan={canViewPayload ? 7 : 5}>
                  No results for the selected filter set.
                </td>
              </tr>
            ) : (
              pageRows.map((entry) => (
                <tr key={`${entry.source}-${entry.id}`} className="border-t border-border/50">
                  <td className="px-3 py-2 align-top">
                    <p className="font-mono text-xs">
                      {entry.timestamp.toLocaleDateString('en-ZA', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      {entry.timestamp.toLocaleTimeString('en-ZA', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.entityType}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{entry.action}</p>
                    <p className="text-xs text-muted-foreground">{entry.entityId.slice(-12)}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p>{entry.entityType}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p className="text-sm">{entry.actorName}</p>
                    {entry.actorRole ? <p className="text-xs text-muted-foreground">{entry.actorRole}</p> : null}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">{entry.source}</td>
                  {canViewPayload ? (
                    <td className="px-3 py-2 align-top">
                      <pre className="max-w-xl overflow-auto rounded border border-border/60 bg-muted/40 px-2 py-1 text-[11px]">
                        {JSON.stringify(entry.before, null, 2)}
                      </pre>
                    </td>
                  ) : null}
                  {canViewPayload ? (
                    <td className="px-3 py-2 align-top">
                      <pre className="max-w-xl overflow-auto rounded border border-border/60 bg-muted/40 px-2 py-1 text-[11px]">
                        {JSON.stringify(entry.after, null, 2)}
                      </pre>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <Link
          href={mergeQueryParams(resolved, { page: page > 1 ? String(page - 1) : undefined })}
          className="rounded-md border px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
          aria-disabled={page <= 1}
        >
          ← Prev
        </Link>
        <p className="text-xs text-muted-foreground">
          Page {Math.min(page, totalPages)} / {totalPages}
        </p>
        <Link
          href={mergeQueryParams(
            resolved,
            { page: page < totalPages ? String(page + 1) : undefined },
          )}
          className="rounded-md border px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
          aria-disabled={page >= totalPages}
        >
          Next →
        </Link>
      </div>
    </div>
  )
}
