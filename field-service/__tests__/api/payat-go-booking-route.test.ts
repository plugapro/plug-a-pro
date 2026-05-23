import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockDb,
  mockCreateBookingPaymentRequest,
  mockCheckPayAtGoLimit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockCreateBookingPaymentRequest: vi.fn(),
  mockCheckPayAtGoLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/payat-go', () => ({
  createPayAtGoBookingPaymentRequest: mockCreateBookingPaymentRequest,
  mapPayAtGoErrorToUserMessage: () => 'We could not start the payment request. Please try again.',
  mapPayAtGoErrorToHttpStatus: () => 502,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkPayAtGoLimit: mockCheckPayAtGoLimit,
}))

describe('POST /api/payat-go/booking/[bookingId]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockCheckPayAtGoLimit.mockResolvedValue({ ok: true })
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mockCreateBookingPaymentRequest).not.toHaveBeenCalled()
  })

  it('returns 403 when booking does not belong to the customer', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-2' } },
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockCreateBookingPaymentRequest).not.toHaveBeenCalled()
  })

  it('returns 429 when create endpoint is rate-limited', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })
    mockCheckPayAtGoLimit.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterMs: 2000,
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(429)
    expect(mockCreateBookingPaymentRequest).not.toHaveBeenCalled()
    expect(response.headers.get('Retry-After')).toBe('2')
  })

  it('rejects tampered amount when request amount differs from server booking amount', async () => {
    mockDb.booking.findUnique
      .mockResolvedValueOnce({
        match: { jobRequest: { customerId: 'customer-1' } },
      })
      .mockResolvedValueOnce({
        quote: { amount: 250 },
        match: {
          jobRequest: {
            customer: {
              name: 'Customer One',
              phone: '+27831234567',
              email: '[email protected]',
            },
          },
        },
      })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 100 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(409)
    expect(mockCreateBookingPaymentRequest).not.toHaveBeenCalled()
  })

  it('uses server-side booking quote amount when creating payment request', async () => {
    mockDb.booking.findUnique
      .mockResolvedValueOnce({
        match: { jobRequest: { customerId: 'customer-1' } },
      })
      .mockResolvedValueOnce({
        quote: { amount: 250.5 },
        match: {
          jobRequest: {
            customer: {
              name: 'Customer One',
              phone: '+27831234567',
              email: '[email protected]',
            },
          },
        },
      })

    mockCreateBookingPaymentRequest.mockResolvedValue({
      paymentId: 'payment-1',
      bookingId: 'booking-1',
      status: 'SENT',
      paymentLink: 'https://pay/1',
      payAtReference: 'PAT-001',
      providerPaymentRequestId: 123,
      providerClientAccountNumber: '12345678901234',
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      amountCents: 25050,
      currency: 'ZAR',
      whatsappMessage: 'mock',
      reusedExisting: false,
    })

    const { POST } = await import('@/app/api/payat-go/booking/[bookingId]/route')
    const response = await POST(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(201)
    expect(mockCreateBookingPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        amountCents: 25050,
        currency: 'ZAR',
      }),
    )
  })
})
