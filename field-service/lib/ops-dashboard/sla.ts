import type { OpsQueueType } from '@prisma/client'
import type { OpsDashboardQueueKey, OpsDashboardTone } from './types'
import { OPS_QUEUE_TYPES } from '@/lib/ops-queue'

export type QueueSlaConfig = {
  key: OpsDashboardQueueKey
  queueType: OpsQueueType
  title: string
  targetMinutes: number
  targetLabel: string
}

export const OPS_DASHBOARD_QUEUE_SLA: Record<OpsDashboardQueueKey, QueueSlaConfig> = {
  validation: {
    key: 'validation',
    queueType: OPS_QUEUE_TYPES.VALIDATION,
    title: 'Validation queue',
    targetMinutes: 15,
    targetLabel: 'Triage inside 15 min',
  },
  dispatch: {
    key: 'dispatch',
    queueType: OPS_QUEUE_TYPES.DISPATCH,
    title: 'Dispatch pressure',
    targetMinutes: 20,
    targetLabel: 'Assign inside 20 min',
  },
  quoteApprovals: {
    key: 'quoteApprovals',
    queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
    title: 'Quote approvals',
    targetMinutes: 240,
    targetLabel: 'Chase inside 4 hours',
  },
  fieldExceptions: {
    key: 'fieldExceptions',
    queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
    title: 'Field exceptions',
    targetMinutes: 60,
    targetLabel: 'Triage inside 1 hour',
  },
  financeFollowUp: {
    key: 'financeFollowUp',
    queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    title: 'Finance follow-up',
    targetMinutes: 1440,
    targetLabel: 'Resolve inside 1 day',
  },
  trustRecovery: {
    key: 'trustRecovery',
    queueType: OPS_QUEUE_TYPES.DISPUTE,
    title: 'Trust recovery',
    targetMinutes: 120,
    targetLabel: 'Acknowledge inside 2 hours',
  },
  providerOnboarding: {
    key: 'providerOnboarding',
    queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
    title: 'Provider onboarding',
    targetMinutes: 1440,
    targetLabel: 'Review inside 1 day',
  },
}

export function getQueueSlaConfig(queueKey: OpsDashboardQueueKey) {
  return OPS_DASHBOARD_QUEUE_SLA[queueKey]
}

export function getSlaTone(ageMinutes: number | null, targetMinutes: number): OpsDashboardTone {
  if (ageMinutes == null) return 'default'
  if (ageMinutes >= targetMinutes * 2) return 'danger'
  if (ageMinutes >= targetMinutes) return 'warning'
  return 'default'
}

export function computeOldestAgeMinutes(dates: Date[], now = new Date()): number | null {
  if (dates.length === 0) return null
  const oldest = dates.reduce((min, value) => (value < min ? value : min), dates[0])
  const diffMs = now.getTime() - oldest.getTime()
  return Math.max(0, Math.floor(diffMs / 60000))
}

export function countOverdueAges(ages: number[], targetMinutes: number) {
  return ages.filter((age) => age >= targetMinutes).length
}
