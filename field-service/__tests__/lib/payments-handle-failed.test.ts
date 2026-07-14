// SRE-01: payment.failed must never clobber a terminal payment, must not
// throw on unknown bookingIds (P2025 → 500 → PSP retry loop), and must keep
// the legitimate-failure path (customer message + ops item) intact.
// CJ-13: in checkout mode the failure message carries a retry checkout link.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockClaimOpsQueueItem,
  mockNotifyCustomerPaymentFailed,
  mockEmitServerConversion,
  mockCheckPilotGate,
  mockResolveAreaScopeByNodeId,
} = vi.hoisted(() => ({
  mockDb: {
    payment: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockClaimOpsQueueItem: vi.fn(),
  mockNotifyCustomerPaymentFailed: vi.fn(),
  mockEmitServerConversion: vi.fn(),
  mockCheckPilotGate: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/ops-queue', () => ({
  OPS_QUEUE_TYPES: { PAYMENT_FOLLOW_UP: 'PAYMENT_FOLLOW_UP' },
  claimOpsQueueItem: mockClaimOpsQueueItem,
}))
vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerPaymentFailed: mockNotifyCustomerPaymentFailed,
}))
vi.mock('@/lib/marketing/server-events', () => ({
  emitServerConversion: mockEmitServerConversion,
}))
vi.mock('@/lib/customer-serviceability', () => ({
  checkPilotGate: mockCheckPilotGate,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
}))
vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

const EVENT = {
  type: 'payment.failed' as const,
  bookingId: 'booking-1',
  pspReference: 'psp-ref-1',
  amount: 45000,
  currency: 'ZAR',
  raw: {},
}

const BOOKING_WITH_CUSTOMER = {
  id: 'booking-1',
  match: {
    jobRequest: {
      category: 'plumbing',
      customer: { phone: '+27821234567' },
      address: { locationNodeId: null },
    },
  },
}

describe('handlePaymentFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYMENT_COLLECTION_MODE
    mockClaimOpsQueueItem.mockResolvedValue({})
    mockNotifyCustomerPaymentFailed.mockResolvedValue({ sent: true })
    mockCheckPilotGate.mockResolvedValue({ ok: true })
    mockResolveAreaScopeByNodeId.mockResolvedValue(null)
  })

  afterEach(() => {
    delete process.env.PAYMENT_COLLECTION_MODE
  })

  it('is a no-op when the payment is already terminal (failed-after-paid)', async () => {
    // Guarded updateMany matched nothing: the payment is PAID/REFUNDED/PARTIALLY_REFUNDED.
    mockDb.payment.updateMany.mockResolvedValue({ count: 0 })

    const { handlePaymentFailed } = await import('@/lib/payments')
    await expect(handlePaymentFailed(EVENT)).resolves.toBeUndefined()

    expect(mockDb.payment.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-1',
        status: { notIn: ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
      },
      data: {
        status: 'FAILED',
        pspReference: 'psp-ref-1',
        failureReason: 'Payment declined',
      },
    })
    // No bogus customer message, no ops item, no conversion event, no booking lookup.
    expect(mockNotifyCustomerPaymentFailed).not.toHaveBeenCalled()
    expect(mockClaimOpsQueueItem).not.toHaveBeenCalled()
    expect(mockEmitServerConversion).not.toHaveBeenCalled()
    expect(mockDb.booking.findUnique).not.toHaveBeenCalled()
  })

  it('does not throw for an unknown bookingId (no P2025 → no PSP retry loop)', async () => {
    mockDb.payment.updateMany.mockResolvedValue({ count: 0 })

    const { handlePaymentFailed } = await import('@/lib/payments')
    await expect(
      handlePaymentFailed({ ...EVENT, bookingId: 'no-such-booking' }),
    ).resolves.toBeUndefined()

    expect(mockNotifyCustomerPaymentFailed).not.toHaveBeenCalled()
    expect(mockClaimOpsQueueItem).not.toHaveBeenCalled()
  })

  it('still notifies the customer and queues ops follow-up on a legitimate failure (bypass mode)', async () => {
    mockDb.payment.updateMany.mockResolvedValue({ count: 1 })
    mockDb.booking.findUnique.mockResolvedValue(BOOKING_WITH_CUSTOMER)

    const { handlePaymentFailed } = await import('@/lib/payments')
    await handlePaymentFailed(EVENT)

    expect(mockEmitServerConversion).toHaveBeenCalledWith({
      name: 'payment_failed',
      entityId: 'booking-1',
    })
    expect(mockNotifyCustomerPaymentFailed).toHaveBeenCalledWith({
      customerPhone: '+27821234567',
      category: 'plumbing',
      bookingRef: 'OOKING-1',
      checkoutUrl: null,
    })
    expect(mockClaimOpsQueueItem).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        queueType: 'PAYMENT_FOLLOW_UP',
        entityId: 'booking-1',
      }),
    )
  })

  it('includes a retry checkout link in checkout mode (stored URL fallback when re-mint fails)', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockDb.payment.updateMany.mockResolvedValue({ count: 1 })
    mockDb.booking.findUnique.mockResolvedValue(BOOKING_WITH_CUSTOMER)
    // refreshCheckoutUrlForFailedPayment reads the stored row...
    mockDb.payment.findUnique.mockResolvedValue({
      amount: 450,
      checkoutUrl: 'https://pay.example/stored-checkout',
    })
    // ...then tries to re-mint via initializeBookingPayment → createCheckout.
    // Peach credentials are absent in tests, so the re-mint throws and the
    // helper falls back to the stored URL.
    mockDb.payment.upsert.mockResolvedValue({})
    mockDb.payment.update.mockResolvedValue({})

    const { handlePaymentFailed } = await import('@/lib/payments')
    await handlePaymentFailed(EVENT)

    expect(mockNotifyCustomerPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        customerPhone: '+27821234567',
        checkoutUrl: 'https://pay.example/stored-checkout',
      }),
    )
  })
})
