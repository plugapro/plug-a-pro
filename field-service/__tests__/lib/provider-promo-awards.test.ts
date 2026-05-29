import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderPromoAwardError,
  awardMobileVerifiedPromoCreditsInTransaction,
  awardPromoCreditsForMilestone,
} from '../../lib/provider-promo-awards'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    provider: any
    wallet: any
    promoAwards: any[]
    ledgerEntries: any[]
  } = {
    provider: null,
    wallet: null,
    promoAwards: [],
    ledgerEntries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: {
      findUnique: vi.fn(),
    },
    providerPromoAward: {
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

  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    name: 'Provider One',
    phone: '+27821234567',
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
    createdAt: new Date('2026-04-29T08:00:00.000Z'),
    updatedAt: new Date('2026-04-29T08:00:00.000Z'),
    ...overrides,
  }
}

function milestoneReference(overrides: Record<string, unknown> = {}) {
  return {
    referenceType: 'provider_application',
    referenceId: 'application-1',
    createdBy: 'admin-1',
    ...overrides,
  }
}

function findAward(providerId: string, awardType: string) {
  return state.promoAwards.find((award) => (
    award.providerId === providerId && award.awardType === awardType
  )) ?? null
}

describe('provider promo award service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.provider = makeProvider()
    state.wallet = makeWallet()
    state.promoAwards = []
    state.ledgerEntries = []

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)

    mockDb.providerPromoAward.findUnique.mockImplementation(async (args: any) => {
      const unique = args.where.providerId_awardType
      return findAward(unique.providerId, unique.awardType)
    })

    mockDb.providerPromoAward.createMany.mockImplementation(async (args: any) => {
      const data = args.data[0]
      if (findAward(data.providerId, data.awardType)) return { count: 0 }

      state.promoAwards.push({
        awardedAt: new Date('2026-04-29T09:00:00.000Z'),
        revokedAt: null,
        status: 'AWARDED',
        ...data,
      })
      return { count: 1 }
    })

    mockDb.providerWallet.upsert.mockImplementation(async () => state.wallet)
    mockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const promoIncrement = args.data.promoCreditBalance?.increment ?? 0
      state.wallet = {
        ...state.wallet,
        promoCreditBalance: state.wallet.promoCreditBalance + promoIncrement,
      }
      return state.wallet
    })

    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `entry-${state.ledgerEntries.length + 1}`,
        createdAt: new Date('2026-04-29T09:01:00.000Z'),
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
    })
  })

  it('awards configured promo credits once and writes a promo ledger entry', async () => {
    const result = await awardPromoCreditsForMilestone(
      'provider-1',
      'MOBILE_VERIFIED',
      milestoneReference(),
    )

    expect(result.awarded).toBe(true)
    expect(result.award).toMatchObject({
      providerId: 'provider-1',
      awardType: 'MOBILE_VERIFIED',
      creditsAwarded: 3,
      referenceType: 'provider_application',
      referenceId: 'application-1',
    })
    expect(result.wallet).toMatchObject({ promoCreditBalance: 3 })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'PROMO_CREDIT',
      creditType: 'PROMO',
      amountCredits: 3,
      referenceType: 'provider_promo_award',
    })
  })

  it('prevents duplicate milestone awards', async () => {
    await awardPromoCreditsForMilestone('provider-1', 'MOBILE_VERIFIED', milestoneReference())
    const duplicate = await awardPromoCreditsForMilestone(
      'provider-1',
      'MOBILE_VERIFIED',
      milestoneReference({ referenceId: 'application-1-retry' }),
    )

    expect(duplicate.awarded).toBe(false)
    expect(duplicate.skippedReason).toBe('DUPLICATE')
    expect(state.promoAwards).toHaveLength(1)
    expect(state.ledgerEntries).toHaveLength(1)
    expect(state.wallet.promoCreditBalance).toBe(3)
  })

  it('awards 10 onboarding test credits to selected internal staff numbers', async () => {
    state.provider = makeProvider({ phone: '+27764010810' })

    const result = await awardPromoCreditsForMilestone(
      'provider-1',
      'MOBILE_VERIFIED',
      milestoneReference(),
    )

    expect(result.awarded).toBe(true)
    expect(result.award).toMatchObject({
      awardType: 'MOBILE_VERIFIED',
      creditsAwarded: 10,
    })
    expect(result.wallet).toMatchObject({ promoCreditBalance: 10 })
    expect(result.ledgerEntries[0]).toMatchObject({
      entryType: 'PROMO_CREDIT',
      creditType: 'PROMO',
      amountCredits: 10,
      isTestTransaction: true,
      cohortName: 'internal_staff_test',
    })
  })

  it('throws ProviderPromoAwardError with UNKNOWN_AWARD_TYPE for any non-MOBILE_VERIFIED type', async () => {
    for (const awardType of ['PROFILE_COMPLETED', 'KYC_APPROVED', 'FIRST_TOPUP', 'FIRST_COMPLETED_JOB'] as const) {
      await expect(
        awardPromoCreditsForMilestone('provider-1', awardType as any, milestoneReference()),
      ).rejects.toThrow(ProviderPromoAwardError)

      await expect(
        awardPromoCreditsForMilestone('provider-1', awardType as any, milestoneReference()),
      ).rejects.toMatchObject({ code: 'UNKNOWN_AWARD_TYPE' })
    }
  })

  // G3: manual admin approval promo credits
  // Confirms that awardMobileVerifiedPromoCreditsInTransaction - the exact
  // function called by the admin approveApplication server action - awards
  // MOBILE_VERIFIED credits with a provider_application reference and is
  // idempotent when called a second time (e.g., if an admin retries the action).
  describe('G3: manual admin approval calls awardMobileVerifiedPromoCreditsInTransaction', () => {
    it('awards MOBILE_VERIFIED credits via the manual admin approval call signature', async () => {
      const result = await awardMobileVerifiedPromoCreditsInTransaction(
        mockDb as any,
        'provider-1',
        {
          referenceType: 'provider_application',
          referenceId: 'application-manual-1',
          createdBy: 'admin-user-42',
        },
      )

      expect(result.awarded).toBe(true)
      expect(result.award).toMatchObject({
        providerId: 'provider-1',
        awardType: 'MOBILE_VERIFIED',
        creditsAwarded: 3,
        referenceType: 'provider_application',
        referenceId: 'application-manual-1',
      })
      expect(result.wallet).toMatchObject({
        promoCreditBalance: 3,
      })
    })

    it('is idempotent - second manual approval attempt does not double-award', async () => {
      await awardMobileVerifiedPromoCreditsInTransaction(mockDb as any, 'provider-1', {
        referenceType: 'provider_application',
        referenceId: 'application-manual-1',
        createdBy: 'admin-user-42',
      })

      const retry = await awardMobileVerifiedPromoCreditsInTransaction(mockDb as any, 'provider-1', {
        referenceType: 'provider_application',
        referenceId: 'application-manual-1',
        createdBy: 'admin-user-42',
      })

      expect(retry.awarded).toBe(false)
      expect(retry.skippedReason).toBe('DUPLICATE')
      expect(state.promoAwards.filter((a) => a.awardType === 'MOBILE_VERIFIED')).toHaveLength(1)
      expect(state.wallet.promoCreditBalance).toBe(3)
    })
  })
})
