// CJ-01: checkout URLs must actually reach the customer - but ONLY in
// checkout mode. Bypass mode (current production) must remain a strict no-op:
// no sends, no payment initialization, no DB writes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSendCtaUrl,
  mockHasRecentInboundWhatsappSession,
  mockInitializeBookingPayment,
} = vi.hoisted(() => ({
  mockDb: {
    booking: {
      findUnique: vi.fn(),
    },
  },
  mockSendCtaUrl: vi.fn(),
  mockHasRecentInboundWhatsappSession: vi.fn(),
  mockInitializeBookingPayment: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
}))
vi.mock('@/lib/whatsapp-policy', () => ({
  hasRecentInboundWhatsappSession: mockHasRecentInboundWhatsappSession,
}))
vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/currency')>('@/lib/currency')
  return {
    // Real env-driven behaviour so the bypass/checkout gate is exercised.
    getPaymentCollectionMode: () =>
      process.env.PAYMENT_COLLECTION_MODE === 'checkout' ? 'checkout' : 'bypass',
    initializeBookingPayment: mockInitializeBookingPayment,
    formatCurrency: actual.formatCurrency,
  }
})

const DELIVERY_PARAMS = {
  bookingId: 'booking-77',
  checkoutUrl: 'https://pay.example/checkout/abc',
  customerPhone: '+27821234567',
  amountRand: 450,
  category: 'plumbing',
}

describe('deliverBookingPaymentLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYMENT_COLLECTION_MODE
    mockHasRecentInboundWhatsappSession.mockResolvedValue(true)
    mockSendCtaUrl.mockResolvedValue('wamid-1')
  })

  afterEach(() => {
    delete process.env.PAYMENT_COLLECTION_MODE
  })

  it('is completely unreachable in bypass mode: no send, no lookups', async () => {
    // PAYMENT_COLLECTION_MODE unset → bypass (production default).
    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink(DELIVERY_PARAMS)

    expect(result).toEqual({ sent: false, outcome: 'bypass_mode' })
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
    expect(mockDb.booking.findUnique).not.toHaveBeenCalled()
    expect(mockHasRecentInboundWhatsappSession).not.toHaveBeenCalled()
  })

  it('sends a window-safe CTA with the checkout URL in checkout mode', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'

    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink(DELIVERY_PARAMS)

    expect(result).toEqual({ sent: true, outcome: 'sent' })
    expect(mockSendCtaUrl).toHaveBeenCalledOnce()
    const [to, body, buttonText, url, , context] = mockSendCtaUrl.mock.calls[0]
    expect(to).toBe('+27821234567')
    expect(buttonText).toBe('Make payment')
    expect(url).toBe('https://pay.example/checkout/abc')
    // URL travels via the CTA button, never inline in the body.
    expect(body).not.toContain('https://')
    expect(body).toContain('OKING-77')
    expect(body).toContain('plumbing')
    expect(context).toMatchObject({
      bookingId: 'booking-77',
      templateName: 'interactive:booking_payment_link',
    })
  })

  it('blocks the free-form send outside the 24h window instead of firing a doomed send', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockHasRecentInboundWhatsappSession.mockResolvedValue(false)

    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink(DELIVERY_PARAMS)

    expect(result).toEqual({
      sent: false,
      outcome: 'outside_window_blocked',
      failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
    })
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
  })

  it('returns no_checkout_url when there is nothing to deliver', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'

    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink({ ...DELIVERY_PARAMS, checkoutUrl: null })

    expect(result).toEqual({ sent: false, outcome: 'no_checkout_url' })
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
  })

  it('resolves the customer phone from the booking when not provided', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockDb.booking.findUnique.mockResolvedValue({
      match: {
        jobRequest: {
          category: 'electrical',
          customer: { phone: '+27830000000' },
        },
      },
    })

    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink({
      ...DELIVERY_PARAMS,
      customerPhone: null,
      category: null,
    })

    expect(result).toEqual({ sent: true, outcome: 'sent' })
    expect(mockSendCtaUrl.mock.calls[0][0]).toBe('+27830000000')
    expect(mockSendCtaUrl.mock.calls[0][1]).toContain('electrical')
  })

  it('never throws on send failure (fire-and-forget contract)', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockSendCtaUrl.mockRejectedValue(new Error('Meta down'))

    const { deliverBookingPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await deliverBookingPaymentLink(DELIVERY_PARAMS)

    expect(result).toEqual({
      sent: false,
      outcome: 'send_error',
      failureReason: 'Meta down',
    })
  })
})

describe('initializeCheckoutAndDeliverPaymentLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYMENT_COLLECTION_MODE
    mockHasRecentInboundWhatsappSession.mockResolvedValue(true)
    mockSendCtaUrl.mockResolvedValue('wamid-1')
  })

  afterEach(() => {
    delete process.env.PAYMENT_COLLECTION_MODE
  })

  it('is a strict no-op in bypass mode: never initializes a checkout payment', async () => {
    const { initializeCheckoutAndDeliverPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await initializeCheckoutAndDeliverPaymentLink({
      bookingId: 'booking-77',
      amountRand: 450,
      customerPhone: '+27821234567',
      category: 'plumbing',
      description: 'plumbing booking',
    })

    expect(result).toEqual({ sent: false, outcome: 'bypass_mode' })
    expect(mockInitializeBookingPayment).not.toHaveBeenCalled()
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
  })

  it('initializes the checkout then delivers the link in checkout mode', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockInitializeBookingPayment.mockResolvedValue({
      mode: 'checkout',
      status: 'PENDING',
      checkoutUrl: 'https://pay.example/checkout/fresh',
    })

    const { initializeCheckoutAndDeliverPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await initializeCheckoutAndDeliverPaymentLink({
      bookingId: 'booking-77',
      amountRand: 450,
      customerPhone: '+27821234567',
      category: 'plumbing',
      description: 'plumbing booking',
    })

    expect(result).toEqual({ sent: true, outcome: 'sent' })
    expect(mockInitializeBookingPayment).toHaveBeenCalledWith({
      bookingId: 'booking-77',
      amountRand: 450,
      customerEmail: null,
      customerPhone: '+27821234567',
      description: 'plumbing booking',
    })
    expect(mockSendCtaUrl.mock.calls[0][3]).toBe('https://pay.example/checkout/fresh')
  })

  it('reports send_error without throwing when checkout initialization fails', async () => {
    process.env.PAYMENT_COLLECTION_MODE = 'checkout'
    mockInitializeBookingPayment.mockRejectedValue(new Error('pilot gate blocked'))

    const { initializeCheckoutAndDeliverPaymentLink } = await import('@/lib/payment-link-delivery')
    const result = await initializeCheckoutAndDeliverPaymentLink({
      bookingId: 'booking-77',
      amountRand: 450,
      description: 'plumbing booking',
    })

    expect(result).toEqual({
      sent: false,
      outcome: 'send_error',
      failureReason: 'pilot gate blocked',
    })
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
  })
})
