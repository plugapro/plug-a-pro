export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getBreachedCases } from '@/lib/cases'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Breached Cases', noIndex: true })

const QUEUE_HREFS: Record<string, string> = {
  VALIDATION:        '/admin/validation',
  DISPATCH:          '/admin/dispatch',
  QUOTE_APPROVAL:    '/admin/quotes',
  DISPUTE:           '/admin/disputes',
  PAYMENT_FOLLOW_UP: '/admin/payments',
  PROVIDER_ONBOARDING: '/admin/applications',
  IDENTITY_VERIFICATION: '/admin/verifications?status=NEEDS_MANUAL_REVIEW',
}

function formatAge(slaDueAt: Date): string {
  const overdueMs = Date.now() - slaDueAt.getTime()
  const mins = Math.floor(overdueMs / 60_000)
  if (mins < 60) return `${mins}m overdue`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h overdue`
  return `${Math.floor(hrs / 24)}d overdue`
}

export default async function BreachedCasesPage() {
  await requireAdmin()
  const summary = await getBreachedCases().catch(() => null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Breached Cases</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cases where the SLA target has passed and the case is still open.
        </p>
      </div>

      {!summary || summary.total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No breached cases. All queues within SLA.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Per-queue summary */}
          <div className="flex flex-wrap gap-2">
            {summary.byQueue.map((q) => (
              <Link
                key={q.queueType}
                href={QUEUE_HREFS[q.queueType] ?? '/admin'}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
              >
                <span className="font-medium">{q.queueType.replace(/_/g, ' ')}</span>{' '}
                <Badge variant="danger">{q.count}</Badge>
              </Link>
            ))}
          </div>

          {/* Oldest cases list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Oldest breached cases (top {summary.oldest.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.oldest.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {c.queueType.replace(/_/g, ' ')} - {c.entityType} {c.entityId.slice(0, 8)}…
                    </p>
                    {c.ownerUserId ? (
                      <p className="text-xs text-muted-foreground">Assigned to {c.ownerUserId}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Unassigned</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="danger">{formatAge(new Date(c.slaDueAt))}</Badge>
                    <Link
                      href={`${QUEUE_HREFS[c.queueType] ?? '/admin'}?request=${c.entityId}`}
                      className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
