import { createHash, createHmac } from 'crypto'
import type { ParseWebhookInput, VerificationVendorAdapter } from './types'

function canonicalJson(rawBody: string) {
  try {
    return JSON.stringify(sortJson(JSON.parse(rawBody)))
  } catch {
    return rawBody
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}

function payloadHash(rawBody: string) {
  return createHash('sha256').update(canonicalJson(rawBody)).digest('hex')
}

function validSignature(input: ParseWebhookInput) {
  const secret = process.env.SMILE_ID_WEBHOOK_SECRET
  if (!secret) return false
  const signature = input.headers['x-smile-signature'] ?? input.headers['X-Smile-Signature']
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex')
  return signature === expected
}

export const smileIdVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'smile_id',
  async submitDocumentCheck() {
    if (!process.env.SMILE_ID_API_KEY || !process.env.SMILE_ID_PARTNER_ID) {
      throw new Error('Smile ID credentials are not configured')
    }
    throw new Error('Smile ID document submission is scaffolded but not enabled without a provider contract implementation')
  },
  async createLivenessSession() {
    if (!process.env.SMILE_ID_API_KEY || !process.env.SMILE_ID_PARTNER_ID) {
      throw new Error('Smile ID credentials are not configured')
    }
    throw new Error('Smile ID liveness session creation is scaffolded but not enabled without a provider contract implementation')
  },
  async parseWebhook(input) {
    const parsed = JSON.parse(input.rawBody || '{}') as Record<string, unknown>
    const result = parsed.result && typeof parsed.result === 'object'
      ? parsed.result as Record<string, unknown>
      : parsed
    const decision = result.decision === 'PASS' || result.decision === 'FAIL'
      ? result.decision
      : result.decision === 'INCONCLUSIVE'
        ? 'INCONCLUSIVE'
        : null
    return {
      signatureValid: validSignature(input),
      vendorEventId: typeof parsed.event_id === 'string' ? parsed.event_id : null,
      vendorReference: typeof parsed.job_id === 'string' ? parsed.job_id : null,
      livenessSessionReference: typeof parsed.session_id === 'string' ? parsed.session_id : null,
      eventType: typeof parsed.event_type === 'string' ? parsed.event_type : null,
      payloadHash: payloadHash(input.rawBody),
      redactedPayload: redactPayload(parsed),
      result: decision
        ? {
          decision,
          confidence: typeof result.confidence === 'number' ? result.confidence : null,
          documentConfidence: typeof result.document_confidence === 'number' ? result.document_confidence : null,
          livenessScore: typeof result.liveness_score === 'number' ? result.liveness_score : null,
          selfieMatchScore: typeof result.selfie_match_score === 'number' ? result.selfie_match_score : null,
          livenessVerified: typeof result.liveness_verified === 'boolean' ? result.liveness_verified : null,
          riskFlags: Array.isArray(result.risk_flags) ? result.risk_flags.map(String) : [],
          reasonCode: typeof result.reason_code === 'string' ? result.reason_code : null,
          vendorReference: typeof parsed.job_id === 'string' ? parsed.job_id : null,
          expiresAt: null,
        }
        : null,
    }
  },
  async cancelVerificationJob() {
    return { supported: false, vendorAcknowledged: false }
  },
}

function redactPayload(value: Record<string, unknown>) {
  const redacted = { ...value }
  for (const key of Object.keys(redacted)) {
    if (/id_number|identifier|document|selfie|image|token|secret/i.test(key)) {
      redacted[key] = '[redacted]'
    }
  }
  return redacted
}
