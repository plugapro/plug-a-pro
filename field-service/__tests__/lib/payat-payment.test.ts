import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPayatToken, mockInvalidatePayatToken } = vi.hoisted(() => ({
  mockGetPayatToken: vi.fn(),
  mockInvalidatePayatToken: vi.fn(),
}))

vi.mock('@/lib/payat/token', () => ({
  getPayatToken: mockGetPayatToken,
  invalidatePayatToken: mockInvalidatePayatToken,
}))

const BASE = 'https://go.payat.co.za/yapi/v1'

const validRtpResponse = {
  requestToPayId: 99001,
  sourceReference: 'PAT-RETAIL-001',
  paymentLink: 'https://go.payat.co.za/pay/abc123',
}

describe('Pay@ merchant RTP payment service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_API_BASE', BASE)
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'plug-a-pro')
    mockGetPayatToken.mockResolvedValue('test-bearer-token')
  })

  it('calls /merchant/rtp/create/single — no generatecredentials, no merchant ID in path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => validRtpResponse,
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await createPayatPaymentRequest({
      topupId: 'intent-xyz',
      amountCents: 10_000,
      description: 'Plug A Pro wallet top-up R100',
      providerName: 'Jacob Dlamini',
      providerPhone: '+27821234567',
      providerEmail: 'jacob@example.com',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/integrator/rtp/create/single/plug-a-pro`)
    expect(fetchMock.mock.calls.every((c: unknown[]) =>
      !String(c[0]).includes('generatecredentials'),
    )).toBe(true)
  })

  it('sends correct headers and body shape to the merchant endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => validRtpResponse,
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await createPayatPaymentRequest({
      topupId: 'intent-body-check',
      amountCents: 20_000,
      description: 'Plug A Pro wallet top-up R200',
      providerName: 'Thabo Nkosi',
      providerPhone: '+27829876543',
      providerEmail: 'thabo@example.com',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/integrator/rtp/create/single/plug-a-pro`)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit & { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer test-bearer-token')
    expect((init as RequestInit & { headers: Record<string, string> }).headers['Content-Type']).toBe('application/json')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      amount: 20_000,
      minimumAmount: 20_000,
      maximumAmount: 20_000,
      description: 'Plug A Pro wallet top-up R200',
      clientReferenceNumber: 'intent-body-check',
      merchantDisplayName: 'Plug A Pro',
      notificationNumber: '+27829876543',
      customerNameSurname: 'Thabo Nkosi',
      customerMobileNumber: '+27829876543',
      customerEmail: 'thabo@example.com',
      daysValid: 3,
    })
    // clientAccountNumber must be a 14-digit numeric string
    expect(body.clientAccountNumber).toMatch(/^\d{14}$/)
    // amount must be a number (integer cents), NOT a string
    expect(typeof body.amount).toBe('number')
    // daysValid must be a number
    expect(typeof body.daysValid).toBe('number')
  })

  it('returns { reference, sourceReference, requestToPayId, paymentLink } on success', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => validRtpResponse,
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-return-check',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'Provider',
      providerPhone: '+27821234567',
      providerEmail: 'p@example.com',
    })

    expect(result).toEqual({
      reference: 'intent-return-check',
      sourceReference: 'PAT-RETAIL-001',
      requestToPayId: 99001,
      paymentLink: 'https://go.payat.co.za/pay/abc123',
    })
  })

  it('throws rtp_response_invalid when paymentLink is absent (paymentLink is required on integrator endpoint)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => ({ requestToPayId: 99002, sourceReference: 'PAT-RETAIL-002' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-no-link',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'Provider',
        providerPhone: '+27821234567',
        providerEmail: 'p@example.com',
      }),
    ).rejects.toMatchObject({ name: 'PayatApiError', stage: 'rtp_response_invalid' })
  })

  it('accepts Pay@ snake_case aliases (source_reference, request_to_pay_id) alongside paymentLink', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => ({
        request_to_pay_id: 99003,
        source_reference: 'PAT-RETAIL-003',
        paymentLink: 'https://go.payat.co.za/pay/snake-case',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-snake',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'Provider',
      providerPhone: '+27821234567',
      providerEmail: 'p@example.com',
    })

    expect(result.sourceReference).toBe('PAT-RETAIL-003')
    expect(result.requestToPayId).toBe(99003)
    expect(result.paymentLink).toBe('https://go.payat.co.za/pay/snake-case')
  })

  it('invalidates token and retries once on Pay@ 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 201, ok: true, json: async () => validRtpResponse })
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
    expect(result.reference).toBe('intent-401')
    // 401 attempt + one retry = 2 calls total, no generatecredentials
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((c: unknown[]) =>
      !String(c[0]).includes('generatecredentials'),
    )).toBe(true)
  })

  it('throws PayatConfigError when PAYAT_API_BASE is missing', async () => {
    vi.stubEnv('PAYAT_API_BASE', '')
    vi.stubGlobal('fetch', vi.fn())

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-cfg-missing',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'D',
        providerPhone: '+27821234567',
        providerEmail: 'd@d.com',
      }),
    ).rejects.toThrow('PAYAT_API_BASE')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws PayatConfigError when PAYAT_MERCHANT_IDENTIFIER is missing', async () => {
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', '')
    vi.stubGlobal('fetch', vi.fn())

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-no-merchant-id',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'D',
        providerPhone: '+27821234567',
        providerEmail: 'd@d.com',
      }),
    ).rejects.toThrow('PAYAT_MERCHANT_IDENTIFIER')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('succeeds with only paymentLink — sourceReference is optional on integrator endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => ({ paymentLink: 'https://go.payat.co.za/pay/abc' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-no-src-ref',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'E',
      providerPhone: '+27821234567',
      providerEmail: 'e@e.com',
    })

    expect(result.paymentLink).toBe('https://go.payat.co.za/pay/abc')
    expect(result.sourceReference).toBeUndefined()
    expect(result.requestToPayId).toBeUndefined()
  })

  it('succeeds with non-numeric requestToPayId — requestToPayId is optional on integrator endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => ({
        requestToPayId: 'rtp-string-id',
        paymentLink: 'https://go.payat.co.za/pay/abc2',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-bad-id',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'F',
      providerPhone: '+27821234567',
      providerEmail: 'f@f.com',
    })

    expect(result.paymentLink).toBe('https://go.payat.co.za/pay/abc2')
    expect(result.requestToPayId).toBeUndefined()
  })

  it('sends customerEmail in request body even when providerEmail is empty string', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: async () => validRtpResponse,
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await createPayatPaymentRequest({
      topupId: 'intent-no-email',
      amountCents: 10_000,
      description: 'R100',
      providerName: 'No Email',
      providerPhone: '+27821234567',
      providerEmail: '',
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    // Always send customerEmail — integrator endpoint rejects when the field is absent entirely.
    expect(body).toHaveProperty('customerEmail', '')
  })

  it('throws PayatApiError(rtp_create_failed) when Pay@ returns 403', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 403,
      ok: false,
      text: async () => 'Forbidden',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-403',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'G',
        providerPhone: '+27821234567',
        providerEmail: 'g@g.com',
      }),
    ).rejects.toMatchObject({ name: 'PayatApiError', stage: 'rtp_create_failed', status: 403 })
  })

  it('throws PayatApiError(rtp_create_failed) when fetch throws before a response', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(
      createPayatPaymentRequest({
        topupId: 'intent-fetch-throw',
        amountCents: 10_000,
        description: 'R100',
        providerName: 'H',
        providerPhone: '+27821234567',
        providerEmail: 'h@h.com',
      }),
    ).rejects.toMatchObject({ name: 'PayatApiError', stage: 'rtp_create_failed' })
  })
})
