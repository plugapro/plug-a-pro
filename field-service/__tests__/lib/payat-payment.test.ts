import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPayatToken, mockInvalidatePayatToken } = vi.hoisted(() => ({
  mockGetPayatToken: vi.fn(),
  mockInvalidatePayatToken: vi.fn(),
}))

vi.mock('@/lib/payat/token', () => ({
  getPayatToken: mockGetPayatToken,
  invalidatePayatToken: mockInvalidatePayatToken,
}))

describe('Pay@ payment request service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/api/v1')
    vi.stubEnv('PAYAT_MERCHANT_ID', '418856')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://plug-a-pro-main.vercel.app')
    mockGetPayatToken.mockResolvedValue('payat-token')
  })

  it('posts a Pay@ payment request and returns provider-facing payment links', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => ({
        qrCodeUrl: 'https://go.payat.co.za/qr/ref-1',
        paymentLink: 'https://go.payat.co.za/pay/ref-1',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    const result = await createPayatPaymentRequest({
      topupId: 'intent-1',
      amountCents: 10_000,
      description: 'Plug A Pro wallet top-up R100',
    })

    expect(result).toEqual({
      reference: 'intent-1',
      qrCodeUrl: 'https://go.payat.co.za/qr/ref-1',
      paymentLink: 'https://go.payat.co.za/pay/ref-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://go.payat.co.za/api/v1/payment-request',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer payat-token',
          'Content-Type': 'application/json',
        },
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      merchantId: '418856',
      amount: 10_000,
      reference: 'intent-1',
      description: 'Plug A Pro wallet top-up R100',
      notifyUrl: 'https://plug-a-pro-main.vercel.app/api/payat/webhook',
    })
  })

  it('invalidates the token and retries once after a Pay@ 401 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false, text: async () => 'expired token' })
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({
          qrCodeUrl: 'https://go.payat.co.za/qr/ref-2',
          paymentLink: 'https://go.payat.co.za/pay/ref-2',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')
    await expect(createPayatPaymentRequest({
      topupId: 'intent-2',
      amountCents: 20_000,
      description: 'Plug A Pro wallet top-up R200',
    })).resolves.toMatchObject({ reference: 'intent-2' })

    expect(mockInvalidatePayatToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported provider top-up amounts before calling Pay@', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const { createPayatPaymentRequest } = await import('@/lib/payat/payment')

    await expect(createPayatPaymentRequest({
      topupId: 'intent-3',
      amountCents: 15_000,
      description: 'Plug A Pro wallet top-up R150',
    })).rejects.toThrow('Invalid top-up amount')
    expect(fetch).not.toHaveBeenCalled()
  })
})
