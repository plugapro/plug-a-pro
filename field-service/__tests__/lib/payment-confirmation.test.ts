// SRE-02: the post-payment booking confirmation must be re-drivable.
// sendPaidBookingConfirmation sets a sentinel only on successful send, caps
// attempts, and never throws.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendBookingConfirmation, mockGetJobRequestAccessUrl } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockSendBookingConfirmation: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp', () => ({
  sendBookingConfirmation: mockSendBookingConfirmation,
}))
vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: mockGetJobRequestAccessUrl,
}))

const PAID_UNSENT = {
  status: 'PAID',
  bookingConfirmationSentAt: null,
  bookingConfirmationAttempts: 0,
}

const CONFIRMABLE_BOOKING = {
  id: 'booking-9',
  scheduledDate: new Date('2026-07-10T08:00:00.000Z'),
  scheduledWindow: '09:00-12:00',
  match: {
    jobRequest: {
      id: 'jr-9',
      category: 'plumbing',
      customer: { name: 'Alice', phone: '+27821234567' },
    },
  },
}

describe('sendPaidBookingConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.payment.update.mockResolvedValue({})
    mockGetJobRequestAccessUrl.mockResolvedValue('https://app.example/requests/access/tok')
    mockSendBookingConfirmation.mockResolvedValue(undefined)
  })

  it('returns no_payment when no payment row exists', async () => {
    mockDb.payment.findUnique.mockResolvedValue(null)

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({ sent: false, outcome: 'no_payment' })
    expect(mockSendBookingConfirmation).not.toHaveBeenCalled()
  })

  it('skips when the confirmation was already sent (sentinel set)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      ...PAID_UNSENT,
      bookingConfirmationSentAt: new Date(),
    })

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({ sent: false, outcome: 'already_sent' })
    expect(mockSendBookingConfirmation).not.toHaveBeenCalled()
    expect(mockDb.payment.update).not.toHaveBeenCalled()
  })

  it('skips when the payment is not PAID', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ ...PAID_UNSENT, status: 'PENDING' })

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({ sent: false, outcome: 'not_paid' })
    expect(mockSendBookingConfirmation).not.toHaveBeenCalled()
  })

  it('stops re-driving after the attempt cap', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      ...PAID_UNSENT,
      bookingConfirmationAttempts: 5,
    })

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({ sent: false, outcome: 'attempts_exhausted' })
    expect(mockSendBookingConfirmation).not.toHaveBeenCalled()
    expect(mockDb.payment.update).not.toHaveBeenCalled()
  })

  it('sends the confirmation and records the sentinel on success', async () => {
    mockDb.payment.findUnique.mockResolvedValue(PAID_UNSENT)
    mockDb.booking.findUnique.mockResolvedValue(CONFIRMABLE_BOOKING)

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({ sent: true, outcome: 'sent' })
    expect(mockSendBookingConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-9',
        customerPhone: '+27821234567',
        serviceName: 'plumbing',
        bookingUrl: 'https://app.example/requests/access/tok',
      }),
    )
    // Attempt counted before the send, sentinel written after it.
    expect(mockDb.payment.update).toHaveBeenNthCalledWith(1, {
      where: { bookingId: 'booking-9' },
      data: { bookingConfirmationAttempts: { increment: 1 } },
    })
    expect(mockDb.payment.update).toHaveBeenNthCalledWith(2, {
      where: { bookingId: 'booking-9' },
      data: { bookingConfirmationSentAt: expect.any(Date) },
    })
  })

  it('leaves the sentinel unset (re-drivable) when the send fails, without throwing', async () => {
    mockDb.payment.findUnique.mockResolvedValue(PAID_UNSENT)
    mockDb.booking.findUnique.mockResolvedValue(CONFIRMABLE_BOOKING)
    mockSendBookingConfirmation.mockRejectedValue(new Error('Meta 500'))

    const { sendPaidBookingConfirmation } = await import('@/lib/payment-confirmation')
    const result = await sendPaidBookingConfirmation('booking-9')

    expect(result).toEqual({
      sent: false,
      outcome: 'send_failed',
      failureReason: 'Meta 500',
    })
    // Attempt consumed, but NO sentinel write.
    expect(mockDb.payment.update).toHaveBeenCalledTimes(1)
    expect(mockDb.payment.update).toHaveBeenCalledWith({
      where: { bookingId: 'booking-9' },
      data: { bookingConfirmationAttempts: { increment: 1 } },
    })
  })
})
