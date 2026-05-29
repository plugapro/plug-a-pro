import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCreditApplicationError,
  applyProviderCreditForAcceptedLead,
} from '../../lib/provider-credit-application'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    lead: any
    wallet: any
    unlock: any
    ledgerEntries: any[]
    failLeadStatusUpdate: boolean
    failLedgerCreate: boolean
    preserveConcurrentCommit: boolean
  } = {
    lead: null,
    wallet: null,
    unlock: null,
    ledgerEntries: [],
    failLeadStatusUpdate: false,
    failLedgerCreate: false,
    preserveConcurrentCommit: false,
  }

  const mockDb = {
    $transaction: vi.fn(),
    lead: { findUnique: vi.fn(), updateMany: vi.fn() },
    leadUnlock: { create: vi.fn(), update: vi.fn() },
    providerWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  }

  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'request-1',
    providerId: 'provider-1',
    status: 'PROVIDER_ACCEPTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    unlock: state.unlock,
    provider: {
      id: 'provider-1',
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: false,
    },
    jobRequest: {
      id: 'request-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      isTestRequest: false,
      cohortName: null,
      expiresAt: new Date(Date.now() + 60_000),
      match: null,
    },
    ...overrides,
  }
}

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    providerId: 'provider-1',
    paidCreditBalance: 2,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function setupTransactionMock() {
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) => {
    const snapshot = {
      lead: clone(state.lead),
      wallet: clone(state.wallet),
      unlock: clone(state.unlock),
      ledgerEntries: clone(state.ledgerEntries),
    }
    try {
      return await callback(mockDb as any)
    } catch (error) {
      if (!(state.preserveConcurrentCommit && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        state.lead = snapshot.lead
        state.wallet = snapshot.wallet
        state.unlock = snapshot.unlock
        state.ledgerEntries = snapshot.ledgerEntries
      }
      throw error
    }
  })
}

