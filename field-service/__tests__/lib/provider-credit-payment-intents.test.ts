import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCreditPaymentIntentError,
  createPayatTopUpIntent,
  createManualEftTopUpIntent,
  generateManualEftPaymentReference,
} from '../../lib/provider-credit-payment-intents'

const {
  mockDb,
  mockNotifyPaymentIntentCreated,
  mockNotifyProviderPayatTopUpInitiated,
  mockCreatePayatPaymentRequest,
  state,
} = vi.hoisted(() => {
  const state: {
    provider: { id: string; phone: string | null } | null
    existingReferences: Set<string>
    intents: any[]
  } = {
    provider: { id: 'provider-1', phone: '+27821234567' },
    existingReferences: new Set(),
    intents: [],
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
    providerWallet: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
    },
  }

  const mockNotifyPaymentIntentCreated = vi.fn()
  const mockNotifyProviderPayatTopUpInitiated = vi.fn()
  const mockCreatePayatPaymentRequest = vi.fn()

  return {
    mockDb,
    mockNotifyPaymentIntentCreated,
    mockNotifyProviderPayatTopUpInitiated,
    mockCreatePayatPaymentRequest,
    state,
  }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentIntentCreated: mockNotifyPaymentIntentCreated,
  notifyProviderPayatTopUpInitiated: mockNotifyProviderPayatTopUpInitiated,
}))

vi.mock('../../lib/payat/payment', () => ({
  PAYAT_ALLOWED_AMOUNTS_CENTS: new Set([10_000, 20_000, 50_000]),
  createPayatPaymentRequest: mockCreatePayatPaymentRequest,
}))

describe('provider credit payment intents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug A Pro provider credits')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BANK_NAME', 'Test Bank')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '123456789')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE', '250655')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE', 'Business current account')
    vi.stubEnv('PROVIDER_CREDIT_EFT_INTENT_EXPIRY_DAYS', '7')

    state.provider = { id: 'provider-1', phone: '+27821234567' }
    state.existingReferences = new Set()
    state.intents = []
    mockNotifyPaymentIntentCreated.mockResolvedValue(undefined)
    mockNotifyProviderPayatTopUpInitiated.mockResolvedValue(undefined)
    mockCreatePayatPaymentRequest.mockResolvedValue({
      reference: 'intent-1',
      qrCodeUrl: 'https://go.payat.co.za/qr/intent-1',
      paymentLink: 'https://go.payat.co.za/pay/intent-1',
    })

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)

    mockDb.paymentIntent.findUnique.mockImplementation(async (args: any) => (
      state.existingReferences.has(args.where.paymentReference)
        ? { id: `intent-${args.where.paymentReference}` }
        : null
    ))

    mockDb.paymentIntent.create.mockImplementation(async (args: any) => {
      const intent = {
        id: `intent-${state.intents.length + 1}`,
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        paidAt: null,
        creditedAt: null,
        gatewayReference: null,
        bankStatementReference: null,
        proofOfPaymentUrl: null,
        ...args.data,
      }
      state.intents.push(intent)
      state.existingReferences.add(intent.paymentReference)
      return intent
    })
  })

  it('rejects an amount below the R100 minimum top-up', async () => {
    await expect(
      createManualEftTopUpIntent({
        providerId: 'provider-1',
        amountCents: 5_000,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    } satisfies Partial<ProviderCreditPaymentIntentError>)

    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
  })

  it.each([
    [10_000, 2],
    [20_000, 4],
    [50_000, 10],
  ])('creates %i cents as %i credits', async (amountCents, creditsToIssue) => {
    const result = await createManualEftTopUpIntent({
      providerId: 'provider-1',
      amountCents,
      now: new Date('2026-04-29T10:00:00.000Z'),
      referenceGenerator: () => `PAP-${creditsToIssue}000-ABCD`,
    })

    expect(result.intent).toMatchObject({
      providerId: 'provider-1',
      amountCents,
      currency: 'ZAR',
      creditsToIssue,
      paymentMethod: 'MANUAL_EFT',
      status: 'PENDING_PAYMENT',
      providerCellphone: '+27821234567',
    })
    expect(result.instructions).toMatchObject({
      amountCents,
      currency: 'ZAR',
      creditsToIssue,
      paymentReference: `PAP-${creditsToIssue}000-ABCD`,
    })
  })

  it('rejects amounts that do not convert cleanly into whole credits', async () => {
    await expect(
      createManualEftTopUpIntent({
        providerId: 'provider-1',
        amountCents: 11_000,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    } satisfies Partial<ProviderCreditPaymentIntentError>)
  })

  it('skips an existing payment reference and creates the intent with a unique reference', async () => {
    state.existingReferences.add('PAP-7842-9F3K')
    const references = ['PAP-7842-9F3K', 'PAP-7842-ABCD']

    const result = await createManualEftTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      referenceGenerator: () => references.shift() ?? 'PAP-7842-ZZZZ',
    })

    expect(result.intent.paymentReference).toBe('PAP-7842-ABCD')
    expect(mockDb.paymentIntent.findUnique).toHaveBeenCalledTimes(2)
  })

  it('generates payment references in the expected manual EFT format', () => {
    expect(generateManualEftPaymentReference()).toMatch(/^PAP-\d{4}-[A-F0-9]{4}$/)
  })

  it('does not mutate wallet balances or ledger entries when creating an intent', async () => {
    await createManualEftTopUpIntent({
      providerId: 'provider-1',
      amountCents: 20_000,
      referenceGenerator: () => 'PAP-2222-DCBA',
    })

    expect(mockDb.providerWallet.update).not.toHaveBeenCalled()
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('fails before creating an intent when manual EFT bank config is missing', async () => {
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '')

    await expect(
      createManualEftTopUpIntent({
        providerId: 'provider-1',
        amountCents: 20_000,
        referenceGenerator: () => 'PAP-3333-DCBA',
      }),
    ).rejects.toThrow('Missing required manual EFT bank account configuration')

    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
    expect(state.intents).toHaveLength(0)
  })

  it('creates a Pay@ intent before requesting Pay@ QR and payment links', async () => {
    const result = await createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
    })

    expect(result.intent).toMatchObject({
      id: 'intent-1',
      providerId: 'provider-1',
      amountCents: 10_000,
      creditsToIssue: 2,
      paymentMethod: 'PAYAT',
      status: 'PENDING_PAYMENT',
      providerCellphone: '+27821234567',
    })
    expect(mockCreatePayatPaymentRequest).toHaveBeenCalledWith({
      topupId: 'intent-1',
      amountCents: 10_000,
      description: 'Plug A Pro wallet top-up R100',
    })
    expect(result.payat).toEqual({
      reference: 'intent-1',
      qrCodeUrl: 'https://go.payat.co.za/qr/intent-1',
      paymentLink: 'https://go.payat.co.za/pay/intent-1',
    })
  })

  it('does not mutate wallet balances or ledger entries when creating a Pay@ intent', async () => {
    await createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 20_000,
    })

    expect(mockDb.providerWallet.update).not.toHaveBeenCalled()
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })
})
