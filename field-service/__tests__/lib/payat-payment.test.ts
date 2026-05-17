import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPayatToken, mockInvalidatePayatToken } = vi.hoisted(() => ({
  mockGetPayatToken: vi.fn(),
  mockInvalidatePayatToken: vi.fn(),
}))

vi.mock('@/lib/payat/token', () => ({
  getPayatToken: mockGetPayatToken,
  invalidatePayatToken: mockInvalidatePayatToken,
}))

describe('Pay@ YAPI payment request service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/yapi/v1')
    vi.stubEnv('PAYAT_MERCHANT_ID', '418856')
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'plug-a-pro')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.plugapro.co.za')
    mockGetPayatToken.mockResolvedValue('payat-token')
  })

  it('registers merchantIdentifier then creates RTP with correct YAPI fields', async () => {
    const fetchMock = vi
      .fn()
      // First call: generatecredentials (registration)
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => '{}' })
      // Second call: RTP creation
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({
          requestToPayId: 'rtp-123',
          paymentLink: 'https://go.payat.co.za/pay/rtp-123',
          sourceReference: 'src-ref-123',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-abc',
      amountCents: 10_000,
      description: 'Plug A Pro wallet top-up R100',
      providerName: 'Jacob Dlamini',
      providerPhone: '+27821234567',
      providerEmail: 'jacob@example.com',
    })

    expect(result).toEqual({
      reference: 'intent-abc',
      paymentLink: 'https://go.payat.co.za/pay/rtp-123',
    })

    // First fetch: registration
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://go.payat.co.za/yapi/v1/integrator/ecommerce/generatecredentials',
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      merchantIdentifier: 'plug-a-pro',
      merchantId: '418856',
    })

    // Second fetch: RTP creation
    const rtpUrl = fetchMock.mock.calls[1][0]
    expect(rtpUrl).toBe(
      'https://go.payat.co.za/yapi/v1/integrator/ecommerce/rtp/create/single/plug-a-pro',
    )
    const rtpBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(rtpBody).toMatchObject({
      amount: '10000',
      minimumAmount: '10000',
      maximumAmount: '10000',
      description: 'Plug A Pro wallet top-up R100',
      clientReferenceNumber: 'intent-abc',
      merchantDisplayName: 'Plug A Pro',
      notificationNumber: '+27821234567',
      customerNameSurname: 'Jacob Dlamini',
      customerMobileNumber: '+27821234567',
      customerEmail: 'jacob@example.com',
      daysValid: '3',
      merchantEcommerceStoreName: 'PLUGAPRO',
      successReturnUrl: 'https://app.plugapro.co.za/provider/credits?topup=success',
      failureReturnUrl: 'https://app.plugapro.co.za/provider/credits?topup=failed',
      multiPremium: 1,
    })
    // clientAccountNumber must be a 14-digit numeric string
    expect(rtpBody.clientAccountNumber).toMatch(/^\d{14}$/)
    // lineItems must match amount
    expect(rtpBody.lineItems).toEqual([
      { description: 'Plug A Pro wallet top-up R100', amount: '10000' },
    ])
  })

  it('calls generatecredentials once per warm instance (TTL-cached, idempotent)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => '{}',
        json: async () => ({ paymentLink: 'https://go.payat.co.za/pay/rtp-x' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await createPayatPaymentRequest({
      topupId: 'i1',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'A',
      providerPhone: '+27821234567',
      providerEmail: 'a@a.com',
    })
    await createPayatPaymentRequest({
      topupId: 'i2',
      amountCents: 20_000,
      description: 'R200',
      providerName: 'A',
      providerPhone: '+27821234567',
      providerEmail: 'a@a.com',
    })

    // Registration is cached for 1 hour — only called once per warm instance.
    // Subsequent RTPs within the TTL skip the generatecredentials round-trip.
    const regCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('generatecredentials'),
    )
    expect(regCalls).toHaveLength(1)
  })

  it('proceeds if generatecredentials returns 409 (already registered)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 409, ok: false, text: async () => 'Conflict' })
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ paymentLink: 'https://go.payat.co.za/pay/rtp-y' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-409',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'B',
      providerPhone: '+27821234567',
      providerEmail: 'b@b.com',
    })
    expect(result.paymentLink).toBe('https://go.payat.co.za/pay/rtp-y')
  })

  it('invalidates token and retries once on Pay@ 401', async () => {
    const fetchMock = vi
      .fn()
      // registration — first attempt (sets merchant cache for this instance)
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => '{}' })
      // RTP attempt 1: 401
      .mockResolvedValueOnce({ status: 401, ok: false, text: async () => 'expired' })
      // RTP attempt 2: success — merchant cache still valid, no second registration call
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ paymentLink: 'https://go.payat.co.za/pay/rtp-retry' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-401',
      amountCents: 20_000,
      description: 'R200',
      providerName: 'C',
      providerPhone: '+27821234567',
      providerEmail: 'c@c.com',
    })

    expect(mockInvalidatePayatToken).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ reference: 'intent-401' })
  })

  it('rejects unsupported top-up amounts before any network call', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-bad',
        amountCents: 15_000,
        description: 'R150',
        providerName: 'D',
        providerPhone: '+27821234567',
        providerEmail: 'd@d.com',
      }),
    ).rejects.toThrow('Invalid top-up amount')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws if Pay@ RTP response does not contain paymentLink', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => '{}' })
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ requestToPayId: 'rtp-no-link' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-no-link',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'E',
        providerPhone: '+27821234567',
        providerEmail: 'e@e.com',
      }),
    ).rejects.toThrow('paymentLink')
  })
})
