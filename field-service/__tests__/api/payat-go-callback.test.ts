import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRefreshByAccount, mockCheckPayAtGoLimit } = vi.hoisted(() => ({
  mockRefreshByAccount: vi.fn(),
  mockCheckPayAtGoLimit: vi.fn(),
}))

vi.mock('@/lib/payat-go', () => ({
  refreshPayAtGoBookingPaymentStatusByClientAccountNumber: mockRefreshByAccount,
  mapPayAtGoErrorToUserMessage: () => 'We could not start the payment request. Please try again.',
  mapPayAtGoErrorToHttpStatus: () => 502,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkPayAtGoLimit: mockCheckPayAtGoLimit,
}))

function buildRequest(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/payat-go/callback', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

describe('POST /api/payat-go/callback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mockCheckPayAtGoLimit.mockResolvedValue({ ok: true })
  })

  it('rejects callback when configured secret is missing/invalid', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(buildRequest({ accountNumber: '12345678901234' }))

    expect(response.status).toBe(401)
    expect(mockRefreshByAccount).not.toHaveBeenCalled()
  })

  it('rejects callback when callback secret is not configured', async () => {
    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(buildRequest({ accountNumber: '12345678901234' }))

    expect(response.status).toBe(503)
    expect(mockRefreshByAccount).not.toHaveBeenCalled()
  })

  it('accepts callback with valid secret header and processes refresh', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockRefreshByAccount.mockResolvedValue({
      bookingId: 'booking-1',
      paymentId: 'payment-1',
      status: 'PAID',
      rawProviderStatus: 'PAYMENT_COMPLETED',
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      providerClientAccountNumber: '12345678901234',
    })

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234', amountPaid: 10000 },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(mockRefreshByAccount).toHaveBeenCalledTimes(1)
    expect(mockRefreshByAccount).toHaveBeenCalledWith('12345678901234', expect.any(String))
  })

  it('acknowledges unknown references idempotently', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockRefreshByAccount.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234' },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ received: true, ignored: 'unknown_reference' })
  })

  it('returns 429 when callback processing is rate-limited', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockCheckPayAtGoLimit.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterMs: 5000,
    })

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234' },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(mockRefreshByAccount).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid callback payload JSON', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/callback', {
        method: 'POST',
        body: '{not-json',
        headers: { 'x-payat-go-secret': 'expected-secret' },
      }),
    )

    expect(response.status).toBe(400)
    expect(mockRefreshByAccount).not.toHaveBeenCalled()
  })

  it('returns 400 when callback payload has no account number', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { referenceNumber: 'PAT-001' },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )

    expect(response.status).toBe(400)
    expect(mockRefreshByAccount).not.toHaveBeenCalled()
  })

  it('returns 503 when callback limiter is unavailable', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockCheckPayAtGoLimit.mockResolvedValue({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 7000,
    })

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234' },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('7')
  })

  it('returns 502 mapped error when callback refresh throws', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockRefreshByAccount.mockRejectedValue(new Error('provider_down'))

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234' },
        { 'x-payat-go-secret': 'expected-secret' },
      ),
    )

    expect(response.status).toBe(502)
  })

  it('accepts callback secret via x-callback-secret header', async () => {
    vi.stubEnv('PAYAT_GO_WEBHOOK_SECRET', 'expected-secret')
    mockRefreshByAccount.mockResolvedValue({
      bookingId: 'booking-1',
      paymentId: 'payment-1',
      status: 'PAID',
      rawProviderStatus: 'PAYMENT_COMPLETED',
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      providerClientAccountNumber: '12345678901234',
    })

    const { POST } = await import('@/app/api/payat-go/callback/route')
    const response = await POST(
      buildRequest(
        { accountNumber: '12345678901234' },
        { 'x-callback-secret': 'expected-secret' },
      ),
    )

    expect(response.status).toBe(200)
    expect(mockRefreshByAccount).toHaveBeenCalledTimes(1)
  })
})
