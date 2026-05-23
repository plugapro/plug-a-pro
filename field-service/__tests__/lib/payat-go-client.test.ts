import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Pay@Go client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('PAYAT_GO_ENABLED', 'true')
    vi.stubEnv('PAYAT_GO_MOCK_MODE', 'false')
    vi.stubEnv('PAYAT_GO_BASE_URL', 'https://go.payat.co.za/yapi/v1')
    vi.stubEnv('PAYAT_GO_CLIENT_ID', 'client-id')
    vi.stubEnv('PAYAT_GO_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('PAYAT_GO_GRANT_TYPE', 'client_credentials')
    vi.stubEnv('PAYAT_GO_SCOPES', 'rtp:create:single rtp:cancel:single rtp:read')
    vi.stubEnv('PAYAT_GO_RETRY_MAX_ATTEMPTS', '3')
    vi.stubEnv('PAYAT_GO_RETRY_BASE_DELAY_MS', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('acquires OAuth token and caches it across RTP calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ requestToPayId: 1001, sourceReference: 'PAT-1001', paymentLink: 'https://pay/1001' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          accountState: 'PAYMENT_OUTSTANDING',
          amount: 10000,
          amountPaid: 0,
          paymentLink: 'https://pay/1001',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const {
      createPayAtGoSingleRtp,
      readPayAtGoSingleRtp,
    } = await import('@/lib/payat-go/client')

    await createPayAtGoSingleRtp({
      clientReferenceNumber: 'BOOKING-REF-1001',
      amountCents: 10000,
      customerNameSurname: 'Customer One',
      customerMobileNumber: '+27831234567',
      customerEmail: '[email protected]',
    })

    await readPayAtGoSingleRtp('12345678901234')

    // 1 token call + 2 provider API calls
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('https://go.payat.co.za/yapi/oauth/token')
    const tokenCallInit = fetchMock.mock.calls[0][1] as RequestInit
    const tokenBody = String(tokenCallInit.body)
    expect(tokenCallInit.method).toBe('POST')
    expect(tokenBody).toContain('grant_type=client_credentials')
    expect(tokenBody).toContain('client_id=client-id')
    expect(tokenBody).toContain('client_secret=client-secret')
    expect(tokenBody).toContain('scope=rtp%3Acreate%3Asingle+rtp%3Acancel%3Asingle+rtp%3Aread')
  })

  it('creates RTP request successfully', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          requestToPayId: 2002,
          sourceReference: 'PAT-2002',
          paymentLink: 'https://pay/2002',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { createPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    const result = await createPayAtGoSingleRtp({
      clientReferenceNumber: 'BOOKING-REF-2002',
      amountCents: 20000,
      customerNameSurname: 'Customer Two',
      customerMobileNumber: '+27831234567',
    })

    expect(result.requestToPayId).toBe(2002)
    expect(result.sourceReference).toBe('PAT-2002')
    expect(result.paymentLink).toBe('https://pay/2002')
    expect(result.internalStatus).toBe('SENT')
  })

  it('throws provider error when create request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ errorDescription: 'Validation failed' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { createPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    await expect(
      createPayAtGoSingleRtp({
        clientReferenceNumber: 'BOOKING-REF-ERR',
        amountCents: 15000,
        customerNameSurname: 'Customer Three',
      }),
    ).rejects.toMatchObject({ name: 'PayAtGoProviderError', status: 422 })
  })

  it('reads RTP status and maps provider status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          accountState: 'PAYMENT_COMPLETED',
          amount: 10000,
          amountPaid: 10000,
          dateTimePaid: '2026-05-23T10:00:00+02:00',
          dateTimeExpire: '2026-05-25T10:00:00+02:00',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { readPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    const result = await readPayAtGoSingleRtp('12345678901234')

    expect(result.internalStatus).toBe('PAID')
    expect(result.amountPaidCents).toBe(10000)
    expect(result.paidAt).toBeInstanceOf(Date)
  })

  it('cancels RTP successfully', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Request cancelled.' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { cancelPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    const result = await cancelPayAtGoSingleRtp('12345678901234')

    expect(result.internalStatus).toBe('CANCELLED')
    expect(result.message).toBe('Request cancelled.')
  })

  it('supports mock mode status simulation', async () => {
    vi.stubEnv('PAYAT_GO_MOCK_MODE', 'true')
    const { createPayAtGoSingleRtp, readPayAtGoSingleRtp, setPayAtGoMockStatus } = await import('@/lib/payat-go/client')

    const created = await createPayAtGoSingleRtp({
      clientReferenceNumber: 'BOOKING-REF-MOCK',
      amountCents: 10000,
      customerNameSurname: 'Mock Customer',
    })

    setPayAtGoMockStatus(created.clientAccountNumber, 'PAID')
    const status = await readPayAtGoSingleRtp(created.clientAccountNumber)

    expect(status.internalStatus).toBe('PAID')
  })

  it('retries token acquisition on transient provider errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => 'temporarily unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers(),
        text: async () => JSON.stringify({
          requestToPayId: 3003,
          sourceReference: 'PAT-3003',
          paymentLink: 'https://pay/3003',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { createPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    const result = await createPayAtGoSingleRtp({
      clientReferenceNumber: 'BOOKING-REF-3003',
      amountCents: 30000,
      customerNameSurname: 'Customer Retry',
    })

    expect(result.requestToPayId).toBe(3003)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries RTP read on transient status responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => 'gateway timeout',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          accountState: 'PAYMENT_OUTSTANDING',
          amount: 10000,
          amountPaid: 0,
          paymentLink: 'https://pay/1001',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { readPayAtGoSingleRtp } = await import('@/lib/payat-go/client')
    const result = await readPayAtGoSingleRtp('12345678901234')

    expect(result.internalStatus).toBe('SENT')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
