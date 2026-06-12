import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderWalletError,
  adjustProviderCredits,
  creditPaidCredits,
  creditPromoCredits,
  debitCreditsForLeadUnlock,
  debitPaidCreditsForKycFeeInTransaction,
  getOrCreateProviderWallet,
  getProviderWalletLedgerEntries,
  getProviderWalletBalance,
  reactivateProviderWallet,
  refundCredits,
  suspendProviderWallet,
} from '../../lib/provider-wallet'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    wallet: any
    entries: any[]
  } = {
    wallet: null,
    entries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    providerWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  }

  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    providerId: 'provider-1',
    paidCreditBalance: 0,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-29T08:00:00.000Z'),
    updatedAt: new Date('2026-04-29T08:00:00.000Z'),
    ...overrides,
  }
}

function reference(overrides: Record<string, unknown> = {}) {
  return {
    referenceType: 'test',
    referenceId: 'ref-1',
    description: 'Test wallet mutation',
    metadata: { source: 'unit-test' },
    createdBy: 'admin-1',
    ...overrides,
  }
}

describe('provider wallet service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.wallet = makeWallet()
    state.entries = []

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.providerWallet.upsert.mockImplementation(async (args: any) => {
      if (!state.wallet) {
        state.wallet = makeWallet({ providerId: args.create.providerId })
      }
      return state.wallet
    })

    mockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const paidIncrement = args.data.paidCreditBalance?.increment ?? 0
      const promoIncrement = args.data.promoCreditBalance?.increment ?? 0
      const status = args.data.status ?? state.wallet.status
      state.wallet = {
        ...state.wallet,
        paidCreditBalance: state.wallet.paidCreditBalance + paidIncrement,
        promoCreditBalance: state.wallet.promoCreditBalance + promoIncrement,
        status,
        updatedAt: new Date('2026-04-29T09:00:00.000Z'),
      }
      return state.wallet
    })

    mockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const paidDecrement = args.data.paidCreditBalance?.decrement ?? 0
      const promoDecrement = args.data.promoCreditBalance?.decrement ?? 0

      // The service uses optimistic concurrency. The mock mirrors that behavior
      // by requiring the in-memory wallet to still match the read balances.
      const exactPaid = args.where.AND.find((clause: any) => typeof clause.paidCreditBalance === 'number')
        ?.paidCreditBalance
      const exactPromo = args.where.AND.find((clause: any) => typeof clause.promoCreditBalance === 'number')
        ?.promoCreditBalance

      if (
        state.wallet.paidCreditBalance !== exactPaid ||
        state.wallet.promoCreditBalance !== exactPromo ||
        state.wallet.paidCreditBalance < paidDecrement ||
        state.wallet.promoCreditBalance < promoDecrement
      ) {
        return { count: 0 }
      }

      state.wallet = {
        ...state.wallet,
        paidCreditBalance: state.wallet.paidCreditBalance - paidDecrement,
        promoCreditBalance: state.wallet.promoCreditBalance - promoDecrement,
        updatedAt: new Date('2026-04-29T09:00:00.000Z'),
      }
      return { count: 1 }
    })

    mockDb.providerWallet.findUniqueOrThrow.mockImplementation(async () => state.wallet)

    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `entry-${state.entries.length + 1}`,
        createdAt: new Date('2026-04-29T09:00:00.000Z'),
        ...args.data,
      }
      state.entries.push(entry)
      return entry
    })
    mockDb.walletLedgerEntry.findMany.mockResolvedValue([])
  })

  it('creates a provider wallet automatically when needed', async () => {
    state.wallet = null

    const wallet = await getOrCreateProviderWallet('provider-1')

    expect(wallet).toMatchObject({
      providerId: 'provider-1',
      paidCreditBalance: 0,
      promoCreditBalance: 0,
      status: 'ACTIVE',
    })
    expect(mockDb.providerWallet.upsert).toHaveBeenCalledWith({
      where: { providerId: 'provider-1' },
      create: { providerId: 'provider-1' },
      update: {},
    })
  })

  it('returns cached paid, promo and total credit balances', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 7, promoCreditBalance: 3 })

    await expect(getProviderWalletBalance('provider-1')).resolves.toEqual({
      providerId: 'provider-1',
      paidCreditBalance: 7,
      promoCreditBalance: 3,
      totalCreditBalance: 10,
      status: 'ACTIVE',
    })
  })

  it('reads provider ledger entries through the wallet module seam', async () => {
    await getProviderWalletLedgerEntries('provider-1', {
      limit: 50,
      cursor: 'entry-cursor',
      referenceType: 'payment_intent',
      referenceId: 'intent-1',
    })

    expect(mockDb.walletLedgerEntry.findMany).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        referenceType: 'payment_intent',
        referenceId: 'intent-1',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      cursor: { id: 'entry-cursor' },
      skip: 1,
    })
  })

  it('credits paid credits and writes a paid top-up ledger entry', async () => {
    const result = await creditPaidCredits('provider-1', 5, reference({
      referenceType: 'manual_eft',
      referenceId: 'eft-1',
      isTestTransaction: true,
      cohortName: 'internal_staff_test',
    }))

    expect(result.wallet.paidCreditBalance).toBe(5)
    expect(result.wallet.promoCreditBalance).toBe(0)
    expect(result.ledgerEntries).toHaveLength(1)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'TOPUP_CREDIT',
      creditType: 'PAID',
      amountCredits: 5,
      balanceAfterPaidCredits: 5,
      balanceAfterPromoCredits: 0,
      referenceType: 'manual_eft',
      referenceId: 'eft-1',
      isTestTransaction: true,
      cohortName: 'internal_staff_test',
      metadata: {
        source: 'unit-test',
        balanceBeforePaidCredits: 0,
        balanceBeforePromoCredits: 0,
        balanceAfterPaidCredits: 5,
        balanceAfterPromoCredits: 0,
      },
    })
  })

  it('credits promo credits and writes a promo ledger entry', async () => {
    const result = await creditPromoCredits('provider-1', 4, reference({
      referenceType: 'promo_campaign',
      referenceId: 'launch-credits',
    }))

    expect(result.wallet.paidCreditBalance).toBe(0)
    expect(result.wallet.promoCreditBalance).toBe(4)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'PROMO_CREDIT',
      creditType: 'PROMO',
      amountCredits: 4,
      balanceAfterPaidCredits: 0,
      balanceAfterPromoCredits: 4,
      referenceType: 'promo_campaign',
      referenceId: 'launch-credits',
    })
  })

  it('debits promo credits first for a lead unlock', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 10, promoCreditBalance: 5 })

    const result = await debitCreditsForLeadUnlock('provider-1', 3, reference({
      referenceType: 'lead',
      referenceId: 'lead-1',
    }))

    expect(result.wallet).toMatchObject({
      paidCreditBalance: 10,
      promoCreditBalance: 2,
    })
    expect(result.ledgerEntries).toHaveLength(1)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      amountCredits: 3,
      balanceAfterPaidCredits: 10,
      balanceAfterPromoCredits: 2,
      referenceType: 'lead',
      referenceId: 'lead-1',
    })
  })

  it('splits a lead unlock debit across promo and paid credits when needed', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 10, promoCreditBalance: 3 })

    const result = await debitCreditsForLeadUnlock('provider-1', 8, reference({
      referenceType: 'lead',
      referenceId: 'lead-2',
    }))

    expect(result.wallet).toMatchObject({
      paidCreditBalance: 5,
      promoCreditBalance: 0,
    })
    expect(result.ledgerEntries).toHaveLength(2)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      amountCredits: 3,
      balanceAfterPaidCredits: 10,
      balanceAfterPromoCredits: 0,
    })
    expect(result.ledgerEntries[1]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      amountCredits: 5,
      balanceAfterPaidCredits: 5,
      balanceAfterPromoCredits: 0,
    })
  })

  it('fails cleanly when total credits are insufficient', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 1 })

    await expect(
      debitCreditsForLeadUnlock('provider-1', 4, reference({
        referenceType: 'lead',
        referenceId: 'lead-3',
      })),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    } satisfies Partial<ProviderWalletError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('refunds credits to the requested credit bucket and writes a refund ledger entry', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 1 })

    const result = await refundCredits('provider-1', 2, 'PAID', reference({
      referenceType: 'lead_refund',
      referenceId: 'lead-4',
    }))

    expect(result.wallet).toMatchObject({
      paidCreditBalance: 4,
      promoCreditBalance: 1,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_REFUND_CREDIT',
      creditType: 'PAID',
      amountCredits: 2,
      balanceAfterPaidCredits: 4,
      balanceAfterPromoCredits: 1,
      referenceType: 'lead_refund',
      referenceId: 'lead-4',
    })
  })

  it('applies a positive admin adjustment and writes an admin ledger entry', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 1 })

    const result = await adjustProviderCredits(
      'provider-1',
      'PAID',
      5,
      'Pilot correction',
      'admin-1',
    )

    expect(result.wallet).toMatchObject({
      paidCreditBalance: 7,
      promoCreditBalance: 1,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'ADMIN_ADJUSTMENT',
      creditType: 'PAID',
      amountCredits: 5,
      balanceAfterPaidCredits: 7,
      balanceAfterPromoCredits: 1,
      referenceType: 'admin_adjustment',
      description: 'Admin adjustment: Pilot correction',
      metadata: {
        reason: 'Pilot correction',
        adjustedBy: 'admin-1',
      },
      createdBy: 'admin-1',
    })
  })

  it('applies a negative admin adjustment without allowing negative balances', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 4 })

    const result = await adjustProviderCredits(
      'provider-1',
      'PROMO',
      -3,
      'Expired launch promo',
      'admin-1',
    )

    expect(result.wallet).toMatchObject({
      paidCreditBalance: 2,
      promoCreditBalance: 1,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'ADMIN_ADJUSTMENT',
      creditType: 'PROMO',
      amountCredits: -3,
      balanceAfterPaidCredits: 2,
      balanceAfterPromoCredits: 1,
    })

    await expect(
      adjustProviderCredits('provider-1', 'PROMO', -2, 'Too much', 'admin-1'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    } satisfies Partial<ProviderWalletError>)
  })

  it('requires an admin reason for adjustments and status changes', async () => {
    await expect(
      adjustProviderCredits('provider-1', 'PAID', 1, ' ', 'admin-1'),
    ).rejects.toMatchObject({
      code: 'INVALID_REASON',
    } satisfies Partial<ProviderWalletError>)

    await expect(
      suspendProviderWallet('provider-1', '', 'admin-1'),
    ).rejects.toMatchObject({
      code: 'INVALID_REASON',
    } satisfies Partial<ProviderWalletError>)
  })

  it('suspends and reactivates wallets without erasing balances', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 3, promoCreditBalance: 2 })

    const suspended = await suspendProviderWallet('provider-1', 'Abuse review', 'admin-1')

    expect(suspended).toMatchObject({
      status: 'SUSPENDED',
      paidCreditBalance: 3,
      promoCreditBalance: 2,
    })
    expect(state.entries.at(-1)).toMatchObject({
      entryType: 'WALLET_SUSPENDED',
      creditType: 'PROMO',
      amountCredits: 0,
      balanceAfterPaidCredits: 3,
      balanceAfterPromoCredits: 2,
      referenceType: 'wallet_status',
      referenceId: 'wallet-1',
      description: 'Wallet suspended: Abuse review',
      createdBy: 'admin-1',
      metadata: {
        reason: 'Abuse review',
        suspendedBy: 'admin-1',
      },
    })

    await expect(
      debitCreditsForLeadUnlock('provider-1', 1, reference({
        referenceType: 'lead',
        referenceId: 'lead-suspended',
      })),
    ).rejects.toMatchObject({
      code: 'WALLET_NOT_ACTIVE',
    } satisfies Partial<ProviderWalletError>)

    const reactivated = await reactivateProviderWallet('provider-1', 'Review resolved', 'admin-1')
    expect(reactivated).toMatchObject({
      status: 'ACTIVE',
      paidCreditBalance: 3,
      promoCreditBalance: 2,
    })
    expect(state.entries.at(-1)).toMatchObject({
      entryType: 'WALLET_REACTIVATED',
      creditType: 'PROMO',
      amountCredits: 0,
      balanceAfterPaidCredits: 3,
      balanceAfterPromoCredits: 2,
      referenceType: 'wallet_status',
      referenceId: 'wallet-1',
      description: 'Wallet reactivated: Review resolved',
      createdBy: 'admin-1',
      metadata: {
        reason: 'Review resolved',
        reactivatedBy: 'admin-1',
      },
    })

    await expect(
      debitCreditsForLeadUnlock('provider-1', 1, reference({
        referenceType: 'lead',
        referenceId: 'lead-active',
      })),
    ).resolves.toMatchObject({
      wallet: {
        paidCreditBalance: 3,
        promoCreditBalance: 1,
      },
    })
  })
})

