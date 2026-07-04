import { isEnabled } from '@/lib/flags'
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'

export const QUALITY_GATE_V2_FLAG = 'provider.onboarding.quality_gate_v2' as const
export const MIN_EVIDENCE_PHOTOS = 3

export function isQualityGateV2Enabled(ctx: { userId?: string } = {}): Promise<boolean> {
  return isEnabled(QUALITY_GATE_V2_FLAG, ctx)
}

function countDistinctNonEmpty(urls: readonly string[]): number {
  const seen = new Set<string>()
  for (const raw of urls) {
    const v = raw?.trim()
    if (v) seen.add(v)
  }
  return seen.size
}

export function evaluateEvidenceGate(evidenceFileUrls: readonly string[]): { ok: boolean; have: number; need: number } {
  const have = countDistinctNonEmpty(evidenceFileUrls ?? [])
  return { ok: have >= MIN_EVIDENCE_PHOTOS, have, need: MIN_EVIDENCE_PHOTOS }
}

export function evaluateCertificationGate(skills: readonly string[], hasCertification: boolean): { required: boolean; ok: boolean } {
  const required = hasHighRiskServiceSelection([...(skills ?? [])])
  return { required, ok: required ? Boolean(hasCertification) : true }
}

export function evidenceShortfallMessage(have: number, need: number): string {
  const remaining = Math.max(0, need - have)
  return `You've added ${have} of ${need} required work photos — please add ${remaining} more.`
}

export function certificationRequiredMessage(): string {
  return 'One of your selected trades is high-risk, so we need a certification document or registration number before you can finish.'
}

/**
 * Pure helper — determines whether the evidence step is complete.
 * When the gate is disabled the step is always complete; when enabled it
 * delegates to evaluateEvidenceGate. Kept separate so it can be unit-tested
 * without a DOM or React.
 */
export function evidenceStepComplete(evidenceFileUrls: string[], gateEnabled: boolean): boolean {
  if (!gateEnabled) return true
  return evaluateEvidenceGate(evidenceFileUrls).ok
}
