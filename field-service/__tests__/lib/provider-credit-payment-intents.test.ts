import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCreditPaymentIntentError,
  createPayatTopUpIntent,
  createManualEftTopUpIntent,
  generateManualEftPaymentReference,
} from '../../lib/provider-credit-payment-intents'
import { invalidateFlagCache } from '../../lib/flags'

const {
  mockDb,
  mockNotifyPaymentIntentCreated,
  mockNotifyProviderPayatTopUpInitiated,
  mockCreatePayatPaymentRequest,
  state,
} = vi.hoisted(() => {
  const state: {
    provider: { id: string; phone: string | null; name: string | null; email: string | null; kycStatus: string } | null
    highAssuranceVerification: { id: string; providerId: string } | null
    existingReferences: Set<string>
    intents: any[]
  } = {
    provider: {
      id: 'provider-1',
      phone: '+27821234567',
      name: 'Provider One',
      email: 'provider@example.com',
      kycStatus: 'VERIFIED',
    },
    highAssuranceVerification: { id: 'verification-1', providerId: 'provider-1' },
    existingReferences: new Set(),
    intents: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: {
      findUnique: vi.fn(),
    },
    providerIdentityVerification: {
      findFirst: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    invalidateFlagCache()
    // Enable the identity gate for all tests in this suite - mirrors production config.
    vi.stubEnv('FEATURE_FLAGS', JSON.stringify({ 'provider.identity.verification': true }))
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug A Pro provider credits')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BANK_NAME', 'Test Bank')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '123456789')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE', '250655')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE', 'Business current account')
    vi.stubEnv('PROVIDER_CREDIT_EFT_INTENT_EXPIRY_DAYS', '7')

    state.provider = {
      id: 'provider-1',
      phone: '+27821234567',
      name: 'Provider One',
      email: 'provider@example.com',
      kycStatus: 'VERIFIED',
    }
    state.highAssuranceVerification = { id: 'verification-1', providerId: 'provider-1' }
    state.existingReferences = new Set()
    state.intents = []
    mockNotifyPaymentIntentCreated.mockResolvedValue(undefined)
    mockNotifyProviderPayatTopUpInitiated.mockResolvedValue(undefined)
    mockCreatePayatPaymentRequest.mockResolvedValue({
      reference: 'intent-1',
      paymentLink: 'https://go.payat.co.za/pay/intent-1',
    })

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)
    mockDb.providerIdentityVerification.findFirst.mockImplementation(async () => state.highAssuranceVerification)

    mockDb.paymentIntent.findUnique.mockImplementation(async (args: any) => (
      state.existingReferences.has(args.where.paymentReference)
        ? { id: `intent-${args.where.paymentReference}` }
        : null
    ))

    // No active duplicate intents by default - allow creation to proceed.
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)

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
    mockDb.paymentIntent.update.mockImplementation(async (args: any) => {
      const intent = state.intents.find((item) => item.id === args.where.id)
      if (intent) Object.assign(intent, args.data)
      return intent ?? null
    })
  })

  afterEach(() => {
    invalidateFlagCache()
    vi.unstubAllEnvs()
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
      providerName: 'Provider One',
      providerPhone: '+27821234567',
      providerEmail: 'provider@example.com',
    })
    expect(result.payat).toEqual({
      reference: 'intent-1',
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

  it('T-1: adds feeAmountCents to amountCents and sends fee-inclusive total to Pay@', async () => {
    const result = await createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      feeAmountCents: 700,
    })

    expect(mockCreatePayatPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 10_700,
        description: 'Plug A Pro wallet top-up R107',
      }),
    )
    expect(result.payAtAmountCents).toBe(10_700)
    // intent.amountCents holds the credit amount (what goes into the wallet), not the gross
    expect(result.intent.amountCents).toBe(10_000)
  })

  it('T-1: stores payAtAmountCents in intent metadata at creation time', async () => {
    await createPayatTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      feeAmountCents: 700,
    })

    const createCall = mockDb.paymentIntent.create.mock.calls[0]?.[0]
    expect(createCall?.data?.metadata).toMatchObject({ payAtAmountCents: 10_700 })
  })

  it('T-2: re-throws Pay@ error when cleanup also fails, logs alert', async () => {
    const payatError = new Error('Pay@ unavailable')
    const dbError = new Error('DB connection lost')
    mockCreatePayatPaymentRequest.mockRejectedValue(payatError)
    mockDb.paymentIntent.update.mockRejectedValue(dbError)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      createPayatTopUpIntent({ providerId: 'provider-1', amountCents: 10_000 }),
    ).rejects.toBe(payatError)

    // Logs are now JSON strings - find the cleanup-failure entry.
    const alertCall = consoleSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('intent_cleanup_failed'),
    )
    expect(alertCall).toBeDefined()
    const parsed = JSON.parse(alertCall![0] as string)
    expect(parsed).toMatchObject({ event: 'payat.intent_cleanup_failed', alert: true, intentId: 'intent-1' })

    consoleSpy.mockRestore()
  })

  it('rejects creation when provider has no high-assurance identity verification', async () => {
    state.highAssuranceVerification = null

    await expect(
      createManualEftTopUpIntent({
        providerId: 'provider-1',
        amountCents: 10_000,
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    } satisfies Partial<ProviderCreditPaymentIntentError>)

    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
  })

  it('T-7: blocks a second PENDING_PAYMENT Pay@ intent for the same provider+amount', async () => {
    mockDb.paymentIntent.findFirst.mockResolvedValue({ id: 'intent-existing' })

    await expect(
      createPayatTopUpIntent({ providerId: 'provider-1', amountCents: 10_000 }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_INTENT' } satisfies Partial<ProviderCreditPaymentIntentError>)

    expect(mockCreatePayatPaymentRequest).not.toHaveBeenCalled()
    expect(mockDb.paymentIntent.create).not.toHaveBeenCalled()
  })
})
