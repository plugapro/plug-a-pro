import { KycStatus } from '@prisma/client'
import { db } from '../db'
import { isEnabled } from '../flags'

export type IdentityVerificationLookupClient = {
  provider: {
    findUnique(args: {
      where: { id: string }
      select: { kycStatus: true }
    }): Promise<{ kycStatus: KycStatus } | null>
  }
  providerIdentityVerification: {
    findFirst(args: {
      where: {
        providerId: string
        status: 'PASSED'
        decision: 'PASS'
        assuranceLevel: 'HIGH'
        OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>
      }
      orderBy: { updatedAt: 'desc' }
      select: { id: true; providerId: true }
    }): Promise<{ id: string; providerId: string | null } | null>
  }
}

type IdentityVerificationFindFirstArgs = Parameters<
  IdentityVerificationLookupClient['providerIdentityVerification']['findFirst']
>[0]

export type HighAssuranceCreditVerificationWhere = IdentityVerificationFindFirstArgs['where']

export type EligibilityLookupClient = IdentityVerificationLookupClient

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

export class IdentityCreditGateError extends Error {
  readonly code = 'IDENTITY_NOT_VERIFIED'

  constructor() {
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
    select: { kycStatus: true },
  })

  if (!provider || provider.kycStatus !== KycStatus.VERIFIED) {
    return null
  }

  const verification = await client.providerIdentityVerification.findFirst({
    where: buildHighAssuranceCreditVerificationWhere(providerId),
    orderBy: { updatedAt: 'desc' },
    select: { id: true, providerId: true },
  })

  if (!verification) {
    return null
  }

  return { providerId, verificationId: verification.id }
}

export async function assertIdentityVerifiedForCredits(
  providerId: string,
  client: IdentityVerificationLookupClient = db,
): Promise<{ providerId: string; verificationId: string | null }> {
  if (!(await isEnabled('provider.identity.verification'))) {
    return { providerId, verificationId: null }
  }

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
// Returns true when:
//   - the flag 'provider.identity.verification' is off (no-op; current behaviour)
//   - OR the provider has kycStatus === VERIFIED and a current PASSED/PASS/HIGH
//     ProviderIdentityVerification row.
export async function isProviderEligibleForCredits(
  providerId: string,
  client: EligibilityLookupClient = db,
): Promise<boolean> {
  if (!(await isEnabled('provider.identity.verification'))) {
    // Flag off means everyone is eligible, preserving behaviour before gating.
    return true
  }

  return Boolean(await findEligibleCreditIdentity(providerId, client))
}
