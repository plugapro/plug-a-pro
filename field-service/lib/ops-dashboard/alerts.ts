import type { PrismaClient } from '@prisma/client'
import type { OpsDashboardQueueKey, QueueBreachResult } from './types'

export type QueueSlaConfig = {
  queueKey: OpsDashboardQueueKey
  label: string
  warnAtMinutes: number
  breachAtMinutes: number
}

export const QUEUE_SLA: QueueSlaConfig[] = [
  { queueKey: 'validation', label: 'Validation', warnAtMinutes: 24, breachAtMinutes: 30 },
  { queueKey: 'dispatch', label: 'Dispatch', warnAtMinutes: 12, breachAtMinutes: 15 },
  { queueKey: 'quoteApprovals', label: 'Quote Approvals', warnAtMinutes: 48, breachAtMinutes: 60 },
  { queueKey: 'fieldExceptions', label: 'Field Exceptions', warnAtMinutes: 48, breachAtMinutes: 60 },
  { queueKey: 'financeFollowUp', label: 'Finance Follow-up', warnAtMinutes: 720, breachAtMinutes: 1440 },
  { queueKey: 'trustRecovery', label: 'Disputes', warnAtMinutes: 120, breachAtMinutes: 240 },
  { queueKey: 'providerOnboarding', label: 'Provider Onboarding', warnAtMinutes: 720, breachAtMinutes: 1440 },
]

type QueueBreachRow = {
  overdueCount: bigint | number | string
  oldestAt: Date | null
}

const QUEUE_SLA_BY_KEY = Object.fromEntries(
  QUEUE_SLA.map((config) => [config.queueKey, config]),
) as Record<OpsDashboardQueueKey, QueueSlaConfig>

function countValue(value: bigint | number | string) {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  return Number.parseInt(value, 10)
}

function minutesSince(date: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000))
}

export function getQueueSlaConfig(queueKey: OpsDashboardQueueKey) {
  return QUEUE_SLA_BY_KEY[queueKey]
}

export function getQueueHref(queueKey: OpsDashboardQueueKey) {
  switch (queueKey) {
    case 'validation':
      return '/admin/validation'
    case 'dispatch':
      return '/admin/dispatch'
    case 'quoteApprovals':
      return '/admin/quotes'
    case 'fieldExceptions':
      return '/admin/field-exceptions'
    case 'financeFollowUp':
      return '/admin/payments'
    case 'trustRecovery':
      return '/admin/disputes'
    case 'providerOnboarding':
      return '/admin/applications'
    default:
      return '/admin'
  }
}

export function getQueueAgeTone(
  queueKey: OpsDashboardQueueKey,
  ageMinutes: number | null,
): 'default' | 'warning' | 'danger' {
  if (ageMinutes == null) return 'default'
  const config = getQueueSlaConfig(queueKey)
  if (ageMinutes >= config.breachAtMinutes) return 'danger'
  if (ageMinutes >= config.warnAtMinutes) return 'warning'
  return 'default'
}

export async function detectQueueBreaches(client: PrismaClient): Promise<QueueBreachResult[]> {
  const now = new Date()
  const [
    validationRow,
    dispatchRow,
    quoteRow,
    fieldExceptionRow,
    financeRow,
    disputeRow,
    providerRow,
  ] = await Promise.all([
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.validation.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "job_requests"
      WHERE "status" = 'PENDING_VALIDATION'
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.dispatch.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "job_requests"
      WHERE "status" IN ('OPEN', 'MATCHING')
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.quoteApprovals.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "quotes"
      WHERE "status" IN ('PENDING', 'REVISED')
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "updatedAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.fieldExceptions.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "jobs"
      WHERE "status" IN ('AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION', 'FAILED', 'CALLBACK_REQUIRED')
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "updatedAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.financeFollowUp.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "payments"
      WHERE "status" IN ('PENDING', 'FAILED', 'PARTIALLY_REFUNDED')
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.trustRecovery.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "disputes"
      WHERE "status" IN ('OPEN', 'UNDER_REVIEW')
    `,
    client.$queryRaw<QueueBreachRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" <= ${new Date(now.getTime() - QUEUE_SLA_BY_KEY.providerOnboarding.breachAtMinutes * 60000)})::bigint AS "overdueCount",
        MIN("createdAt") AS "oldestAt"
      FROM "provider_applications"
      WHERE "status" = 'PENDING'
    `,
  ])

  const queueRows: Array<[OpsDashboardQueueKey, QueueBreachRow | undefined]> = [
    ['validation', validationRow[0]],
    ['dispatch', dispatchRow[0]],
    ['quoteApprovals', quoteRow[0]],
    ['fieldExceptions', fieldExceptionRow[0]],
    ['financeFollowUp', financeRow[0]],
    ['trustRecovery', disputeRow[0]],
    ['providerOnboarding', providerRow[0]],
  ]

  return queueRows.flatMap(([queueKey, row]) => {
    if (!row?.oldestAt) return []

    const overdueCount = countValue(row.overdueCount)
    if (overdueCount <= 0) return []

    const config = getQueueSlaConfig(queueKey)
    const oldestAgeMinutes = minutesSince(row.oldestAt, now)

    return [
      {
        queueKey,
        label: config.label,
        overdueCount,
        oldestAgeMinutes,
        severity: oldestAgeMinutes >= config.breachAtMinutes ? 'breach' : 'warn',
      },
    ]
  })
}
