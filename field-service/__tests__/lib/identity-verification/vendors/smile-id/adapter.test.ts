import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { smileIdVerificationAdapter } from '../../../../../lib/identity-verification/vendors/smile-id'

describe('SmileIdVerificationAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', '100')
    vi.stubEnv('SMILE_ID_API_KEY', 'TEST_KEY')
    vi.stubEnv('SMILE_ID_BASE_URL', 'https://testapi.smileidentity.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('vendorKey is smile_id', () => {
    expect(smileIdVerificationAdapter.vendorKey).toBe('smile_id')
  })

  describe('submitDocumentCheck', () => {
    it('returns a fresh partner_job_id and expectsWebhook=true', async () => {
      const a = await smileIdVerificationAdapter.submitDocumentCheck({
        verificationId: 'ver-1',
        providerId: null,
        identityBasis: 'NATIONAL_ID' as any,
        issuingCountry: 'ZA',
        identifierHash: null,
        identifierLast4: null,
        identifierPlaintext: null,
        documents: [],
        webhookCallbackUrl: 'https://app.test/cb',
        livenessReturnUrl: 'https://app.test/r',
      })
      expect(a.vendorReference).toMatch(/^pap-[0-9a-f-]{36}$/)
      expect(a.expectsWebhook).toBe(true)
      expect(a.immediateResult).toBeUndefined()
    })

    it('generates distinct partner_job_ids across calls', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const r = await smileIdVerificationAdapter.submitDocumentCheck({
          verificationId: `ver-${i}`, providerId: null,
          identityBasis: 'NATIONAL_ID' as any, issuingCountry: 'ZA',
          identifierHash: null, identifierLast4: null, identifierPlaintext: null,
          documents: [], webhookCallbackUrl: 'x', livenessReturnUrl: 'x',
        })
        ids.add(r.vendorReference)
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('createLivenessSession', () => {
    it('throws when submittedVendorReference is null', async () => {
      await expect(smileIdVerificationAdapter.createLivenessSession!({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        returnUrl: 'https://app.test/r',
        submittedVendorReference: null,
        webhookCallbackUrl: 'https://app.test/cb',
      })).rejects.toThrow(/submittedVendorReference/)
    })

    it('calls createSmileLink with input.submittedVendorReference as partnerJobId', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          link_url: 'https://links.smileidentity.com/ABC',
          ref_id: 'link-ref-1',
          disabled_at: null,
          id_types: [],
          expires_at: '2026-05-27T11:00:00.000Z',
        }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const r = await smileIdVerificationAdapter.createLivenessSession!({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        returnUrl: 'https://app.test/r',
        submittedVendorReference: 'pap-job-1',
        webhookCallbackUrl: 'https://app.test/cb',
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.partner_params.job_id).toBe('pap-job-1')
      expect(body.callback_url).toBe('https://app.test/cb')
      expect(body.id_types[0].id_type).toBe('IDENTITY_CARD')

      expect(r.vendorReference).toBe('link-ref-1')
      expect(r.sessionUrl).toBe('https://links.smileidentity.com/ABC')
      expect(r.expiresAt).toBeInstanceOf(Date)
    })
  })

  describe('parseWebhook', () => {
    it('delegates to parseSmileWebhook', async () => {
      const { computeSmileSignature, currentIsoTimestamp } = await import(
        '../../../../../lib/identity-verification/vendors/smile-id/signing'
      )
      const timestamp = currentIsoTimestamp()
      const signature = computeSmileSignature(timestamp)
      const rawBody = JSON.stringify({
        timestamp, signature,
        SmileJobID: 'smile-x',
        ResultCode: '0810',
        IsFinalResult: 'true',
        PartnerParams: { user_id: 'u', job_id: 'pap', job_type: 11, verification_id: 'v' },
        Actions: { Liveness_Check: 'Passed' },
      })
      const r = await smileIdVerificationAdapter.parseWebhook({ headers: {}, rawBody })
      expect(r.signatureValid).toBe(true)
      expect(r.result?.decision).toBe('PASS')
      expect(r.vendorReference).toBe('pap')
    })

    it('rejects stale timestamps (older than freshness window)', async () => {
      // Security: in-body HMAC scheme doesn't cover the body, so an attacker
      // with a captured valid (timestamp, signature) pair could replay it.
      // Mitigation: enforce 5-minute freshness window in the adapter parser.
      const { computeSmileSignature } = await import(
        '../../../../../lib/identity-verification/vendors/smile-id/signing'
      )
      const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString()  // 6 min ago
      const signature = computeSmileSignature(staleTimestamp)
      const rawBody = JSON.stringify({
        timestamp: staleTimestamp, signature,
        SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
        Actions: { Liveness_Check: 'Passed' },
      })
      const r = await smileIdVerificationAdapter.parseWebhook({ headers: {}, rawBody })
      // Signature is cryptographically valid but timestamp is stale → signatureValid:false
      expect(r.signatureValid).toBe(false)
    })

    it('accepts fresh timestamps within the 5-minute window', async () => {
      const { computeSmileSignature, currentIsoTimestamp } = await import(
        '../../../../../lib/identity-verification/vendors/smile-id/signing'
      )
      const timestamp = currentIsoTimestamp()
      const signature = computeSmileSignature(timestamp)
      const rawBody = JSON.stringify({
        timestamp, signature,
        SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
        Actions: { Liveness_Check: 'Passed' },
      })
      const r = await smileIdVerificationAdapter.parseWebhook({ headers: {}, rawBody })
      expect(r.signatureValid).toBe(true)
    })

    it('rejects future timestamps beyond 1 minute skew tolerance', async () => {
      // The freshness guard rejects timestamps more than 1 minute in the future
      // to prevent an attacker from extending the window by forging a future ts.
      const { computeSmileSignature } = await import(
        '../../../../../lib/identity-verification/vendors/smile-id/signing'
      )
      const futureTimestamp = new Date(Date.now() + 90 * 1000).toISOString()  // 90s in future
      const signature = computeSmileSignature(futureTimestamp)
      const rawBody = JSON.stringify({
        timestamp: futureTimestamp, signature,
        SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
        Actions: { Liveness_Check: 'Passed' },
      })
      const r = await smileIdVerificationAdapter.parseWebhook({ headers: {}, rawBody })
      expect(r.signatureValid).toBe(false)
    })
  })

  describe('cancelVerificationJob', () => {
    it('returns supported=false without HTTP when livenessSessionReference is null', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const r = await smileIdVerificationAdapter.cancelVerificationJob({
        verificationId: 'ver-1',
        vendorReference: 'pap-job-1',
        livenessSessionReference: null,
        reason: 'PROVIDER_WITHDREW_CONSENT',
      })
      expect(r.supported).toBe(false)
      expect(r.vendorAcknowledged).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('PUTs to /v1/smile_links/:refId with is_disabled when ref present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)

      const r = await smileIdVerificationAdapter.cancelVerificationJob({
        verificationId: 'ver-1',
        vendorReference: 'pap-job-1',
        livenessSessionReference: 'link-ref-1',
        reason: 'PROVIDER_WITHDREW_CONSENT',
      })
      expect(r.supported).toBe(true)
      expect(r.vendorAcknowledged).toBe(true)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.is_disabled).toBe(true)
    })
  })
})
