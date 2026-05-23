import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockCreatePayAtGoSingleRtp,
  mockReadPayAtGoSingleRtp,
  mockCancelPayAtGoSingleRtp,
  mockSetPayAtGoMockStatus,
  mockHandlePaymentSuccess,
  mockHandlePaymentFailed,
} = vi.hoisted(() => ({
  mockDb: {
    booking: { findUnique: vi.fn() },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
  mockCreatePayAtGoSingleRtp: vi.fn(),
  mockReadPayAtGoSingleRtp: vi.fn(),
  mockCancelPayAtGoSingleRtp: vi.fn(),
  mockSetPayAtGoMockStatus: vi.fn(),
  mockHandlePaymentSuccess: vi.fn(),
  mockHandlePaymentFailed: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/payat-go/client', () => ({
  createPayAtGoSingleRtp: mockCreatePayAtGoSingleRtp,
  readPayAtGoSingleRtp: mockReadPayAtGoSingleRtp,
  cancelPayAtGoSingleRtp: mockCancelPayAtGoSingleRtp,
  setPayAtGoMockStatus: mockSetPayAtGoMockStatus,
}))

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments')
  return {
    ...actual,
    handlePaymentSuccess: mockHandlePaymentSuccess,
    handlePaymentFailed: mockHandlePaymentFailed,
  }
})

