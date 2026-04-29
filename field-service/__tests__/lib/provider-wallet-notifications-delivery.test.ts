import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendTemplate, state } = vi.hoisted(() => {
  const state: {
    existingMessage: any
    createdMessages: any[]
    intent: any
    provider: any
    leadUnlock: any
  } = {
    existingMessage: null,
    createdMessages: [],
    intent: null,
    provider: null,
    leadUnlock: null,
  }

  const mockDb = {
    provider: {
      findUnique: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
    },
    leadUnlock: {
      findUnique: vi.fn(),
    },
    messageEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  }

  const mockSendTemplate = vi.fn()

  return { mockDb, mockSendTemplate, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/whatsapp', () => ({
  sendTemplate: mockSendTemplate,
}))

describe('provider wallet notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug-A-Pro Credits')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BANK_NAME', 'Test Bank')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '123456789')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE', '250655')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE', 'Business current account')

    state.existingMessage = null
    state.createdMessages = []
    state.intent = {
      id: 'intent-1',
      providerId: 'provider-1',
      status: 'CREDITED',
      creditsToIssue: 5,
      amountCents: 10_000,
      paymentReference: 'PAP-1000-ABCD',
      providerCellphone: null,
      provider: { id: 'provider-1', phone: '+27821234567' },
    }
    state.provider = {
      id: 'provider-1',
      phone: '+27821234567',
      wallet: {
        id: 'wallet-1',
        paidCreditBalance: 1,
        promoCreditBalance: 0,
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
      walletLedgerEntries: [{ id: 'ledger-1' }],
    }
    state.leadUnlock = {
      id: 'unlock-1',
      leadId: 'lead-1',
      providerId: 'provider-1',
      provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27821234567' },
      lead: {
        jobRequest: {
          category: 'plumbing',
          description: 'Kitchen sink leak',
          requestedWindowStart: new Date('2026-04-30T08:00:00.000Z'),
          requestedWindowEnd: new Date('2026-04-30T10:00:00.000Z'),
          requestedArrivalLatest: null,
          customer: { id: 'customer-1', name: 'Zanele', phone: '+27829876543' },
          address: {
            street: '12 Main Road',
            suburb: 'Sandton',
            city: 'Johannesburg',
            province: 'Gauteng',
          },
        },
      },
    }

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)
    mockDb.paymentIntent.findUnique.mockImplementation(async () => state.intent)
    mockDb.leadUnlock.findUnique.mockImplementation(async () => state.leadUnlock)
    mockDb.messageEvent.findFirst.mockImplementation(async () => state.existingMessage)
    mockDb.messageEvent.create.mockImplementation(async (args: any) => {
      const message = { id: `message-${state.createdMessages.length + 1}`, ...args.data }
      state.createdMessages.push(message)
      return message
    })
    mockSendTemplate.mockResolvedValue('wamid-1')
  })

  it('sends and records a payment credited template notification with an idempotency key', async () => {
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderPaymentCredited('intent-1')

    expect(mockSendTemplate).toHaveBeenCalledWith({
      to: '+27821234567',
      template: 'wallet_payment_credited',
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: '5' }],
        },
      ],
    })
    expect(state.createdMessages[0]).toMatchObject({
      channel: 'WHATSAPP',
      templateName: 'wallet:payment_credited',
      body: 'Payment received. Your wallet has been credited with 5 Plug-A-Pro Credits.',
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

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('records a failed notification without throwing', async () => {
    mockSendTemplate.mockRejectedValue(new Error('WhatsApp unavailable'))
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    await expect(notifyProviderPaymentCredited('intent-1')).resolves.toBeUndefined()

    expect(state.createdMessages[0]).toMatchObject({
      templateName: 'wallet:payment_credited',
      status: 'FAILED',
      failureReason: 'WhatsApp unavailable',
    })
  })

  it('sends low-balance notifications only when the wallet has one total credit', async () => {
    const { notifyProviderLowBalance } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderLowBalance('provider-1')

    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'wallet_low_balance',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '1' },
            { type: 'text', text: 'R100' },
            { type: 'text', text: '5' },
          ],
        },
      ],
    }))
    expect(state.createdMessages[0].templateName).toBe('wallet:low_balance')
  })

  it('sends zero-balance lead notifications only when the wallet has no credits', async () => {
    state.provider.wallet.paidCreditBalance = 0
    const { notifyProviderZeroBalanceLeadAvailable } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderZeroBalanceLeadAvailable({
      providerId: 'provider-1',
      leadId: 'lead-1',
      jobRequestId: 'job-1',
      holdId: 'hold-1',
    })

    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'wallet_zero_balance_lead',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '0' },
            { type: 'text', text: 'R100' },
          ],
        },
      ],
    }))
    expect(state.createdMessages[0].templateName).toBe('wallet:zero_balance_lead_available')
  })

  it('sends payment intent templates with configured EFT bank details', async () => {
    state.intent.status = 'PENDING_PAYMENT'
    const { notifyProviderPaymentIntentCreated } = await import('../../lib/provider-wallet-notifications')

    await notifyProviderPaymentIntentCreated('intent-1')

    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'wallet_payment_intent_created',
      components: [
        {
          type: 'body',
          parameters: expect.arrayContaining([
            { type: 'text', text: 'Test Bank' },
            { type: 'text', text: '123456789' },
            { type: 'text', text: 'PAP-1000-ABCD' },
          ]),
        },
      ],
    }))
    expect(state.createdMessages[0].body).not.toContain('Configure')
  })

  it('does not send payment intent notifications when EFT bank config is missing', async () => {
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '')
    state.intent.status = 'PENDING_PAYMENT'
    const { notifyProviderPaymentIntentCreated } = await import('../../lib/provider-wallet-notifications')

    await expect(notifyProviderPaymentIntentCreated('intent-1')).rejects.toThrow(
      'Missing required manual EFT bank account configuration',
    )

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('sends both lead-unlocked provider and customer intro templates', async () => {
    const { notifyLeadUnlocked } = await import('../../lib/provider-wallet-notifications')

    await notifyLeadUnlocked('unlock-1')

    expect(mockSendTemplate).toHaveBeenCalledTimes(2)
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27821234567',
      template: 'lead_unlock_provider',
    }))
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27829876543',
      template: 'lead_unlock_customer_intro',
    }))
    expect(state.createdMessages.map((message) => message.templateName)).toEqual([
      'lead_unlock:provider_confirmation',
      'lead_unlock:customer_intro',
    ])
  })
})
