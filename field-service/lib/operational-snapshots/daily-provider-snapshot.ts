// Daily provider snapshot — collects + persists derived aggregate counts.
//
// Read paths only against the source tables (no writes outside our own
// daily_provider_snapshots table). Idempotent on snapshotDate via upsert.

import { Prisma, type PrismaClient } from '@prisma/client'

// Minimal contract so callers (route + tests) can pass either a full
// PrismaClient or a typed mock without dragging in extension types.
export type SnapshotDbClient = Pick<
  PrismaClient,
  | '$queryRaw'
  | 'providerApplication'
  | 'provider'
  | 'providerApplicationDraft'
  | 'messageEvent'
  | 'otpDeliveryAttempt'
  | 'providerWallet'
  | 'leadUnlock'
  | 'jobRequest'
  | 'dailyProviderSnapshot'
>

export type DailyProviderSnapshotMetrics = {
  snapshotDate: Date
  appsApproved: number
  appsPending: number
  appsMoreInfo: number
  providersActive: number
  providersVerified: number
  pendingBreachingSla: number
  approvalP50Minutes: number | null
  approvalP90Minutes: number | null
  approvalSlaHitRate: number | null
  whatsappOutbound30d: number
  otpAttempts30d: number
  promoCreditsHeld: number
  paidCreditsHeld: number
  leadUnlocks30d: number
  jobRequests30d: number
  applicationsLast7d: number
  approvedLast7d: number
  rawMetricsJson: Record<string, unknown>
}

const SLA_MINUTES = 30

