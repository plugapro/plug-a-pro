import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockDb,
  mockCheckPayAtGoLimit,
  mockCancelPayAtGoBookingPaymentRequest,
  mockMapPayAtGoErrorToHttpStatus,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockCheckPayAtGoLimit: vi.fn(),
  mockCancelPayAtGoBookingPaymentRequest: vi.fn(),
  mockMapPayAtGoErrorToHttpStatus: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkPayAtGoLimit: mockCheckPayAtGoLimit,
}))

vi.mock('@/lib/payat-go', () => ({
  cancelPayAtGoBookingPaymentRequest: mockCancelPayAtGoBookingPaymentRequest,
  mapPayAtGoErrorToUserMessage: () => 'We could not start the payment request. Please try again.',
  mapPayAtGoErrorToHttpStatus: mockMapPayAtGoErrorToHttpStatus,
}))

describe('POST /api/payat-go/booking/[bookingId]/cancel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockCheckPayAtGoLimit.mockResolvedValue({ ok: true })
    mockMapPayAtGoErrorToHttpStatus.mockReturnValue(502)
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/cancel/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/cancel', { method: 'POST' }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(401)
  })

  it('returns 403 when customer does not own booking', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-2' } },
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/cancel/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/cancel', { method: 'POST' }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockCancelPayAtGoBookingPaymentRequest).not.toHaveBeenCalled()
  })

  it('returns 429 when cancel endpoint is rate-limited', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })
    mockCheckPayAtGoLimit.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterMs: 3000,
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/cancel/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/cancel', { method: 'POST' }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
    expect(mockCancelPayAtGoBookingPaymentRequest).not.toHaveBeenCalled()
  })

  it('returns 200 when cancellation succeeds', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })
    mockCancelPayAtGoBookingPaymentRequest.mockResolvedValue({
      bookingId: 'booking-1',
      paymentId: 'payment-1',
      status: 'CANCELLED',
      rawProviderStatus: 'PAYMENT_CANCELLED',
      cancelledAt: new Date('2026-05-23T10:00:00.000Z'),
      providerClientAccountNumber: '12345678901234',
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/cancel/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/cancel', { method: 'POST' }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockCancelPayAtGoBookingPaymentRequest).toHaveBeenCalledWith('booking-1')
  })

  it('uses mapped error status when cancellation fails', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })
    mockMapPayAtGoErrorToHttpStatus.mockReturnValue(400)
    mockCancelPayAtGoBookingPaymentRequest.mockRejectedValue(new Error('validation'))

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/cancel/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/cancel', { method: 'POST' }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(400)
  })
})
