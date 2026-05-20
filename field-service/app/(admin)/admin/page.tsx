export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { ApplicationStatus, DisputeStatus, PaymentStatus } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { cn } from '@/lib/utils'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import { getOpsDashboardSnapshot, getMatchingHealthMetrics } from '@/lib/ops-dashboard/service'
import { getQueueSlaConfig } from '@/lib/ops-dashboard/sla'
import type { AssignmentRecord, OpsDashboardQueueCard, OpsDashboardRangePreset } from '@/lib/ops-dashboard/types'
import { IncidentBar } from '@/components/admin/dashboard/IncidentBar'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { TrendChart } from '@/components/admin/dashboard/TrendChart'
import { BreachBanner } from '@/components/admin/case/BreachBanner'
import { getBreachedCases } from '@/lib/cases'
import { isEnabled } from '@/lib/flags'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Operations Dashboard', noIndex: true })

const RANGE_PRESETS: { label: string; value: OpsDashboardRangePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: '7 days', value: '7d' },
  { label: '14 days', value: '14d' },
  { label: '30 days', value: '30d' },
]

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requireAdmin()
  const resolvedParams = await searchParams
  const [snapshot, matchingHealth] = await Promise.all([
    getOpsDashboardSnapshot({ client: db, actorId: admin.id, searchParams: resolvedParams }),
    getMatchingHealthMetrics(24).catch(() => null),
  ])
  const refreshSearch = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedParams)) {
    if (typeof value === 'string') {
      refreshSearch.set(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        refreshSearch.append(key, entry)
      }
    }
  }
  const refreshHref = refreshSearch.toString() ? `/admin?${refreshSearch.toString()}` : '/admin'

  const now = new Date()
  const showBreachBanner = await isEnabled('ops.v2.breachBanner')
  const breachedCases = showBreachBanner ? await getBreachedCases().catch(() => null) : null
  const breachCount = breachedCases?.total ?? 0

  const heroMetrics = snapshot.hero.data?.metrics ?? []
  const queueData = snapshot.queues.data
  const funnelMetrics = snapshot.trends.data?.funnel ?? []
  const queueIncidents = snapshot.incidents.filter((incident) => incident.queueKey)
  const hasPartialFailure = !snapshot.hero.ok || !snapshot.queues.ok || !snapshot.trends.ok || !snapshot.exceptions.ok

  const heroStats = heroMetrics.map((m) => ({
    label: m.label,
    // When breach banner is enabled, show live breach count for "Operational exceptions"
    value: (showBreachBanner && m.key === 'operationalExceptions') ? breachCount : m.value,
    tone: heroToneClass(
      showBreachBanner && m.key === 'operationalExceptions'
        ? (breachCount > 0 ? 'danger' : 'default')
        : m.tone
    ),
  }))

  const queueCards = (queueData?.cards ?? []).map((card) => {
    const sla = getQueueSlaConfig(card.key)
    const healthTone = card.health.tone
    const tone: 'default' | 'warning' | 'danger' =
      healthTone === 'danger' ? 'danger' : healthTone === 'warning' ? 'warning' : 'default'
    return {
      lane: card.lane,
      title: card.title,
      count: card.health.openCount,
      target: sla.targetLabel,
      href: card.href,
      note: card.description,
      detail: queueHealthDetail(card),
      health: card.health,
      tone,
    }
  })

  const validationQueue = queueData?.previews.validation ?? []
  const validationCount = queueData?.cards.find((c) => c.key === 'validation')?.health.openCount ?? 0
  const validationAssignments = queueData?.assignments.validation ?? new Map<string, AssignmentRecord>()

  const dispatchQueue = queueData?.previews.dispatch ?? []
  const dispatchCount = queueData?.cards.find((c) => c.key === 'dispatch')?.health.openCount ?? 0
  const dispatchAssignments = queueData?.assignments.dispatch ?? new Map<string, AssignmentRecord>()

  const pendingQuotes = queueData?.previews.quoteApprovals ?? []
  const quoteCount = queueData?.cards.find((c) => c.key === 'quoteApprovals')?.health.openCount ?? 0
  const quoteAssignments = queueData?.assignments.quoteApprovals ?? new Map<string, AssignmentRecord>()

  const financeFollowUp = queueData?.previews.financeFollowUp ?? []
  const paymentExceptionCount = queueData?.cards.find((c) => c.key === 'financeFollowUp')?.health.openCount ?? 0
  const paymentAssignments = queueData?.assignments.financeFollowUp ?? new Map<string, AssignmentRecord>()

  const openDisputes = queueData?.previews.trustRecovery ?? []
  const disputeCount = queueData?.cards.find((c) => c.key === 'trustRecovery')?.health.openCount ?? 0
  const disputeAssignments = queueData?.assignments.trustRecovery ?? new Map<string, AssignmentRecord>()

  const providerOnboarding = queueData?.previews.providerOnboarding ?? []
  const providerReviewCount = queueData?.cards.find((c) => c.key === 'providerOnboarding')?.health.openCount ?? 0
  const providerAssignments = queueData?.assignments.providerOnboarding ?? new Map<string, AssignmentRecord>()

  const revenueFunnel = funnelMetrics.find((m) => m.key === 'revenue')
  const coreFunnel = funnelMetrics.filter((m) => m.key !== 'revenue')

  const trendSeries = snapshot.trends.data?.series ?? []
  const activePreset = snapshot.range.preset

  return (
    <div className="space-y-8">
      {hasPartialFailure ? <StaleBanner refreshHref={refreshHref} /> : null}
      {showBreachBanner && breachCount > 0 ? <BreachBanner count={breachCount} /> : null}
      <IncidentBar incidents={queueIncidents} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)]">
        <Card className="app-hero-surface border-border/70">
          <CardHeader className="gap-4">
            <div className="space-y-2">
              <Badge variant="brand">
                Control Tower
              </Badge>
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
              <HeroStat key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {queueCards.map((card) => (
          <QueueCard key={card.title} {...card} />
        ))}
      </section>

      {matchingHealth && (
        <section>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">Matching health — last 24 h</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Dispatch decisions, hold outcomes, and queue depth from the orchestrator.
                </p>
              </div>
              <Link href="/admin/dispatch" className="text-sm text-muted-foreground hover:underline">
                Dispatch console →
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                <MatchingStatCell
                  label="Dispatched"
                  value={matchingHealth.dispatched}
                  tone="default"
                />
                <MatchingStatCell
                  label="No-match rate"
                  value={`${(matchingHealth.noMatchRate * 100).toFixed(0)}%`}
                  tone={matchingHealth.noMatchRate > 0.3 ? 'warning' : 'default'}
                  sub={`${matchingHealth.noMatch} unmatched`}
                />
                <MatchingStatCell
                  label="Expired holds"
                  value={matchingHealth.holdsExpired}
                  tone={matchingHealth.holdsExpired > 10 ? 'warning' : 'default'}
                />
                <MatchingStatCell
                  label="Rematches"
                  value={matchingHealth.rematches}
                  tone="default"
                />
                <MatchingStatCell
                  label="Open / active holds"
                  value={`${matchingHealth.currentOpenJobs} / ${matchingHealth.currentActiveHolds}`}
                  tone={matchingHealth.currentOpenJobs > 5 ? 'warning' : 'default'}
                  sub="jobs / holds now"
                />
              </div>
            </CardContent>
          </Card>
        </section>
      )}

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
              <EmptyState
                title="Validation queue is clear"
                message="No requests are waiting on validation right now."
                actionHref="/admin/validation"
                actionLabel="Open validation queue"
              />
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
                      <Badge variant={assignmentBadgeVariant(validationAssignments.get(request.id), admin.id)}>
                        {ownerLabel(validationAssignments.get(request.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant={slaBadgeClass(getQueueAgeTone('validation', Math.floor((now.getTime() - request.createdAt.getTime()) / 60000)))}>
                      Age {formatAge(request.createdAt, now)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Phone {request.customer.phone}</span>
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
            <Badge variant={slaBadgeClass(dispatchCount > 0 ? 'warning' : 'default')}>
              {dispatchCount} queued
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {dispatchQueue.length === 0 ? (
              <EmptyState
                title="Dispatch queue is clear"
                message="No open or matching requests need dispatch attention right now."
                actionHref="/admin/dispatch"
                actionLabel="Open dispatch console"
              />
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
                      <Badge variant={assignmentBadgeVariant(dispatchAssignments.get(request.id), admin.id)}>
                        {ownerLabel(dispatchAssignments.get(request.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={laneBadgeClass('Dispatch')}>
                      {request.leadCount ?? 0} leads sent
                    </Badge>
                    <Badge variant="outline">
                      {request.expiresAt
                        ? `Expires ${formatShortDate(request.expiresAt)}`
                        : `Opened ${formatAge(request.createdAt, now)} ago`}
                    </Badge>
                    {request.matchProviderName ? (
                      <Badge variant="outline">Matched to {request.matchProviderName}</Badge>
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
              <EmptyState
                title="Quote queue is clear"
                message="No quotes are waiting on approval right now."
                actionHref="/admin/quotes"
                actionLabel="Open quote queue"
              />
            ) : (
              pendingQuotes.map((quote) => (
                <div key={quote.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{quote.jobRequestTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {quote.customerName} · {quote.providerName}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={quote.status} type="quote" />
                      <Badge variant={assignmentBadgeVariant(quoteAssignments.get(quote.id), admin.id)}>
                        {ownerLabel(quoteAssignments.get(quote.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">Age {formatAge(quote.createdAt, now)}</Badge>
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
              <EmptyState
                title="Finance follow-up is clear"
                message="No payments are awaiting manual finance follow-up."
                actionHref="/admin/payments"
                actionLabel="Open payments queue"
              />
            ) : (
              financeFollowUp.map((payment) => (
                <div key={payment.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{payment.jobRequestTitle}</p>
                      <p className="text-sm text-muted-foreground">{payment.customerName}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PaymentBadge status={payment.status} />
                      <Badge variant={assignmentBadgeVariant(paymentAssignments.get(payment.id), admin.id)}>
                        {ownerLabel(paymentAssignments.get(payment.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">Age {formatAge(payment.updatedAt, now)}</Badge>
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
              <EmptyState
                title="Trust recovery is clear"
                message="No open disputes are on the board."
                actionHref="/admin/disputes"
                actionLabel="Open disputes queue"
              />
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
                      <Badge variant={assignmentBadgeVariant(disputeAssignments.get(dispute.id), admin.id)}>
                        {ownerLabel(disputeAssignments.get(dispute.id), admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">Age {formatAge(dispute.createdAt, now)}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

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
              <EmptyState
                title="Provider onboarding is clear"
                message="No provider applications are waiting for review."
                actionHref="/admin/applications"
                actionLabel="Open provider queue"
              />
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
                        {ownerLabel(providerAssignments.get(application.id), admin.id)}
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
                    <Badge variant="outline">Age {formatAge(application.submittedAt, now)}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Operational trends — {snapshot.range.label}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Daily demand, bookings, and completions over the selected window.
                </p>
              </div>
              <RangePresets active={activePreset} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {snapshot.trends.ok ? (
              <>
                <TrendChart series={trendSeries} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {coreFunnel.map((m) => (
                    <FunnelMetric key={m.key} label={m.label} value={m.value} note={m.note} />
                  ))}
                  {revenueFunnel && (
                    <div className="tone-info rounded-xl border p-4 sm:col-span-2 xl:col-span-3">
                      <p className="text-sm font-medium">Revenue collected</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                        {formatCurrency(revenueFunnel.value)}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Trend data unavailable — {snapshot.trends.error?.message ?? 'unknown error'}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function RangePresets({ active }: { active: OpsDashboardRangePreset }) {
  return (
    <div className="flex flex-wrap gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Link
          key={preset.value}
          href={`?range=${preset.value}`}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            active === preset.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/70',
          )}
        >
          {preset.label}
        </Link>
      ))}
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
  health,
  tone,
}: {
  lane: string
  title: string
  count: number
  target: string
  href: string
  note: string
  detail: string
  health: OpsDashboardQueueCard['health']
  tone: 'default' | 'warning' | 'danger'
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <Badge variant={laneBadgeClass(lane)}>{lane}</Badge>
          <Badge variant={slaBadgeClass(tone)} className={tone === 'danger' ? 'animate-pulse' : undefined}>
            {detail}
          </Badge>
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{note}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[10px] font-medium uppercase leading-[13px] tracking-[0.16em] text-muted-foreground">
              {target}
            </p>
            <p className="text-3xl font-semibold tracking-tight">{count}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {health.overdueCount} overdue · {health.unclaimedCount} unclaimed · {health.claimedByYouCount} mine
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Open queue</Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            Oldest {formatAgeMinutes(health.oldestAgeMinutes)}
          </Badge>
          <Badge variant={slaBadgeClass(tone)}>{count} open</Badge>
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          Queue health: {detail}
        </div>
      </CardContent>
    </Card>
  )
}

function HeroStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: string
}) {
  return (
    <div className={cn('rounded-2xl border p-4', tone)}>
      <p className="text-xs uppercase tracking-[0.16em] text-current/80">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
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

function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title: string
  message: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <div className="rounded-xl border border-dashed p-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      </div>
    </div>
  )
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
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

function formatCurrency(amount: number) {
  return `R ${amount.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function formatAgeMinutes(minutes: number | null) {
  if (minutes == null) return 'n/a'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
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

function heroToneClass(tone: string) {
  if (tone === 'danger') return 'tone-danger'
  if (tone === 'warning') return 'tone-warning'
  if (tone === 'info') return 'tone-info'
  if (tone === 'success') return 'tone-success'
  return 'tone-neutral'
}

function queueHealthDetail(card: OpsDashboardQueueCard): string {
  const h = card.health
  const parts: string[] = []
  if (h.overdueCount > 0) parts.push(`${h.overdueCount} overdue`)
  if (h.unclaimedCount > 0) parts.push(`${h.unclaimedCount} unclaimed`)
  if (h.claimedByYouCount > 0) parts.push(`${h.claimedByYouCount} yours`)
  if (parts.length === 0) parts.push('No open work')
  if (h.oldestAgeMinutes != null) {
    const age = h.oldestAgeMinutes < 60
      ? `${h.oldestAgeMinutes}m`
      : h.oldestAgeMinutes < 1440
        ? `${Math.floor(h.oldestAgeMinutes / 60)}h`
        : `${Math.floor(h.oldestAgeMinutes / 1440)}d`
    parts.push(`oldest ${age}`)
  }
  return parts.join(' · ')
}

function ownerLabel(
  assignment: AssignmentRecord | undefined,
  currentActorId?: string | null,
): string {
  if (!assignment?.claimedById) return 'Unclaimed'
  if (currentActorId && assignment.claimedById === currentActorId) return 'Claimed by you'
  return assignment.claimedByLabel ?? assignment.claimedById.slice(0, 8)
}

function assignmentBadgeVariant(
  assignment: AssignmentRecord | undefined,
  currentActorId?: string | null,
): 'outline' | 'brand' | 'warning' {
  if (!assignment?.claimedById) return 'outline'
  if (currentActorId && assignment.claimedById === currentActorId) return 'brand'
  return 'warning'
}

function MatchingStatCell({
  label,
  value,
  tone = 'default',
  sub,
}: {
  label: string
  value: string | number
  tone?: 'default' | 'warning' | 'danger'
  sub?: string
}) {
  const toneClass =
    tone === 'danger' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' :
    'text-foreground'
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
