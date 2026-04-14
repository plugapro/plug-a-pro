export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { ApplicationStatus, DisputeStatus, JobStatus, PaymentStatus } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
} from '@/lib/ops-queue'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Operations Dashboard', noIndex: true })

const jobRequestSummarySelect = {
  id: true,
  title: true,
  category: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  customer: {
    select: {
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
} as const

const quoteSummarySelect = {
  id: true,
  amount: true,
  validUntil: true,
  status: true,
  createdAt: true,
  match: {
    select: {
      provider: { select: { name: true } },
      jobRequest: {
        select: jobRequestSummarySelect,
      },
    },
  },
} as const

const jobBoardSelect = {
  id: true,
  status: true,
  failureReason: true,
  updatedAt: true,
  provider: { select: { name: true } },
  booking: {
    select: {
      scheduledDate: true,
      scheduledWindow: true,
      match: {
        select: {
          jobRequest: {
            select: jobRequestSummarySelect,
          },
        },
      },
    },
  },
} as const

const paymentFollowUpSelect = {
  id: true,
  status: true,
  amount: true,
  updatedAt: true,
  pspProvider: true,
  booking: {
    select: {
      scheduledDate: true,
      match: {
        select: {
          jobRequest: {
            select: jobRequestSummarySelect,
          },
        },
      },
    },
  },
} as const

const disputeSummarySelect = {
  id: true,
  jobId: true,
  reason: true,
  status: true,
  createdAt: true,
  raisedByRole: true,
} as const

const providerApplicationSummarySelect = {
  id: true,
  name: true,
  phone: true,
  skills: true,
  serviceAreas: true,
  status: true,
  submittedAt: true,
} as const

const ACTIVE_FIELD_STATUSES: JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PAUSED',
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
] 

const FIELD_EXCEPTION_STATUSES: JobStatus[] = [
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
  'FAILED',
  'CALLBACK_REQUIRED',
] 

const PAYMENT_EXCEPTION_STATUSES: PaymentStatus[] = [
  'PENDING',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] 

const OPEN_DISPUTE_STATUSES: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW']

export default async function AdminDashboardPage() {
  const admin = await requireAdmin()

  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const queueGroupResult = await Promise.all([
    db.jobRequest.findMany({
      where: { status: 'PENDING_VALIDATION' },
      select: jobRequestSummarySelect,
      orderBy: { createdAt: 'asc' },
      take: 6,
    }),
    db.jobRequest.count({
      where: { status: 'PENDING_VALIDATION' },
    }),
    db.jobRequest.findMany({
      where: { status: { in: ['OPEN', 'MATCHING'] } },
      select: {
        ...jobRequestSummarySelect,
        match: {
          select: {
            provider: { select: { name: true } },
          },
        },
        _count: {
          select: { leads: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 6,
    }),
    db.jobRequest.count({
      where: { status: { in: ['OPEN', 'MATCHING'] } },
    }),
    db.quote.findMany({
      where: { status: { in: ['PENDING', 'REVISED'] } },
      select: quoteSummarySelect,
      orderBy: { createdAt: 'asc' },
      take: 6,
    }),
    db.quote.count({
      where: { status: { in: ['PENDING', 'REVISED'] } },
    }),
  ]).catch(() => null)

  const queueGroupError = queueGroupResult === null
  const [
    validationQueue,
    validationCount,
    dispatchQueue,
    dispatchCount,
    pendingQuotes,
    quoteCount,
  ] = queueGroupResult ?? [[], 0, [], 0, [], 0]

  const [validationAssignments, dispatchAssignments, quoteAssignments] = await Promise.all([
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.VALIDATION,
      validationQueue.map((request) => request.id),
    ),
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.DISPATCH,
      dispatchQueue.map((request) => request.id),
    ),
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.QUOTE_APPROVAL,
      pendingQuotes.map((quote) => quote.id),
    ),
  ]).catch(() => [new Map(), new Map(), new Map()])
  const fieldGroupResult = await Promise.all([
    db.job.count({
      where: { status: { in: ACTIVE_FIELD_STATUSES } },
    }),
    db.job.findMany({
      where: { status: { in: FIELD_EXCEPTION_STATUSES } },
      select: jobBoardSelect,
      orderBy: { updatedAt: 'asc' },
      take: 6,
    }),
    db.job.count({
      where: { status: { in: FIELD_EXCEPTION_STATUSES } },
    }),
    db.payment.findMany({
      where: { status: { in: PAYMENT_EXCEPTION_STATUSES } },
      select: paymentFollowUpSelect,
      orderBy: { updatedAt: 'asc' },
      take: 6,
    }),
    db.payment.count({
      where: { status: { in: PAYMENT_EXCEPTION_STATUSES } },
    }),
  ]).catch(() => null)

  const fieldGroupError = fieldGroupResult === null
  const [
    activeFieldCount,
    fieldExceptions,
    fieldExceptionCount,
    financeFollowUp,
    paymentExceptionCount,
  ] = fieldGroupResult ?? [0, [], 0, [], 0]

  const trustSupplyGroupResult = await Promise.all([
    db.dispute.findMany({
      where: { status: { in: OPEN_DISPUTE_STATUSES } },
      select: disputeSummarySelect,
      orderBy: { createdAt: 'asc' },
      take: 6,
    }),
    db.dispute.count({
      where: { status: { in: OPEN_DISPUTE_STATUSES } },
    }),
    db.providerApplication.findMany({
      where: { status: 'PENDING' },
      select: providerApplicationSummarySelect,
      orderBy: { submittedAt: 'asc' },
      take: 6,
    }),
    db.providerApplication.count({
      where: { status: 'PENDING' },
    }),
    db.jobRequest.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    db.match.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    db.quote.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    db.booking.count({
      where: { createdAt: { gte: weekAgo } },
    }),
  ]).catch(() => null)

  const trustSupplyGroupError = trustSupplyGroupResult === null
  const [
    openDisputes,
    disputeCount,
    providerOnboarding,
    providerReviewCount,
    weekRequests,
    weekMatches,
    weekQuotes,
    weekBookings,
  ] = trustSupplyGroupResult ?? [[], 0, [], 0, 0, 0, 0, 0]

  const [fieldExceptionAssignments, disputeAssignments, paymentAssignments, providerAssignments] = await Promise.all([
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.FIELD_EXCEPTION,
      fieldExceptions.map((job) => job.id),
    ),
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.DISPUTE,
      openDisputes.map((dispute) => dispute.id),
    ),
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
      financeFollowUp.map((payment) => payment.id),
    ),
    listOpsQueueAssignments(
      db,
      OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
      providerOnboarding.map((application) => application.id),
    ),
  ])

  const validationHealth = summarizeQueueHealth(
    validationQueue,
    validationAssignments,
    now,
    15,
    (request) => request.createdAt,
  )
  const dispatchHealth = summarizeQueueHealth(
    dispatchQueue,
    dispatchAssignments,
    now,
    20,
    (request) => request.createdAt,
  )
  const quoteHealth = summarizeQueueHealth(
    pendingQuotes,
    quoteAssignments,
    now,
    240,
    (quote) => quote.createdAt,
  )
  const fieldExceptionHealth = summarizeQueueHealth(
    fieldExceptions,
    fieldExceptionAssignments,
    now,
    60,
    (job) => job.updatedAt,
  )
  const paymentHealth = summarizeQueueHealth(
    financeFollowUp,
    paymentAssignments,
    now,
    1440,
    (payment) => payment.updatedAt,
  )
  const disputeHealth = summarizeQueueHealth(
    openDisputes,
    disputeAssignments,
    now,
    120,
    (dispute) => dispute.createdAt,
  )
  const providerHealth = summarizeQueueHealth(
    providerOnboarding,
    providerAssignments,
    now,
    1440,
    (application) => application.submittedAt,
  )

  const revenueGroupResult = await Promise.all([
    db.job.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: weekAgo },
      },
    }),
    db.payment.count({
      where: {
        status: 'PAID',
        paidAt: { gte: weekAgo },
      },
    }),
    db.payment.aggregate({
      where: {
        status: 'PAID',
        paidAt: { gte: weekAgo },
      },
      _sum: { amount: true },
    }),
  ]).catch(() => null)

  const revenueGroupError = revenueGroupResult === null
  const [weekCompleted, weekPaid, weekRevenue] = revenueGroupResult ?? [
    0,
    0,
    { _sum: { amount: null } },
  ]

  const heroStats = [
    {
      label: 'Requests needing validation',
      description: 'Job requests submitted but not yet cleared for matching. Target: triage inside 15 min.',
      value: validationCount,
      tone: heroToneClass(queueHealthHeroTone(validationHealth)),
    },
    {
      label: 'Dispatch queue',
      description: 'Open or matching requests without a confirmed provider. Target: assign inside 20 min.',
      value: dispatchCount,
      tone: heroToneClass(queueHealthHeroTone(dispatchHealth)),
    },
    {
      label: 'Jobs in field',
      description: 'Active jobs currently in EN_ROUTE, ARRIVED, STARTED, PAUSED, AWAITING_APPROVAL, or PENDING_COMPLETION_CONFIRMATION.',
      value: activeFieldCount,
      tone: heroToneClass(activeFieldCount > 0 ? 'info' : 'default'),
    },
    {
      label: 'Operational exceptions',
      description: `Field exceptions (${fieldExceptionCount}) + payment exceptions (${paymentExceptionCount}) + open disputes (${disputeCount}). Any non-zero value needs an owner.`,
      value: fieldExceptionCount + paymentExceptionCount + disputeCount,
      tone: heroToneClass(
        fieldExceptionCount + paymentExceptionCount + disputeCount > 0 ? 'danger' : 'default'
      ),
    },
  ]

  const queueCards = [
    {
      lane: 'Ops',
      title: 'Validation queue',
      count: validationCount,
      target: 'Triage inside 15 min',
      href: '/admin/validation',
      note: 'Requests missing platform validation before matching can start.',
      detail: queueHealthDetail(validationHealth),
      tone: queueHealthCardTone(validationHealth),
    },
    {
      lane: 'Dispatch',
      title: 'Dispatch pressure',
      count: dispatchCount,
      target: 'Assign inside 20 min',
      href: '/admin/dispatch',
      note: `${activeFieldCount} jobs already live in the field today.`,
      detail: queueHealthDetail(dispatchHealth),
      tone: queueHealthCardTone(dispatchHealth),
    },
    {
      lane: 'Field',
      title: 'Field exceptions',
      count: fieldExceptionCount,
      target: 'Triage inside 1 hour',
      href: '/admin/field-exceptions',
      note: 'Jobs that are blocked, failed, or waiting on customer action.',
      detail: queueHealthDetail(fieldExceptionHealth),
      tone: queueHealthCardTone(fieldExceptionHealth),
    },
    {
      lane: 'Finance',
      title: 'Finance follow-up',
      count: paymentExceptionCount,
      target: 'Resolve inside 1 day',
      href: '/admin/payments',
      note: 'Pending, failed, and refund-state payments requiring intervention.',
      detail: queueHealthDetail(paymentHealth),
      tone: queueHealthCardTone(paymentHealth),
    },
    {
      lane: 'Trust',
      title: 'Trust recovery',
      count: disputeCount,
      target: 'Acknowledge inside 2 hours',
      href: '/admin/disputes',
      note: 'Open disputes and complaints with customer-provider risk attached.',
      detail: queueHealthDetail(disputeHealth),
      tone: queueHealthCardTone(disputeHealth),
    },
    {
      lane: 'Quotes',
      title: 'Quote approvals',
      count: quoteCount,
      target: 'Chase inside 4 hours',
      href: '/admin/quotes',
      note: 'Quotes waiting on customer decision or revision follow-through.',
      detail: queueHealthDetail(quoteHealth),
      tone: queueHealthCardTone(quoteHealth),
    },
    {
      lane: 'Supply',
      title: 'Provider onboarding',
      count: providerReviewCount,
      target: 'Review inside 1 day',
      href: '/admin/applications',
      note: 'Pending applications that block future assignment capacity.',
      detail: queueHealthDetail(providerHealth),
      tone: queueHealthCardTone(providerHealth),
    },
  ]

  return (
    <div className="space-y-8">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)]">
        <Card className="app-hero-surface border-border/70">
          <CardHeader className="gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="brand">Control Tower</Badge>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Refreshed at{' '}
                    {now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <a
                    href="/admin"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Refresh
                  </a>
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Run the platform from queues, not lagging reports. This view surfaces validation,
                  dispatch, quote, field, finance, trust, and supply actions that need an owner
                  now.
                </p>
              </div>
              <p className="app-kicker">
                {now.toLocaleDateString('en-ZA', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {heroStats.map((stat) => (
              <HeroStat
                key={stat.label}
                label={stat.label}
                description={stat.description}
                value={stat.value}
                tone={stat.tone}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-base">Immediate actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full justify-between">
              <Link href="/admin/validation">
                Open validation queue
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/dispatch">
                Open dispatch console
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/field-exceptions">
                Triage field exceptions
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/quotes">
                Work quote approvals
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/payments">
                Review finance blockers
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/disputes">
                Work complaints and disputes
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/applications">
                Approve providers
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {(queueGroupError || fieldGroupError) && (
        <SectionErrorBanner message="Queue data could not be loaded. Counts shown are stale or zero. Retry to reload." />
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {queueCards.map((card) => (
          <QueueCard key={card.title} {...card} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Validation queue</CardTitle>
              <p className="text-sm text-muted-foreground">
                New requests that need enough information before ops can match them.
              </p>
            </div>
            <Badge variant={slaBadgeClass(validationCount > 0 ? 'warning' : 'default')}>
              {validationCount} open
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {validationQueue.length === 0 ? (
              <EmptyState message="No requests are waiting on validation." />
            ) : (
              validationQueue.map((request) => (
                <div key={request.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{request.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.customer.name}
                        {request.address ? ` · ${request.address.suburb}, ${request.address.city}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={request.status} type="jobRequest" />
                      <Badge
                        variant={assignmentBadgeVariant(
                          validationAssignments.get(request.id),
                          admin.id,
                        )}
                      >
                        {formatOpsQueueOwnerLabel(validationAssignments.get(request.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Age {formatAge(request.createdAt, now)}</span>
                    <span>Phone {request.customer.phone}</span>
                  </div>
                  <div className="mt-3">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/admin/validation">Open validation queue</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Dispatch pressure</CardTitle>
              <p className="text-sm text-muted-foreground">
                Open service requests and active field load that can tip into lateness.
              </p>
            </div>
            <Badge variant={slaBadgeClass(queueHealthBadgeTone(dispatchHealth))}>
              {dispatchCount} queued
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {dispatchQueue.length === 0 ? (
              <EmptyState message="No open or matching requests need dispatch attention." />
            ) : (
              dispatchQueue.map((request) => (
                <div key={request.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{request.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.customer.name}
                        {request.address ? ` · ${request.address.suburb}, ${request.address.city}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={request.status} type="jobRequest" />
                      <Badge
                        variant={assignmentBadgeVariant(dispatchAssignments.get(request.id), admin.id)}
                      >
                        {formatOpsQueueOwnerLabel(dispatchAssignments.get(request.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={laneBadgeClass('Dispatch')}>
                      {request._count.leads} leads sent
                    </Badge>
                    <Badge variant="outline">
                      {request.expiresAt
                        ? `Expires ${formatShortDate(request.expiresAt)}`
                        : `Opened ${formatAge(request.createdAt, now)} ago`}
                    </Badge>
                    {request.match?.provider ? (
                      <Badge variant="outline">Matched to {request.match.provider.name}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/dispatch?request=${request.id}`}>Open in dispatch</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Quote approvals</CardTitle>
              <p className="text-sm text-muted-foreground">
                Quotes that can move revenue forward with a customer decision or chase.
              </p>
            </div>
            <Badge variant={slaBadgeClass(quoteCount > 0 ? 'warning' : 'default')}>
              {quoteCount} waiting
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingQuotes.length === 0 ? (
              <EmptyState message="No quotes are waiting on approval right now." />
            ) : (
              pendingQuotes.map((quote) => (
                <div key={quote.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{quote.match.jobRequest.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {quote.match.jobRequest.customer.name} · {quote.match.provider.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={quote.status} type="quote" />
                      <Badge
                        variant={assignmentBadgeVariant(quoteAssignments.get(quote.id), admin.id)}
                      >
                        {formatOpsQueueOwnerLabel(quoteAssignments.get(quote.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={slaBadgeClass(getSlaTone(quote.createdAt, now, 240))}>
                      Age {formatAge(quote.createdAt, now)}
                    </Badge>
                    <Badge variant="outline">{formatCurrency(Number(quote.amount))}</Badge>
                    {quote.validUntil ? (
                      <Badge variant="outline">Valid until {formatShortDate(quote.validUntil)}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/admin/quotes">Open quote queue</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Field exceptions</CardTitle>
              <p className="text-sm text-muted-foreground">
                Jobs that are blocked, failed, or waiting on human intervention.
              </p>
            </div>
            <Badge variant={slaBadgeClass(queueHealthBadgeTone(fieldExceptionHealth))}>
              {fieldExceptionCount} escalated
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {fieldExceptions.length === 0 ? (
              <EmptyState message="No field exceptions are open right now." />
            ) : (
              fieldExceptions.map((job) => (
                <div key={job.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{job.booking.match.jobRequest.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {job.provider.name} · {job.booking.match.jobRequest.customer.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={job.status} type="job" />
                      <Badge
                        variant={assignmentBadgeVariant(fieldExceptionAssignments.get(job.id), admin.id)}
                      >
                        {formatOpsQueueOwnerLabel(fieldExceptionAssignments.get(job.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={slaBadgeClass(getSlaTone(job.updatedAt, now, 60))}>
                      Last update {formatAge(job.updatedAt, now)}
                    </Badge>
                    <Badge variant="outline">{formatBookingWindow(job.booking)}</Badge>
                    {job.failureReason ? <Badge variant="outline">{job.failureReason}</Badge> : null}
                  </div>
                  <div className="mt-3">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/admin/field-exceptions">Open field exceptions queue</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Finance follow-up</CardTitle>
              <p className="text-sm text-muted-foreground">
                Payments that can block closeout, payout, or dispute resolution.
              </p>
            </div>
            <Badge variant={slaBadgeClass(paymentExceptionCount > 0 ? 'danger' : 'default')}>
              {paymentExceptionCount} blocked
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {financeFollowUp.length === 0 ? (
              <EmptyState message="No payments are awaiting manual finance follow-up." />
            ) : (
              financeFollowUp.map((payment) => (
                <div key={payment.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{payment.booking.match.jobRequest.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {payment.booking.match.jobRequest.customer.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PaymentBadge status={payment.status} />
                      <Badge
                        variant={assignmentBadgeVariant(paymentAssignments.get(payment.id), admin.id)}
                      >
                        {formatOpsQueueOwnerLabel(paymentAssignments.get(payment.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={slaBadgeClass(getSlaTone(payment.updatedAt, now, 1440))}>
                      Age {formatAge(payment.updatedAt, now)}
                    </Badge>
                    <Badge variant="outline">{formatCurrency(Number(payment.amount))}</Badge>
                    <Badge variant="outline">
                      {payment.pspProvider ? payment.pspProvider.toUpperCase() : 'Offline recorded'}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Trust recovery</CardTitle>
              <p className="text-sm text-muted-foreground">
                Open disputes and customer-provider issues that need acknowledgement and ownership.
              </p>
            </div>
            <Badge variant={slaBadgeClass(disputeCount > 0 ? 'danger' : 'default')}>
              {disputeCount} open
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {openDisputes.length === 0 ? (
              <EmptyState message="No open disputes are on the board." />
            ) : (
              openDisputes.map((dispute) => (
                <div key={dispute.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{dispute.reason}</p>
                      <p className="text-sm text-muted-foreground">
                        Job {dispute.jobId.slice(0, 8)} · Raised by {dispute.raisedByRole}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <DisputeBadge status={dispute.status} />
                      <Badge
                        variant={assignmentBadgeVariant(disputeAssignments.get(dispute.id), admin.id)}
                      >
                        {formatOpsQueueOwnerLabel(disputeAssignments.get(dispute.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={slaBadgeClass(getSlaTone(dispute.createdAt, now, 120))}>
                      Age {formatAge(dispute.createdAt, now)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {trustSupplyGroupError && (
        <SectionErrorBanner message="Trust, supply, and funnel data could not be loaded. Retry to reload." />
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Provider onboarding</CardTitle>
              <p className="text-sm text-muted-foreground">
                Pending applications that determine near-term supply and coverage.
              </p>
            </div>
            <Badge variant={slaBadgeClass(providerReviewCount > 0 ? 'warning' : 'default')}>
              {providerReviewCount} pending
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {providerOnboarding.length === 0 ? (
              <EmptyState message="No provider applications are waiting for review." />
            ) : (
              providerOnboarding.map((application) => (
                <div key={application.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{application.name}</p>
                      <p className="text-sm text-muted-foreground">{application.phone}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ApplicationBadge status={application.status} />
                      <Badge
                        variant={assignmentBadgeVariant(
                          providerAssignments.get(application.id),
                          admin.id,
                        )}
                      >
                        {formatOpsQueueOwnerLabel(providerAssignments.get(application.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {application.skills.slice(0, 3).map((skill) => (
                      <Badge key={skill} variant="outline">
                        {skill}
                      </Badge>
                    ))}
                    {application.serviceAreas.slice(0, 2).map((area) => (
                      <Badge key={area} variant={laneBadgeClass('Supply')}>
                        {area}
                      </Badge>
                    ))}
                    <Badge variant={slaBadgeClass(getSlaTone(application.submittedAt, now, 1440))}>
                      Age {formatAge(application.submittedAt, now)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">7-day funnel snapshot</CardTitle>
            <p className="text-sm text-muted-foreground">
              Weekly operational conversion from demand capture to paid completion.
              Counts requests, matches, quotes, bookings, completions, and payments created in the last 7 days.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {revenueGroupError || trustSupplyGroupError ? (
              <div className="sm:col-span-2 xl:col-span-3">
                <SectionErrorBanner message="Funnel data could not be loaded. Retry to reload." />
              </div>
            ) : (
              <>
                <FunnelMetric label="Requests" value={weekRequests} note="Demand entering ops" />
                <FunnelMetric label="Matches" value={weekMatches} note={ratioLabel(weekMatches, weekRequests)} />
                <FunnelMetric label="Quotes" value={weekQuotes} note={ratioLabel(weekQuotes, weekMatches)} />
                <FunnelMetric label="Bookings" value={weekBookings} note={ratioLabel(weekBookings, weekQuotes)} />
                <FunnelMetric
                  label="Completed jobs"
                  value={weekCompleted}
                  note={ratioLabel(weekCompleted, weekBookings)}
                />
                <FunnelMetric label="Paid" value={weekPaid} note={ratioLabel(weekPaid, weekCompleted)} />
                <div className="tone-info rounded-xl border p-4 sm:col-span-2 xl:col-span-3">
                  <p className="text-sm font-medium">7-day revenue collected</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                    {formatCurrency(Number(weekRevenue._sum.amount ?? 0))}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function QueueCard({
  lane,
  title,
  count,
  target,
  href,
  note,
  detail,
  tone,
}: {
  lane: string
  title: string
  count: number
  target: string
  href: string
  note: string
  detail: string
  tone: 'default' | 'warning' | 'danger'
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <Badge variant={laneBadgeClass(lane)}>{lane}</Badge>
          <Badge variant={slaBadgeClass(tone)}>{count} open</Badge>
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{note}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-3xl font-semibold tracking-tight">{count}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{target}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>Open</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function HeroStat({
  label,
  description,
  value,
  tone,
}: {
  label: string
  description: string
  value: number
  tone: string
}) {
  return (
    <div className={cn('rounded-2xl border p-4', tone)} title={description}>
      <p className="text-xs uppercase tracking-[0.16em] text-current/80">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-xs text-current/60 leading-snug">{description}</p>
    </div>
  )
}

function FunnelMetric({
  label,
  value,
  note,
}: {
  label: string
  value: number
  note: string
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function SectionErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  )
}

function PaymentBadge({
  status,
}: {
  status: PaymentStatus
}) {
  const variant =
    status === 'FAILED'
      ? 'danger'
      : status === 'PENDING'
        ? 'warning'
        : 'neutral'

  return <Badge variant={variant}>{status.replaceAll('_', ' ')}</Badge>
}

function DisputeBadge({ status }: { status: DisputeStatus }) {
  const variant = status === 'OPEN' ? 'danger' : 'warning'

  return <Badge variant={variant}>{status.replaceAll('_', ' ')}</Badge>
}

function ApplicationBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant="warning">{status}</Badge>
}

function formatAge(from: Date, to: Date) {
  const diffMs = Math.max(0, to.getTime() - from.getTime())
  const minutes = Math.floor(diffMs / 60000)

  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatTarget(date?: Date | null) {
  if (!date) return 'No arrival target'
  return `Target ${date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`
}

function formatBookingWindow(booking: {
  scheduledDate: Date
  scheduledWindow: string | null
}) {
  if (booking.scheduledWindow) return booking.scheduledWindow
  return booking.scheduledDate.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}

function formatCurrency(amount: number) {
  return `R ${amount.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}

function getSlaTone(createdAt: Date, now: Date, targetMinutes: number) {
  const ageMinutes = (now.getTime() - createdAt.getTime()) / 60000
  if (ageMinutes > targetMinutes) return 'danger'
  if (ageMinutes > targetMinutes * 0.6) return 'warning'
  return 'default'
}

function ratioLabel(current: number, previous: number) {
  if (previous === 0) return 'No upstream volume'
  return `${Math.round((current / previous) * 100)}% of previous stage`
}

function laneBadgeClass(lane: string): 'neutral' | 'info' | 'success' | 'danger' | 'warning' | 'brand' {
  if (lane === 'Ops') return 'neutral'
  if (lane === 'Dispatch') return 'info'
  if (lane === 'Field') return 'danger'
  if (lane === 'Finance') return 'success'
  if (lane === 'Trust') return 'danger'
  if (lane === 'Quotes') return 'warning'
  return 'brand'
}

function slaBadgeClass(tone: 'default' | 'warning' | 'danger'): 'neutral' | 'warning' | 'danger' {
  if (tone === 'danger') return 'danger'
  if (tone === 'warning') return 'warning'
  return 'neutral'
}

function heroToneClass(tone: 'default' | 'warning' | 'danger' | 'info') {
  if (tone === 'danger') return 'tone-danger'
  if (tone === 'warning') return 'tone-warning'
  if (tone === 'info') return 'tone-info'
  return 'tone-neutral'
}

function summarizeQueueHealth<T extends { id: string }>(
  items: T[],
  assignments: Map<string, { claimedById: string | null }>,
  now: Date,
  targetMinutes: number,
  getTimestamp: (item: T) => Date,
) {
  let claimedCount = 0
  let unclaimedCount = 0
  let overdueCount = 0
  let overdueClaimedCount = 0
  let overdueUnclaimedCount = 0

  for (const item of items) {
    const assignment = assignments.get(item.id)
    const claimed = Boolean(assignment?.claimedById)
    const overdue = getSlaTone(getTimestamp(item), now, targetMinutes) === 'danger'

    if (claimed) {
      claimedCount += 1
    } else {
      unclaimedCount += 1
    }

    if (overdue) {
      overdueCount += 1
      if (claimed) {
        overdueClaimedCount += 1
      } else {
        overdueUnclaimedCount += 1
      }
    }
  }

  return {
    claimedCount,
    unclaimedCount,
    overdueCount,
    overdueClaimedCount,
    overdueUnclaimedCount,
  }
}

function queueHealthCardTone(stats: {
  overdueUnclaimedCount: number
  overdueClaimedCount: number
  unclaimedCount: number
}) {
  if (stats.overdueUnclaimedCount > 0) return 'danger' as const
  if (stats.overdueClaimedCount > 0 || stats.unclaimedCount > 0) return 'warning' as const
  return 'default' as const
}

function queueHealthBadgeTone(stats: {
  overdueUnclaimedCount: number
  overdueClaimedCount: number
  unclaimedCount: number
}) {
  return queueHealthCardTone(stats)
}

function queueHealthHeroTone(stats: {
  overdueUnclaimedCount: number
  overdueClaimedCount: number
  unclaimedCount: number
}) {
  if (stats.overdueUnclaimedCount > 0) return 'danger' as const
  if (stats.overdueClaimedCount > 0 || stats.unclaimedCount > 0) return 'warning' as const
  return 'default' as const
}

function queueHealthDetail(stats: {
  claimedCount: number
  unclaimedCount: number
  overdueClaimedCount: number
  overdueUnclaimedCount: number
}) {
  const parts: string[] = []

  if (stats.overdueUnclaimedCount > 0) {
    parts.push(`${stats.overdueUnclaimedCount} overdue unclaimed`)
  }
  if (stats.overdueClaimedCount > 0) {
    parts.push(`${stats.overdueClaimedCount} overdue claimed`)
  }
  if (stats.unclaimedCount > 0) {
    parts.push(`${stats.unclaimedCount} unclaimed`)
  } else if (stats.claimedCount > 0) {
    parts.push(`${stats.claimedCount} claimed`)
  } else {
    parts.push('No open work')
  }

  return parts.join(' · ')
}

function assignmentBadgeVariant(
  assignment:
    | {
        claimedById: string | null
      }
    | undefined,
  currentActorId?: string | null,
) {
  if (!assignment?.claimedById) return 'outline' as const
  if (currentActorId && assignment.claimedById === currentActorId) return 'brand' as const
  return 'warning' as const
}
