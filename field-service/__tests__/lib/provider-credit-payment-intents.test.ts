import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCreditPaymentIntentError,
  createManualEftTopUpIntent,
  generateManualEftPaymentReference,
} from '../../lib/provider-credit-payment-intents'

const { mockDb, mockNotifyPaymentIntentCreated, state } = vi.hoisted(() => {
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

  return { mockDb, mockNotifyPaymentIntentCreated, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentIntentCreated: mockNotifyPaymentIntentCreated,
}))

describe('provider credit payment intents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_INTENT_EXPIRY_DAYS', '7')

    state.provider = { id: 'provider-1', phone: '+27821234567' }
    state.existingReferences = new Set()
    state.intents = []
    mockNotifyPaymentIntentCreated.mockResolvedValue(undefined)

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

  it('rejects a R50 top-up', async () => {
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
    [10_000, 5],
    [20_000, 10],
    [50_000, 25],
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
})
