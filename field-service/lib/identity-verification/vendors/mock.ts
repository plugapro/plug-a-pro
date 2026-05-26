import { createHash } from 'crypto'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'
import type { ParseWebhookInput, VerificationVendorAdapter } from './types'

function hashPayload(rawBody: string) {
  return createHash('sha256').update(canonicalJson(rawBody)).digest('hex')
}

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

export const mockVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'mock',
  async submitDocumentCheck(input) {
    const shouldPass = input.identifierLast4 === '0000'
    const vendorReference = `mock:${input.verificationId}`
    return {
      vendorReference,
      expectsWebhook: false,
      immediateResult: {
        decision: shouldPass ? 'PASS' : 'MANUAL_REVIEW',
        confidence: shouldPass ? 0.99 : null,
        documentConfidence: shouldPass ? 0.99 : null,
        livenessScore: shouldPass ? 0.99 : null,
        selfieMatchScore: shouldPass ? 0.99 : null,
        livenessVerified: shouldPass,
        riskFlags: [],
        reasonCode: shouldPass ? null : 'MOCK_MANUAL_REVIEW',
        vendorReference,
        expiresAt: null,
      },
    }
  },
  async createLivenessSession(input) {
    const base = getPublicAppUrl(`/mock/liveness/${encodeURIComponent(input.verificationId)}`) || 'https://mock.local'
    return {
      vendorReference: `mock-live:${input.verificationId}`,
      sessionUrl: `${base}?return=${encodeURIComponent(input.returnUrl)}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }
  },
  async parseWebhook(input: ParseWebhookInput) {
    const parsed = JSON.parse(input.rawBody || '{}') as Record<string, unknown>
    const decision = typeof parsed.decision === 'string' ? parsed.decision : null
    return {
      signatureValid: true,
      vendorEventId: typeof parsed.eventId === 'string' ? parsed.eventId : null,
      vendorReference: typeof parsed.vendorReference === 'string' ? parsed.vendorReference : null,
      livenessSessionReference: typeof parsed.livenessSessionReference === 'string' ? parsed.livenessSessionReference : null,
      eventType: typeof parsed.eventType === 'string' ? parsed.eventType : 'mock.result',
      payloadHash: hashPayload(input.rawBody),
      redactedPayload: parsed,
      result: decision === 'PASS' || decision === 'FAIL'
        ? {
          decision,
          confidence: Number(parsed.confidence ?? 0.99),
          documentConfidence: null,
          livenessScore: null,
          selfieMatchScore: null,
          livenessVerified: parsed.livenessVerified === true,
          riskFlags: [],
          reasonCode: null,
          vendorReference: typeof parsed.vendorReference === 'string' ? parsed.vendorReference : null,
          expiresAt: null,
        }
        : null,
    }
  },
  async cancelVerificationJob() {
    return { supported: true, vendorAcknowledged: true }
  },
}
