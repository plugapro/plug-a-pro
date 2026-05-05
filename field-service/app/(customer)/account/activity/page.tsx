export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        <Link href="/bookings" className="text-xs text-muted-foreground hover:text-foreground">
          ← My requests &amp; bookings
        </Link>
        <h1 className="text-xl font-semibold mt-1">Activity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your last 50 account events</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity yet.</p>
          ) : (
            <ul className="divide-y">
              {logs.map((log) => (
                <li key={log.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{formatAction(log.action)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatEntityType(log.entityType)}
                      {log.entityId && (
                        <span className="ml-1 font-mono">#{log.entityId.slice(-8).toUpperCase()}</span>
                      )}
                    </p>
                  </div>
                  <time
                    dateTime={log.timestamp.toISOString()}
                    className="text-xs text-muted-foreground whitespace-nowrap shrink-0"
                  >
                    {formatTimestamp(log.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
