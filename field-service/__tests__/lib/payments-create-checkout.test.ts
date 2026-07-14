// SRE-04: the Payment row must exist BEFORE the PSP session is created, so a
// customer can never pay against a checkout that has no Payment record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/marketing/server-events', () => ({
  emitServerConversion: vi.fn(),
}))

const CHECKOUT_PARAMS = {
  bookingId: 'booking-42',
  amount: 45000,
  currency: 'ZAR',
  description: 'plumbing booking',
  successUrl: 'https://app.example/bookings/booking-42',
  cancelUrl: 'https://app.example/quotes',
  notifyUrl: 'https://app.example/api/webhooks/payments',
}

const originalFetch = globalThis.fetch

describe('createCheckout (SRE-04 ordering)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PSP_PROVIDER = 'peach'
    process.env.PEACH_ENTITY_ID = 'entity-test'
    process.env.PEACH_ACCESS_TOKEN = 'token-test'
    mockDb.payment.upsert.mockResolvedValue({})
    mockDb.payment.update.mockResolvedValue({})
  })

  afterEach(() => {
    delete process.env.PSP_PROVIDER
    delete process.env.PEACH_ENTITY_ID
    delete process.env.PEACH_ACCESS_TOKEN
    globalThis.fetch = originalFetch
  })

  it('upserts the PENDING payment row BEFORE creating the PSP session, then attaches the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'chk_123', timestamp: new Date().toISOString() }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { createCheckout } = await import('@/lib/payments')
    const session = await createCheckout(CHECKOUT_PARAMS)

    expect(session.id).toBe('chk_123')

    // Row exists before the PSP is ever contacted.
    expect(mockDb.payment.upsert).toHaveBeenCalledOnce()
    expect(mockDb.payment.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    )
    expect(mockDb.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: 'booking-42' },
        create: expect.objectContaining({
          status: 'PENDING',
          collectionMode: 'PLATFORM_CHECKOUT',
          amount: 450,
        }),
      }),
    )

    // Session details attached after creation.
    expect(mockDb.payment.update).toHaveBeenCalledWith({
      where: { bookingId: 'booking-42' },
      data: {
        pspCheckoutId: 'chk_123',
        checkoutUrl: expect.stringContaining('chk_123'),
      },
    })
  })

  it('keeps the row PENDING with a failureReason and rethrows when the PSP session fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ result: { description: 'entity rejected' } }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { createCheckout } = await import('@/lib/payments')
    await expect(createCheckout(CHECKOUT_PARAMS)).rejects.toThrow('Peach checkout failed')

    expect(mockDb.payment.upsert).toHaveBeenCalledOnce()
    expect(mockDb.payment.update).toHaveBeenCalledWith({
      where: { bookingId: 'booking-42' },
      data: {
        failureReason: expect.stringContaining('PSP checkout creation failed'),
      },
    })
    // No session data was ever written.
    expect(mockDb.payment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pspCheckoutId: expect.anything() }),
      }),
    )
  })

  it('never contacts the PSP when the payment row cannot be created', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    mockDb.payment.upsert.mockRejectedValue(new Error('db down'))

    const { createCheckout } = await import('@/lib/payments')
    await expect(createCheckout(CHECKOUT_PARAMS)).rejects.toThrow('db down')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
