// ─── SLA registry — public API ───────────────────────────────────────────────
// Thin re-export that normalises the ops-dashboard SLA config into the
// Case-layer API the plan calls `slaFor(queueType)`.
//
// The underlying config lives in lib/ops-dashboard/sla.ts; this file
// is the single import point for code outside the ops-dashboard module.

import type { OpsQueueType } from '@prisma/client'
import { OPS_DASHBOARD_QUEUE_SLA } from './ops-dashboard/sla'
import type { OpsDashboardQueueKey } from './ops-dashboard/types'

export type SlaSpec = {
  targetMinutes: number
  warningAtMinutes: number   // 80 % of target — matches getSlaTone logic
  targetLabel: string
}

// Map OpsQueueType → OpsDashboardQueueKey so callers don't need to know both
const QUEUE_TYPE_TO_KEY: Record<OpsQueueType, OpsDashboardQueueKey | null> = {
  VALIDATION:         'validation',
  DISPATCH:           'dispatch',
  QUOTE_APPROVAL:     'quoteApprovals',
  FIELD_EXCEPTION:    'fieldExceptions',
  PAYMENT_FOLLOW_UP:  'financeFollowUp',
  DISPUTE:            'trustRecovery',
  PROVIDER_ONBOARDING:'providerOnboarding',
}

export function slaFor(queueType: OpsQueueType): SlaSpec {
  const key = QUEUE_TYPE_TO_KEY[queueType]
  if (!key) {
    // SUPPLY queue introduced by WS5 — default to 1 business day
    return { targetMinutes: 8 * 60, warningAtMinutes: Math.floor(8 * 60 * 0.8), targetLabel: 'Resolve inside 1 day' }
  }
  const config = OPS_DASHBOARD_QUEUE_SLA[key]
  return {
    targetMinutes:    config.targetMinutes,
    warningAtMinutes: Math.floor(config.targetMinutes * 0.8),
    targetLabel:      config.targetLabel,
  }
}

// Re-export helpers for convenience
export { getSlaTone, computeOldestAgeMinutes, countOverdueAges } from './ops-dashboard/sla'
