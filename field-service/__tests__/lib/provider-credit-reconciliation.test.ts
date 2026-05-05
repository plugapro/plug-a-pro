import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCreditReconciliationError,
  creditPaymentIntent,
  reconcilePaymentIntent,
} from '../../lib/provider-credit-reconciliation'

const { mockDb, mockNotifyPaymentCredited, state } = vi.hoisted(() => {
  const state: {
    intent: any
    wallet: any
    ledgerEntries: any[]
    promoAwards: any[]
  } = {
    intent: null,
    wallet: null,
    ledgerEntries: [],
    promoAwards: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: {
      findUnique: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
    },
    providerPromoAward: {
      aggregate: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
    },
    providerWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
    },
  }

  const mockNotifyPaymentCredited = vi.fn()

  return { mockDb, mockNotifyPaymentCredited, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentCredited: mockNotifyPaymentCredited,
}))

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    providerId: 'provider-1',
    amountCents: 10_000,
    currency: 'ZAR',
    creditsToIssue: 2,
    paymentMethod: 'MANUAL_EFT',
    paymentReference: 'PAP-7842-9F3K',
    status: 'MATCHED_ON_STATEMENT',
    providerCellphone: '+27821234567',
    gatewayReference: null,
    bankStatementReference: 'BANK-REF-1',
    proofOfPaymentUrl: null,
    adminNote: null,
    createdAt: new Date('2026-04-29T09:00:00.000Z'),
    paidAt: new Date('2026-04-29T10:00:00.000Z'),
    creditedAt: null,
    expiresAt: null,
    metadata: {},
    ...overrides,
  }
}

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    providerId: 'provider-1',
    paidCreditBalance: 2,
    promoCreditBalance: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-29T09:00:00.000Z'),
    updatedAt: new Date('2026-04-29T09:00:00.000Z'),
    ...overrides,
  }
}

