/**
 * Plug-A-Pro AI operating loop — human-review gating.
 *
 * The quality gate. Maps a *change area* to whether a human must approve before
 * anything is merged/applied, and to a risk level. The default is FAIL-SAFE:
 * any unknown or unmapped area requires human review at high risk. It is much
 * cheaper to over-flag a docs change than to under-flag a payment change.
 *
 * Nothing here executes anything. It only classifies. Improvement candidates use
 * it to set their humanReviewRequired flag.
 */

import type { CandidateRiskLevel } from './types'

export const CHANGE_AREAS = [
  // High-risk — always require human review.
  'production_deploy',
  'payment_logic',
  'kyc_logic',
  'security_auth_rbac',
  'database_migration',
  'data_deletion',
  'provider_activation',
  'customer_refund',
  'voucher_credit_balance',
  'bulk_whatsapp_campaign',
  'privacy_popia',
  'secrets_credentials',
  // Lower-risk — may be flagged as lower risk (still reviewed by a human owner,
  // but not gated as a high-risk change).
  'documentation',
  'test_addition',
  'internal_dashboard',
  'read_only_reporting',
  // Catch-all.
  'other',
] as const

export type ChangeArea = (typeof CHANGE_AREAS)[number]

/** The 12 areas that must always pass through human review before execution. */
export const HUMAN_REVIEW_REQUIRED_AREAS: readonly ChangeArea[] = [
  'production_deploy',
  'payment_logic',
  'kyc_logic',
  'security_auth_rbac',
  'database_migration',
  'data_deletion',
  'provider_activation',
  'customer_refund',
  'voucher_credit_balance',
  'bulk_whatsapp_campaign',
  'privacy_popia',
  'secrets_credentials',
]

export const LOWER_RISK_AREAS: readonly ChangeArea[] = [
  'documentation',
  'test_addition',
  'internal_dashboard',
  'read_only_reporting',
]

const RISK_BY_AREA: Record<ChangeArea, CandidateRiskLevel> = {
  production_deploy: 'critical',
  payment_logic: 'critical',
  kyc_logic: 'critical',
  security_auth_rbac: 'critical',
  secrets_credentials: 'critical',
  database_migration: 'high',
  data_deletion: 'high',
  provider_activation: 'high',
  customer_refund: 'high',
  voucher_credit_balance: 'high',
  bulk_whatsapp_campaign: 'high',
  privacy_popia: 'high',
  documentation: 'low',
  test_addition: 'low',
  internal_dashboard: 'low',
  read_only_reporting: 'low',
  other: 'high', // fail-safe
}

export function isKnownChangeArea(value: string): value is ChangeArea {
  return (CHANGE_AREAS as readonly string[]).includes(value)
}

/**
 * Whether a human must review changes in this area before they are applied.
 * Fail-safe: anything not explicitly on the lower-risk list requires review.
 */
export function requiresHumanReview(area: string): boolean {
  if (!isKnownChangeArea(area)) return true
  if (LOWER_RISK_AREAS.includes(area)) return false
  return true
}

export interface ChangeRiskClassification {
  area: ChangeArea
  riskLevel: CandidateRiskLevel
  humanReviewRequired: boolean
  rationale: string
}

export function classifyChangeRisk(area: string): ChangeRiskClassification {
  const resolved: ChangeArea = isKnownChangeArea(area) ? area : 'other'
  const humanReviewRequired = requiresHumanReview(resolved)
  const rationale = HUMAN_REVIEW_REQUIRED_AREAS.includes(resolved)
    ? `${resolved} is a gated high-risk area`
    : LOWER_RISK_AREAS.includes(resolved)
      ? `${resolved} is a lower-risk area`
      : `unrecognised area "${area}" — defaulting to human review (fail-safe)`
  return { area: resolved, riskLevel: RISK_BY_AREA[resolved], humanReviewRequired, rationale }
}

/**
 * Map a business flow (as carried on an OperationalEvent / candidate) to the
 * change area whose code a fix would most likely touch. Used to set risk and
 * the human-review flag on improvement candidates. Unknown ⇒ 'other' (fail-safe).
 */
export function areaForFlow(flow: string): ChangeArea {
  const f = flow.toLowerCase()
  if (f.includes('payment') || f.includes('payat') || f.includes('payfast') || f.includes('payout')) {
    return 'payment_logic'
  }
  if (f.includes('refund')) return 'customer_refund'
  if (f.includes('kyc') || f.includes('identity') || f.includes('verification')) return 'kyc_logic'
  if (f.includes('auth') || f.includes('otp') || f.includes('session') || f.includes('rbac')) {
    return 'security_auth_rbac'
  }
  if (f.includes('voucher') || f.includes('credit') || f.includes('wallet')) return 'voucher_credit_balance'
  if (f.includes('provider_activation') || f.includes('approval') || f.includes('activation')) {
    return 'provider_activation'
  }
  if (f.includes('campaign') || f.includes('broadcast') || f.includes('bulk')) return 'bulk_whatsapp_campaign'
  if (f.includes('privacy') || f.includes('popia') || f.includes('terms') || f.includes('legal')) {
    return 'privacy_popia'
  }
  if (f.includes('report') || f.includes('dashboard')) return 'read_only_reporting'
  return 'other'
}
