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

  it('returns duplicate (with the confirmation sentinel and stored pspReference) when the payment is already PAID', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PAID',
      amount: 500,
      bookingConfirmationSentAt: null,
      pspReference: 'psp-ref-original',
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50000 })

    expect(result).toEqual({
      outcome: 'duplicate',
      bookingConfirmationSentAt: null,
      storedPspReference: 'psp-ref-original',
    })
  })

  // NEW-2b: the caller compares storedPspReference against the incoming
  // event's pspReference to detect a possible double charge (two distinct
  // sessions both succeeded for the same booking) - the guard itself stays
  // pure and just carries the stored value through.
  it('carries a null storedPspReference through when the stored payment has none', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PAID',
      amount: 500,
      bookingConfirmationSentAt: new Date('2026-05-01T08:00:00Z'),
      pspReference: null,
    })

    const result = await guardPaymentSuccessWebhook({ bookingId: 'booking-1', amountCents: 50000 })

    expect(result).toEqual({
      outcome: 'duplicate',
      bookingConfirmationSentAt: new Date('2026-05-01T08:00:00Z'),
      storedPspReference: null,
    })
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