// Computes one calendar-day snapshot. Uses a clock parameter so tests can
// pin the "now" anchor without freezing global time.
export async function collectDailyProviderSnapshot(
  db: SnapshotDbClient,
  now: Date = new Date(),
): Promise<DailyProviderSnapshotMetrics> {
  const snapshotDate = startOfUtcDay(now)
  const sla = new Date(now.getTime() - SLA_MINUTES * 60_000)
  const thirty = new Date(now.getTime() - 30 * 24 * 60 * 60_000)
  const seven = new Date(now.getTime() - 7 * 24 * 60 * 60_000)

  // 1) Application status breakdown — prod cohort only.
  const appStatuses = await db.providerApplication.groupBy({
    by: ['status'],
    where: { isTestUser: { not: true } },
    _count: { _all: true },
  })
  const appsApproved = countFor(appStatuses, 'APPROVED')
  const appsPending = countFor(appStatuses, 'PENDING')
  const appsMoreInfo = countFor(appStatuses, 'MORE_INFO_REQUIRED')

  // 2) Provider fleet.
  const [providersActive, providersVerified] = await Promise.all([
    db.provider.count({ where: { active: true, isTestUser: { not: true } } }),
    db.provider.count({ where: { verified: true, isTestUser: { not: true } } }),
  ])

  // 3) Pending breaching SLA.
  const pendingBreachingSla = await db.providerApplication.count({
    where: {
      status: 'PENDING',
      isTestUser: { not: true },
      submittedAt: { lt: sla },
    },
  })

  // 4) Approval SLA — needs percentiles, so a single raw query.
  const slaRows = await db.$queryRaw<
    Array<{
      p50: string | null
      p90: string | null
      hit_rate: string | null
    }>
  >`
    WITH d AS (
      SELECT EXTRACT(EPOCH FROM ("reviewedAt" - "submittedAt"))/60 AS m
      FROM provider_applications
      WHERE status = 'APPROVED'
        AND "reviewedAt" IS NOT NULL
        AND "submittedAt" >= ${thirty}::timestamp
        AND COALESCE("isTestUser", false) = false
    )
    SELECT
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m)::text AS p50,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY m)::text AS p90,
      (COUNT(*) FILTER (WHERE m <= ${SLA_MINUTES}))::float
        / NULLIF(COUNT(*), 0)::float AS hit_rate
    FROM d
  `
  const slaRow = slaRows[0] ?? { p50: null, p90: null, hit_rate: null }
  const approvalP50Minutes = toFiniteNumber(slaRow.p50)
  const approvalP90Minutes = toFiniteNumber(slaRow.p90)
  const approvalSlaHitRate = toFiniteNumber(slaRow.hit_rate)

  // 5) Communication volume — 30 days.
  const [whatsappOutbound30d, otpAttempts30d] = await Promise.all([
    db.messageEvent.count({
      where: { direction: 'OUTBOUND', createdAt: { gte: thirty } },
    }),
    db.otpDeliveryAttempt.count({
      where: { createdAt: { gte: thirty } },
    }),
  ])

  // 6) Wallets — sum credit balances.
  const walletAgg = await db.providerWallet.aggregate({
    _sum: { paidCreditBalance: true, promoCreditBalance: true },
  })
  const paidCreditsHeld = Number(walletAgg._sum.paidCreditBalance ?? 0)
  const promoCreditsHeld = Number(walletAgg._sum.promoCreditBalance ?? 0)

  // 7) Demand side — 30 days.
  const [leadUnlocks30d, jobRequests30d] = await Promise.all([
    db.leadUnlock.count({ where: { createdAt: { gte: thirty } } }),
    db.jobRequest.count({
      where: { createdAt: { gte: thirty }, isTestRequest: { not: true } },
    }),
  ])

  // 8) Acquisition window — 7 days.
  const [applicationsLast7d, approvedLast7d] = await Promise.all([
    db.providerApplication.count({
      where: { submittedAt: { gte: seven }, isTestUser: { not: true } },
    }),
    db.providerApplication.count({
      where: {
        status: 'APPROVED',
        reviewedAt: { gte: seven },
        isTestUser: { not: true },
      },
    }),
  ])

  // 9) Detail bag — pending age buckets + draft funnel.
  const [pendingAgeRows, draftRows] = await Promise.all([
    db.$queryRaw<
      Array<{ age_bucket: string; pending_count: bigint }>
    >`
      SELECT
        CASE
          WHEN "submittedAt" > NOW() - INTERVAL '30 minutes' THEN '0_within_sla'
          WHEN "submittedAt" > NOW() - INTERVAL '1 hour'     THEN '1_30min_to_1h'
          WHEN "submittedAt" > NOW() - INTERVAL '6 hours'    THEN '2_1h_to_6h'
          WHEN "submittedAt" > NOW() - INTERVAL '24 hours'   THEN '3_6h_to_24h'
          WHEN "submittedAt" > NOW() - INTERVAL '7 days'     THEN '4_1d_to_7d'
          ELSE                                                    '5_over_7d'
        END AS age_bucket,
        COUNT(*) AS pending_count
      FROM provider_applications
      WHERE status = 'PENDING' AND COALESCE("isTestUser", false) = false
      GROUP BY 1
      ORDER BY 1
    `,
    db.providerApplicationDraft.groupBy({
      by: ['lastCompletedStep'],
      _count: { _all: true },
    }),
  ])

  const rawMetricsJson: Record<string, unknown> = {
    pendingAgeBuckets: Object.fromEntries(
      pendingAgeRows.map((r) => [r.age_bucket, Number(r.pending_count)]),
    ),
    draftsByStep: Object.fromEntries(
      draftRows.map((r) => [String(r.lastCompletedStep), r._count._all]),
    ),
    capturedAtIso: now.toISOString(),
    slaThresholdMinutes: SLA_MINUTES,
  }

  return {
    snapshotDate,
    appsApproved,
    appsPending,
    appsMoreInfo,
    providersActive,
    providersVerified,
    pendingBreachingSla,
    approvalP50Minutes,
    approvalP90Minutes,
    approvalSlaHitRate,
    whatsappOutbound30d,
    otpAttempts30d,
    promoCreditsHeld,
    paidCreditsHeld,
    leadUnlocks30d,
    jobRequests30d,
    applicationsLast7d,
    approvedLast7d,
    rawMetricsJson,
  }
}

