import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSmileLink,
  disableSmileLink,
} from '../../../../../lib/identity-verification/vendors/smile-id/smile-links-client'

const PARTNER_ID = '100'
const API_KEY = 'TEST_KEY'
const BASE_URL = 'https://testapi.smileidentity.com'

describe('Smile Links client', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', API_KEY)
    vi.stubEnv('SMILE_ID_BASE_URL', BASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('createSmileLink', () => {
    it('POSTs to /v1/smile_links with the expected body shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          link_url: 'https://links.smileidentity.com/ABC',
          ref_id: 'link-ref-1',
          disabled_at: null,
          id_types: [{ country: 'ZA', id_type: 'IDENTITY_CARD', verification_method: 'doc_verification' }],
        }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-27T11:00:00.000Z'),
      })

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/smile_links`)
      expect(opts.method).toBe('POST')

      const body = JSON.parse(opts.body as string)
      expect(body.partner_id).toBe(PARTNER_ID)
      expect(typeof body.timestamp).toBe('string')
      expect(typeof body.signature).toBe('string')
      expect(body.source_sdk).toBe('rest_api')
      expect(body.id_types).toEqual([{
        country: 'ZA',
        id_type: 'IDENTITY_CARD',
        verification_method: 'doc_verification',
      }])
      expect(body.callback_url).toBe('https://app.test/api/webhooks/verification/smile_id')
      expect(body.is_single_use).toBe(true)
      expect(body.partner_params).toMatchObject({
        user_id: 'prov-1',
        job_id: 'pap-uuid-1',
        job_type: 11,
        verification_id: 'ver-1',
      })
      expect(body.expires_at).toBe('2026-05-27T11:00:00.000Z')

      expect(result.linkUrl).toBe('https://links.smileidentity.com/ABC')
      expect(result.refId).toBe('link-ref-1')
    })

    it('uses verificationId as user_id when providerId is null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ link_url: 'x', ref_id: 'r', disabled_at: null, id_types: [] }),
      }))
      await createSmileLink({
        verificationId: 'ver-1',
        providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })
      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.partner_params.user_id).toBe('ver-1')
    })

    it('throws SmileApiError on 4xx with status and body', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 400,
        text: async () => '{"code":"2204","error":"missing callback_url"}',
      }))
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/Smile.*400/)
    })

    it('throws when required env vars are unset', async () => {
      vi.unstubAllEnvs()
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/SMILE_ID/)
    })

    it('throws SmileApiError(0) on request timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          const e = new Error('The operation was aborted due to timeout')
          ;(e as Error).name = 'TimeoutError'
          reject(e)
        })
      }))
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/timeout/)
    })

    it('throws SmileApiError when response is missing link_url or ref_id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ link_url: null, ref_id: 'r' }),
      }))
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/unexpected response shape/)
    })
  })

  describe('disableSmileLink', () => {
    it('PUTs to /v1/smile_links/:refId with is_disabled:true and signed body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)

      const result = await disableSmileLink('link-ref-1')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/smile_links/link-ref-1`)
      expect(opts.method).toBe('PUT')

      const body = JSON.parse(opts.body as string)
      expect(body.is_disabled).toBe(true)
      expect(body.partner_id).toBe(PARTNER_ID)
      expect(typeof body.timestamp).toBe('string')
      expect(typeof body.signature).toBe('string')

      expect(result.acknowledged).toBe(true)
    })

    it('returns acknowledged=false on non-2xx', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }))
      const result = await disableSmileLink('link-ref-bogus')
      expect(result.acknowledged).toBe(false)
    })

    it('returns acknowledged=false on timeout (does not throw)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          const e = new Error('aborted')
          ;(e as Error).name = 'TimeoutError'
          reject(e)
        })
      }))
      const result = await disableSmileLink('link-ref-1')
      expect(result.acknowledged).toBe(false)
    })
  })

  describe('base URL validation in production', () => {
    it('rejects an unknown SMILE_ID_BASE_URL when NODE_ENV=production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('SMILE_ID_BASE_URL', 'https://attacker.example.com')
      await expect(createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://plug.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-26T13:00:00.000Z'),
      })).rejects.toThrow(/SMILE_ID_BASE_URL must be one of/)
      await expect(disableSmileLink('link-ref-1'))
        .rejects.toThrow(/SMILE_ID_BASE_URL must be one of/)
    })

    it('accepts live Smile host in production (trailing slash tolerated)', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('SMILE_ID_BASE_URL', 'https://api.smileidentity.com/')
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ link_url: 'https://links.smileidentity.com/X', ref_id: 'r' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://plug.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-26T13:00:00.000Z'),
      })
      expect(result.refId).toBe('r')
    })

    it('rejects sandbox Smile host in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('SMILE_ID_BASE_URL', 'https://testapi.smileidentity.com/')
      await expect(createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://plug.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-26T13:00:00.000Z'),
      })).rejects.toThrow(/Sandbox Smile ID URL not allowed in production/)
      await expect(disableSmileLink('link-ref-1'))
        .rejects.toThrow(/Sandbox Smile ID URL not allowed in production/)
    })

    it('does NOT validate when NODE_ENV is not production', async () => {
      // Defaults to 'test' under vitest; unknown URL should pass through.
      vi.stubEnv('SMILE_ID_BASE_URL', 'http://localhost:9999')
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ link_url: 'https://x/y', ref_id: 'r' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://plug.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-26T13:00:00.000Z'),
      })
      expect(result.refId).toBe('r')
    })
  })
})
