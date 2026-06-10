import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockGetAdminActor,
  mockDb,
  mockRefreshBookingPaymentStatus,
  mockCheckPayAtGoLimit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAdminActor: vi.fn(),
  mockDb: {
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockRefreshBookingPaymentStatus: vi.fn(),
  mockCheckPayAtGoLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  getAdminActor: mockGetAdminActor,
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/payat-go', () => ({
  refreshPayAtGoBookingPaymentStatus: mockRefreshBookingPaymentStatus,
  mapPayAtGoErrorToUserMessage: () => 'Payment is still pending.',
  mapPayAtGoErrorToHttpStatus: () => 502,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkPayAtGoLimit: mockCheckPayAtGoLimit,
}))

describe('GET /api/payat-go/booking/[bookingId]/status', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    // Default: no DB-backed admin actor, so access falls to customer ownership.
    mockGetAdminActor.mockResolvedValue(null)
    mockCheckPayAtGoLimit.mockResolvedValue({ ok: true })
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/payat-go/booking/[bookingId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/status'),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mockRefreshBookingPaymentStatus).not.toHaveBeenCalled()
  })

  it('returns 403 when booking does not belong to the customer', async () => {
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-2' } },
    })

    const { GET } = await import('@/app/api/payat-go/booking/[bookingId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/status'),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockRefreshBookingPaymentStatus).not.toHaveBeenCalled()
  })

  it('returns 429 when status endpoint is rate-limited', async () => {
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })
    mockCheckPayAtGoLimit.mockResolvedValue({
      ok: false,
      code: 'rate_limited',
      retryAfterMs: 4000,
    })

    const { GET } = await import('@/app/api/payat-go/booking/[bookingId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/status'),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('4')
    expect(mockRefreshBookingPaymentStatus).not.toHaveBeenCalled()
  })

  it('rejects mockStatus for non-admin users even when mock mode is enabled', async () => {
    vi.stubEnv('PAYAT_GO_MOCK_MODE', 'true')
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockDb.booking.findUnique.mockResolvedValue({
      match: { jobRequest: { customerId: 'customer-1' } },
    })

    const { GET } = await import('@/app/api/payat-go/booking/[bookingId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/status?mockStatus=PAID'),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockRefreshBookingPaymentStatus).not.toHaveBeenCalled()
  })

  it('allows admin to use mockStatus in mock mode outside production', async () => {
    vi.stubEnv('PAYAT_GO_MOCK_MODE', 'true')
    vi.stubEnv('NODE_ENV', 'test')
    mockGetSession.mockResolvedValue({ id: 'admin-1', role: 'customer' })
    // DB-backed admin actor grants access; the client-writable session role does not.
    mockGetAdminActor.mockResolvedValue({ id: 'admin-1', adminUserId: 'admin-1', adminRole: 'ADMIN' })

    mockRefreshBookingPaymentStatus.mockResolvedValue({
      bookingId: 'booking-1',
      paymentId: 'payment-1',
      status: 'PAID',
      rawProviderStatus: 'PAYMENT_COMPLETED',
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      amountPaidCents: 25050,
      providerClientAccountNumber: '12345678901234',
    })

    const { GET } = await import('@/app/api/payat-go/booking/[bookingId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/payat-go/booking/booking-1/status?mockStatus=PAID'),
      { params: Promise.resolve({ bookingId: 'booking-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockRefreshBookingPaymentStatus).toHaveBeenCalledWith('booking-1', { mockStatus: 'PAID' })
  })
})
