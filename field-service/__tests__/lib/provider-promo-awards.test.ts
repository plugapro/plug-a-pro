import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRE_PAYMENT_PROMO_CREDIT_CAP,
  PROVIDER_PROMO_CREDIT_REWARDS,
  awardFirstCompletedJobWithCustomerRatingPromoCredits,
  awardFirstTopUpPromoCreditsInTransaction,
  awardPromoCreditsForMilestone,
  evaluateAndAwardProviderProfileCompletionPromoCredits,
} from '../../lib/provider-promo-awards'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    provider: any
    wallet: any
    promoAwards: any[]
    ledgerEntries: any[]
    paymentIntents: any[]
    jobs: any[]
    reviews: any[]
  } = {
    provider: null,
    wallet: null,
    promoAwards: [],
    ledgerEntries: [],
    paymentIntents: [],
    jobs: [],
    reviews: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: {
      findUnique: vi.fn(),
    },
    paymentIntent: {
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
    job: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    review: {
      findFirst: vi.fn(),
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
    bio: 'Experienced plumber',
    experience: '5 years',
    skills: ['plumbing'],
    serviceAreas: ['Sandton'],
    avatarUrl: 'https://example.com/selfie.jpg',
    technicianServiceAreas: [],
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
    state.paymentIntents = []
    state.jobs = []
    state.reviews = []

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)

    mockDb.paymentIntent.count.mockImplementation(async (args: any) => {
      return state.paymentIntents.filter((intent) => {
        if (intent.providerId !== args.where.providerId) return false
        if (args.where.status && intent.status !== args.where.status) return false
        if (args.where.creditedAt?.not === null && intent.creditedAt == null) return false
        if (args.where.id?.not && intent.id === args.where.id.not) return false
        return true
      }).length
    })

    mockDb.providerPromoAward.findUnique.mockImplementation(async (args: any) => {
      const unique = args.where.providerId_awardType
      return findAward(unique.providerId, unique.awardType)
    })

    mockDb.providerPromoAward.aggregate.mockImplementation(async (args: any) => {
      const sum = state.promoAwards
        .filter((award) => (
          award.providerId === args.where.providerId &&
          award.status === args.where.status &&
          args.where.awardType.in.includes(award.awardType)
        ))
        .reduce((total, award) => total + award.creditsAwarded, 0)

      return { _sum: { creditsAwarded: sum } }
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

    mockDb.job.findFirst.mockImplementation(async (args: any) => {
      return state.jobs.find((job) => {
        if (args.where.id && job.id !== args.where.id) return false
        if (args.where.providerId && job.providerId !== args.where.providerId) return false
        if (args.where.status && job.status !== args.where.status) return false
        return true
      }) ?? null
    })
    mockDb.job.findMany.mockImplementation(async (args: any) => {
      return state.jobs
        .filter((job) => job.providerId === args.where.providerId && job.status === args.where.status)
        .map((job) => ({ id: job.id }))
    })
    mockDb.review.findFirst.mockImplementation(async (args: any) => {
      return state.reviews.find((review) => {
        if (args.where.id && review.id !== args.where.id) return false
        if (args.where.jobId && typeof args.where.jobId === 'string' && review.jobId !== args.where.jobId) return false
        if (args.where.jobId?.in && !args.where.jobId.in.includes(review.jobId)) return false
        if (args.where.reviewerType && review.reviewerType !== args.where.reviewerType) return false
        return true
      }) ?? null
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

  it('does not add profile or KYC pre-payment credits after an internal 10-credit onboarding award', async () => {
    state.provider = makeProvider({ phone: '+27823035070' })

    const mobileAward = await awardPromoCreditsForMilestone(
      'provider-1',
      'MOBILE_VERIFIED',
      milestoneReference(),
    )
    const profileAward = await evaluateAndAwardProviderProfileCompletionPromoCredits(
      'provider-1',
      milestoneReference({ referenceType: 'provider', referenceId: 'provider-1' }),
    )
    const kycAward = await awardPromoCreditsForMilestone(
      'provider-1',
      'KYC_APPROVED',
      milestoneReference({ referenceType: 'provider_kyc', referenceId: 'provider-1' }),
    )

    expect(mobileAward.awarded).toBe(true)
    expect(profileAward.awarded).toBe(false)
    expect(profileAward.skippedReason).toBe('PRE_PAYMENT_CAP_REACHED')
    expect(kycAward.awarded).toBe(false)
    expect(kycAward.skippedReason).toBe('PRE_PAYMENT_CAP_REACHED')
    expect(state.wallet.promoCreditBalance).toBe(10)
    expect(state.ledgerEntries).toHaveLength(1)
  })

  it('enforces the pre-payment promo credit cap', async () => {
    state.promoAwards = [{
      id: 'award-existing',
      providerId: 'provider-1',
      awardType: 'MOBILE_VERIFIED',
      creditsAwarded: PRE_PAYMENT_PROMO_CREDIT_CAP - 1,
      status: 'AWARDED',
      referenceType: 'test',
      referenceId: 'existing',
      metadata: {},
    }]

    const result = await awardPromoCreditsForMilestone(
      'provider-1',
      'KYC_APPROVED',
      milestoneReference({ referenceType: 'provider_kyc', referenceId: 'provider-1' }),
    )

    expect(result.awarded).toBe(false)
    expect(result.skippedReason).toBe('PRE_PAYMENT_CAP_REACHED')
    expect(state.promoAwards).toHaveLength(1)
    expect(state.ledgerEntries).toHaveLength(0)
  })

  it('keeps configured pre-payment rewards aligned with the cap', () => {
    const prePaymentRewardTotal =
      PROVIDER_PROMO_CREDIT_REWARDS.MOBILE_VERIFIED +
      PROVIDER_PROMO_CREDIT_REWARDS.PROFILE_COMPLETED +
      PROVIDER_PROMO_CREDIT_REWARDS.KYC_APPROVED

    expect(prePaymentRewardTotal).toBe(PRE_PAYMENT_PROMO_CREDIT_CAP)
  })

  it('allows pre-payment awards above the cap after a credited top-up exists', async () => {
    state.promoAwards = [{
      id: 'award-existing',
      providerId: 'provider-1',
      awardType: 'MOBILE_VERIFIED',
      creditsAwarded: PRE_PAYMENT_PROMO_CREDIT_CAP,
      status: 'AWARDED',
      referenceType: 'test',
      referenceId: 'existing',
      metadata: {},
    }]
    state.paymentIntents = [{
      id: 'intent-1',
      providerId: 'provider-1',
      status: 'CREDITED',
      creditedAt: new Date('2026-04-29T09:00:00.000Z'),
    }]

    const result = await awardPromoCreditsForMilestone(
      'provider-1',
      'KYC_APPROVED',
      milestoneReference({ referenceType: 'provider_kyc', referenceId: 'provider-1' }),
    )

    expect(result.awarded).toBe(true)
    expect(result.award).toMatchObject({
      awardType: 'KYC_APPROVED',
      creditsAwarded: 5,
    })
  })

  it('awards profile completion only when the profile is at least 80 percent complete with a photo', async () => {
    state.provider = makeProvider({ avatarUrl: null })

    const blocked = await evaluateAndAwardProviderProfileCompletionPromoCredits(
      'provider-1',
      milestoneReference({ referenceType: 'provider', referenceId: 'provider-1' }),
    )
    expect(blocked.awarded).toBe(false)
    expect(blocked.skippedReason).toBe('CONDITION_NOT_MET')

    state.provider = makeProvider()
    const awarded = await evaluateAndAwardProviderProfileCompletionPromoCredits(
      'provider-1',
      milestoneReference({ referenceType: 'provider', referenceId: 'provider-1' }),
    )

    expect(awarded.awarded).toBe(true)
    expect(awarded.award).toMatchObject({
      awardType: 'PROFILE_COMPLETED',
      creditsAwarded: 2,
    })
  })

  it('requires at least six of seven profile completion signals and a photo', async () => {
    state.provider = makeProvider({ serviceAreas: [], technicianServiceAreas: [] })
    const sixSignals = await evaluateAndAwardProviderProfileCompletionPromoCredits(
      'provider-1',
      milestoneReference({ referenceType: 'provider', referenceId: 'provider-1' }),
    )
    expect(sixSignals.awarded).toBe(true)
    expect(sixSignals.award?.metadata).toMatchObject({ completionPercent: 86 })

    state.promoAwards = []
    state.ledgerEntries = []
    state.wallet = makeWallet()
    state.provider = makeProvider({
      bio: null,
      serviceAreas: [],
      technicianServiceAreas: [],
    })
    const fiveSignals = await evaluateAndAwardProviderProfileCompletionPromoCredits(
      'provider-1',
      milestoneReference({ referenceType: 'provider', referenceId: 'provider-1' }),
    )

    expect(fiveSignals.awarded).toBe(false)
    expect(fiveSignals.skippedReason).toBe('CONDITION_NOT_MET')
  })

  it('does not double-award KYC approval after re-verification', async () => {
    const first = await awardPromoCreditsForMilestone(
      'provider-1',
      'KYC_APPROVED',
      milestoneReference({ referenceType: 'provider_kyc', referenceId: 'provider-1' }),
    )
    const second = await awardPromoCreditsForMilestone(
      'provider-1',
      'KYC_APPROVED',
      milestoneReference({ referenceType: 'provider_kyc', referenceId: 'provider-1-reverified' }),
    )

    expect(first.awarded).toBe(true)
    expect(second.awarded).toBe(false)
    expect(second.skippedReason).toBe('DUPLICATE')
    expect(state.promoAwards.filter((award) => award.awardType === 'KYC_APPROVED')).toHaveLength(1)
  })

  it('awards the first top-up bonus only when there is no earlier credited top-up', async () => {
    const first = await awardFirstTopUpPromoCreditsInTransaction(
      mockDb as any,
      'provider-1',
      'intent-1',
      'admin-1',
    )
    expect(first.awarded).toBe(true)
    expect(first.award).toMatchObject({ awardType: 'FIRST_TOPUP', creditsAwarded: 2 })

    state.promoAwards = []
    state.paymentIntents = [{
      id: 'intent-1',
      providerId: 'provider-1',
      status: 'CREDITED',
      creditedAt: new Date('2026-04-29T09:00:00.000Z'),
    }]
    const second = await awardFirstTopUpPromoCreditsInTransaction(
      mockDb as any,
      'provider-1',
      'intent-2',
      'admin-1',
    )

    expect(second.awarded).toBe(false)
    expect(second.skippedReason).toBe('CONDITION_NOT_MET')
  })

  it('awards first completed job credits only after a customer rating', async () => {
    state.jobs = [{ id: 'job-1', providerId: 'provider-1', status: 'COMPLETED' }]
    state.reviews = [{ id: 'review-1', jobId: 'job-1', reviewerType: 'CUSTOMER' }]

    const result = await awardFirstCompletedJobWithCustomerRatingPromoCredits(
      'provider-1',
      'job-1',
      'review-1',
    )

    expect(result.awarded).toBe(true)
    expect(result.award).toMatchObject({
      awardType: 'FIRST_COMPLETED_JOB',
      creditsAwarded: 3,
    })
  })

  it('awards first completed job credits on the first rated completed job even when earlier completed jobs were unrated', async () => {
    state.jobs = [
      { id: 'job-1', providerId: 'provider-1', status: 'COMPLETED' },
      { id: 'job-2', providerId: 'provider-1', status: 'COMPLETED' },
    ]
    state.reviews = [{ id: 'review-2', jobId: 'job-2', reviewerType: 'CUSTOMER' }]

    const result = await awardFirstCompletedJobWithCustomerRatingPromoCredits(
      'provider-1',
      'job-2',
      'review-2',
    )

    expect(result.awarded).toBe(true)
    expect(result.award).toMatchObject({
      awardType: 'FIRST_COMPLETED_JOB',
      referenceType: 'review',
      referenceId: 'review-2',
    })
  })
})
