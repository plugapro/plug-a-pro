import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { guardPaymentSuccessWebhook } from '@/lib/payments/webhook-guards'

describe('guardPaymentSuccessWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unknown_booking when no Payment row matches bookingId', async () => {
    mockDb.payment.findUnique.mockResolvedValue(null)

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50000 })

    expect(result).toEqual({ outcome: 'unknown_booking' })
  })

  it('returns proceed when the amount matches and the payment is not yet PAID', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      amount: 500, // rand
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50000 })

    expect(result).toEqual({ outcome: 'proceed' })
  })

  it('returns amount_mismatch when the received amount differs by more than 1 cent', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      amount: 500,
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 49000 })

    expect(result).toEqual({
      outcome: 'amount_mismatch',
      storedAmountCents: 50000,
      receivedAmountCents: 49000,
    })
  })

  // I-3 regression: Math.abs(NaN - stored) > tolerance is FALSE, so without an
  // explicit finiteness check a malformed/non-numeric provider amount would
  // silently pass the guard.
  it('returns amount_mismatch (not proceed) when the received amount is NaN', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      amount: 500,
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: Number('not-a-number') })

    expect(result.outcome).toBe('amount_mismatch')
  })

  it('returns amount_mismatch when the received amount is Infinity', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      amount: 500,
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: Infinity })

    expect(result.outcome).toBe('amount_mismatch')
  })

  it('returns duplicate (with the confirmation sentinel) when the payment is already PAID', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PAID',
      amount: 500,
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50000 })

    expect(result).toEqual({ outcome: 'duplicate', bookingConfirmationSentAt: null })
  })

  it('amount check is within ±1 cent tolerance (rounding-safe)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      amount: 500,
      bookingConfirmationSentAt: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50001 })

    expect(result.outcome).toBe('proceed')
  })
})
