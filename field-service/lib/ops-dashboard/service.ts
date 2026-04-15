import { db } from '@/lib/db'
import { listOpsQueueAssignments, OPS_QUEUE_TYPES } from '@/lib/ops-queue'
import { detectQueueBreaches } from './alerts'
import { OPS_DASHBOARD_QUEUE_SLA, computeOldestAgeMinutes } from './sla'
import type {
  AssignmentRecord,
  JobExceptionPreview,
  JobRequestPreview,
  OpsDashboardExceptionSection,
  OpsDashboardHeroSection,
  OpsDashboardIncident,
  OpsDashboardQueueCard,
  OpsDashboardQueueHealth,
  OpsDashboardQueueKey,
  OpsDashboardQueueSection,
  OpsDashboardRange,
  OpsDashboardRangePreset,
  OpsDashboardSnapshot,
  OpsDashboardTrendSection,
  PaymentPreview,
  DisputePreview,
  ProviderApplicationPreview,
  QuotePreview,
  SectionResult,
} from './types'
import type { DisputeStatus, JobStatus, PaymentStatus, ApplicationStatus } from '@prisma/client'

type DashboardSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>

type DashboardClient = typeof db

// ─── Status constants (mirrors page.tsx constants) ───────────────────────────

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

// ─── Range parser ─────────────────────────────────────────────────────────────

const PRESET_DAYS: Record<Exclude<OpsDashboardRangePreset, 'today' | 'custom'>, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
}

function normalizeSearchParam(
  searchParams: DashboardSearchParams | undefined,
  key: string,
): string | undefined {
  if (!searchParams) return undefined
  if (searchParams instanceof URLSearchParams) return searchParams.get(key) ?? undefined
  const value = searchParams[key]
  if (Array.isArray(value)) return value[0]
  return value
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

export function parseOpsDashboardRange(searchParams?: DashboardSearchParams): OpsDashboardRange {
  const presetParam = normalizeSearchParam(searchParams, 'range')
  const fromParam = normalizeSearchParam(searchParams, 'from')
  const toParam = normalizeSearchParam(searchParams, 'to')
  const now = new Date()

  const preset: OpsDashboardRangePreset =
    presetParam === 'today' ||
    presetParam === '7d' ||
    presetParam === '14d' ||
    presetParam === '30d' ||
    presetParam === 'custom'
      ? presetParam
      : '7d'

  if (preset === 'today') {
    return { preset, from: startOfDay(now), to: endOfDay(now), label: 'Today', isCustom: false }
  }

  if (preset === 'custom' && fromParam && toParam) {
    const from = new Date(fromParam)
    const to = new Date(toParam)
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return {
        preset,
        from: startOfDay(from),
        to: endOfDay(to),
        label: `${from.toLocaleDateString('en-ZA')} – ${to.toLocaleDateString('en-ZA')}`,
        isCustom: true,
      }
    }
  }

  const days = PRESET_DAYS[preset === 'custom' ? '7d' : preset]
  const from = new Date(now)
  from.setDate(from.getDate() - (days - 1))

  return {
    preset: preset === 'custom' ? '7d' : preset,
    from: startOfDay(from),
    to: endOfDay(now),
    label: `Last ${days} days`,
    isCustom: false,
  }
}

// ─── SLA health helpers ───────────────────────────────────────────────────────

function buildQueueHealth(
  items: { id: string; _ts: Date }[],
  assignments: Map<string, AssignmentRecord>,
  actorId: string,
  targetMinutes: number,
  queueKey: OpsDashboardQueueKey,
  now: Date,
): OpsDashboardQueueHealth {
  let unclaimedCount = 0
  let claimedByYouCount = 0
  let overdueCount = 0
  const ages: number[] = []

  for (const item of items) {
    const assignment = assignments.get(item.id)
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - item._ts.getTime()) / 60000))
    ages.push(ageMinutes)

    if (!assignment?.claimedById) {
      unclaimedCount += 1
    } else if (assignment.claimedById === actorId) {
      claimedByYouCount += 1
    }

    if (ageMinutes >= targetMinutes) overdueCount += 1
  }

  const oldestAgeMinutes = computeOldestAgeMinutes(items.map((i) => i._ts), now)
  const tone =
    overdueCount > 0 && unclaimedCount > 0
      ? ('danger' as const)
      : overdueCount > 0 || unclaimedCount > 0
      ? ('warning' as const)
      : ('default' as const)

  return {
    queueKey,
    queueType: OPS_DASHBOARD_QUEUE_SLA[queueKey].queueType,
    openCount: items.length,
    overdueCount,
    unclaimedCount,
    claimedByYouCount,
    oldestAgeMinutes,
    slaTargetMinutes: targetMinutes,
    tone,
  }
}

