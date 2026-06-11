import { KycStatus, ProviderStatus } from '@prisma/client'
import { db } from '../db'

export type ProviderCreditGateProvider = {
  active: boolean
  verified: boolean
  status: ProviderStatus
  kycStatus: KycStatus
  suspendedUntil: Date | null
}

export type ProviderCreditBlockReason =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_INACTIVE'
  | 'PROVIDER_NOT_APPROVED'
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_SUSPENDED'
  | 'KYC_NOT_VERIFIED'
  | 'HIGH_ASSURANCE_IDENTITY_REQUIRED'

export type IdentityVerificationLookupClient = {
  provider: {
    findUnique(args: {
      where: { id: string }
      select: {
        active: true
        verified: true
        status: true
        kycStatus: true
        suspendedUntil: true
      }
    }): Promise<ProviderCreditGateProvider | null>
  }
  providerIdentityVerification: {
    findFirst(args: {
      where: { providerId: string }
      orderBy: Array<{ createdAt: 'desc' } | { updatedAt: 'desc' }>
      select: {
        id: true
        providerId: true
        status: true
        decision: true
        assuranceLevel: true
        expiresAt: true
      }
    }): Promise<LatestProviderIdentityVerification | null>
  }
}

type LatestProviderIdentityVerification = {
  id: string
  providerId: string | null
  status: string | null
  decision: string | null
  assuranceLevel: string | null
  expiresAt: Date | null
}

export type HighAssuranceCreditVerificationWhere = {
  providerId: string
  status: 'PASSED'
  decision: 'PASS'
  assuranceLevel: 'HIGH'
  OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>
}

export type EligibilityLookupClient = IdentityVerificationLookupClient

export function providerCreditProfileBlockReason(
  provider: ProviderCreditGateProvider | null,
  now = new Date(),
): ProviderCreditBlockReason | null {
  if (!provider) return 'PROVIDER_NOT_FOUND'
  if (!provider.active) return 'PROVIDER_INACTIVE'
  if (!provider.verified) return 'PROVIDER_NOT_APPROVED'
  if (provider.status !== ProviderStatus.ACTIVE) return 'PROVIDER_NOT_ACTIVE'
  if (provider.suspendedUntil && provider.suspendedUntil.getTime() > now.getTime()) {
    return 'PROVIDER_SUSPENDED'
  }
  if (provider.kycStatus !== KycStatus.VERIFIED) return 'KYC_NOT_VERIFIED'
  return null
}

export function isProviderProfileEligibleForCreditPurchases(
  provider: ProviderCreditGateProvider | null,
  now = new Date(),
): provider is ProviderCreditGateProvider {
  return providerCreditProfileBlockReason(provider, now) === null
}

// NOTE: this where-clause is shared with the verification-start "already
// verified?" check in gate.ts and with provider-journey.ts. It returns the
// predicate for a high-assurance PASS row but does NOT by itself guarantee that
// row is the provider's LATEST verification. The credit gate
// (findEligibleCreditIdentity) additionally enforces the latest-record rule via
// isPassingCreditVerification so a stale PASS cannot unlock paid credits when a
// newer adverse record exists. Do not weaken this predicate for other callers.
export function buildHighAssuranceCreditVerificationWhere(
  providerId: string,
  now = new Date(),
): HighAssuranceCreditVerificationWhere {
  return {
    providerId,
    status: 'PASSED',
    decision: 'PASS',
    assuranceLevel: 'HIGH',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

/**
 * True only when this (latest) verification row is a current high-assurance pass:
 * status PASSED, decision PASS, assuranceLevel HIGH, and not expired.
 */
export function isPassingCreditVerification(
  verification: LatestProviderIdentityVerification | null,
  now = new Date(),
): boolean {
  if (!verification) return false
  if (verification.status !== 'PASSED') return false
  if (verification.decision !== 'PASS') return false
  if (verification.assuranceLevel !== 'HIGH') return false
  if (verification.expiresAt && verification.expiresAt.getTime() <= now.getTime()) return false
  return true
}

export class IdentityCreditGateError extends Error {
  readonly code = 'IDENTITY_NOT_VERIFIED'

  constructor(
    readonly reason: ProviderCreditBlockReason = 'HIGH_ASSURANCE_IDENTITY_REQUIRED',
  ) {
    super('High-assurance identity verification is required before purchasing credits.')
    this.name = 'IdentityCreditGateError'
  }
}

async function findEligibleCreditIdentity(
  providerId: string,
  client: IdentityVerificationLookupClient,
): Promise<{ providerId: string; verificationId: string } | null> {
  const provider = await client.provider.findUnique({
    where: { id: providerId },
    select: {
      active: true,
      verified: true,
      status: true,
      kycStatus: true,
      suspendedUntil: true,
    },
  })

  if (!isProviderProfileEligibleForCreditPurchases(provider)) {
    return null
  }

  // Fetch the LATEST verification record for this provider regardless of outcome,
  // then require that this most-recent row is a current high-assurance pass.
  // Ordering by createdAt (then updatedAt as a tie-breaker) ensures a newer
  // adverse verification (FAILED / CANCELLED / EXPIRED / manual-review) supersedes
  // any older PASS - a stale historical pass must not unlock paid credits.
  const verification = await client.providerIdentityVerification.findFirst({
    where: { providerId },
    orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      providerId: true,
      status: true,
      decision: true,
      assuranceLevel: true,
      expiresAt: true,
    },
  })

  if (!isPassingCreditVerification(verification)) {
    return null
  }

  return { providerId, verificationId: verification!.id }
}

export async function assertIdentityVerifiedForCredits(
  providerId: string,
  client: IdentityVerificationLookupClient = db,
): Promise<{ providerId: string; verificationId: string | null }> {
  const eligibleIdentity = await findEligibleCreditIdentity(providerId, client)

  if (!eligibleIdentity) {
    throw new IdentityCreditGateError()
  }

  return eligibleIdentity
}

// Non-throwing eligibility check (display gating).
//
// Use this to determine whether to SHOW the top-up UI. The throwing gate above
// (assertIdentityVerifiedForCredits) remains the server-side enforcement backstop.
//
// IMPORTANT: the verification where-clause is built by
// buildHighAssuranceCreditVerificationWhere and shared with the throwing gate.
// The full kycStatus + verification-row predicate is shared through
// findEligibleCreditIdentity. Change that helper when the paid-credit
// verification predicate changes.
//
// Returns true only when the provider profile is active, marketplace-approved,
// status ACTIVE, KYC VERIFIED, not currently suspended, and has a current
// PASSED/PASS/HIGH ProviderIdentityVerification row.
export async function isProviderEligibleForCredits(
  providerId: string,
  client: EligibilityLookupClient = db,
): Promise<boolean> {
  return Boolean(await findEligibleCreditIdentity(providerId, client))
}