describe('provider credit application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.unlock = null
    state.lead = makeLead()
    state.wallet = makeWallet()
    state.ledgerEntries = []
    state.failLeadStatusUpdate = false
    state.failLedgerCreate = false
    state.preserveConcurrentCommit = false
    setupTransactionMock()

    mockDb.lead.findUnique.mockImplementation(async () => {
      if (!state.lead) return null
      return {
        ...state.lead,
        unlock: state.unlock,
      }
    })

    mockDb.providerWallet.findUnique.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.upsert.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.findUniqueOrThrow.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const paidDec = args.data.paidCreditBalance?.decrement ?? 0
      const promoDec = args.data.promoCreditBalance?.decrement ?? 0
      const exactPaid = args.where.AND.find((clause: any) => typeof clause.paidCreditBalance === 'number')?.paidCreditBalance
      const exactPromo = args.where.AND.find((clause: any) => typeof clause.promoCreditBalance === 'number')?.promoCreditBalance

      if (
        state.wallet.paidCreditBalance !== exactPaid ||
        state.wallet.promoCreditBalance !== exactPromo ||
        state.wallet.paidCreditBalance < paidDec ||
        state.wallet.promoCreditBalance < promoDec
      ) {
        return { count: 0 }
      }

      state.wallet = {
        ...state.wallet,
        paidCreditBalance: state.wallet.paidCreditBalance - paidDec,
        promoCreditBalance: state.wallet.promoCreditBalance - promoDec,
      }
      return { count: 1 }
    })

    mockDb.leadUnlock.create.mockImplementation(async (args: any) => {
      if (state.unlock) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`leadId`)',
          { code: 'P2002', clientVersion: 'test' },
        )
      }
      state.unlock = {
        id: 'unlock-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        unlockedAt: new Date(),
        ...args.data,
      }
      return state.unlock
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: any) => {
      state.unlock = { ...state.unlock, ...args.data }
      return state.unlock
    })

    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      if (state.failLedgerCreate) {
        throw new Error('ledger write failed')
      }
      const entry = {
        id: `ledger-${state.ledgerEntries.length + 1}`,
        createdAt: new Date(),
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
    })
    mockDb.walletLedgerEntry.findFirst.mockImplementation(async (args: any) => (
      [...state.ledgerEntries]
        .reverse()
        .find((entry) =>
          entry.providerId === args.where.providerId &&
          entry.entryType === args.where.entryType &&
          args.where.referenceType.in.includes(entry.referenceType) &&
          entry.referenceId === args.where.referenceId,
        ) ?? null
    ))
    mockDb.walletLedgerEntry.findMany.mockImplementation(async (args: any) => (
      state.ledgerEntries.filter((entry) =>
        entry.providerId === args.where.providerId &&
        entry.entryType === args.where.entryType &&
        args.where.referenceType.in.includes(entry.referenceType) &&
        entry.referenceId === args.where.referenceId,
      )
    ))

    mockDb.lead.updateMany.mockImplementation(async (args: any) => {
      if (state.failLeadStatusUpdate) return { count: 0 }
      if (args.where.status) {
        const filter = args.where.status
        const matched = typeof filter === 'string'
          ? state.lead.status === filter
          : Array.isArray(filter.in) && filter.in.includes(state.lead.status)
        if (!matched) return { count: 0 }
      }
      state.lead = { ...state.lead, ...args.data }
      return { count: 1 }
    })
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  })

  it('deducts credit once, creates a transaction and marks the lead CREDIT_APPLIED', async () => {
    const result = await applyProviderCreditForAcceptedLead({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
      idempotencyKey: 'idem-1',
      traceId: 'trace-1',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-1',
      providerId: 'provider-1',
      leadStatus: 'CREDIT_APPLIED',
      requiredCredits: 1,
      currentCreditBalance: 1,
      paidCreditBalance: 1,
      promoCreditBalance: 0,
      creditTransactionId: 'ledger-1',
      leadUnlockId: 'unlock-1',
      alreadyApplied: false,
    })
    expect(state.wallet).toMatchObject({ paidCreditBalance: 1, promoCreditBalance: 0 })
    expect(state.lead.status).toBe('CREDIT_APPLIED')
    expect(state.ledgerEntries).toHaveLength(1)
    expect(state.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      amountCredits: 1,
      referenceType: 'selected_lead_credit_application',
      referenceId: 'lead-1',
      idempotencyKey: 'idem-1',
      traceId: 'trace-1',
      source: 'whatsapp',
    })
    expect(state.ledgerEntries[0].metadata).toMatchObject({
      leadId: 'lead-1',
      jobRequestId: 'request-1',
      leadUnlockId: 'unlock-1',
      action: 'selected_provider_credit_application',
    })
  })

  it('blocks a missing lead before touching the wallet', async () => {
    state.lead = null

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'missing-lead', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<ProviderCreditApplicationError>)

    expect(mockDb.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('returns idempotent success for duplicate calls without a second deduction', async () => {
    await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })
    const result = await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result.alreadyApplied).toBe(true)
    expect(result.creditTransactionId).toBe('ledger-1')
    expect(state.wallet).toMatchObject({ paidCreditBalance: 1, promoCreditBalance: 0 })
    expect(state.ledgerEntries).toHaveLength(1)
  })

  it('returns an existing successful transaction as an idempotent replay', async () => {
    state.unlock = {
      id: 'unlock-existing',
      leadId: 'lead-1',
      providerId: 'provider-1',
      creditsCharged: 1,
      status: 'UNLOCKED',
      creditTypeBreakdown: { paid: 1 },
    }
    state.lead = makeLead({ status: 'CREDIT_APPLIED' })
    state.wallet = makeWallet({ paidCreditBalance: 1, promoCreditBalance: 0 })
    state.ledgerEntries = [{
      id: 'ledger-existing',
      providerId: 'provider-1',
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      amountCredits: 1,
      referenceType: 'selected_lead_credit_application',
      referenceId: 'lead-1',
      balanceAfterPaidCredits: 1,
      balanceAfterPromoCredits: 0,
      createdAt: new Date(),
    }]

    const result = await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      alreadyApplied: true,
      creditTransactionId: 'ledger-existing',
      leadUnlockId: 'unlock-existing',
      currentCreditBalance: 1,
    })
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('blocks insufficient credits without changing lead status', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.unlock).toBeNull()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('blocks negative wallet balances without changing lead status', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: -1 })

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'CORRUPT_CREDIT_BALANCE' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.unlock).toBeNull()
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('blocks the wrong provider', async () => {
    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-2' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_SELECTED' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.wallet).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 0 })
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('blocks leads that have not been provider accepted', async () => {
    state.lead = makeLead({ status: 'CUSTOMER_SELECTED' })

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'LEAD_NOT_ACCEPTED' } satisfies Partial<ProviderCreditApplicationError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('blocks expired and cancelled leads', async () => {
    state.lead = makeLead({ status: 'EXPIRED' })
    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'LEAD_EXPIRED' } satisfies Partial<ProviderCreditApplicationError>)

    state.lead = makeLead({ cancelledAt: new Date(), jobRequest: { ...makeLead().jobRequest, status: 'CANCELLED' } })
    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('blocks request expiry and accepted-locked requests before deduction', async () => {
    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        expiresAt: new Date(Date.now() - 1_000),
      },
    })

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'LEAD_EXPIRED' } satisfies Partial<ProviderCreditApplicationError>)

    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        status: 'ACCEPTED_LOCKED',
      },
    })

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'LEAD_ALREADY_LOCKED' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('returns an existing application transaction without deducting again when the unlock marker is missing', async () => {
    state.ledgerEntries = [{
      id: 'ledger-existing-no-unlock',
      providerId: 'provider-1',
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      amountCredits: 1,
      referenceType: 'selected_lead_credit_application',
      referenceId: 'lead-1',
      balanceAfterPaidCredits: 1,
      balanceAfterPromoCredits: 0,
      createdAt: new Date(),
    }]
    state.wallet = makeWallet({ paidCreditBalance: 1, promoCreditBalance: 0 })

    const result = await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      alreadyApplied: true,
      creditTransactionId: 'ledger-existing-no-unlock',
      leadUnlockId: 'unlock-1',
      currentCreditBalance: 1,
    })
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
    expect(state.ledgerEntries).toHaveLength(1)
    expect(state.lead.status).toBe('CREDIT_APPLIED')
  })

  it('handles a concurrent duplicate marker as an idempotent replay', async () => {
    state.preserveConcurrentCommit = true
    mockDb.leadUnlock.create.mockImplementationOnce(async () => {
      state.unlock = {
        id: 'unlock-race',
        leadId: 'lead-1',
        providerId: 'provider-1',
        creditsCharged: 1,
        status: 'UNLOCKED',
        creditTypeBreakdown: { paid: 1 },
      }
      state.lead = makeLead({ status: 'CREDIT_APPLIED' })
      state.wallet = makeWallet({ paidCreditBalance: 1, promoCreditBalance: 0 })
      state.ledgerEntries = [{
        id: 'ledger-race',
        providerId: 'provider-1',
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PAID',
        amountCredits: 1,
        referenceType: 'selected_lead_credit_application',
        referenceId: 'lead-1',
        balanceAfterPaidCredits: 1,
        balanceAfterPromoCredits: 0,
        createdAt: new Date(),
      }]
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`leadId`)',
        { code: 'P2002', clientVersion: 'test' },
      )
    })

    const result = await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      alreadyApplied: true,
      creditTransactionId: 'ledger-race',
      currentCreditBalance: 1,
    })
    expect(state.ledgerEntries).toHaveLength(1)
  })

  it('rolls back the wallet debit and unlock marker if ledger creation fails', async () => {
    state.failLedgerCreate = true

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toThrow('ledger write failed')

    expect(state.wallet).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 0 })
    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.unlock).toBeNull()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('rolls back and reports a failed replay when an idempotency key collides without an existing lead transaction', async () => {
    mockDb.walletLedgerEntry.create.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`idempotencyKey`)',
        { code: 'P2002', clientVersion: 'test' },
      )
    })

    await expect(
      applyProviderCreditForAcceptedLead({
        leadId: 'lead-1',
        providerId: 'provider-1',
        idempotencyKey: 'colliding-key',
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_DEDUCTION' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.wallet).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 0 })
    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.unlock).toBeNull()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('rolls back the deduction and transaction if the lead status update fails', async () => {
    state.failLeadStatusUpdate = true

    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_DEDUCTION' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.wallet).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 0 })
    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.unlock).toBeNull()
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('reports correct balance after sequential same-provider two-job acceptances', async () => {
    // Job 1: wallet starts at 3 paid, deducts 1 → ledger records balanceAfterPaidCredits = 2
    state.wallet = makeWallet({ paidCreditBalance: 3, promoCreditBalance: 0 })

    // makeLead() hardcodes selectedLeadInviteId: 'lead-1', so set the lead id to match.
    // For job 1 we reuse the default lead-1 identity.
    state.lead = makeLead()

    // Override walletLedgerEntry.create to record the post-deduction balance snapshot.
    // (The beforeEach mock does not populate balanceAfterPaidCredits from state.wallet,
    // so we override it here to match what the real Prisma write would produce.)
    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      if (state.failLedgerCreate) throw new Error('ledger write failed')
      const entry = {
        id: `ledger-${state.ledgerEntries.length + 1}`,
        createdAt: new Date(),
        balanceAfterPaidCredits: state.wallet.paidCreditBalance,
        balanceAfterPromoCredits: state.wallet.promoCreditBalance,
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
    })

    const result1 = await applyProviderCreditForAcceptedLead({
      leadId: 'lead-1',
      providerId: 'provider-1',
    })

    // After Job 1: wallet deducted from 3 → 2; ledger captures balanceAfterPaidCredits = 2.
    expect(result1.currentCreditBalance).toBe(2)
    expect(result1.paidCreditBalance).toBe(2)
    expect(result1.alreadyApplied).toBe(false)
    expect(state.wallet.paidCreditBalance).toBe(2)

    // Reset for Job 2: use a different lead id.
    // The lead's jobRequest.selectedLeadInviteId must match the lead id for the
    // PROVIDER_NOT_SELECTED guard to pass - so use makeLead with id: 'lead-2' and
    // override selectedLeadInviteId to match.
    state.unlock = null
    state.lead = makeLead({
      id: 'lead-2',
      jobRequest: {
        ...makeLead().jobRequest,
        selectedLeadInviteId: 'lead-2',
      },
    })

    const result2 = await applyProviderCreditForAcceptedLead({
      leadId: 'lead-2',
      providerId: 'provider-1',
    })

    // After Job 2: wallet deducted from 2 → 1; ledger captures balanceAfterPaidCredits = 1.
    expect(result2.currentCreditBalance).toBe(1)
    expect(result2.paidCreditBalance).toBe(1)
    expect(result2.alreadyApplied).toBe(false)
    expect(state.wallet.paidCreditBalance).toBe(1)
    // Both results must reflect post-deduction ledger values, not pre-deduction wallet reads
    expect(result1.currentCreditBalance).not.toBe(3)
    expect(result2.currentCreditBalance).not.toBe(2)
  })

  it('idempotent replay uses ledger entry balance, not stale wallet row balance', async () => {
    // Setup: lead already has an unlock - this is an idempotent replay scenario.
    // The wallet row shows paidCreditBalance = 3 (stale - another deduction hasn't propagated),
    // but the authoritative ledger entry recorded balanceAfterPaidCredits = 2 at deduction time.
    state.unlock = {
      id: 'unlock-stale',
      leadId: 'lead-1',
      providerId: 'provider-1',
      creditsCharged: 1,
      status: 'UNLOCKED',
      creditTypeBreakdown: { paid: 1 },
    }
    state.lead = makeLead({ status: 'CREDIT_APPLIED' })
    // Stale wallet: another deduction may have already consumed a credit after the first deduction
    state.wallet = makeWallet({ paidCreditBalance: 3, promoCreditBalance: 0 })
    state.ledgerEntries = [{
      id: 'ledger-stale',
      providerId: 'provider-1',
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      amountCredits: 1,
      referenceType: 'selected_lead_credit_application',
      referenceId: 'lead-1',
      // Authoritative snapshot: balance was 2 immediately after this deduction
      balanceAfterPaidCredits: 2,
      balanceAfterPromoCredits: 0,
      createdAt: new Date(),
    }]

    const result = await applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-1' })

    // Must use ledger entry snapshot (2), NOT the stale wallet row (3)
    expect(result.currentCreditBalance).toBe(2)
    expect(result.paidCreditBalance).toBe(2)
    expect(result.alreadyApplied).toBe(true)
    expect(result.creditTransactionId).toBe('ledger-stale')
    // Confirms the wallet was not touched during the idempotent replay
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
    // Verify the stale wallet value was NOT returned
    expect(result.currentCreditBalance).not.toBe(3)
    expect(result.paidCreditBalance).not.toBe(3)
  })
})