// ─── Section loaders ──────────────────────────────────────────────────────────

async function loadHeroSection(
  client: DashboardClient,
): Promise<SectionResult<OpsDashboardHeroSection>> {
  try {
    const now = new Date()

    const [
      validationCount,
      dispatchCount,
      activeFieldCount,
      fieldExceptionCount,
      paymentExceptionCount,
      disputeCount,
    ] = await Promise.all([
      client.jobRequest.count({ where: { status: 'PENDING_VALIDATION' } }),
      client.jobRequest.count({ where: { status: { in: ['OPEN', 'MATCHING'] } } }),
      client.job.count({ where: { status: { in: ACTIVE_FIELD_STATUSES } } }),
      client.job.count({ where: { status: { in: FIELD_EXCEPTION_STATUSES } } }),
      client.payment.count({ where: { status: { in: PAYMENT_EXCEPTION_STATUSES } } }),
      client.dispute.count({ where: { status: { in: OPEN_DISPUTE_STATUSES } } }),
    ])

    const exceptionCount = fieldExceptionCount + paymentExceptionCount + disputeCount

    const validationTone =
      validationCount === 0 ? 'default' : validationCount > 5 ? 'danger' : 'warning'
    const dispatchTone =
      dispatchCount === 0 ? 'default' : dispatchCount > 10 ? 'danger' : 'warning'
    const exceptionTone = exceptionCount > 0 ? 'danger' : 'default'

    return {
      ok: true,
      data: {
        freshness: {
          generatedAt: now,
          refreshedLabel: now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        },
        metrics: [
          {
            key: 'requestsNeedingValidation',
            label: 'Requests needing validation',
            value: validationCount,
            description: 'Job requests with status PENDING_VALIDATION that ops must review before matching can start.',
            drilldownHref: '/admin/validation',
            tone: validationTone,
          },
          {
            key: 'dispatchQueue',
            label: 'Dispatch queue',
            value: dispatchCount,
            description: 'Open and MATCHING requests waiting for a provider to be assigned.',
            drilldownHref: '/admin/dispatch',
            tone: dispatchTone,
          },
          {
            key: 'jobsInField',
            label: 'Jobs in field',
            value: activeFieldCount,
            description: 'Jobs currently active: EN_ROUTE, ARRIVED, STARTED, PAUSED, AWAITING_APPROVAL, PENDING_COMPLETION_CONFIRMATION.',
            drilldownHref: '/admin/bookings',
            tone: activeFieldCount > 0 ? 'info' : 'default',
          },
          {
            key: 'operationalExceptions',
            label: 'Operational exceptions',
            value: exceptionCount,
            description: 'Total of field exceptions, payment exceptions, and open disputes requiring ops action.',
            drilldownHref: '/admin/field-exceptions',
            tone: exceptionTone,
          },
        ],
      },
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'QUERY_FAILED',
        message: `Hero section failed: ${String(err)}`,
        recoverable: true,
      },
    }
  }
}

const jobRequestSummarySelect = {
  id: true,
  title: true,
  category: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  customer: { select: { name: true, phone: true } },
  address: { select: { suburb: true, city: true } },
} as const