describe('debitPaidCreditsForKycFeeInTransaction', () => {
  it('debits paid credits only and writes a FIRST_TOPUP_KYC_DEDUCTION ledger entry', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 3 })

    const result = await debitPaidCreditsForKycFeeInTransaction(
      mockDb as any,
      'provider-1',
      1,
      reference({ referenceType: 'payment_intent', referenceId: 'intent-1' }),
    )

    expect(result.wallet.paidCreditBalance).toBe(1)
    expect(result.wallet.promoCreditBalance).toBe(3)
    expect(result.ledgerEntries).toHaveLength(1)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'FIRST_TOPUP_KYC_DEDUCTION',
      creditType: 'PAID',
      amountCredits: 1,
      balanceAfterPaidCredits: 1,
      balanceAfterPromoCredits: 3,
    })
  })

  it('throws INSUFFICIENT_FUNDS when paid balance cannot cover the fee even if promo could', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 5 })

    await expect(
      debitPaidCreditsForKycFeeInTransaction(
        mockDb as any,
        'provider-1',
        1,
        reference({ referenceType: 'payment_intent', referenceId: 'intent-1' }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
  })

  it('throws CONCURRENT_MUTATION when the optimistic balance check misses', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 0 })
    mockDb.providerWallet.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      debitPaidCreditsForKycFeeInTransaction(
        mockDb as any,
        'provider-1',
        1,
        reference({ referenceType: 'payment_intent', referenceId: 'intent-1' }),
      ),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MUTATION' })
  })

  it('rejects a suspended wallet', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, status: 'SUSPENDED' })

    await expect(
      debitPaidCreditsForKycFeeInTransaction(
        mockDb as any,
        'provider-1',
        1,
        reference({ referenceType: 'payment_intent', referenceId: 'intent-1' }),
      ),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_ACTIVE' })
  })
})