describe('Pay@Go booking payments service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_GO_ENABLED', 'true')

    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      match: {
        jobRequest: {
          category: 'Plumbing',
          customer: {
            name: 'Customer One',
            phone: '+27831234567',
          },
        },
      },
      payment: null,
    })

    mockCreatePayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      requestToPayId: 123,
      sourceReference: 'PAT-001',
      paymentLink: 'https://pay/1',
      internalStatus: 'SENT',
      rawProviderStatus: 'PAYMENT_OUTSTANDING',
      raw: { paymentLink: 'https://pay/1' },
    })

    mockDb.payment.upsert.mockResolvedValue({
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    })
  })

  it('creates a new Pay@Go booking payment request', async () => {
    const { createPayAtGoBookingPaymentRequest } = await import('@/lib/payat-go/booking-payments')

    const result = await createPayAtGoBookingPaymentRequest({
      bookingId: 'booking-1',
      amountCents: 10000,
      currency: 'ZAR',
      customerName: 'Customer One',
      customerMobile: '+27831234567',
      customerEmail: '[email protected]',
      description: 'Booking payment',
    })

    expect(result.reusedExisting).toBe(false)
    expect(result.providerClientAccountNumber).toBe('12345678901234')
    expect(mockCreatePayAtGoSingleRtp).toHaveBeenCalledTimes(1)
    expect(mockDb.payment.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns existing pending request instead of creating duplicate', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      match: {
        jobRequest: {
          category: 'Plumbing',
          customer: {
            name: 'Customer One',
            phone: '+27831234567',
          },
        },
      },
      payment: {
        id: 'payment-existing',
        bookingId: 'booking-1',
        status: 'PENDING',
        collectionMode: 'PLATFORM_CHECKOUT',
        amount: 100,
        currency: 'ZAR',
        pspProvider: 'payat_go',
        pspReference: '123',
        pspCheckoutId: '12345678901234',
        checkoutUrl: 'https://pay/existing',
        metadata: {
          providerInternalStatus: 'SENT',
          providerSourceReference: 'PAT-EXIST',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        paidAt: null,
        failureReason: null,
        refundedAmount: null,
        refundedAt: null,
      },
    })

    const { createPayAtGoBookingPaymentRequest } = await import('@/lib/payat-go/booking-payments')

    const result = await createPayAtGoBookingPaymentRequest({
      bookingId: 'booking-1',
      amountCents: 10000,
      currency: 'ZAR',
      customerName: 'Customer One',
      customerMobile: '+27831234567',
      description: 'Booking payment',
    })

    expect(result.reusedExisting).toBe(true)
    expect(result.paymentLink).toBe('https://pay/existing')
    expect(mockCreatePayAtGoSingleRtp).not.toHaveBeenCalled()
  })

  it('marks payment as paid on provider paid status and does not duplicate success side effects', async () => {
    const callbackPayload = '{"event":"same"}'
    const callbackHash = createHash('sha256').update(callbackPayload).digest('hex')

    const paymentRecord = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    }

    mockDb.payment.findUnique.mockResolvedValue(paymentRecord)
    mockReadPayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      requestToPayId: 123,
      sourceReference: 'PAT-001',
      paymentLink: 'https://pay/1',
      accountState: 'PAYMENT_COMPLETED',
      internalStatus: 'PAID',
      amountCents: 10000,
      amountPaidCents: 10000,
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      raw: { accountState: 'PAYMENT_COMPLETED' },
    })

    mockDb.payment.update.mockResolvedValue({})
    mockDb.payment.findUniqueOrThrow.mockResolvedValue({
      ...paymentRecord,
      status: 'PAID',
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      metadata: {
        providerInternalStatus: 'PAID',
        providerStatus: 'PAYMENT_COMPLETED',
      },
    })

    const { refreshPayAtGoBookingPaymentStatus } = await import('@/lib/payat-go/booking-payments')
    const result = await refreshPayAtGoBookingPaymentStatus('booking-1')

    expect(result.status).toBe('PAID')
    expect(mockHandlePaymentSuccess).toHaveBeenCalledTimes(1)

    // Simulate repeated callback with the same record now paid.
    mockDb.payment.findFirst.mockResolvedValue({
      ...paymentRecord,
      status: 'PAID',
      metadata: {
        providerInternalStatus: 'PAID',
        providerStatus: 'PAYMENT_COMPLETED',
        webhookLastEventHash: callbackHash,
      },
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
    })

    const { refreshPayAtGoBookingPaymentStatusByClientAccountNumber } = await import('@/lib/payat-go/booking-payments')

    const duplicate = await refreshPayAtGoBookingPaymentStatusByClientAccountNumber(
      '12345678901234',
      callbackPayload,
    )

    expect(duplicate?.status).toBe('PAID')
    expect(mockHandlePaymentSuccess).toHaveBeenCalledTimes(1)
  })

  it('cancels Pay@Go payment request', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    })

    mockCancelPayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      internalStatus: 'CANCELLED',
      rawProviderStatus: 'PAYMENT_CANCELLED',
      message: 'Request cancelled.',
      raw: { message: 'Request cancelled.' },
    })
    mockDb.payment.update.mockResolvedValue({})

    const { cancelPayAtGoBookingPaymentRequest } = await import('@/lib/payat-go/booking-payments')
    const result = await cancelPayAtGoBookingPaymentRequest('booking-1')

    expect(result.status).toBe('CANCELLED')
    expect(mockCancelPayAtGoSingleRtp).toHaveBeenCalledWith('12345678901234')
  })

  it('does not re-trigger failure side effects when already failed', async () => {
    const paymentRecord = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'FAILED',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {
        providerInternalStatus: 'FAILED',
        providerStatus: 'PAYMENT_FEES_ISSUE',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      failureReason: 'Payment declined',
      refundedAmount: null,
      refundedAt: null,
    }

    mockDb.payment.findUnique.mockResolvedValue(paymentRecord)
    mockReadPayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      requestToPayId: 123,
      sourceReference: 'PAT-001',
      paymentLink: 'https://pay/1',
      accountState: 'PAYMENT_FEES_ISSUE',
      internalStatus: 'FAILED',
      amountCents: 10000,
      amountPaidCents: 0,
      paidAt: null,
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      raw: { accountState: 'PAYMENT_FEES_ISSUE' },
    })

    mockDb.payment.update.mockResolvedValue({})
    mockDb.payment.findUniqueOrThrow.mockResolvedValue({
      ...paymentRecord,
      metadata: {
        providerInternalStatus: 'FAILED',
        providerStatus: 'PAYMENT_FEES_ISSUE',
      },
    })

    const { refreshPayAtGoBookingPaymentStatus } = await import('@/lib/payat-go/booking-payments')
    const result = await refreshPayAtGoBookingPaymentStatus('booking-1')

    expect(result.status).toBe('FAILED')
    expect(mockHandlePaymentFailed).not.toHaveBeenCalled()
  })

  it('rejects cancel when payment is already terminal', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PAID',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: { providerInternalStatus: 'PAID' },
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: new Date(),
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    })

    const { cancelPayAtGoBookingPaymentRequest } = await import('@/lib/payat-go/booking-payments')

    await expect(cancelPayAtGoBookingPaymentRequest('booking-1')).rejects.toMatchObject({
      name: 'PayAtGoValidationError',
    })
    expect(mockCancelPayAtGoSingleRtp).not.toHaveBeenCalled()
  })

  it('rejects create when booking payment is already settled', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      match: {
        jobRequest: {
          category: 'Plumbing',
          customer: {
            name: 'Customer One',
            phone: '+27831234567',
          },
        },
      },
      payment: {
        id: 'payment-paid',
        bookingId: 'booking-1',
        status: 'PAID',
        collectionMode: 'PLATFORM_CHECKOUT',
        amount: 100,
        currency: 'ZAR',
        pspProvider: 'payat_go',
        pspReference: '123',
        pspCheckoutId: '12345678901234',
        checkoutUrl: 'https://pay/1',
        metadata: { providerInternalStatus: 'PAID' },
        createdAt: new Date(),
        updatedAt: new Date(),
        paidAt: new Date(),
        failureReason: null,
        refundedAmount: null,
        refundedAt: null,
      },
    })

    const { createPayAtGoBookingPaymentRequest } = await import('@/lib/payat-go/booking-payments')

    await expect(
      createPayAtGoBookingPaymentRequest({
        bookingId: 'booking-1',
        amountCents: 10000,
        currency: 'ZAR',
        customerName: 'Customer One',
        customerMobile: '+27831234567',
        description: 'Booking payment',
      }),
    ).rejects.toMatchObject({ name: 'PayAtGoValidationError' })
    expect(mockCreatePayAtGoSingleRtp).not.toHaveBeenCalled()
  })

  it('does not downgrade an already paid payment when provider later reports failed/cancelled', async () => {
    const paymentRecord = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PAID',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {
        providerInternalStatus: 'PAID',
        providerStatus: 'PAYMENT_COMPLETED',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    }
    mockDb.payment.findUnique.mockResolvedValue(paymentRecord)
    mockReadPayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      requestToPayId: 123,
      sourceReference: 'PAT-001',
      paymentLink: 'https://pay/1',
      accountState: 'PAYMENT_CANCELLED',
      internalStatus: 'CANCELLED',
      amountCents: 10000,
      amountPaidCents: 0,
      paidAt: null,
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      raw: { accountState: 'PAYMENT_CANCELLED' },
    })
    mockDb.payment.update.mockResolvedValue({})
    mockDb.payment.findUniqueOrThrow.mockResolvedValue(paymentRecord)

    const { refreshPayAtGoBookingPaymentStatus } = await import('@/lib/payat-go/booking-payments')
    const result = await refreshPayAtGoBookingPaymentStatus('booking-1')

    expect(result.status).toBe('PAID')
    expect(mockHandlePaymentFailed).not.toHaveBeenCalled()
  })

  it('marks payment failed when provider paid amount does not match expected booking amount', async () => {
    const paymentRecord = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: 100,
      currency: 'ZAR',
      pspProvider: 'payat_go',
      pspReference: '123',
      pspCheckoutId: '12345678901234',
      checkoutUrl: 'https://pay/1',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      failureReason: null,
      refundedAmount: null,
      refundedAt: null,
    }
    mockDb.payment.findUnique.mockResolvedValue(paymentRecord)
    mockReadPayAtGoSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      requestToPayId: 123,
      sourceReference: 'PAT-001',
      paymentLink: 'https://pay/1',
      accountState: 'PAYMENT_COMPLETED',
      internalStatus: 'PAID',
      amountCents: 100,
      amountPaidCents: 100,
      paidAt: new Date('2026-05-23T10:00:00.000Z'),
      expiresAt: new Date('2026-05-26T10:00:00.000Z'),
      raw: { accountState: 'PAYMENT_COMPLETED' },
    })
    mockDb.payment.update.mockResolvedValue({})
    mockDb.payment.findUniqueOrThrow.mockResolvedValue({
      ...paymentRecord,
      status: 'FAILED',
      metadata: {
        providerInternalStatus: 'FAILED',
        providerStatus: 'PAYMENT_COMPLETED',
      },
    })

    const { refreshPayAtGoBookingPaymentStatus } = await import('@/lib/payat-go/booking-payments')
    const result = await refreshPayAtGoBookingPaymentStatus('booking-1')

    expect(result.status).toBe('FAILED')
    expect(mockHandlePaymentSuccess).not.toHaveBeenCalled()
  })
})
