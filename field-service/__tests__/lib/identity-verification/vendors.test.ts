import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('identity verification vendor adapters', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('manual adapter routes to manual review without reporting provider outage', async () => {
    const { manualVerificationAdapter } = await import('../../../lib/identity-verification/vendors/manual')

    const result = await manualVerificationAdapter.submitDocumentCheck({
      verificationId: 'ver-1',
      providerId: 'provider-1',
      identityBasis: 'SA_ID',
      issuingCountry: 'South Africa',
      identifierHash: 'hash-1',
      identifierLast4: '9087',
      identifierPlaintext: null,
      documents: [],
      webhookCallbackUrl: 'https://app.test/api/webhooks/verification/manual',
      livenessReturnUrl: 'https://app.test/provider/verify/token/liveness/complete',
    })

    expect(result).toMatchObject({
      vendorReference: 'manual:ver-1',
      expectsWebhook: false,
      immediateResult: expect.objectContaining({
        decision: 'MANUAL_REVIEW',
        reasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED',
        confidence: null,
      }),
    })
  })

  it('registry refuses mock adapter in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { getAdapter } = await import('../../../lib/identity-verification/vendors/registry')

    expect(() => getAdapter('mock')).toThrow('Mock verification provider cannot be used in production')
  })

  it('mock adapter can create a liveness session for local tests', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { getAdapter } = await import('../../../lib/identity-verification/vendors/registry')

    const adapter = getAdapter('mock')
    const result = await adapter.createLivenessSession?.({
      verificationId: 'ver-1',
      providerId: 'provider-1',
      returnUrl: 'https://app.test/provider/verify/token/liveness/complete',
      submittedVendorReference: 'mock:ver-1',
      webhookCallbackUrl: 'https://app.test/api/webhooks/verification/mock',
    })

    expect(result).toMatchObject({
      vendorReference: 'mock-live:ver-1',
      sessionUrl: expect.stringContaining('/mock/liveness/ver-1'),
      expiresAt: expect.any(Date),
    })
  })

  it('Smile ID webhook parsing redacts nested identity payload fields', async () => {
    vi.stubEnv('SMILE_ID_WEBHOOK_SECRET', 'secret')
    const { createHmac } = await import('crypto')
    const { smileIdVerificationAdapter } = await import('../../../lib/identity-verification/vendors/smile-id')
    const rawBody = JSON.stringify({
      event_id: 'evt-1',
      job_id: 'job-1',
      result: {
        decision: 'PASS',
        confidence: 0.99,
        nested: {
          document_url: 'https://vendor.example/doc-secret',
          selfie_image: 'base64-secret',
        },
      },
    })
    const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex')

    const parsed = await smileIdVerificationAdapter.parseWebhook({
      rawBody,
      headers: { 'x-smile-signature': signature },
    })

    expect(parsed.signatureValid).toBe(true)
    expect(JSON.stringify(parsed.redactedPayload)).not.toContain('doc-secret')
    expect(JSON.stringify(parsed.redactedPayload)).not.toContain('base64-secret')
    expect(parsed.redactedPayload).toMatchObject({
      result: {
        nested: {
          document_url: '[redacted]',
          selfie_image: '[redacted]',
        },
      },
    })
  })
})
