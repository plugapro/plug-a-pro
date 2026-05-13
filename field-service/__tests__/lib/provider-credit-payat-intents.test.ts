import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockCreatePayatPaymentRequest, state } = vi.hoisted(() => {
  const state = {
    provider: { id: 'provider-1', phone: '+27821234567', name: 'Provider One', email: 'pro@example.com' },
    createdIntent: null as any,
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: {
      findUnique: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  }

  return {
    mockDb,
    mockCreatePayatPaymentRequest: vi.fn(),
    state,
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/payat/payment', () => ({
  PAYAT_ALLOWED_AMOUNTS_CENTS: new Set([10_000, 20_000, 50_000]),
  createPayatPaymentRequest: mockCreatePayatPaymentRequest,
}))

describe('Pay@ provider credit payment intents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.createdIntent = null
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any),
    )
    mockDb.provider.findUnique.mockResolvedValue(state.provider)
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)
    mockDb.paymentIntent.create.mockImplementation(async (args: any) => {
      state.createdIntent = {
        id: 'intent-payat-1',
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        paidAt: null,
        creditedAt: null,
        gatewayReference: null,
        ...args.data,
      }
      return state.createdIntent
    })
    mockCreatePayatPaymentRequest.mockResolvedValue({
      reference: 'intent-payat-1',
      qrCodeUrl: 'https://go.payat.co.za/qr/intent-payat-1',
      paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
    })
  })

  it('creates a pending Pay@ intent before calling the gateway', async () => {
    const { createPayatTopUpIntent } = await import('@/lib/provider-credit-payment-intents')

    const result = await createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
    })

    expect(mockDb.paymentIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'provider-1',
        amountCents: 10_000,
        creditsToIssue: 2,
        paymentMethod: 'PAYAT',
        status: 'PENDING_PAYMENT',
        providerCellphone: '+27821234567',
      }),
    })
    expect(mockCreatePayatPaymentRequest).toHaveBeenCalledWith({
      topupId: 'intent-payat-1',
      amountCents: 10_000,
      description: 'Plug A Pro wallet top-up R100',
    })
    expect(result).toEqual({
      intent: state.createdIntent,
      payat: {
        reference: 'intent-payat-1',
        qrCodeUrl: 'https://go.payat.co.za/qr/intent-payat-1',
        paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      },
    })
  })

  it('rejects unsupported Pay@ package amounts before creating an intent', async () => {
    const { createPayatTopUpIntent } = await import('@/lib/provider-credit-payment-intents')

    await expect(createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 15_000,
    })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })

    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
    expect(mockCreatePayatPaymentRequest).not.toHaveBeenCalled()
  })
})
