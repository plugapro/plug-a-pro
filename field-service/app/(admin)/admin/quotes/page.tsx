export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import type { QuoteStatus } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Quote Approvals', noIndex: true })

const QUOTE_QUEUE_STATUSES: QuoteStatus[] = ['PENDING', 'REVISED']

export default async function AdminQuoteQueuePage() {
  const admin = await requireAdmin()
  const now = new Date()

  const quotes = await db.quote.findMany({
    where: { status: { in: QUOTE_QUEUE_STATUSES } },
    select: {
      id: true,
      status: true,
      amount: true,
      createdAt: true,
      validUntil: true,
      approvalToken: true,
      notes: true,
      description: true,
      match: {
        select: {
          id: true,
          provider: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          jobRequest: {
            select: {
              id: true,
              title: true,
              category: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                },
              },
              address: {
                select: {
                  suburb: true,
                  city: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  const quoteIds = quotes.map((quote) => quote.id)

  const [assignments, rawAuditLogs] = await Promise.all([
    listOpsQueueAssignments(db, OPS_QUEUE_TYPES.QUOTE_APPROVAL, quoteIds),
    db.auditLog.findMany({
      where: { entityId: { in: quoteIds }, entityType: 'quote' },
      select: { id: true, entityId: true, action: true, actorRole: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: quoteIds.length * 5 + 10,
    }),
  ])

  const auditByQuote = new Map<string, typeof rawAuditLogs>()
  for (const log of rawAuditLogs) {
    if (!log.entityId) continue
    const list = auditByQuote.get(log.entityId) ?? []
    list.push(log)
    auditByQuote.set(log.entityId, list)
  }

  async function claimQuote(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const quoteId = String(formData.get('quoteId') ?? '')
    if (!quoteId) return

    await claimOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
      entityId: quoteId,
      claimedById: activeAdmin.id,
      claimedByRole: activeAdmin.role,
      claimedByLabel: activeAdmin.email ?? 'admin',
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    revalidatePath('/admin/quotes')
    revalidatePath('/admin')
  }

  async function releaseQuote(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const quoteId = String(formData.get('quoteId') ?? '')
    if (!quoteId) return

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
      entityId: quoteId,
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    revalidatePath('/admin/quotes')
    revalidatePath('/admin')
  }

  const expiredCount = quotes.filter((quote) => quote.validUntil && quote.validUntil < now).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Quote Approvals Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pending and revised quotes that need a customer decision or an ops chase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={quotes.length > 0 ? 'warning' : 'neutral'}>{quotes.length} waiting</Badge>
          <Badge variant={expiredCount > 0 ? 'danger' : 'outline'}>{expiredCount} expired</Badge>
        </div>
      </div>

      {quotes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No quotes are waiting on approval.
        </div>
      ) : (
        <div className="space-y-4">
          {quotes.map((quote) => {
            const assignment = assignments.get(quote.id)
            const claimedByCurrentUser = assignment?.claimedById === admin.id
            const quotePageUrl = `/quotes/${quote.approvalToken}`
            const expired = quote.validUntil ? quote.validUntil < now : false

            return (
              <Card key={quote.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{quote.match.jobRequest.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {quote.match.jobRequest.customer.name} · {quote.match.provider.name}
                        {quote.match.jobRequest.address
                          ? ` · ${quote.match.jobRequest.address.suburb}, ${quote.match.jobRequest.address.city}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={quote.status} type="quote" />
                      <Badge variant={expired ? 'danger' : 'outline'}>
                        {expired ? 'Expired' : 'Awaiting customer'}
                      </Badge>
                      <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                        {formatOpsQueueOwnerLabel(assignment, admin.id)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Age {formatAge(quote.createdAt, now)}</Badge>
                    <Badge variant="outline">Amount {formatCurrency(Number(quote.amount))}</Badge>
                    {quote.validUntil ? (
                      <Badge variant={expired ? 'danger' : 'outline'}>
                        Valid until {formatDateTime(quote.validUntil)}
                      </Badge>
                    ) : null}
                    <Badge variant="outline">Quote {quote.id.slice(-8).toUpperCase()}</Badge>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p>{quote.description}</p>
                    {quote.notes ? (
                      <p className="text-muted-foreground">Customer feedback: {quote.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!claimedByCurrentUser ? (
                      <form action={claimQuote}>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <Button type="submit" variant="outline" size="sm">
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </Button>
                      </form>
                    ) : (
                      <form action={releaseQuote}>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Release
                        </Button>
                      </form>
                    )}

                    <Button asChild size="sm">
                      <Link href={quotePageUrl} target="_blank">
                        Open approval page
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/customers/${quote.match.jobRequest.customer.id}`}>Open customer</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/providers/${quote.match.provider.id}`}>Open provider</Link>
                    </Button>
                  </div>

                  {(() => {
                    const trail = auditByQuote.get(quote.id) ?? []
                    if (trail.length === 0) return null
                    return (
                      <div className="border-t pt-3 space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
                        {trail.slice(0, 4).map((entry) => (
                          <div key={entry.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0 tabular-nums">{formatAge(entry.timestamp, now)}</span>
                            <span className="font-medium text-foreground/70">{entry.action.replace(/\./g, ' · ')}</span>
                            <span className="ml-auto shrink-0">{entry.actorRole}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatAge(date: Date, now: Date) {
  const diffMs = Math.max(0, now.getTime() - date.getTime())
  const minutes = Math.floor(diffMs / 60000)

  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatCurrency(amount: number) {
  return `R ${amount.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatDateTime(date: Date) {
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}
