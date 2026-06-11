import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { isEnabled } from '../flags'
import { KYC_FEE_CENTS, kycFeeAccruedKey, kycFeeSponsoredKey } from './constants'
import { findEligibleCampaign } from './campaign-matching'
import { writeKycFeeLedgerEntryInTransaction } from './ledger'

export class KycFeeBookingError extends Error {
  constructor(
    public readonly code: 'VERIFICATION_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'KycFeeBookingError'
  }
}

export type KycFeeBookingClient = Pick<
  Prisma.TransactionClient,
  | 'kycFeeLedgerEntry'
  | 'kycCampaign'
  | 'kycSponsorship'
  | 'provider'
  | 'providerIdentityVerification'
  | 'technicianServiceArea'
>

export type KycFeeBookingResult =
  | { outcome: 'FLAG_OFF' | 'ALREADY_BOOKED' }
  | {
      outcome: 'ACCRUED'
      skippedSponsorship?:
        | 'NO_ELIGIBLE_CAMPAIGN'
        | 'IDENTIFIER_ALREADY_SPONSORED'
        | 'ALLOCATION_EXHAUSTED'
        | 'ALREADY_SPONSORED_ON_CAMPAIGN'
    }
  | { outcome: 'SPONSORED'; campaignId: string; campaignCode: string; sponsorshipId: string }

/**
 * Books the once-off KYC recovery fee for a provider that just reached
 * kycStatus VERIFIED. Accrues the fee, then — if an ACTIVE, in-window,
 * area-matched campaign has allocation left — atomically claims a slot and
 * writes the sponsorship offset.
 *
 * Pass `client` when already inside a transaction (the admin approval path
 * runs transitionIdentityVerification inside crudAction's tx). With no
 * client, the whole booking runs in its own db.$transaction.
 *
 * Idempotent via the provider-scoped accrual idempotency key, plus a
 * pre-claim check for an existing (campaign, provider) sponsorship. Residual
 * concurrency duplicates surface as P2002 (accrual key or campaign unique)
 * and abort the transaction; the orchestrator hook logs them and
 * scripts/reconcile-kyc-fees.ts re-books any provider left without a fee row.
 */
export async function bookKycFeeForVerifiedProvider(
  input: { providerId: string; verificationId: string },
  client?: KycFeeBookingClient,
): Promise<KycFeeBookingResult> {
  if (!(await isEnabled('kyc.fee_accrual.enabled'))) {
    return { outcome: 'FLAG_OFF' }
  }
  if (client) return bookInTx(client, input)
  return db.$transaction((tx) => bookInTx(tx, input))
}

async function bookInTx(
  tx: KycFeeBookingClient,
  input: { providerId: string; verificationId: string },
): Promise<KycFeeBookingResult> {
  const { providerId, verificationId } = input

  const existing = await tx.kycFeeLedgerEntry.findUnique({
    where: { idempotencyKey: kycFeeAccruedKey(providerId) },
    select: { id: true },
  })
  if (existing) return { outcome: 'ALREADY_BOOKED' }

  const verification = await tx.providerIdentityVerification.findUnique({
    where: { id: verificationId },
    select: { identifierHash: true },
  })

  if (!verification) {
    throw new KycFeeBookingError(
      'VERIFICATION_NOT_FOUND',
      `Verification ${verificationId} not found while booking KYC fee for provider ${providerId}.`,
    )
  }

  await writeKycFeeLedgerEntryInTransaction(tx, {
    providerId,
    reason: 'KYC_FEE_ACCRUED',
    amountCents: KYC_FEE_CENTS,
    referenceType: 'provider_identity_verification',
    referenceId: verificationId,
    idempotencyKey: kycFeeAccruedKey(providerId),
    source: 'system',
    description: 'Once-off ID verification recovery fee',
    metadata: { identifierHashPresent: Boolean(verification.identifierHash) },
  })

  const campaign = await findEligibleCampaign(tx, providerId)
  if (!campaign) {
    return { outcome: 'ACCRUED', skippedSponsorship: 'NO_ELIGIBLE_CAMPAIGN' }
  }

  if (verification.identifierHash) {
    const priorSponsorship = await tx.kycSponsorship.findFirst({
      where: { identifierHash: verification.identifierHash, status: 'CONSUMED' },
      select: { id: true },
    })
    if (priorSponsorship) {
      return { outcome: 'ACCRUED', skippedSponsorship: 'IDENTIFIER_ALREADY_SPONSORED' }
    }
  }

  const existingOnCampaign = await tx.kycSponsorship.findFirst({
    where: { campaignId: campaign.id, providerId },
    select: { id: true },
  })
  if (existingOnCampaign) {
    return { outcome: 'ACCRUED', skippedSponsorship: 'ALREADY_SPONSORED_ON_CAMPAIGN' }
  }

  // Atomic allocation claim: WHERE re-evaluates sponsoredCount at write time,
  // so concurrent claims cannot oversubscribe the cap.
  const claimed = await tx.kycCampaign.updateMany({
    where: {
      id: campaign.id,
      status: 'ACTIVE',
      sponsoredCount: { lt: campaign.maxSponsoredCount },
    },
    data: { sponsoredCount: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { outcome: 'ACCRUED', skippedSponsorship: 'ALLOCATION_EXHAUSTED' }
  }

  const sponsorship = await tx.kycSponsorship.create({
    data: {
      campaignId: campaign.id,
      providerId,
      verificationId,
      identifierHash: verification.identifierHash ?? null,
      status: 'CONSUMED',
      source: 'system',
      feeCents: KYC_FEE_CENTS,
    },
  })

  await writeKycFeeLedgerEntryInTransaction(tx, {
    providerId,
    reason: 'KYC_FEE_SPONSORED',
    amountCents: KYC_FEE_CENTS,
    referenceType: 'kyc_sponsorship',
    referenceId: sponsorship.id,
    campaignId: campaign.id,
    idempotencyKey: kycFeeSponsoredKey(sponsorship.id),
    source: 'system',
    description: `ID verification fee sponsored by launch campaign ${campaign.campaignCode}`,
  })

  return {
    outcome: 'SPONSORED',
    campaignId: campaign.id,
    campaignCode: campaign.campaignCode,
    sponsorshipId: sponsorship.id,
  }
}
