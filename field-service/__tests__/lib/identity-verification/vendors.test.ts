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
    })

    expect(result).toMatchObject({
      vendorReference: 'mock-live:ver-1',
      sessionUrl: expect.stringContaining('/mock/liveness/ver-1'),
      expiresAt: expect.any(Date),
    })
  })
})
