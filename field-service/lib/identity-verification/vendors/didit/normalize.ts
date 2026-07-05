// Didit decision -> NormalizedVerificationResult mapping.
//
// Trusted-terminal rationale: Didit's hosted flow runs liveness + face match
// + AML + ID checks before issuing "Approved". When status is Approved we
// surface livenessVerified=true plus a real confidence value derived from the
// feature-array scores so the orchestrator's PASS gate (in applyVendorVerdict)
// is satisfied without weakening - if Didit reports any failure in
// liveness_checks/face_matches, livenessVerified flips false and the
// orchestrator routes to NEEDS_MANUAL_REVIEW automatically.

import type { NormalizedVerificationResult } from '../types'
import type { DiditDecisionResponse, DiditFeatureCheck, DiditWebhookEnvelope } from './types'

const DIDIT_STATUS = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  RESUBMITTED: 'Resubmitted',
  AWAITING_USER: 'Awaiting User',
  IN_REVIEW: 'In Review',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  KYC_EXPIRED: 'Kyc Expired',
  ABANDONED: 'Abandoned',
} as const

export type DiditNormalizeContext = {
  // Workflow id stamped on the verification row at session-create time.
  // Used to derive whether Approved -> HIGH assurance (authoritative workflow)
  // or MEDIUM (basic workflow, e.g. customer-side check).
  storedVendorWorkflowId: string | null
  authoritativeWorkflowId: string | null
}

export type DiditNormalizedOutput = {
  // The verdict that should drive applyVendorVerdict, if any. null when the
  // Didit status is non-terminal (NOT_STARTED, IN_PROGRESS, AWAITING_USER,
  // RESUBMITTED, EXPIRED, ABANDONED, KYC_EXPIRED or unknown).
  result: NormalizedVerificationResult | null
  // Diagnostic for the webhook event row when the status falls outside the
  // mapping table. Empty for known statuses.
  unknownStatus: string | null
}

export function normalizeDiditDecision(
  payload: DiditWebhookEnvelope | DiditDecisionResponse,
  ctx: DiditNormalizeContext,
): DiditNormalizedOutput {
  const status = typeof payload.status === 'string' ? payload.status : null
  const sessionId = typeof (payload as DiditDecisionResponse).session_id === 'string'
    ? (payload as DiditDecisionResponse).session_id
    : null

  if (!status) return { result: null, unknownStatus: null }

  // Pull feature arrays from either the envelope's nested decision or
  // directly off the response object (GET /decision/ shape).
  const featureSource: DiditDecisionResponse | DiditWebhookEnvelope =
    payload.decision && typeof payload.decision === 'object' && !Array.isArray(payload.decision)
      ? (payload.decision as DiditDecisionResponse)
      : payload

  switch (status) {
    case DIDIT_STATUS.APPROVED:
      return { result: buildApprovedResult(featureSource, sessionId, ctx), unknownStatus: null }
    case DIDIT_STATUS.DECLINED:
      return { result: buildDeclinedResult(featureSource, sessionId), unknownStatus: null }
    case DIDIT_STATUS.IN_REVIEW:
      return { result: buildManualReviewResult(featureSource, sessionId), unknownStatus: null }
    case DIDIT_STATUS.NOT_STARTED:
    case DIDIT_STATUS.IN_PROGRESS:
    case DIDIT_STATUS.RESUBMITTED:
    case DIDIT_STATUS.AWAITING_USER:
    case DIDIT_STATUS.EXPIRED:
    case DIDIT_STATUS.KYC_EXPIRED:
    case DIDIT_STATUS.ABANDONED:
      // Non-decision states: audit the event but emit no verdict. The
      // existing verification TTL (link.ts + gate.ts) handles cleanup of
      // expired/abandoned sessions; webhook receipt alone is sufficient.
      return { result: null, unknownStatus: null }
    default:
      return { result: null, unknownStatus: status }
  }
}

function buildApprovedResult(
  source: DiditDecisionResponse | DiditWebhookEnvelope,
  sessionId: string | null,
  ctx: DiditNormalizeContext,
): NormalizedVerificationResult {
  const liveness = firstFeature(featureArray(source, 'liveness_checks'))
  const faceMatch = firstFeature(featureArray(source, 'face_matches'))
  const idVerification = firstFeature(featureArray(source, 'id_verifications'))

  const livenessVerified = isPassedFeature(liveness)

  // Didit emits feature scores on either a 0-1 (fraction) or 0-100 (percent)
  // scale depending on the workflow, but consistently within a single decision.
  // Detect the scale ONCE across the whole decision rather than per feature: a
  // lone score of 1 is ambiguous (perfect fraction, or 1% percent), but its
  // siblings disambiguate. Any raw score > 1 proves the decision is on the
  // percent scale, so every score is then divided by 100 and clamped to [0,1].
  // Without this, a percentage score of 1 (a 1% match — a hard fail) read as
  // 1.0 would clear the confidence threshold and auto-PASS a failing check.
  const rawLiveness = rawScore(liveness)
  const rawFace = rawScore(faceMatch)
  const rawDoc = rawScore(idVerification) ?? rawFallback(idVerification, 'confidence')
  const percentScale = [rawLiveness, rawFace, rawDoc].some(
    (s): s is number => typeof s === 'number' && s > 1,
  )

  const livenessScore = resolveScore(liveness, rawLiveness, percentScale)
  const selfieMatchScore = resolveScore(faceMatch, rawFace, percentScale)
  const documentConfidence = resolveScore(idVerification, rawDoc, percentScale)

  // Conservative aggregate: confidence is the minimum across the three
  // feature scores. Missing-but-passed defaults to 1.0 so the orchestrator
  // threshold (default 0.85) is met. If any check reports a sub-threshold
  // numeric score, applyVendorVerdict routes to manual review for us.
  const candidates = [livenessScore, selfieMatchScore, documentConfidence].filter(
    (s): s is number => typeof s === 'number',
  )
  const confidence = candidates.length > 0 ? Math.min(...candidates) : 1.0

  const riskFlags = collectRiskFlags(source)
  const assuranceLevelHint = deriveAssuranceLevelHint(ctx)

  return {
    decision: 'PASS',
    confidence,
    documentConfidence,
    livenessScore,
    selfieMatchScore,
    livenessVerified,
    riskFlags,
    reasonCode: null,
    vendorReference: sessionId,
    expiresAt: null,
    assuranceLevelHint,
  }
}

