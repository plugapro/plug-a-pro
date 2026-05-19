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
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    // No active duplicate intents by default — allow creation to proceed.
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)
    mockDb.paymentIntent.update.mockResolvedValue(undefined)
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
      providerName: 'Provider One',
      providerPhone: '+27821234567',
      providerEmail: 'pro@example.com',
    })
    expect(result).toMatchObject({
      intent: state.createdIntent,
      payat: {
        reference: 'intent-payat-1',
        paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      },
      payAtAmountCents: 10_000, // no fee passed → payAtAmountCents equals amountCents
    })
    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-payat-1' },
      data: {
        metadata: {
          payatReference: 'intent-payat-1',
          paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
        },
      },
    })
  })

  it('rejects DUPLICATE_INTENT when an active PENDING_PAYMENT Pay@ intent already exists', async () => {
    mockDb.paymentIntent.findFirst.mockResolvedValue({ id: 'existing-intent' })
    const { createPayatTopUpIntent } = await import('@/lib/provider-credit-payment-intents')

    await expect(
      createPayatTopUpIntent({ providerId: 'provider-1', amountCents: 10_000 }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_INTENT' })

    // No new intent should be created and Pay@ must not be contacted.
    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
    expect(mockCreatePayatPaymentRequest).not.toHaveBeenCalled()
  })

  it('marks the intent FAILED and re-throws when the Pay@ API call fails', async () => {
    mockCreatePayatPaymentRequest.mockRejectedValue(new Error('Pay@ API down'))
    mockDb.paymentIntent.update = vi.fn().mockResolvedValue(undefined)
    const { createPayatTopUpIntent } = await import('@/lib/provider-credit-payment-intents')

    await expect(
      createPayatTopUpIntent({ providerId: 'provider-1', amountCents: 10_000 }),
    ).rejects.toThrow('Pay@ API down')

    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
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