describe('provider credit reconciliation service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.intent = makeIntent()
    state.wallet = makeWallet()
    state.ledgerEntries = []
    state.promoAwards = []
    mockNotifyPaymentCredited.mockResolvedValue(undefined)

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1' })

    mockDb.paymentIntent.findUnique.mockImplementation(async () => state.intent)
    mockDb.paymentIntent.findUniqueOrThrow.mockImplementation(async () => state.intent)
    mockDb.paymentIntent.count.mockImplementation(async (args: any) => {
      if (args.where.id?.not === state.intent.id) return 0
      return state.intent.status === 'CREDITED' && state.intent.creditedAt ? 1 : 0
    })
    mockDb.paymentIntent.update.mockImplementation(async (args: any) => {
      state.intent = {
        ...state.intent,
        ...args.data,
      }
      return state.intent
    })
    mockDb.paymentIntent.updateMany.mockImplementation(async (args: any) => {
      const allowedStatuses = args.where.status.in
      if (
        state.intent.id !== args.where.id ||
        !allowedStatuses.includes(state.intent.status) ||
        state.intent.creditedAt !== args.where.creditedAt
      ) {
        return { count: 0 }
      }

      state.intent = {
        ...state.intent,
        ...args.data,
      }
      return { count: 1 }
    })

    mockDb.providerWallet.upsert.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const paidIncrement = args.data.paidCreditBalance?.increment ?? 0
      const promoIncrement = args.data.promoCreditBalance?.increment ?? 0
      state.wallet = {
        ...state.wallet,
        paidCreditBalance: state.wallet.paidCreditBalance + paidIncrement,
        promoCreditBalance: state.wallet.promoCreditBalance + promoIncrement,
      }
      return state.wallet
    })
    mockDb.providerPromoAward.aggregate.mockResolvedValue({ _sum: { creditsAwarded: 0 } })
    mockDb.providerPromoAward.findUnique.mockImplementation(async (args: any) => {
      const unique = args.where.providerId_awardType
      return state.promoAwards.find((award) => (
        award.providerId === unique.providerId && award.awardType === unique.awardType
      )) ?? null
    })
    mockDb.providerPromoAward.createMany.mockImplementation(async (args: any) => {
      const data = args.data[0]
      const exists = state.promoAwards.some((award) => (
        award.providerId === data.providerId && award.awardType === data.awardType
      ))
      if (exists) return { count: 0 }
      state.promoAwards.push({
        awardedAt: new Date('2026-04-29T10:05:00.000Z'),
        revokedAt: null,
        status: 'AWARDED',
        ...data,
      })
      return { count: 1 }
    })
    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `entry-${state.ledgerEntries.length + 1}`,
        createdAt: new Date('2026-04-29T10:05:00.000Z'),
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
    })
  })

  it('credits a matched payment intent into paid credits and writes a ledger entry', async () => {
    const result = await creditPaymentIntent('intent-1', 'admin-user-1', {
      adminNote: 'Funds confirmed',
    })

    expect(result.intent.status).toBe('CREDITED')
    expect(result.intent.creditedAt).toBeInstanceOf(Date)
    expect(result.wallet).toMatchObject({
      paidCreditBalance: 4,
      promoCreditBalance: 3,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'TOPUP_CREDIT',
      creditType: 'PAID',
      amountCredits: 2,
      referenceType: 'payment_intent',
      referenceId: 'intent-1',
      createdBy: 'admin-user-1',
    })
    expect(result.ledgerEntries[1]).toMatchObject({
      entryType: 'PROMO_CREDIT',
      creditType: 'PROMO',
      amountCredits: 2,
      referenceType: 'provider_promo_award',
    })
    expect(result.promoAward).toMatchObject({
      awardType: 'FIRST_TOPUP',
      creditsAwarded: 2,
    })
  })

  it('does not emit payment credited WhatsApp from the lib-level credit path', async () => {
    mockNotifyPaymentCredited.mockRejectedValue(new Error('WhatsApp unavailable'))

    const result = await creditPaymentIntent('intent-1', 'admin-user-1', {
      adminNote: 'Funds confirmed',
    })

    expect(result.intent.status).toBe('CREDITED')
    expect(result.wallet).toMatchObject({
      paidCreditBalance: 4,
      promoCreditBalance: 3,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'TOPUP_CREDIT',
      creditType: 'PAID',
      amountCredits: 2,
    })
    expect(mockNotifyPaymentCredited).not.toHaveBeenCalled()
  })

  it('fails safely when the same payment intent is credited twice', async () => {
    state.intent = makeIntent({
      status: 'CREDITED',
      creditedAt: new Date('2026-04-29T10:05:00.000Z'),
    })

    await expect(
      creditPaymentIntent('intent-1', 'admin-user-1'),
    ).rejects.toMatchObject({
      code: 'ALREADY_CREDITED',
    } satisfies Partial<ProviderCreditReconciliationError>)

    expect(mockDb.providerWallet.update).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('rejects crediting a payment intent in an invalid status', async () => {
    state.intent = makeIntent({ status: 'FAILED' })

    await expect(
      creditPaymentIntent('intent-1', 'admin-user-1'),
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    } satisfies Partial<ProviderCreditReconciliationError>)
  })

  it('rejects crediting an expired payment intent', async () => {
    state.intent = makeIntent({
      status: 'PENDING_PAYMENT',
      expiresAt: new Date('2026-04-28T10:05:00.000Z'),
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T10:05:00.000Z'))

    await expect(
      creditPaymentIntent('intent-1', 'admin-user-1', { adminNote: 'Funds confirmed late' }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    } satisfies Partial<ProviderCreditReconciliationError>)

    expect(mockDb.providerWallet.update).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects statement matches when the bank amount differs from the intent amount', async () => {
    await expect(
      reconcilePaymentIntent('intent-1', 'admin-user-1', 'BANK-REF-2', {
        statementAmountCents: 9_000,
      }),
    ).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
    } satisfies Partial<ProviderCreditReconciliationError>)
  })
})
