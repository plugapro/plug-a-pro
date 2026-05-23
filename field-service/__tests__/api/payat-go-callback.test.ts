import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRefreshByAccount } = vi.hoisted(() => ({
  mockRefreshByAccount: vi.fn(),
}))

vi.mock('@/lib/payat-go', () => ({
  refreshPayAtGoBookingPaymentStatusByClientAccountNumber: mockRefreshByAccount,
  mapPayAtGoErrorToUserMessage: () => 'We could not start the payment request. Please try again.',
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

    expect(response.status).toBe(200)
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
})
