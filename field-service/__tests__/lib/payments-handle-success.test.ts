import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClaimOpsQueueItem,
  mockTx,
  mockDb,
} = vi.hoisted(() => {
  const tx = {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      update: vi.fn(),
    },
    bookingStatusEvent: {
      create: vi.fn(),
    },
  }

  return {
    mockClaimOpsQueueItem: vi.fn(),
    mockTx: tx,
    mockDb: {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<void>) => callback(tx)),
    },
  }
})

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/ops-queue', () => ({
  OPS_QUEUE_TYPES: {
    PAYMENT_FOLLOW_UP: 'PAYMENT_FOLLOW_UP',
  },
  claimOpsQueueItem: mockClaimOpsQueueItem,
}))

vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerPaymentFailed: vi.fn(),
}))

describe('handlePaymentSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not re-schedule a cancelled booking and queues manual follow-up', async () => {
    mockTx.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      booking: { status: 'CANCELLED' },
    })
    mockTx.payment.update.mockResolvedValue({})
    mockClaimOpsQueueItem.mockResolvedValue({})

    const { handlePaymentSuccess } = await import('@/lib/payments')
    await handlePaymentSuccess({
      type: 'payment.success',
      bookingId: 'booking-1',
      pspReference: 'psp-ref-1',
      amount: 10000,
      currency: 'ZAR',
      raw: { provider: 'payat-go' },
    })

    expect(mockTx.payment.update).toHaveBeenCalledTimes(1)
    expect(mockTx.booking.update).not.toHaveBeenCalled()
    expect(mockTx.bookingStatusEvent.create).not.toHaveBeenCalled()
    expect(mockClaimOpsQueueItem).toHaveBeenCalledTimes(1)
  })

  it('schedules booking when booking status is active', async () => {
    mockTx.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      booking: { status: 'SCHEDULED' },
    })
    mockTx.payment.update.mockResolvedValue({})
    mockTx.booking.update.mockResolvedValue({})
    mockTx.bookingStatusEvent.create.mockResolvedValue({})

    const { handlePaymentSuccess } = await import('@/lib/payments')
    await handlePaymentSuccess({
      type: 'payment.success',
      bookingId: 'booking-2',
      pspReference: 'psp-ref-2',
      amount: 5000,
      currency: 'ZAR',
      raw: { provider: 'payat-go' },
    })

    expect(mockTx.booking.update).toHaveBeenCalledTimes(1)
    expect(mockTx.bookingStatusEvent.create).toHaveBeenCalledTimes(1)
    expect(mockClaimOpsQueueItem).not.toHaveBeenCalled()
  })
})