async function loadQueueSection(
  client: DashboardClient,
  actorId: string,
): Promise<SectionResult<OpsDashboardQueueSection>> {
  try {
    const now = new Date()

    // ── Fetch preview items for all 7 queues ────────────────────────────────
    const [
      validationItems,
      validationCount,
      dispatchItems,
      dispatchCount,
      quoteItems,
      quoteCount,
    ] = await Promise.all([
      client.jobRequest.findMany({
        where: { status: 'PENDING_VALIDATION' },
        select: jobRequestSummarySelect,
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),
      client.jobRequest.count({ where: { status: 'PENDING_VALIDATION' } }),
      client.jobRequest.findMany({
        where: { status: { in: ['OPEN', 'MATCHING'] } },
        select: {
          ...jobRequestSummarySelect,
          match: { select: { provider: { select: { name: true } } } },
          _count: { select: { leads: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),
      client.jobRequest.count({ where: { status: { in: ['OPEN', 'MATCHING'] } } }),
      client.quote.findMany({
        where: { status: { in: ['PENDING', 'REVISED'] } },
        select: {
          id: true,
          amount: true,
          validUntil: true,
          status: true,
          createdAt: true,
          match: {
            select: {
              provider: { select: { name: true } },
              jobRequest: { select: jobRequestSummarySelect },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),
      client.quote.count({ where: { status: { in: ['PENDING', 'REVISED'] } } }),
    ])

    const [
      fieldExceptionItems,
      fieldExceptionCount,
      financeItems,
      financeCount,
      disputeItems,
      disputeCount,
      providerItems,
      providerCount,
    ] = await Promise.all([
      client.job.findMany({
        where: { status: { in: FIELD_EXCEPTION_STATUSES } },
        select: {
          id: true,
          status: true,
          failureReason: true,
          updatedAt: true,
          provider: { select: { name: true } },
          booking: {
            select: {
              scheduledDate: true,
              scheduledWindow: true,
              match: { select: { jobRequest: { select: jobRequestSummarySelect } } },
            },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 6,
      }),
      client.job.count({ where: { status: { in: FIELD_EXCEPTION_STATUSES } } }),
      client.payment.findMany({
        where: { status: { in: PAYMENT_EXCEPTION_STATUSES } },
        select: {
          id: true,
          status: true,
          amount: true,
          updatedAt: true,
          pspProvider: true,
          booking: {
            select: {
              scheduledDate: true,
              match: { select: { jobRequest: { select: jobRequestSummarySelect } } },
            },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 6,
      }),
      client.payment.count({ where: { status: { in: PAYMENT_EXCEPTION_STATUSES } } }),
      client.dispute.findMany({
        where: { status: { in: OPEN_DISPUTE_STATUSES } },
        select: { id: true, jobId: true, reason: true, status: true, createdAt: true, raisedByRole: true },
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),
      client.dispute.count({ where: { status: { in: OPEN_DISPUTE_STATUSES } } }),
      client.providerApplication.findMany({
        where: { status: 'PENDING' },
        select: { id: true, name: true, phone: true, skills: true, serviceAreas: true, status: true, submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 6,
      }),
      client.providerApplication.count({ where: { status: 'PENDING' } }),
    ])

    // ── Assignments ──────────────────────────────────────────────────────────
    const [
      validationAssignments,
      dispatchAssignments,
      quoteAssignments,
      fieldExceptionAssignments,
      financeAssignments,
      disputeAssignments,
      providerAssignments,
    ] = await Promise.all([
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.VALIDATION, validationItems.map((r) => r.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.DISPATCH, dispatchItems.map((r) => r.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.QUOTE_APPROVAL, quoteItems.map((q) => q.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.FIELD_EXCEPTION, fieldExceptionItems.map((j) => j.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP, financeItems.map((p) => p.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.DISPUTE, disputeItems.map((d) => d.id)),
      listOpsQueueAssignments(client, OPS_QUEUE_TYPES.PROVIDER_ONBOARDING, providerItems.map((a) => a.id)),
    ])

    // ── Health stats (computed from preview sample) ──────────────────────────
    const slaConfig = OPS_DASHBOARD_QUEUE_SLA
    const buildHealth = (
      items: { id: string; _ts: Date }[],
      assignments: Map<string, AssignmentRecord>,
      queueKey: OpsDashboardQueueKey,
    ) => buildQueueHealth(items, assignments, actorId, slaConfig[queueKey].targetMinutes, queueKey, now)

    const validationHealth = buildHealth(
      validationItems.map((r) => ({ id: r.id, _ts: r.createdAt })),
      validationAssignments,
      'validation',
    )
    const dispatchHealth = buildHealth(
      dispatchItems.map((r) => ({ id: r.id, _ts: r.createdAt })),
      dispatchAssignments,
      'dispatch',
    )
    const quoteHealth = buildHealth(
      quoteItems.map((q) => ({ id: q.id, _ts: q.createdAt })),
      quoteAssignments,
      'quoteApprovals',
    )
    const fieldExceptionHealth = buildHealth(
      fieldExceptionItems.map((j) => ({ id: j.id, _ts: j.updatedAt })),
      fieldExceptionAssignments,
      'fieldExceptions',
    )
    const financeHealth = buildHealth(
      financeItems.map((p) => ({ id: p.id, _ts: p.updatedAt })),
      financeAssignments,
      'financeFollowUp',
    )
    const disputeHealth = buildHealth(
      disputeItems.map((d) => ({ id: d.id, _ts: d.createdAt })),
      disputeAssignments,
      'trustRecovery',
    )
    const providerHealth = buildHealth(
      providerItems.map((a) => ({ id: a.id, _ts: a.submittedAt })),
      providerAssignments,
      'providerOnboarding',
    )

    // ── Build queue cards ────────────────────────────────────────────────────
    function makeCard(
      queueKey: OpsDashboardQueueKey,
      health: OpsDashboardQueueHealth,
      totalCount: number,
      overrides: Partial<OpsDashboardQueueCard> = {},
    ): OpsDashboardQueueCard {
      const cfg = slaConfig[queueKey]
      return {
        key: queueKey,
        queueType: cfg.queueType,
        title: cfg.title,
        lane: queueKeyToLane(queueKey),
        description: queueKeyToDescription(queueKey, totalCount),
        href: queueKeyToHref(queueKey),
        health: { ...health, openCount: totalCount },
        ...overrides,
      }
    }

    const cards: OpsDashboardQueueCard[] = [
      makeCard('validation', validationHealth, validationCount),
      makeCard('dispatch', dispatchHealth, dispatchCount),
      makeCard('fieldExceptions', fieldExceptionHealth, fieldExceptionCount),
      makeCard('financeFollowUp', financeHealth, financeCount),
      makeCard('trustRecovery', disputeHealth, disputeCount),
      makeCard('quoteApprovals', quoteHealth, quoteCount),
      makeCard('providerOnboarding', providerHealth, providerCount),
    ]

    // ── Denormalise preview items ────────────────────────────────────────────
    const validationPreviews: JobRequestPreview[] = validationItems.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      customer: r.customer,
      address: r.address ?? null,
    }))

    const dispatchPreviews: JobRequestPreview[] = dispatchItems.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      customer: r.customer,
      address: r.address ?? null,
      leadCount: r._count.leads,
      matchProviderName: r.match?.provider?.name ?? null,
    }))

    const quotePreviews: QuotePreview[] = quoteItems.map((q) => ({
      id: q.id,
      amount: Number(q.amount),
      validUntil: q.validUntil,
      status: q.status,
      createdAt: q.createdAt,
      jobRequestTitle: q.match.jobRequest.title,
      customerName: q.match.jobRequest.customer.name,
      providerName: q.match.provider.name,
    }))

    const fieldExceptionPreviews: JobExceptionPreview[] = fieldExceptionItems.map((j) => ({
      id: j.id,
      status: j.status as JobStatus,
      failureReason: j.failureReason,
      updatedAt: j.updatedAt,
      providerName: j.provider.name,
      jobRequestTitle: j.booking.match.jobRequest.title,
      customerName: j.booking.match.jobRequest.customer.name,
      scheduledDate: j.booking.scheduledDate,
      scheduledWindow: j.booking.scheduledWindow,
    }))

    const financePreviews: PaymentPreview[] = financeItems.map((p) => ({
      id: p.id,
      status: p.status as PaymentStatus,
      amount: Number(p.amount),
      updatedAt: p.updatedAt,
      pspProvider: p.pspProvider,
      jobRequestTitle: p.booking.match.jobRequest.title,
      customerName: p.booking.match.jobRequest.customer.name,
      scheduledDate: p.booking.scheduledDate,
    }))

    const disputePreviews: DisputePreview[] = disputeItems.map((d) => ({
      id: d.id,
      jobId: d.jobId,
      reason: d.reason,
      status: d.status as DisputeStatus,
      createdAt: d.createdAt,
      raisedByRole: d.raisedByRole,
    }))

    const providerPreviews: ProviderApplicationPreview[] = providerItems.map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      skills: a.skills,
      serviceAreas: a.serviceAreas,
      status: a.status as ApplicationStatus,
      submittedAt: a.submittedAt,
    }))

    return {
      ok: true,
      data: {
        cards,
        previews: {
          validation: validationPreviews,
          dispatch: dispatchPreviews,
          quoteApprovals: quotePreviews,
          fieldExceptions: fieldExceptionPreviews,
          financeFollowUp: financePreviews,
          trustRecovery: disputePreviews,
          providerOnboarding: providerPreviews,
        },
        assignments: {
          validation: validationAssignments,
          dispatch: dispatchAssignments,
          quoteApprovals: quoteAssignments,
          fieldExceptions: fieldExceptionAssignments,
          financeFollowUp: financeAssignments,
          trustRecovery: disputeAssignments,
          providerOnboarding: providerAssignments,
        },
      },
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'QUERY_FAILED',
        message: `Queue section failed: ${String(err)}`,
        recoverable: true,
      },
    }
  }
}

type DailyCountRow = { day: Date; count: bigint }

function toDayString(d: Date) {
  return d.toISOString().slice(0, 10)
}

function buildDailyPoints(
  rows: DailyCountRow[],
  from: Date,
  to: Date,
): import('./types').OpsDashboardTrendPoint[] {
  const byDay = new Map(rows.map((r) => [toDayString(r.day), Number(r.count)]))

  // Walk every calendar day in the range so missing days appear as 0
  const points: import('./types').OpsDashboardTrendPoint[] = []
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)

  while (cursor <= end) {
    const date = toDayString(cursor)
    points.push({ date, value: byDay.get(date) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  return points
}

async function loadTrendSection(
  client: DashboardClient,
  range: OpsDashboardRange,
): Promise<SectionResult<OpsDashboardTrendSection>> {
  try {
    const { from, to } = range

    const [requests, matches, quotes, bookings, completed, paid, revenue,
           reqByDay, bookingsByDay, completedByDay] = await Promise.all([
      client.jobRequest.count({ where: { createdAt: { gte: from, lte: to } } }),
      client.match.count({ where: { createdAt: { gte: from, lte: to } } }),
      client.quote.count({ where: { createdAt: { gte: from, lte: to } } }),
      client.booking.count({ where: { createdAt: { gte: from, lte: to } } }),
      client.job.count({ where: { status: 'COMPLETED', completedAt: { gte: from, lte: to } } }),
      client.payment.count({ where: { status: 'PAID', paidAt: { gte: from, lte: to } } }),
      client.payment.aggregate({
        where: { status: 'PAID', paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      // Daily series — only for ranges that benefit from a chart (>1 day)
      client.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM "job_requests"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY day ORDER BY day ASC
      `,
      client.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM "bookings"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY day ORDER BY day ASC
      `,
      client.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "completedAt") AS day, COUNT(*)::bigint AS count
        FROM "jobs"
        WHERE status = 'COMPLETED' AND "completedAt" >= ${from} AND "completedAt" <= ${to}
        GROUP BY day ORDER BY day ASC
      `,
    ])

    const ratio = (n: number, d: number) =>
      d === 0 ? 'No upstream volume' : `${Math.round((n / d) * 100)}% of previous stage`

    return {
      ok: true,
      data: {
        funnel: [
          { key: 'requests', label: 'Requests', value: requests, note: 'Demand entering ops' },
          { key: 'matches', label: 'Matches', value: matches, note: ratio(matches, requests) },
          { key: 'quotes', label: 'Quotes', value: quotes, note: ratio(quotes, matches) },
          { key: 'bookings', label: 'Bookings', value: bookings, note: ratio(bookings, quotes) },
          { key: 'completedJobs', label: 'Completed jobs', value: completed, note: ratio(completed, bookings) },
          { key: 'paid', label: 'Paid', value: paid, note: ratio(paid, completed) },
          {
            key: 'revenue',
            label: 'Revenue collected',
            value: Number(revenue._sum.amount ?? 0),
            note: `${range.label} total`,
          },
        ],
        series: [
          { key: 'requests', label: 'Requests', points: buildDailyPoints(reqByDay, from, to) },
          { key: 'bookings', label: 'Bookings', points: buildDailyPoints(bookingsByDay, from, to) },
          { key: 'completedJobs', label: 'Completed', points: buildDailyPoints(completedByDay, from, to) },
        ],
      },
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'QUERY_FAILED',
        message: `Trend section failed: ${String(err)}`,
        recoverable: true,
      },
    }
  }
}

async function loadExceptionSection(
  client: DashboardClient,
): Promise<SectionResult<OpsDashboardExceptionSection>> {
  try {
    const [fieldCount, paymentCount, disputeCount] = await Promise.all([
      client.job.count({ where: { status: { in: FIELD_EXCEPTION_STATUSES } } }),
      client.payment.count({ where: { status: { in: PAYMENT_EXCEPTION_STATUSES } } }),
      client.dispute.count({ where: { status: { in: OPEN_DISPUTE_STATUSES } } }),
    ])
    return { ok: true, data: { totalExceptions: fieldCount + paymentCount + disputeCount }, error: null }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: { code: 'QUERY_FAILED', message: `Exception section failed: ${String(err)}`, recoverable: true },
    }
  }
}

// ─── Incident layer ───────────────────────────────────────────────────────────

async function loadIncidentSection(client: DashboardClient): Promise<OpsDashboardIncident[]> {
  const breaches = await detectQueueBreaches(client).catch((error) => {
    console.error('[ops-dashboard] Failed to detect queue breaches', error)
    return []
  })

  return breaches.map((breach) => ({
    id: `incident:${breach.queueKey}:${breach.severity}`,
    section: 'queues',
    severity: breach.severity === 'breach' ? 'danger' : 'warning',
    queueKey: breach.queueKey,
    label: breach.label,
    overdueCount: breach.overdueCount,
    oldestAgeMinutes: breach.oldestAgeMinutes,
    message: `${breach.label}: ${breach.overdueCount} item${breach.overdueCount === 1 ? '' : 's'} overdue (oldest ${formatIncidentAge(breach.oldestAgeMinutes)})`,
  }))
}

function buildSectionFailureIncidents(snapshot: OpsDashboardSnapshot): OpsDashboardIncident[] {
  const sections: Array<[OpsDashboardIncident['section'], SectionResult<unknown>]> = [
    ['hero', snapshot.hero],
    ['queues', snapshot.queues],
    ['trends', snapshot.trends],
    ['exceptions', snapshot.exceptions],
  ]

  return sections.flatMap(([section, result]) => {
    if (result.ok || !result.error) return []
    return [
      {
        id: `incident:${section}:${result.error.code}`,
        section,
        severity: 'warning',
        message: `${section} section unavailable — ${result.error.message}`,
      },
    ]
  })
}

// ─── Main snapshot orchestrator ───────────────────────────────────────────────

export async function getOpsDashboardSnapshot(params?: {
  client?: DashboardClient
  actorId?: string
  searchParams?: DashboardSearchParams
}): Promise<OpsDashboardSnapshot> {
  const client = params?.client ?? db
  const actorId = params?.actorId ?? ''
  const range = parseOpsDashboardRange(params?.searchParams)

  const [hero, queues, trends, exceptions, incidents] = await Promise.all([
    loadHeroSection(client),
    loadQueueSection(client, actorId),
    loadTrendSection(client, range),
    loadExceptionSection(client),
    loadIncidentSection(client),
  ])

  const snapshot: OpsDashboardSnapshot = {
    range,
    hero,
    queues,
    trends,
    exceptions,
    incidents: [...incidents, ...buildSectionFailureIncidents({ range, hero, queues, trends, exceptions, incidents: [] })],
  }

  return snapshot
}

// ─── Label helpers ────────────────────────────────────────────────────────────

function queueKeyToLane(key: OpsDashboardQueueKey): string {
  const lanes: Record<OpsDashboardQueueKey, string> = {
    validation: 'Ops',
    dispatch: 'Dispatch',
    quoteApprovals: 'Quotes',
    fieldExceptions: 'Field',
    financeFollowUp: 'Finance',
    trustRecovery: 'Trust',
    providerOnboarding: 'Supply',
  }
  return lanes[key]
}

function queueKeyToDescription(key: OpsDashboardQueueKey, count: number): string {
  const descriptions: Record<OpsDashboardQueueKey, string> = {
    validation: 'Requests missing platform validation before matching can start.',
    dispatch: `${count} request${count === 1 ? '' : 's'} waiting for provider assignment.`,
    quoteApprovals: 'Quotes waiting on customer decision or revision follow-through.',
    fieldExceptions: 'Jobs that are blocked, failed, or waiting on customer action.',
    financeFollowUp: 'Pending, failed, and refund-state payments requiring intervention.',
    trustRecovery: 'Open disputes and complaints with customer-provider risk attached.',
    providerOnboarding: 'Pending applications that block future assignment capacity.',
  }
  return descriptions[key]
}

function queueKeyToHref(key: OpsDashboardQueueKey): string {
  const hrefs: Record<OpsDashboardQueueKey, string> = {
    validation: '/admin/validation',
    dispatch: '/admin/dispatch',
    quoteApprovals: '/admin/quotes',
    fieldExceptions: '/admin/field-exceptions',
    financeFollowUp: '/admin/payments',
    trustRecovery: '/admin/disputes',
    providerOnboarding: '/admin/applications',
  }
  return hrefs[key]
}

function formatIncidentAge(ageMinutes: number) {
  if (ageMinutes < 60) return `${ageMinutes}m`
  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60
  if (hours < 24) return `${hours}h ${minutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}
