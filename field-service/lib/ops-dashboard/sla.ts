import type { OpsQueueType } from '@prisma/client'
import type { OpsDashboardQueueKey, OpsDashboardTone } from './types'
import { OPS_QUEUE_TYPES } from '@/lib/ops-queue'
import { getQueueSlaConfig as getAlertSlaConfig } from './alerts'

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
    targetMinutes: getAlertSlaConfig('validation').breachAtMinutes,
    targetLabel: 'Triage inside 30 min',
  },
  dispatch: {
    key: 'dispatch',
    queueType: OPS_QUEUE_TYPES.DISPATCH,
    title: 'Dispatch pressure',
    targetMinutes: getAlertSlaConfig('dispatch').breachAtMinutes,
    targetLabel: 'Assign inside 15 min',
  },
  quoteApprovals: {
    key: 'quoteApprovals',
    queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
    title: 'Quote approvals',
    targetMinutes: getAlertSlaConfig('quoteApprovals').breachAtMinutes,
    targetLabel: 'Chase inside 1 hour',
  },
  fieldExceptions: {
    key: 'fieldExceptions',
    queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
    title: 'Field exceptions',
    targetMinutes: getAlertSlaConfig('fieldExceptions').breachAtMinutes,
    targetLabel: 'Triage inside 1 hour',
  },
  financeFollowUp: {
    key: 'financeFollowUp',
    queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    title: 'Finance follow-up',
    targetMinutes: getAlertSlaConfig('financeFollowUp').breachAtMinutes,
    targetLabel: 'Resolve inside 1 day',
  },
  trustRecovery: {
    key: 'trustRecovery',
    queueType: OPS_QUEUE_TYPES.DISPUTE,
    title: 'Trust recovery',
    targetMinutes: getAlertSlaConfig('trustRecovery').breachAtMinutes,
    targetLabel: 'Acknowledge inside 2 hours',
  },
  providerOnboarding: {
    key: 'providerOnboarding',
    queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
    title: 'Provider onboarding',
    targetMinutes: getAlertSlaConfig('providerOnboarding').breachAtMinutes,
    targetLabel: 'Review inside 1 day',
  },
  identityVerification: {
    key: 'identityVerification',
    queueType: OPS_QUEUE_TYPES.IDENTITY_VERIFICATION,
    title: 'Identity verifications',
    targetMinutes: getAlertSlaConfig('identityVerification').breachAtMinutes,
    targetLabel: 'Review inside 4 hours',
  },
}

export function getQueueSlaConfig(queueKey: OpsDashboardQueueKey) {
  return OPS_DASHBOARD_QUEUE_SLA[queueKey]
}

export function getSlaTone(ageMinutes: number | null, targetMinutes: number): OpsDashboardTone {
  if (ageMinutes == null) return 'default'
  if (ageMinutes >= targetMinutes) return 'danger'
  if (ageMinutes >= Math.floor(targetMinutes * 0.8)) return 'warning'
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
