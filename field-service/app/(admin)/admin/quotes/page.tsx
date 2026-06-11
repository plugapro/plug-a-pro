export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { QuoteStatus } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import {
  OPS_QUEUE_TYPES,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
} from '@/lib/ops-queue'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'
import {
  claimQuoteFromFormAction,
  releaseQuoteFromFormAction,
  approveQuoteFromFormAction,
  sendQuoteFromFormAction,
} from './actions'
import { VoidQuoteButton } from './_components/VoidQuoteButton'
import { DeclineQuoteButton } from './_components/DeclineQuoteButton'
import { EmptyState } from '@/components/shared/EmptyState'

export const metadata = buildMetadata({ title: 'Quote Approvals', noIndex: true })

const QUOTE_QUEUE_STATUSES: QuoteStatus[] = ['PENDING', 'REVISED']
const FLAG = 'admin.crud.quotes'
const CASES_FLAG = 'ops.v2.cases'

export default async function AdminQuoteQueuePage() {
  const admin = await requireAdmin()
  const now = new Date()
  const pageWarnings: string[] = []
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const sendEnabled = await isEnabled('admin.quotes.send', { userId: admin.id })
  const casesEnabled = await isEnabled(CASES_FLAG, { userId: admin.id })

  const quotes = await db.quote.findMany({
    where: { status: { in: QUOTE_QUEUE_STATUSES } },
    select: {
      id: true,
      status: true,
      amount: true,
      createdAt: true,
      validUntil: true,
      // Quote.approvalToken is a customer bearer secret: holding it lets anyone
      // accept / request-revision on the customer's behalf via /quotes/{token}.
      // It must never be surfaced in operational queues. Admins act through
      // their own session-authorized actions below (claim / approve / decline /
      // send), so the token is not needed here.
      approvalWhatsappSentAt: true,
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
  }).catch((error) => {
    console.error('[admin/quotes] Failed to load quote queue', error)
    pageWarnings.push('Quote queue data is temporarily unavailable.')
    return []
  })

  const quoteIds = quotes.map((quote) => quote.id)

  const [assignments, rawAuditLogs, quoteReadyMessages] = await Promise.all([
    listOpsQueueAssignments(db, OPS_QUEUE_TYPES.QUOTE_APPROVAL, quoteIds).catch((error) => {
      console.error('[admin/quotes] Failed to load queue assignments', error)
      pageWarnings.push('Assignment ownership data is temporarily unavailable.')
      return new Map() as Awaited<ReturnType<typeof listOpsQueueAssignments>>
    }),
    db.auditLog.findMany({
      where: { entityId: { in: quoteIds }, entityType: AUDIT_ENTITY.QUOTE },
      select: { id: true, entityId: true, action: true, actorRole: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: quoteIds.length * 5 + 10,
    }).catch((error) => {
      console.error('[admin/quotes] Failed to load audit logs', error)
      pageWarnings.push('Recent quote activity failed to load.')
      return [] as Array<{ id: string; entityId: string | null; action: string; actorRole: string; timestamp: Date }>
    }),
    quoteIds.length > 0
      ? db.messageEvent.findMany({
          where: {
            // Must match the template name sent at actions.ts:308 (notifyQuoteReady - OOS-06).
            templateName: 'customer_quote_ready',
            OR: quoteIds.map((quoteId) => ({
              metadata: {
                path: ['quoteId'],
                equals: quoteId,
              },
            })),
          },
          select: {
            id: true,
            metadata: true,
          },
        }).catch((error) => {
          console.error('[admin/quotes] Failed to load quote-ready message events', error)
          pageWarnings.push('Quote notification evidence is temporarily unavailable.')
          return [] as Array<{ id: string; metadata: unknown }>
        })
      : [],
  ])

  const quoteIdsWithCustomerNotification = new Set(
    quoteReadyMessages
      .map((event) => {
        const metadata = event.metadata
        return metadata && typeof metadata === 'object' && 'quoteId' in metadata
          ? String((metadata as { quoteId?: unknown }).quoteId ?? '')
          : ''
      })
      .filter(Boolean),
  )

  const auditByQuote = new Map<string, typeof rawAuditLogs>()
  for (const log of rawAuditLogs) {
    if (!log.entityId) continue
    const list = auditByQuote.get(log.entityId) ?? []
    list.push(log)
    auditByQuote.set(log.entityId, list)
  }

  // Fetch open cases for each quote (gated by flag)
  const rawQuoteCases = casesEnabled
    ? await db.case.findMany({
        where: {
          entityType: 'QUOTE',
          entityId: { in: quoteIds },
          state: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => [])
    : []
  const caseByQuote = new Map(rawQuoteCases.map((c) => [c.entityId, c]))

  const expiredCount = quotes.filter((quote) => quote.validUntil && quote.validUntil < now).length

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref="/admin/quotes" /> : null}
      {!crudEnabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Quote queue mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      ) : null}
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
        <EmptyState
          title="Queue is clear"
          description="No quotes are currently waiting on customer approval."
        />
      ) : (
        <div className="space-y-4">
          {quotes.map((quote) => {
            const assignment = assignments.get(quote.id)
            const claimedByCurrentUser = assignment?.claimedById === admin.id
            const expired = quote.validUntil ? quote.validUntil < now : false
            const customerNotNotified =
              Boolean(quote.approvalWhatsappSentAt) && !quoteIdsWithCustomerNotification.has(quote.id)

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
                      {customerNotNotified ? (
                        <Badge variant="warning">customer not notified</Badge>
                      ) : null}
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
                    <Badge variant={slaToneVariant(getQueueAgeTone('quoteApprovals', ageMinutes(quote.createdAt, now)))}>
                      Age {formatAge(quote.createdAt, now)}
                    </Badge>
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
                      <ActionForm action={claimQuoteFromFormAction} successMessage="Quote claimed" refreshOnSuccess>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!crudEnabled}>
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      <ActionForm action={releaseQuoteFromFormAction} successMessage="Quote released" refreshOnSuccess>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!crudEnabled}>
                          Release
                        </SubmitButton>
                      </ActionForm>
                    )}

                    <VoidQuoteButton
                      quoteId={quote.id}
                      quoteAmount={formatCurrency(Number(quote.amount))}
                      disabled={!crudEnabled}
                    />

                    {(quote.status === 'PENDING' || quote.status === 'REVISED') && (
                      <ActionForm action={approveQuoteFromFormAction} successMessage="Quote approved" refreshOnSuccess>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!sendEnabled}>
                          Approve
                        </SubmitButton>
                      </ActionForm>
                    )}

                    {(quote.status === 'PENDING' || quote.status === 'REVISED') && (
                      <DeclineQuoteButton
                        quoteId={quote.id}
                        quoteAmount={formatCurrency(Number(quote.amount))}
                        disabled={!sendEnabled}
                      />
                    )}

                    {!quote.approvalWhatsappSentAt && (
                      <ActionForm action={sendQuoteFromFormAction} successMessage="Quote sent to customer" refreshOnSuccess>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!sendEnabled}>
                          Send to customer
                        </SubmitButton>
                      </ActionForm>
                    )}

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

                  {casesEnabled && (() => {
                    const activeCase = caseByQuote.get(quote.id)
                    if (!activeCase) return null
                    return (
                      <div className="space-y-4 border-t pt-4 mt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Case actions</p>
                          <ResolveCaseDialog caseId={activeCase.id} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Timeline</p>
                          <CaseActivityTimeline events={activeCase.events} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
                          <CaseNotes caseId={activeCase.id} notes={activeCase.notes} />
                        </div>
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

function ageMinutes(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000))
}

function slaToneVariant(tone: 'default' | 'warning' | 'danger') {
  if (tone === 'danger') return 'danger' as const
  if (tone === 'warning') return 'warning' as const
  return 'outline' as const
}

function formatDateTime(date: Date) {
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}
