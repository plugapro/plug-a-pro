import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendTemplate, mockSendCtaUrl } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
    },
    messageEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  mockSendTemplate: vi.fn(),
  mockSendCtaUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp', () => ({ sendTemplate: mockSendTemplate }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendCtaUrl: mockSendCtaUrl }))

// The notifications module imports getManualEftBankAccountInstructions but
// notifyProviderPayatTopUpInitiated does not call it - stub to avoid db calls.
vi.mock('@/lib/provider-credit-payment-intents', () => ({
  getManualEftBankAccountInstructions: vi.fn().mockResolvedValue('EFT details'),
}))

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-payat-1',
    providerId: 'provider-1',
    amountCents: 10_000,
    creditsToIssue: 2,
    status: 'PENDING_PAYMENT',
    paymentMethod: 'PAYAT',
    paymentReference: 'PAT-ABCDEF',
    providerCellphone: '+27821234567',
    creditedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    provider: { id: 'provider-1', phone: '+27821234567' },
    ...overrides,
  }
}

describe('notifyProviderPayatTopUpInitiated', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockDb.paymentIntent.findUnique.mockResolvedValue(makeIntent())
    // hasSentNotification returns false - allow the send to proceed
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.create.mockResolvedValue({})
    mockSendTemplate.mockResolvedValue('wa-msg-id-1')
    mockSendCtaUrl.mockResolvedValue('wa-cta-id-1')
  })

  it('H-6: skips send when intent status is FAILED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(makeIntent({ status: 'FAILED' }))

    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    await notifyProviderPayatTopUpInitiated('intent-payat-1', 'https://go.payat.co.za/pay/abc')

    expect(mockSendTemplate).not.toHaveBeenCalled()
  })

  it('H-6: skips send when intent status is EXPIRED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(makeIntent({ status: 'EXPIRED' }))

    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    await notifyProviderPayatTopUpInitiated('intent-payat-1', 'https://go.payat.co.za/pay/abc')

    expect(mockSendTemplate).not.toHaveBeenCalled()
  })

  it('H-6: sends template for PENDING_PAYMENT intent', async () => {
    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    await notifyProviderPayatTopUpInitiated('intent-payat-1', 'https://go.payat.co.za/pay/abc')

    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821234567' }),
    )
  })

  it('H-5: includes URL button component when payment link is a valid go.payat.co.za URL', async () => {
    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    await notifyProviderPayatTopUpInitiated(
      'intent-payat-1',
      'https://go.payat.co.za/pay/intent-payat-1',
    )

    const { components } = mockSendTemplate.mock.calls[0][0]
    const buttonComponent = components.find(
      (c: { type: string }) => c.type === 'button',
    )
    expect(buttonComponent).toBeDefined()
    expect(buttonComponent).toMatchObject({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: 'pay/intent-payat-1' }],
    })
  })

  it('sends live PayAt payat.io payment links as an exact CTA URL instead of a go.payat template suffix', async () => {
    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    const paymentLink = 'https://payat.io/qr/1170041885612636145692557'

    await notifyProviderPayatTopUpInitiated('intent-payat-1', paymentLink)

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('Tap the button below to pay'),
      'Pay now',
      paymentLink,
    )
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalId: 'wa-cta-id-1',
        templateName: 'wallet:payat_topup_initiated',
        idempotencyKey: 'wallet:payat_topup_initiated:intent-payat-1',
        metadata: expect.objectContaining({
          paymentLinkDelivered: true,
          paymentLinkDeliveryMode: 'cta_url',
        }),
      }),
    }))
  })

  it('H-5: omits URL button component when payment link is not a valid URL', async () => {
    const { notifyProviderPayatTopUpInitiated } = await import(
      '@/lib/provider-wallet-notifications'
    )
    await notifyProviderPayatTopUpInitiated('intent-payat-1', 'not-a-valid-url')

    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
    const { components } = mockSendTemplate.mock.calls[0][0]
    const buttonComponent = components.find(
      (c: { type: string }) => c.type === 'button',
    )
    expect(buttonComponent).toBeUndefined()
  })
})