export async function persistDailyProviderSnapshot(
  db: SnapshotDbClient,
  metrics: DailyProviderSnapshotMetrics,
): Promise<{ id: string; snapshotDate: Date }> {
  const decimalOrNull = (n: number | null) =>
    n === null ? null : new Prisma.Decimal(n)

  const data = {
    snapshotDate: metrics.snapshotDate,
    appsApproved: metrics.appsApproved,
    appsPending: metrics.appsPending,
    appsMoreInfo: metrics.appsMoreInfo,
    providersActive: metrics.providersActive,
    providersVerified: metrics.providersVerified,
    pendingBreachingSla: metrics.pendingBreachingSla,
    approvalP50Minutes: decimalOrNull(metrics.approvalP50Minutes),
    approvalP90Minutes: decimalOrNull(metrics.approvalP90Minutes),
    approvalSlaHitRate: decimalOrNull(metrics.approvalSlaHitRate),
    whatsappOutbound30d: metrics.whatsappOutbound30d,
    otpAttempts30d: metrics.otpAttempts30d,
    promoCreditsHeld: metrics.promoCreditsHeld,
    paidCreditsHeld: metrics.paidCreditsHeld,
    leadUnlocks30d: metrics.leadUnlocks30d,
    jobRequests30d: metrics.jobRequests30d,
    applicationsLast7d: metrics.applicationsLast7d,
    approvedLast7d: metrics.approvedLast7d,
    rawMetricsJson: metrics.rawMetricsJson as Prisma.InputJsonValue,
  }

  const row = await db.dailyProviderSnapshot.upsert({
    where: { snapshotDate: metrics.snapshotDate },
    create: data,
    update: data,
    select: { id: true, snapshotDate: true },
  })

  return row
}

// ─── WhatsApp digest ──────────────────────────────────────────────────────────
//
// Fire-and-(don't-)forget admin digest. Wraps `sendTemplate` so:
//   - missing ADMIN_WHATSAPP_NUMBER → returns reason='no_admin_phone'
//   - missing template approval / Meta-side rejection → caught, returns
//     reason='send_failed' with the underlying error message. NEVER throws.
//
// The caller (cron route) treats any non-ok return as a soft warning, not a
// 500 — the snapshot row itself has already been persisted by this point.

export type DailySnapshotDigestSender = (params: {
  to: string
  template: 'admin_daily_provider_snapshot'
  components?: Array<{
    type: 'body'
    parameters: Array<{ type: 'text'; text: string }>
  }>
  metadata?: Record<string, unknown>
}) => Promise<string>

export type DailySnapshotDigestResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'no_admin_phone' | 'send_failed'; error?: string }

/**
 * Send the digest. Returns a structured result instead of throwing so the
 * caller can decide whether to escalate. The default sender is the
 * production `sendTemplate` from lib/whatsapp; tests inject a mock.
 */
export async function sendDailySnapshotDigest(
  metrics: DailyProviderSnapshotMetrics,
  options?: {
    sender?: DailySnapshotDigestSender
    adminPhone?: string | null
  },
): Promise<DailySnapshotDigestResult> {
  const adminPhone =
    options?.adminPhone === undefined
      ? process.env.ADMIN_WHATSAPP_NUMBER ?? null
      : options.adminPhone

  if (!adminPhone) {
    return { sent: false, reason: 'no_admin_phone' }
  }

  // Lazy import keeps the cron route bundle small for the (default-off) path
  // and lets tests substitute a sender without touching whatsapp.ts module
  // initialisation (which reads env at first require).
  const sender: DailySnapshotDigestSender =
    options?.sender ??
    (await import('@/lib/whatsapp').then(
      (m) => m.sendTemplate as unknown as DailySnapshotDigestSender,
    ))

  const date = metrics.snapshotDate.toISOString().slice(0, 10)
  const components = [
    {
      type: 'body' as const,
      parameters: [
        { type: 'text' as const, text: date },
        { type: 'text' as const, text: String(metrics.appsApproved) },
        { type: 'text' as const, text: String(metrics.appsPending) },
        { type: 'text' as const, text: String(metrics.pendingBreachingSla) },
        { type: 'text' as const, text: String(metrics.applicationsLast7d) },
        { type: 'text' as const, text: String(metrics.approvedLast7d) },
      ],
    },
  ]

  try {
    const messageId = await sender({
      to: adminPhone,
      template: 'admin_daily_provider_snapshot',
      components,
      metadata: {
        cron: 'daily-provider-snapshot',
        snapshotDate: date,
      },
    })
    return { sent: true, messageId }
  } catch (err) {
    return {
      sent: false,
      reason: 'send_failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function countFor(
  rows: Array<{ status: string; _count: { _all: number } }>,
  status: string,
): number {
  return rows.find((r) => r.status === status)?._count._all ?? 0
}

function toFiniteNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
