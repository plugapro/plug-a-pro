import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/ops-queue', () => ({
  OPS_QUEUE_TYPES: {
    PAYMENT_FOLLOW_UP: 'PAYMENT_FOLLOW_UP',
  },
  claimOpsQueueItem: vi.fn(),
}))

vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerPaymentFailed: vi.fn(),
}))

vi.mock('@/lib/payat-go', () => ({
  createPayAtGoBookingPaymentRequest: vi.fn(),
}))

describe('generic PayFast PSP configuration', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      PSP_PROVIDER: 'payfast',
      PAYFAST_MERCHANT_ID: 'merchant-id',
      PAYFAST_MERCHANT_KEY: 'merchant-key',
      PAYFAST_SANDBOX: 'false',
    }
    delete process.env.PAYFAST_PASSPHRASE
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('fails closed before checkout persistence when live PayFast has no passphrase', async () => {
    expect(process.env.PAYFAST_PASSPHRASE).toBeUndefined()

    const { createCheckout } = await import('@/lib/payments')
    expect(process.env.PAYFAST_PASSPHRASE).toBeUndefined()

    await expect(createCheckout({
      bookingId: 'booking-1',
      amount: 10_000,
      currency: 'ZAR',
      description: 'Test booking payment',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/cancel',
      notifyUrl: 'https://app.example.com/api/webhooks/payments',
    })).rejects.toThrow(/PAYFAST_PASSPHRASE/)

    expect(mockDb.payment.upsert).not.toHaveBeenCalled()
  })
})
