// I-1: issueRefund must route the refund through the provider that actually
// took the money (Payment.pspProvider), not the current global PSP_PROVIDER
// default — those can diverge per-booking now that resolvePspProviderNameFor()
// picks 'vodapay' per-channel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockRefundPayment } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRefundPayment: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/vodapay/client', () => ({
  payCashier: vi.fn(),
  refundPayment: mockRefundPayment,
}))

const originalFetch = globalThis.fetch

describe('issueRefund — provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Global default is deliberately Peach while the payment being refunded
    // was collected via VodaPay, so a routing bug (always using the global
    // default) is caught even though 'peach' happens to be the fallback.
    process.env.PSP_PROVIDER = 'peach'
    process.env.PEACH_ENTITY_ID = 'entity-test'
    process.env.PEACH_ACCESS_TOKEN = 'token-test'
    mockDb.payment.update.mockResolvedValue({})
  })

  afterEach(() => {
    delete process.env.PSP_PROVIDER
    delete process.env.PEACH_ENTITY_ID
    delete process.env.PEACH_ACCESS_TOKEN
    globalThis.fetch = originalFetch
  })

  it('routes to the provider recorded on Payment.pspProvider, not the global PSP_PROVIDER default', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      bookingId: 'booking-1',
      pspReference: 'vp_ref_1',
      pspProvider: 'vodapay',
      amount: 500,
    })
    mockRefundPayment.mockResolvedValue({ refundId: 'refund-1' })
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { issueRefund } = await import('@/lib/payments')
    const result = await issueRefund({ bookingId: 'booking-1', amountCents: 50000 })

    expect(mockRefundPayment).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled() // Peach (the global default) never contacted
    expect(result.success).toBe(true)
  })

  it("falls back to the global default provider when Payment.pspProvider is null (today's behaviour)", async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      bookingId: 'booking-2',
      pspReference: 'peach_ref_1',
      pspProvider: null,
      amount: 500,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'refund-2' }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { issueRefund } = await import('@/lib/payments')
    const result = await issueRefund({ bookingId: 'booking-2', amountCents: 50000 })

    expect(fetchMock).toHaveBeenCalledOnce() // Peach (global default) contacted
    expect(mockRefundPayment).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
  })

  it('throws when the payment has no pspReference, before any provider is contacted', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      bookingId: 'booking-3',
      pspReference: null,
      pspProvider: 'vodapay',
      amount: 500,
    })

    const { issueRefund } = await import('@/lib/payments')

    await expect(issueRefund({ bookingId: 'booking-3', amountCents: 50000 })).rejects.toThrow(
      'No PSP reference found for this booking',
    )
    expect(mockRefundPayment).not.toHaveBeenCalled()
  })

  // NEW-1: a stored 'payfast' Payment.pspProvider (a payment collected before
  // PayFast was removed as a PSP) must normalize to Peach the same way the
  // PSP_PROVIDER env var does, not hit getProvider()'s "Unknown PSP provider"
  // throw.
  it("normalizes a legacy pspProvider:'payfast' to Peach instead of throwing", async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      bookingId: 'booking-4',
      pspReference: 'legacy_ref_1',
      pspProvider: 'payfast',
      amount: 500,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'refund-4' }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { issueRefund } = await import('@/lib/payments')
    const result = await issueRefund({ bookingId: 'booking-4', amountCents: 50000 })

    expect(fetchMock).toHaveBeenCalledOnce() // routed to Peach, not thrown
    expect(mockRefundPayment).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
  })
})
