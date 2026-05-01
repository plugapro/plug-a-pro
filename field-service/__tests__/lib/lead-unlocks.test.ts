import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LeadUnlockError,
  unlockLeadForProvider,
} from '../../lib/lead-unlocks'

const { mockDb, mockNotifyLeadUnlocked, mockNotifyLowBalance, state } = vi.hoisted(() => {
  const state: {
    lead: any
    unlock: any
    wallet: any
    ledgerEntries: any[]
  } = {
    lead: null,
    unlock: null,
    wallet: null,
    ledgerEntries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    leadUnlock: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    providerWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
    },
  }

  const mockNotifyLeadUnlocked = vi.fn()
  const mockNotifyLowBalance = vi.fn()

  return { mockDb, mockNotifyLeadUnlocked, mockNotifyLowBalance, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyLeadUnlocked: mockNotifyLeadUnlocked,
  notifyProviderLowBalance: mockNotifyLowBalance,
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'job-request-1',
    providerId: 'provider-1',
    status: 'VIEWED',
    expiresAt: new Date('2030-04-29T10:00:00.000Z'),
    provider: {
      id: 'provider-1',
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'NOT_STARTED',
      isTestUser: false,
    },
    jobRequest: {
      id: 'job-request-1',
      status: 'MATCHING',
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
    paidCreditBalance: 0,
    promoCreditBalance: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-29T10:00:00.000Z'),
    updatedAt: new Date('2026-04-29T10:00:00.000Z'),
    ...overrides,
  }
}

describe('lead unlock service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.unlock = null
    state.wallet = makeWallet()
    state.ledgerEntries = []
    mockNotifyLeadUnlocked.mockResolvedValue(undefined)
    mockNotifyLowBalance.mockResolvedValue(undefined)

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.leadUnlock.findUnique.mockImplementation(async () => state.unlock)
    mockDb.leadUnlock.create.mockImplementation(async (args: any) => {
      state.unlock = {
        id: 'unlock-1',
        unlockedAt: new Date('2026-04-29T10:05:00.000Z'),
        createdAt: new Date('2026-04-29T10:05:00.000Z'),
        updatedAt: new Date('2026-04-29T10:05:00.000Z'),
        refundedAt: null,
        refundReason: null,
        ...args.data,
      }
      return state.unlock
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: any) => {
      state.unlock = { ...state.unlock, ...args.data }
      return state.unlock
    })

    mockDb.lead.findUnique.mockImplementation(async () => state.lead)
    mockDb.lead.update.mockImplementation(async (args: any) => {
      state.lead = { ...state.lead, ...args.data }
      return state.lead
    })

    mockDb.providerWallet.findUnique.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.upsert.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const paidDecrement = args.data.paidCreditBalance?.decrement ?? 0
      const promoDecrement = args.data.promoCreditBalance?.decrement ?? 0
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
      }
      return { count: 1 }
    })
    mockDb.providerWallet.findUniqueOrThrow.mockImplementation(async () => state.wallet)
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

  it('charges exactly 1 credit, creates a lead unlock, and writes a debit ledger entry', async () => {
    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(false)
    expect(result.unlock).toMatchObject({
      leadId: 'lead-1',
      providerId: 'provider-1',
      creditsCharged: 1,
      status: 'UNLOCKED',
      creditTypeBreakdown: { promo: 1 },
    })
    expect(result.ledgerEntries).toHaveLength(1)
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      amountCredits: 1,
      referenceType: 'lead_unlock',
      referenceId: 'unlock-1',
    })
    expect(state.wallet).toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
    expect(mockNotifyLeadUnlocked).toHaveBeenCalledWith('unlock-1')
    expect(mockNotifyLowBalance).toHaveBeenCalledWith('provider-1', 'entry-1')
  })

  it('keeps the confirmed unlock when WhatsApp notifications fail', async () => {
    mockNotifyLeadUnlocked.mockRejectedValue(new Error('WhatsApp unavailable'))
    mockNotifyLowBalance.mockRejectedValue(new Error('WhatsApp unavailable'))

    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(false)
    expect(result.unlock).toMatchObject({
      id: 'unlock-1',
      leadId: 'lead-1',
      providerId: 'provider-1',
    })
    expect(state.wallet).toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
  })

  it('returns an existing unlock without charging twice', async () => {
    state.unlock = {
      id: 'unlock-1',
      leadId: 'lead-1',
      providerId: 'provider-1',
      creditsCharged: 1,
      status: 'UNLOCKED',
    }

    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(true)
    expect(result.ledgerEntries).toEqual([])
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('handles a concurrent duplicate unlock without charging twice', async () => {
    mockDb.leadUnlock.create.mockImplementationOnce(async () => {
      state.unlock = {
        id: 'unlock-1',
        leadId: 'lead-1',
        providerId: 'provider-1',
        creditsCharged: 1,
        status: 'UNLOCKED',
      }
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`leadId`)',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      )
    })

    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(true)
    expect(result.ledgerEntries).toEqual([])
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('allows approved providers to unlock without KYC approval', async () => {
    state.lead = makeLead({
      provider: {
        id: 'provider-1',
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'REJECTED',
        isTestUser: false,
      },
    })

    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(false)
    expect(mockDb.providerWallet.updateMany).toHaveBeenCalled()
  })

  it('blocks providers whose application is not approved', async () => {
    state.lead = makeLead({
      provider: {
        id: 'provider-1',
        active: true,
        verified: false,
        status: 'UNDER_REVIEW',
        kycStatus: 'VERIFIED',
        isTestUser: false,
      },
    })

    await expect(unlockLeadForProvider('lead-1', 'provider-1')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
    } satisfies Partial<LeadUnlockError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
  })

  it('blocks inactive or suspended providers', async () => {
    state.lead = makeLead({
      provider: {
        id: 'provider-1',
        active: false,
        verified: true,
        status: 'SUSPENDED',
        kycStatus: 'VERIFIED',
        isTestUser: false,
      },
    })

    await expect(unlockLeadForProvider('lead-1', 'provider-1')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_ACTIVE',
    } satisfies Partial<LeadUnlockError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
  })

  it('blocks providers with insufficient credits', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })

    await expect(
      unlockLeadForProvider('lead-1', 'provider-1'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    } satisfies Partial<LeadUnlockError>)
  })

  it('blocks test lead unlocks when no promo/test credits are available', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })
    state.lead = makeLead({
      provider: {
        id: 'provider-1',
        active: true,
        verified: true,
        status: 'ACTIVE',
        isTestUser: true,
      },
      jobRequest: {
        id: 'job-request-1',
        status: 'MATCHING',
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        match: null,
      },
    })

    await expect(unlockLeadForProvider('lead-1', 'provider-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    } satisfies Partial<LeadUnlockError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
  })

  it('records test lead unlocks against promo/test credits instead of paid revenue', async () => {
    state.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 1 })
    state.lead = makeLead({
      provider: {
        id: 'provider-1',
        active: true,
        verified: true,
        status: 'ACTIVE',
        isTestUser: true,
      },
      jobRequest: {
        id: 'job-request-1',
        status: 'MATCHING',
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        match: null,
      },
    })

    const result = await unlockLeadForProvider('lead-1', 'provider-1')

    expect(result.alreadyUnlocked).toBe(false)
    expect(mockDb.providerWallet.updateMany).toHaveBeenCalled()
    expect(result.unlock).toMatchObject({
      isTestUnlock: true,
      cohortName: 'internal_staff_test',
    })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      referenceType: 'test_lead_unlock',
      isTestTransaction: true,
      cohortName: 'internal_staff_test',
    })
    expect(state.wallet).toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
  })

  it('blocks leads assigned to another provider', async () => {
    await expect(
      unlockLeadForProvider('lead-1', 'provider-2'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<LeadUnlockError>)

    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
  })
})
