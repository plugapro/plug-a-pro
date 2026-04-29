import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LeadUnlockDisputeError,
  approveLeadUnlockDispute,
  disputeLeadUnlockForProvider,
  rejectLeadUnlockDispute,
} from '../../lib/lead-unlock-disputes'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    unlock: any
    dispute: any
    wallet: any
    ledgerEntries: any[]
  } = {
    unlock: null,
    dispute: null,
    wallet: null,
    ledgerEntries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    leadUnlock: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    leadUnlockDispute: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    walletLedgerEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    providerWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  }

  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

function makeUnlock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unlock-1',
    leadId: 'lead-1',
    providerId: 'provider-1',
    matchId: null,
    creditsCharged: 1,
    creditTypeBreakdown: { promo: 1 },
    status: 'UNLOCKED',
    unlockedAt: new Date('2026-04-29T10:00:00.000Z'),
    disputeReason: null,
    disputeNotes: null,
    disputedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    refundedAt: null,
    refundReason: null,
    createdAt: new Date('2026-04-29T10:00:00.000Z'),
    updatedAt: new Date('2026-04-29T10:00:00.000Z'),
    ...overrides,
  }
}

function makeDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispute-1',
    leadUnlockId: 'unlock-1',
    providerId: 'provider-1',
    reason: 'INVALID_CUSTOMER_NUMBER',
    notes: 'Number does not connect.',
    status: 'OPEN',
    createdAt: new Date('2026-04-29T10:05:00.000Z'),
    resolvedAt: null,
    resolvedBy: null,
    adminNotes: null,
    ...overrides,
  }
}

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    providerId: 'provider-1',
    paidCreditBalance: 0,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-29T09:00:00.000Z'),
    updatedAt: new Date('2026-04-29T09:00:00.000Z'),
    ...overrides,
  }
}

describe('lead unlock disputes service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.unlock = makeUnlock()
    state.dispute = null
    state.wallet = makeWallet()
    state.ledgerEntries = [{
      id: 'debit-entry-1',
      walletId: 'wallet-1',
      providerId: 'provider-1',
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      amountCredits: 1,
      balanceAfterPaidCredits: 0,
      balanceAfterPromoCredits: 0,
      referenceType: 'lead_unlock',
      referenceId: 'unlock-1',
      metadata: {},
      createdAt: new Date('2026-04-29T10:00:00.000Z'),
      createdBy: 'provider-1',
    }]

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.leadUnlock.findUnique.mockImplementation(async (args: any) => {
      if (args.where.leadId && args.where.leadId !== state.unlock.leadId) return null
      if (args.include?.dispute) return { ...state.unlock, dispute: state.dispute }
      return state.unlock
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: any) => {
      state.unlock = { ...state.unlock, ...args.data }
      return state.unlock
    })
    mockDb.leadUnlock.updateMany.mockImplementation(async (args: any) => {
      if (
        state.unlock.id !== args.where.id ||
        state.unlock.status !== args.where.status ||
        state.unlock.refundedAt !== args.where.refundedAt
      ) {
        return { count: 0 }
      }
      state.unlock = { ...state.unlock, ...args.data }
      return { count: 1 }
    })
    mockDb.leadUnlock.findUniqueOrThrow.mockImplementation(async () => state.unlock)

    mockDb.leadUnlockDispute.findUnique.mockImplementation(async (args: any) => {
      if (!state.dispute || state.dispute.id !== args.where.id) return null
      return args.include?.leadUnlock
        ? { ...state.dispute, leadUnlock: state.unlock }
        : state.dispute
    })
    mockDb.leadUnlockDispute.create.mockImplementation(async (args: any) => {
      state.dispute = makeDispute(args.data)
      return state.dispute
    })
    mockDb.leadUnlockDispute.update.mockImplementation(async (args: any) => {
      state.dispute = { ...state.dispute, ...args.data }
      return state.dispute
    })

    mockDb.walletLedgerEntry.findMany.mockImplementation(async (args: any) => {
      return state.ledgerEntries.filter((entry) => (
        entry.referenceType === args.where.referenceType &&
        entry.referenceId === args.where.referenceId &&
        entry.entryType === args.where.entryType
      ))
    })
    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `refund-entry-${state.ledgerEntries.length}`,
        createdAt: new Date('2026-04-29T10:10:00.000Z'),
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
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
  })

  it('lets a provider dispute only their own unlocked lead', async () => {
    const result = await disputeLeadUnlockForProvider(
      'lead-1',
      'provider-1',
      'INVALID_CUSTOMER_NUMBER',
      'Number does not connect.',
    )

    expect(result.unlock).toMatchObject({
      status: 'DISPUTED',
      disputeReason: 'INVALID_CUSTOMER_NUMBER',
      disputeNotes: 'Number does not connect.',
    })
    expect(result.dispute).toMatchObject({
      providerId: 'provider-1',
      reason: 'INVALID_CUSTOMER_NUMBER',
      status: 'OPEN',
    })
  })

  it('blocks a provider from disputing another provider unlock', async () => {
    await expect(
      disputeLeadUnlockForProvider('lead-1', 'provider-2', 'DUPLICATE_LEAD', 'Duplicate'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<LeadUnlockDisputeError>)
  })

  it('approves a dispute once and refunds the original promo credit', async () => {
    state.unlock = makeUnlock({ status: 'DISPUTED' })
    state.dispute = makeDispute()

    const result = await approveLeadUnlockDispute('dispute-1', 'admin-1', 'Invalid number confirmed')

    expect(result.unlock).toMatchObject({
      status: 'REFUNDED',
      refundReason: 'Customer number is invalid',
      resolvedBy: 'admin-1',
    })
    expect(result.dispute).toMatchObject({
      status: 'APPROVED',
      resolvedBy: 'admin-1',
      adminNotes: 'Invalid number confirmed',
    })
    expect(result.wallet).toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 1,
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_REFUND_CREDIT',
      creditType: 'PROMO',
      amountCredits: 1,
      referenceType: 'lead_unlock_dispute',
      referenceId: 'dispute-1',
      createdBy: 'admin-1',
    })
  })

  it('rejects a dispute without changing wallet balance', async () => {
    state.unlock = makeUnlock({ status: 'DISPUTED' })
    state.dispute = makeDispute()

    const result = await rejectLeadUnlockDispute('dispute-1', 'admin-1', 'Customer confirmed valid intro')

    expect(result.unlock.status).toBe('UNLOCKED')
    expect(result.dispute).toMatchObject({
      status: 'REJECTED',
      adminNotes: 'Customer confirmed valid intro',
    })
    expect(result.ledgerEntries).toEqual([])
    expect(state.wallet).toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('prevents duplicate refunds for the same lead unlock', async () => {
    state.unlock = makeUnlock({
      status: 'REFUNDED',
      refundedAt: new Date('2026-04-29T10:10:00.000Z'),
    })
    state.dispute = makeDispute()

    await expect(
      approveLeadUnlockDispute('dispute-1', 'admin-1'),
    ).rejects.toMatchObject({
      code: 'ALREADY_REFUNDED',
    } satisfies Partial<LeadUnlockDisputeError>)

    expect(mockDb.providerWallet.update).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })
})
