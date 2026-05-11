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
    preserveConcurrentCommit: boolean
  } = {
    lead: null,
    wallet: null,
    unlock: null,
    ledgerEntries: [],
    failLeadStatusUpdate: false,
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
    walletLedgerEntry: { create: vi.fn(), findFirst: vi.fn() },
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
    state.preserveConcurrentCommit = false
    setupTransactionMock()

    mockDb.lead.findUnique.mockImplementation(async () => ({
      ...state.lead,
      unlock: state.unlock,
    }))

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

    mockDb.lead.updateMany.mockImplementation(async (args: any) => {
      if (state.failLeadStatusUpdate) return { count: 0 }
      if (args.where.status && state.lead.status !== args.where.status) return { count: 0 }
      state.lead = { ...state.lead, ...args.data }
      return { count: 1 }
    })
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  })

  it('deducts credit once, creates a transaction, and marks the lead CREDIT_APPLIED', async () => {
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

  it('blocks the wrong provider', async () => {
    await expect(
      applyProviderCreditForAcceptedLead({ leadId: 'lead-1', providerId: 'provider-2' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_SELECTED' } satisfies Partial<ProviderCreditApplicationError>)

    expect(state.wallet).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 0 })
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
})
