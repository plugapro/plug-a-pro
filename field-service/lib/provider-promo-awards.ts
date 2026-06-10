import {
  Prisma,
  type ProviderPromoAward,
  type ProviderPromoAwardType,
  type ProviderWallet,
  type WalletLedgerEntry,
} from '@prisma/client'
import { db } from './db'
import {
  INTERNAL_TEST_ONBOARDING_CREDITS,
  INTERNAL_TEST_COHORT_NAME,
  isInternalTestPhone,
  isInternalTestOnboardingCreditPhone,
} from './internal-test-cohort'
import { creditPromoCreditsInTransaction } from './provider-wallet'

// Only MOBILE_VERIFIED is active. All other award types have been deactivated.
// Do not re-add other types without an explicit product decision.
const MOBILE_VERIFIED_CREDITS = 3

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
  | 'CONDITION_NOT_MET'

export type ProviderPromoAwardResult = {
  awarded: boolean
  skippedReason?: PromoAwardSkippedReason
  award: ProviderPromoAward | null
  wallet: ProviderWallet | null
  ledgerEntries: WalletLedgerEntry[]
}

type PromoAwardTx = Prisma.TransactionClient
type PromoAwardProvider = {
  id: string
  phone: string | null
}

function assertPromoAwardReference(reference: PromoAwardReference) {
  if (!reference.referenceType.trim() || !reference.referenceId.trim()) {
    throw new ProviderPromoAwardError(
      'INVALID_REFERENCE',
      'Promo credit awards require referenceType and referenceId.',
    )
  }
}

function toJson(metadata: PromoAwardReference['metadata']): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

function emptyResult(
  skippedReason: PromoAwardSkippedReason,
  award: ProviderPromoAward | null = null,
): ProviderPromoAwardResult {
  return { awarded: false, skippedReason, award, wallet: null, ledgerEntries: [] }
}

async function getProviderForPromoAward(
  tx: PromoAwardTx,
  providerId: string,
): Promise<PromoAwardProvider> {
  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: { id: true, phone: true },
  })
  if (!provider) {
    throw new ProviderPromoAwardError('PROVIDER_NOT_FOUND', `Provider ${providerId} not found.`)
  }
  return provider
}

function creditsForAwardType(awardType: ProviderPromoAwardType, provider: PromoAwardProvider): number {
  if (awardType !== 'MOBILE_VERIFIED') {
    throw new ProviderPromoAwardError(
      'UNKNOWN_AWARD_TYPE',
      `Award type ${awardType} is not active. Only MOBILE_VERIFIED awards are issued.`,
    )
  }
  return isInternalTestOnboardingCreditPhone(provider.phone)
    ? INTERNAL_TEST_ONBOARDING_CREDITS
    : MOBILE_VERIFIED_CREDITS
}

function promoAwardDescription(creditsAwarded: number) {
  return `Mobile verified promo award: ${creditsAwarded} Plug A Pro provider credits`
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

  const provider = await getProviderForPromoAward(tx, providerId)
  const creditsToAward = creditsForAwardType(awardType, provider)
  const isTestAward = isInternalTestPhone(provider.phone)

  const existingAward = await tx.providerPromoAward.findUnique({
    where: { providerId_awardType: { providerId, awardType } },
  })
  if (existingAward) return emptyResult('DUPLICATE', existingAward)

  // Guard: never award milestone credits to a provider who already holds a
  // non-zero promo balance. Credits must be seeded once via the activation
  // voucher path; any subsequent top-up must go through a deliberate admin
  // adjustment so it is auditable and intentional.
  const existingWallet = await tx.providerWallet.findUnique({
    where: { providerId },
    select: { promoCreditBalance: true },
  })
  if (existingWallet && existingWallet.promoCreditBalance > 0) {
    return emptyResult('CONDITION_NOT_MET')
  }

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

  if (created.count !== 1 || !award) return emptyResult('DUPLICATE', award)

  const walletResult = await creditPromoCreditsInTransaction(
    tx,
    providerId,
    creditsToAward,
    {
      referenceType: 'provider_promo_award',
      referenceId: award.id,
      description: reference.description ?? promoAwardDescription(creditsToAward),
      metadata: {
        awardType,
        milestoneReferenceType: reference.referenceType,
        milestoneReferenceId: reference.referenceId,
        ...(reference.metadata ?? {}),
      },
      createdBy: reference.createdBy,
      isTestTransaction: isTestAward,
      cohortName: isTestAward ? INTERNAL_TEST_COHORT_NAME : null,
    },
  )

  return { awarded: true, award, wallet: walletResult.wallet, ledgerEntries: walletResult.ledgerEntries }
}

export async function awardMobileVerifiedPromoCreditsInTransaction(
  tx: PromoAwardTx,
  providerId: string,
  reference: PromoAwardReference,
) {
  return awardPromoCreditsForMilestoneInTransaction(tx, providerId, 'MOBILE_VERIFIED', reference)
}
