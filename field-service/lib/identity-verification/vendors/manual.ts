import type { VerificationVendorAdapter } from './types'

export const manualVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'manual',
  async submitDocumentCheck(input) {
    return {
      vendorReference: `manual:${input.verificationId}`,
      expectsWebhook: false,
      immediateResult: {
        decision: 'MANUAL_REVIEW',
        confidence: null,
        documentConfidence: null,
        livenessScore: null,
        selfieMatchScore: null,
        livenessVerified: null,
        riskFlags: [],
        reasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED',
        vendorReference: `manual:${input.verificationId}`,
        expiresAt: null,
      },
    }
  },
  async parseWebhook() {
    return {
      signatureValid: false,
      vendorEventId: null,
      vendorReference: null,
      livenessSessionReference: null,
      eventType: 'unsupported',
      payloadHash: 'manual-webhook-unsupported',
      redactedPayload: null,
      result: null,
    }
  },
  async cancelVerificationJob() {
    return { supported: false, vendorAcknowledged: false }
  },
}
