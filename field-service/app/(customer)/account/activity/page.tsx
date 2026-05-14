export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { ChevronLeft } from 'lucide-react'

export const metadata = buildMetadata({ title: 'Activity', noIndex: true })

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatEntityType(entityType: string): string {
  return entityType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default async function ActivityPage() {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    redirect('/sign-in?next=/account/activity')
  }

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    redirect('/sign-in?next=/account/activity')
  }

  // Collect job request IDs for this customer so we can surface
  // audit events that reference those entities even if actorId differs.
  const jobReqs = await db.jobRequest.findMany({
    where: { customerId: customer.id },
    select: { id: true },
  })
  const jobRequestIds = jobReqs.map((j) => j.id)

  const orClauses: Array<Record<string, unknown>> = []

  if (customer.userId) {
    orClauses.push({ actorId: customer.userId })
  }

  if (jobRequestIds.length > 0) {
    orClauses.push({ entityId: { in: jobRequestIds } })
  }

  const logs =
    orClauses.length > 0
      ? await db.auditLog.findMany({
          where: { OR: orClauses },
          orderBy: { timestamp: 'desc' },
          take: 50,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            timestamp: true,
          },
        })
      : []

  return (
    <div className="min-h-screen pb-32 screen-enter">
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link
          href="/bookings"
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ChevronLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>
          Activity
        </h1>
      </div>

      <div
        className="mx-[18px] rounded-[20px]"
        style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
      >
        <p
          className="px-5 pt-4 pb-2 text-[11px] font-bold tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-mute)' }}
        >
          Recent events
        </p>
        <div className="divide-y divide-[var(--border)]">
          {logs.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-mute)' }}>
              No activity yet.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {logs.map((log) => (
                <li key={log.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm" style={{ color: 'var(--ink)' }}>
                      {formatAction(log.action)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                      {formatEntityType(log.entityType)}
                      {log.entityId && (
                        <span className="ml-1 font-mono">#{log.entityId.slice(-8).toUpperCase()}</span>
                      )}
                    </p>
                  </div>
                  <time
                    dateTime={log.timestamp.toISOString()}
                    className="text-xs whitespace-nowrap shrink-0"
                    style={{ color: 'var(--ink-mute)' }}
                  >
                    {formatTimestamp(log.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
