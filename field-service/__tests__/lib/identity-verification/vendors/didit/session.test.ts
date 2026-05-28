import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DiditApiError,
  postSession,
} from '../../../../../lib/identity-verification/vendors/didit/client'
import {
  resetDiditConfigCacheForTests,
} from '../../../../../lib/identity-verification/vendors/didit/config'
import { createDiditSession } from '../../../../../lib/identity-verification/vendors/didit/session'

const WORKFLOW_AUTH = 'wf-auth-uuid'
const WORKFLOW_BASIC = 'wf-basic-uuid'

function mockFetchOnce(body: unknown, init: { status?: number } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    return new Response(JSON.stringify(body), { status: init.status ?? 200 })
  })
}

describe('createDiditSession', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'sk_test_didit')
    vi.stubEnv('DIDIT_BASE_URL', 'https://verification.didit.me')
    vi.stubEnv('DIDIT_WEBHOOK_SECRET', 'shared-secret')
    vi.stubEnv('DIDIT_PROVIDER_KYC_WORKFLOW_ID', WORKFLOW_BASIC)
    vi.stubEnv('DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID', WORKFLOW_AUTH)
    resetDiditConfigCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetDiditConfigCacheForTests()
  })

  it('defaults to KYC_AUTHORITATIVE workflow id and threads vendor_data + callback (spec §6.1)', async () => {
    const fetchSpy = mockFetchOnce({
      session_id: 'sess-abc',
      url: 'https://verification.didit.me/session/sess-abc',
      status: 'Not Started',
    })

    const result = await createDiditSession({
      verificationId: 'ver-123',
      providerId: 'prov-456',
      returnUrl: 'https://app.plugapro.com/provider/verify/tok-1/liveness/complete',
      submittedVendorReference: 'didit-pre:abcdef',
      webhookCallbackUrl: 'https://app.plugapro.com/api/webhooks/verification/didit',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://verification.didit.me/v3/session/')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('sk_test_didit')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.workflow_id).toBe(WORKFLOW_AUTH)
    expect(body.vendor_data).toBe('ver-123')
    expect(body.callback).toBe('https://app.plugapro.com/provider/verify/tok-1/liveness/complete')
    expect(body.metadata.workflow_profile).toBe('KYC_AUTHORITATIVE')

    expect(result.vendorReference).toBe('sess-abc')
    expect(result.sessionUrl).toBe('https://verification.didit.me/session/sess-abc')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('uses KYC_BASIC workflow id when explicitly requested', async () => {
    const fetchSpy = mockFetchOnce({
      session_id: 'sess-basic',
      url: 'https://verification.didit.me/session/sess-basic',
      status: 'Not Started',
    })

    await createDiditSession(
      {
        verificationId: 'ver-basic',
        providerId: null,
        returnUrl: 'https://app.plugapro.com/callback',
        submittedVendorReference: null,
        webhookCallbackUrl: 'https://app.plugapro.com/api/webhooks/verification/didit',
      },
      { workflowProfile: 'KYC_BASIC' },
    )
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.workflow_id).toBe(WORKFLOW_BASIC)
    expect(body.metadata.workflow_profile).toBe('KYC_BASIC')
  })

  it('throws DiditApiError on non-2xx response without retrying for 4xx', async () => {
    const fetchSpy = mockFetchOnce({ detail: 'invalid workflow_id' }, { status: 400 })

    await expect(
      createDiditSession({
        verificationId: 'ver-fail',
        providerId: null,
        returnUrl: 'https://app.plugapro.com/cb',
        submittedVendorReference: null,
        webhookCallbackUrl: 'https://app.plugapro.com/api/webhooks/verification/didit',
      }),
    ).rejects.toBeInstanceOf(DiditApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to internally-derived expiry when Didit response omits expires_at', async () => {
    mockFetchOnce({
      session_id: 'sess-no-expiry',
      url: 'https://verification.didit.me/session/sess-no-expiry',
      status: 'Not Started',
    })
    const result = await createDiditSession({
      verificationId: 'ver-noexp',
      providerId: null,
      returnUrl: 'https://app.plugapro.com/cb',
      submittedVendorReference: null,
      webhookCallbackUrl: 'https://app.plugapro.com/api/webhooks/verification/didit',
    })
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('retries once on transient 5xx and succeeds on the retry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => new Response('upstream', { status: 502 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({
        session_id: 'sess-retry',
        url: 'https://verification.didit.me/session/sess-retry',
        status: 'Not Started',
      }), { status: 200 }))

    const result = await postSession({ workflow_id: WORKFLOW_AUTH, vendor_data: 'ver-retry' })
    expect(result.session_id).toBe('sess-retry')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
