import {
  Prisma,
  type ProviderPromoAward,
  type ProviderPromoAwardType,
  type ProviderWallet,
  type WalletLedgerEntry,
} from '@prisma/client'
import { db } from './db'
import { creditPromoCreditsInTransaction } from './provider-wallet'

export const PRE_PAYMENT_PROMO_CREDIT_CAP = 10

export const PROVIDER_PROMO_CREDIT_REWARDS: Record<ProviderPromoAwardType, number> = {
  MOBILE_VERIFIED: 3,
  PROFILE_COMPLETED: 2,
  KYC_APPROVED: 5,
  FIRST_TOPUP: 2,
  FIRST_COMPLETED_JOB: 3,
}

const PRE_PAYMENT_AWARD_TYPES: readonly ProviderPromoAwardType[] = [
  'MOBILE_VERIFIED',
  'PROFILE_COMPLETED',
  'KYC_APPROVED',
]

type PromoAwardErrorCode =
  | 'INVALID_REFERENCE'
  | 'UNKNOWN_AWARD_TYPE'
  | 'PROVIDER_NOT_FOUND'

export class ProviderPromoAwardError extends Error {
  constructor(
    public readonly code: PromoAwardErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderPromoAwardError'
  }
}

export type PromoAwardReference = {
  referenceType: string
  referenceId: string
  description?: string
  metadata?: Record<string, unknown>
  createdBy?: string | null
}

export type PromoAwardSkippedReason =
  | 'DUPLICATE'
  | 'PRE_PAYMENT_CAP_REACHED'
  | 'CONDITION_NOT_MET'

export type ProviderPromoAwardResult = {
  awarded: boolean
  skippedReason?: PromoAwardSkippedReason
  award: ProviderPromoAward | null
  wallet: ProviderWallet | null
  ledgerEntries: WalletLedgerEntry[]
}

type PromoAwardTx = Prisma.TransactionClient

function assertPromoAwardReference(reference: PromoAwardReference) {
  if (!reference.referenceType.trim() || !reference.referenceId.trim()) {
    throw new ProviderPromoAwardError(
      'INVALID_REFERENCE',
      'Promo credit awards require referenceType and referenceId.',
    )
  }
}

function toJson(metadata: PromoAwardReference['metadata']): Prisma.InputJsonValue {
  // Strip undefined values before writing JSON so audit metadata is stable and
  // accepted by Prisma's JSON input type.
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

function isPrePaymentAwardType(awardType: ProviderPromoAwardType) {
  return PRE_PAYMENT_AWARD_TYPES.includes(awardType)
}

function emptyResult(
  skippedReason: PromoAwardSkippedReason,
  award: ProviderPromoAward | null = null,
): ProviderPromoAwardResult {
  return {
    awarded: false,
    skippedReason,
    award,
    wallet: null,
    ledgerEntries: [],
  }
}

async function providerExists(tx: PromoAwardTx, providerId: string) {
  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: { id: true },
  })

  if (!provider) {
    throw new ProviderPromoAwardError(
      'PROVIDER_NOT_FOUND',
      `Provider ${providerId} not found.`,
    )
  }
}

async function hasCreditedTopUp(tx: PromoAwardTx, providerId: string) {
  const creditedTopUps = await tx.paymentIntent.count({
    where: {
      providerId,
      status: 'CREDITED',
      creditedAt: { not: null },
    },
  })

  return creditedTopUps > 0
}

async function assertPrePaymentCap(
  tx: PromoAwardTx,
  providerId: string,
  awardType: ProviderPromoAwardType,
  creditsToAward: number,
) {
  if (!isPrePaymentAwardType(awardType)) return true
  if (await hasCreditedTopUp(tx, providerId)) return true

  const awardedPrePaymentCredits = await tx.providerPromoAward.aggregate({
    where: {
      providerId,
      status: 'AWARDED',
      awardType: { in: [...PRE_PAYMENT_AWARD_TYPES] },
    },
    _sum: { creditsAwarded: true },
  })

  const alreadyAwarded = awardedPrePaymentCredits._sum.creditsAwarded ?? 0
  return alreadyAwarded + creditsToAward <= PRE_PAYMENT_PROMO_CREDIT_CAP
}

export async function awardPromoCreditsForMilestone(
  providerId: string,
  awardType: ProviderPromoAwardType,
  reference: PromoAwardReference,
): Promise<ProviderPromoAwardResult> {
  return db.$transaction((tx) => (
    awardPromoCreditsForMilestoneInTransaction(tx, providerId, awardType, reference)
  ))
}

export async function awardPromoCreditsForMilestoneInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  awardType: ProviderPromoAwardType,
  reference: PromoAwardReference,
): Promise<ProviderPromoAwardResult> {
  assertPromoAwardReference(reference)

  const creditsToAward = PROVIDER_PROMO_CREDIT_REWARDS[awardType]
  if (!creditsToAward) {
    throw new ProviderPromoAwardError(
      'UNKNOWN_AWARD_TYPE',
      `Unsupported provider promo award type: ${awardType}.`,
    )
  }

  await providerExists(tx, providerId)

  const existingAward = await tx.providerPromoAward.findUnique({
    where: { providerId_awardType: { providerId, awardType } },
  })
  if (existingAward) return emptyResult('DUPLICATE', existingAward)

  if (!(await assertPrePaymentCap(tx, providerId, awardType, creditsToAward))) {
    return emptyResult('PRE_PAYMENT_CAP_REACHED')
  }

  // createMany with skipDuplicates turns double-fired milestone events into a
  // harmless no-op without throwing a unique constraint error inside the caller's
  // larger transaction.
  const awardId = crypto.randomUUID()
  const created = await tx.providerPromoAward.createMany({
    data: [{
      id: awardId,
      providerId,
      awardType,
      creditsAwarded: creditsToAward,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      metadata: toJson(reference.metadata),
    }],
    skipDuplicates: true,
  })

  const award = await tx.providerPromoAward.findUnique({
    where: { providerId_awardType: { providerId, awardType } },
  })

  if (created.count !== 1 || !award) {
    return emptyResult('DUPLICATE', award)
  }

  const walletResult = await creditPromoCreditsInTransaction(
    tx,
    providerId,
    creditsToAward,
    {
      referenceType: 'provider_promo_award',
      referenceId: award.id,
      description: reference.description ?? promoAwardDescription(awardType, creditsToAward),
      metadata: {
        awardType,
        milestoneReferenceType: reference.referenceType,
        milestoneReferenceId: reference.referenceId,
        ...(reference.metadata ?? {}),
      },
      createdBy: reference.createdBy,
    },
  )

  return {
    awarded: true,
    award,
    wallet: walletResult.wallet,
    ledgerEntries: walletResult.ledgerEntries,
  }
}

