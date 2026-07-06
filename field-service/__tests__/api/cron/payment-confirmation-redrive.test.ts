// SRE-02: cron sweep re-drives PAID payments whose booking confirmation was
// never delivered (sentinel null, < 7 days old, attempts under cap).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendPaidBookingConfirmation } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      findMany: vi.fn(),
    },
  },
  mockSendPaidBookingConfirmation: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/payment-confirmation', () => ({
  MAX_BOOKING_CONFIRMATION_ATTEMPTS: 5,
  sendPaidBookingConfirmation: mockSendPaidBookingConfirmation,
}))

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/payment-confirmation-redrive', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('GET /api/cron/payment-confirmation-redrive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret-test'
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('rejects requests without the cron secret', async () => {
    const { GET } = await import('../../../app/api/cron/payment-confirmation-redrive/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockDb.payment.findMany).not.toHaveBeenCalled()
  })

  it('rejects requests with a wrong secret', async () => {
    const { GET } = await import('../../../app/api/cron/payment-confirmation-redrive/route')
    const res = await GET(makeRequest('wrong'))
    expect(res.status).toBe(401)
  })

  it('rejects all requests when CRON_SECRET is not configured (fail closed)', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('../../../app/api/cron/payment-confirmation-redrive/route')
    const res = await GET(makeRequest('anything'))
    expect(res.status).toBe(401)
  })

  it('sweeps unsent PAID payments and re-drives each via the confirmation helper', async () => {
    mockDb.payment.findMany.mockResolvedValue([
      { bookingId: 'booking-a' },
      { bookingId: 'booking-b' },
      { bookingId: 'booking-c' },
    ])
    mockSendPaidBookingConfirmation
      .mockResolvedValueOnce({ sent: true, outcome: 'sent' })
      .mockResolvedValueOnce({ sent: false, outcome: 'send_failed', failureReason: 'Meta 500' })
      .mockResolvedValueOnce({ sent: false, outcome: 'already_sent' })

    const { GET } = await import('../../../app/api/cron/payment-confirmation-redrive/route')
    const res = await GET(makeRequest('cron-secret-test'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, candidates: 3, sent: 1, failed: 1, skipped: 1 })

    expect(mockDb.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PAID',
          bookingConfirmationSentAt: null,
          bookingConfirmationAttempts: { lt: 5 },
          paidAt: { gte: expect.any(Date) },
        }),
        take: 25,
      }),
    )
    expect(mockSendPaidBookingConfirmation).toHaveBeenCalledTimes(3)
    expect(mockSendPaidBookingConfirmation).toHaveBeenCalledWith('booking-a')

    // The sweep window is 7 days.
    const where = mockDb.payment.findMany.mock.calls[0][0].where
    const cutoffAgeMs = Date.now() - where.paidAt.gte.getTime()
    expect(cutoffAgeMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000)
    expect(cutoffAgeMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000)
  })
})