function buildDeclinedResult(
  source: DiditDecisionResponse | DiditWebhookEnvelope,
  sessionId: string | null,
): NormalizedVerificationResult {
  const riskFlags = collectRiskFlags(source)
  return {
    decision: 'FAIL',
    confidence: 0,
    documentConfidence: null,
    livenessScore: null,
    selfieMatchScore: null,
    livenessVerified: false,
    riskFlags,
    reasonCode: riskFlags[0] ?? 'DIDIT_DECLINED',
    vendorReference: sessionId,
    expiresAt: null,
  }
}

function buildManualReviewResult(
  source: DiditDecisionResponse | DiditWebhookEnvelope,
  sessionId: string | null,
): NormalizedVerificationResult {
  const riskFlags = collectRiskFlags(source)
  return {
    decision: 'MANUAL_REVIEW',
    confidence: null,
    documentConfidence: null,
    livenessScore: null,
    selfieMatchScore: null,
    livenessVerified: null,
    riskFlags,
    reasonCode: riskFlags[0] ?? 'DIDIT_IN_REVIEW',
    vendorReference: sessionId,
    expiresAt: null,
  }
}

function firstFeature(features: DiditFeatureCheck[] | undefined): DiditFeatureCheck | null {
  if (!Array.isArray(features) || features.length === 0) return null
  return features[0]
}

function isPassedFeature(feature: DiditFeatureCheck | null): boolean {
  if (!feature) return false
  // Production payloads report feature-level status 'Approved' (matching the
  // session-level status); 'Passed' is kept for the documented sandbox shape.
  // First live GA verification (2026-07-04, session 0d49f025) proved this:
  // liveness {score:100, status:'Approved'} was treated as failed and the
  // provider was wrongly routed to manual review.
  return feature.status === 'Passed' || feature.status === 'Approved'
}

// Raw (un-scaled) numeric score for a feature, or null when absent.
function rawScore(feature: DiditFeatureCheck | null): number | null {
  if (!feature) return null
  return typeof feature.score === 'number' ? feature.score : null
}

// Raw fallback field (e.g. id_verifications carries `confidence` not `score`).
function rawFallback(
  feature: DiditFeatureCheck | null,
  fallbackKey: 'confidence' | 'score',
): number | null {
  if (!feature) return null
  return typeof feature[fallbackKey] === 'number' ? (feature[fallbackKey] as number) : null
}

// Resolve a feature's confidence on the 0-1 scale the orchestrator threshold
// expects. `percentScale` is decided once per decision (see buildApprovedResult).
// A Passed/Approved feature with no numeric score defaults to 1.0; a present
// score is scaled if the decision is on the percent scale, then clamped to
// [0,1] so a malformed out-of-range value cannot exceed a perfect confidence.
function resolveScore(
  feature: DiditFeatureCheck | null,
  raw: number | null,
  percentScale: boolean,
): number | null {
  if (raw === null) {
    return isPassedFeature(feature) ? 1.0 : null
  }
  const scaled = percentScale ? raw / 100 : raw
  return Math.min(1, Math.max(0, scaled))
}

function collectRiskFlags(source: DiditDecisionResponse | DiditWebhookEnvelope): string[] {
  const flags = new Set<string>()
  for (const key of ['id_verifications', 'liveness_checks', 'face_matches', 'aml_screenings', 'database_validations'] as const) {
    const features = featureArray(source, key)
    if (!features) continue
    for (const feature of features) {
      if (!feature?.warnings || !Array.isArray(feature.warnings)) continue
      for (const warning of feature.warnings) {
        if (warning && typeof warning.risk_code === 'string' && warning.risk_code.trim()) {
          flags.add(warning.risk_code.trim())
        }
      }
    }
  }
  return [...flags]
}

// Both DiditDecisionResponse and DiditWebhookEnvelope have an open index
// signature ([key: string]: unknown). Reading a typed property directly forces
// us through that signature, so narrow at the boundary.
function featureArray(
  source: DiditDecisionResponse | DiditWebhookEnvelope,
  key: 'id_verifications' | 'liveness_checks' | 'face_matches' | 'aml_screenings' | 'database_validations',
): DiditFeatureCheck[] | undefined {
  const value = (source as Record<string, unknown>)[key]
  return Array.isArray(value) ? (value as DiditFeatureCheck[]) : undefined
}

function deriveAssuranceLevelHint(ctx: DiditNormalizeContext): 'HIGH' | 'MEDIUM' {
  // Safe default: when the authoritative workflow id isn't configured
  // (dev / staging running basic-only or env misconfigured in prod),
  // never claim HIGH assurance. A missing discriminator means the
  // assurance level cannot be authenticated as authoritative - MEDIUM
  // is the conservative posture and keeps credit-gate / selected-provider
  // acceptance properly blocked.
  if (!ctx.authoritativeWorkflowId) return 'MEDIUM'
  return ctx.storedVendorWorkflowId === ctx.authoritativeWorkflowId ? 'HIGH' : 'MEDIUM'
}