function promoAwardDescription(awardType: ProviderPromoAwardType, creditsAwarded: number) {
  const labels: Record<ProviderPromoAwardType, string> = {
    MOBILE_VERIFIED: 'Mobile verified',
    PROFILE_COMPLETED: 'Profile completed',
    KYC_APPROVED: 'KYC approved',
    FIRST_TOPUP: 'First top-up',
    FIRST_COMPLETED_JOB: 'First completed job with rating',
  }

  return `${labels[awardType]} promo award: ${creditsAwarded} Plug-A-Pro Credits`
}

export async function awardMobileVerifiedPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  reference: PromoAwardReference,
) {
  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'MOBILE_VERIFIED', reference)
}

export async function awardKycApprovedPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  reference: PromoAwardReference,
) {
  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'KYC_APPROVED', reference)
}

export async function awardFirstTopUpPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  paymentIntentId: string,
  adminUserId: string,
) {
  const earlierCreditedTopUps = await tx.paymentIntent.count({
    where: {
      providerId,
      id: { not: paymentIntentId },
      status: 'CREDITED',
      creditedAt: { not: null },
    },
  })

  if (earlierCreditedTopUps > 0) return emptyResult('CONDITION_NOT_MET')

  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'FIRST_TOPUP', {
    referenceType: 'payment_intent',
    referenceId: paymentIntentId,
    createdBy: adminUserId,
  })
}

export async function evaluateAndAwardProviderProfileCompletionPromoCredits(
  providerId: string,
  reference: PromoAwardReference,
) {
  return db.$transaction(async (tx) => (
    evaluateAndAwardProviderProfileCompletionPromoCreditsInTransaction(
      tx,
      providerId,
      reference,
    )
  ))
}

export async function evaluateAndAwardProviderProfileCompletionPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  reference: PromoAwardReference,
) {
  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      phone: true,
      bio: true,
      experience: true,
      skills: true,
      serviceAreas: true,
      avatarUrl: true,
      technicianServiceAreas: {
        where: { active: true },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!provider) {
    throw new ProviderPromoAwardError(
      'PROVIDER_NOT_FOUND',
      `Provider ${providerId} not found.`,
    )
  }

  const hasStructuredArea = provider.technicianServiceAreas.length > 0
  const completedSignals = [
    Boolean(provider.name?.trim()),
    Boolean(provider.phone?.trim()),
    Boolean(provider.bio?.trim()),
    Boolean(provider.experience?.trim()),
    provider.skills.length > 0,
    provider.serviceAreas.length > 0 || hasStructuredArea,
    Boolean(provider.avatarUrl?.trim()),
  ]

  const completionPercent = Math.round(
    (completedSignals.filter(Boolean).length / completedSignals.length) * 100,
  )

  if (completionPercent < 80 || !provider.avatarUrl?.trim()) {
    return emptyResult('CONDITION_NOT_MET')
  }

  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'PROFILE_COMPLETED', {
    ...reference,
    metadata: {
      ...(reference.metadata ?? {}),
      completionPercent,
    },
  })
}

export async function awardFirstCompletedJobWithCustomerRatingPromoCredits(
  providerId: string,
  jobId: string,
  reviewId: string,
) {
  return db.$transaction((tx) => (
    awardFirstCompletedJobWithCustomerRatingPromoCreditsInTransaction(
      tx,
      providerId,
      jobId,
      reviewId,
    )
  ))
}

export async function awardFirstCompletedJobWithCustomerRatingPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  jobId: string,
  reviewId: string,
) {
  const [job, review, completedProviderJobs] = await Promise.all([
    tx.job.findFirst({
      where: { id: jobId, providerId, status: 'COMPLETED' },
      select: { id: true },
    }),
    tx.review.findFirst({
      where: { id: reviewId, jobId, reviewerType: 'CUSTOMER' },
      select: { id: true },
    }),
    tx.job.findMany({
      where: { providerId, status: 'COMPLETED' },
      select: { id: true },
    }),
  ])

  if (!job || !review) return emptyResult('CONDITION_NOT_MET')

  const completedJobIds = completedProviderJobs
    .map((candidate) => candidate.id)
    .filter((candidateJobId) => candidateJobId !== jobId)

  if (completedJobIds.length > 0) {
    const earlierRatedJob = await tx.review.findFirst({
      where: {
        reviewerType: 'CUSTOMER',
        jobId: { in: completedJobIds },
      },
      select: { id: true },
    })

    if (earlierRatedJob) return emptyResult('CONDITION_NOT_MET')
  }

  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'FIRST_COMPLETED_JOB', {
    referenceType: 'review',
    referenceId: reviewId,
    metadata: { jobId },
  })
}
