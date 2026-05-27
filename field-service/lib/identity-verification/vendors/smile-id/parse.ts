import { createHash } from 'crypto'
import type {
  ParseWebhookInput,
  ParseWebhookResult,
  NormalizedVerificationResult,
} from '../types'
import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  deriveDecision,
  isTerminalResultCode,
} from './result-codes'
import { verifySmileSignature } from './signing'
import { redactSmilePayload } from './redact'
import type { SmileEvdActions, SmileEvdWebhookPayload } from './types'

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  )
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function deriveIsFinal(payload: SmileEvdWebhookPayload): boolean {
  // Smile sends IsFinalResult as either boolean or string "true"/"false".
  if (payload.IsFinalResult === true) return true
  if (payload.IsFinalResult === 'true') return true
  // EVD callbacks may omit IsFinalResult; treat terminal ResultCode as final.
  if (isTerminalResultCode(payload.ResultCode)) return true
  return false
}

function deriveLivenessVerified(actions: SmileEvdActions | undefined): boolean | null {
  const check = actions?.Liveness_Check
  if (check === 'Passed') return true
  if (check === 'Failed') return false
  return null  // 'Under Review', 'Not Applicable', missing — all ambiguous
}

function deriveBinaryConfidence(payload: SmileEvdWebhookPayload, isFinal: boolean): number {
  const isPass = SMILE_ID_EVD_PASS_RESULT_CODES.has(payload.ResultCode)
  const livenessPassed = payload.Actions?.Liveness_Check === 'Passed'
  return (isPass && isFinal && livenessPassed) ? 1.0 : 0.0
}

function deriveReasonCode(
  resultCode: string | undefined,
  decision: NormalizedVerificationResult['decision'],
): string | null {
  if (decision === 'PASS') return null
  return resultCode ?? null
}

function deriveRiskFlags(payload: SmileEvdWebhookPayload): string[] {
  const flags: string[] = []
  const actions = payload.Actions ?? {}
  if (actions.Document_Check === 'Failed') flags.push('DOCUMENT_FAILED_AUTHENTICITY')
  if (actions.Verify_Document === 'Failed') flags.push('DOCUMENT_OCR_MISMATCH')
  if (actions.Selfie_To_ID_Card_Compare === 'Failed') flags.push('SELFIE_NOT_MATCHING_DOCUMENT')
  if (actions.Liveness_Check === 'Failed') flags.push('LIVENESS_FAILED')
  return flags
}

export async function parseSmileWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  let payload: SmileEvdWebhookPayload
  try {
    payload = JSON.parse(input.rawBody) as SmileEvdWebhookPayload
  } catch {
    return {
      signatureValid: false,
      vendorEventId: null,
      vendorReference: null,
      livenessSessionReference: null,
      eventType: null,
      payloadHash: sha256(input.rawBody ?? ''),
      redactedPayload: null,
      result: null,
    }
  }

  const signatureValid = typeof payload.signature === 'string' && typeof payload.timestamp === 'string'
    ? verifySmileSignature(payload.timestamp, payload.signature)
    : false

  const isFinal = deriveIsFinal(payload)
  const eventType = isFinal ? 'final' : 'interim'

  const partnerJobId = payload.PartnerParams?.job_id ?? null
  const refId = (typeof (payload as Record<string, unknown>).ref_id === 'string'
    ? (payload as Record<string, unknown>).ref_id as string
    : null)

  const payloadHash = sha256(canonicalJson(payload))
  const redactedPayload = redactSmilePayload(payload as unknown as Record<string, unknown>)

  let result: NormalizedVerificationResult | null = null
  if (isFinal) {
    const decision = deriveDecision(payload.ResultCode)
    const livenessVerified = deriveLivenessVerified(payload.Actions)
    result = {
      decision,
      confidence: deriveBinaryConfidence(payload, isFinal),
      documentConfidence: null,
      livenessScore: null,
      selfieMatchScore: null,
      livenessVerified,
      riskFlags: deriveRiskFlags(payload),
      reasonCode: deriveReasonCode(payload.ResultCode, decision),
      vendorReference: partnerJobId,
      expiresAt: null,
    }
  }

  return {
    signatureValid,
    vendorEventId: null,
    vendorReference: partnerJobId,
    livenessSessionReference: refId,
    eventType,
    payloadHash,
    redactedPayload,
    result,
  }
}
