import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendText, state } = vi.hoisted(() => {
  const state: {
    existingMessage: any
    createdMessages: any[]
    intent: any
  } = {
    existingMessage: null,
    createdMessages: [],
    intent: null,
  }

  const mockDb = {
    paymentIntent: {
      findUnique: vi.fn(),
    },
    messageEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  }

  const mockSendText = vi.fn()

  return { mockDb, mockSendText, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
}))

describe('provider wallet notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.existingMessage = null
    state.createdMessages = []
    state.intent = {
      id: 'intent-1',
      providerId: 'provider-1',
      status: 'CREDITED',
      creditsToIssue: 5,
      provider: { id: 'provider-1', phone: '+27821234567' },
    }

    mockDb.paymentIntent.findUnique.mockImplementation(async () => state.intent)
    mockDb.messageEvent.findFirst.mockImplementation(async () => state.existingMessage)
    mockDb.messageEvent.create.mockImplementation(async (args: any) => {
      const message = { id: `message-${state.createdMessages.length + 1}`, ...args.data }
      state.createdMessages.push(message)
      return message
    })
    mockSendText.mockResolvedValue('wamid-1')
  })

  it('sends and records a payment credited notification with an idempotency key', async () => {
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderPaymentCredited('intent-1')

    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      'Payment received. Your wallet has been credited with 5 Plug-A-Pro Credits.',
    )
    expect(state.createdMessages[0]).toMatchObject({
      channel: 'WHATSAPP',
      templateName: 'wallet:payment_credited',
      to: '+27821234567',
      status: 'SENT',
      metadata: expect.objectContaining({
        idempotencyKey: 'wallet:payment_credited:intent-1',
        providerId: 'provider-1',
        paymentIntentId: 'intent-1',
      }),
    })
  })

  it('does not send a duplicate payment credited notification', async () => {
    state.existingMessage = { id: 'message-existing' }
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderPaymentCredited('intent-1')

    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('records a failed notification without throwing', async () => {
    mockSendText.mockRejectedValue(new Error('WhatsApp unavailable'))
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    await expect(notifyProviderPaymentCredited('intent-1')).resolves.toBeUndefined()

    expect(state.createdMessages[0]).toMatchObject({
      templateName: 'wallet:payment_credited',
      status: 'FAILED',
      failureReason: 'WhatsApp unavailable',
    })
  })
})
