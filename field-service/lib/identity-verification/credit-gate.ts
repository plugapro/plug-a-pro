import { db } from '../db'
import { isEnabled } from '../flags'

export class IdentityCreditGateError extends Error {
  readonly code = 'IDENTITY_NOT_VERIFIED'

  constructor() {
    super('High-assurance identity verification is required before purchasing credits.')
    this.name = 'IdentityCreditGateError'
  }
}

export async function assertIdentityVerifiedForCredits(
  providerId: string,
): Promise<{ providerId: string; verificationId: string | null }> {
  if (!(await isEnabled('provider.identity.verification'))) {
    return { providerId, verificationId: null }
  }

  const verification = await db.providerIdentityVerification.findFirst({
    where: {
      providerId,
      status: 'PASSED',
      decision: 'PASS',
      assuranceLevel: 'HIGH',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, providerId: true },
  })

  if (!verification) {
    throw new IdentityCreditGateError()
  }

  return { providerId: verification.providerId!, verificationId: verification.id }
}
