import { createHash, randomBytes } from 'crypto'

import { db } from './db'

const DEFAULT_TOKEN_TTL_HOURS = 72
const TERMINAL_STATUSES = new Set(['PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'])

export type ProviderVerificationTokenErrorCode =
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'TOKEN_TERMINAL'

export class ProviderVerificationTokenError extends Error {
  constructor(
    public readonly code: ProviderVerificationTokenErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderVerificationTokenError'
  }
}

export async function issueProviderVerificationToken(params: {
  verificationId: string
  now?: Date
}): Promise<{ token: string; expiresAt: Date }> {
  const now = params.now ?? new Date()
  const token = randomBytes(24).toString('hex')
  const expiresAt = addHours(now, readTokenTtlHours())

  await db.providerIdentityVerification.update({
    where: { id: params.verificationId },
    data: {
      accessTokenHash: hashProviderVerificationToken(token),
      accessTokenExpiresAt: expiresAt,
      accessTokenLastUsedAt: null,
      accessTokenRevokedAt: null,
    },
  })

  return { token, expiresAt }
}

export async function resolveProviderVerificationToken(
  token: string,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date()
  const verification = await db.providerIdentityVerification.findUnique({
    where: { accessTokenHash: hashProviderVerificationToken(token) },
  })

  if (!verification) {
    throw new ProviderVerificationTokenError('TOKEN_INVALID', 'Verification link is invalid.')
  }
  if (verification.accessTokenRevokedAt) {
    throw new ProviderVerificationTokenError('TOKEN_REVOKED', 'Verification link has been revoked.')
  }
  if (!verification.accessTokenExpiresAt || verification.accessTokenExpiresAt <= now) {
    throw new ProviderVerificationTokenError('TOKEN_EXPIRED', 'Verification link has expired.')
  }
  if (TERMINAL_STATUSES.has(verification.status)) {
    throw new ProviderVerificationTokenError('TOKEN_TERMINAL', 'Verification is already complete.')
  }

  await db.providerIdentityVerification.update({
    where: { id: verification.id },
    data: { accessTokenLastUsedAt: now },
  })

  return verification
}

export function hashProviderVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function readTokenTtlHours(): number {
  const configured = Number.parseInt(process.env.IDENTITY_VERIFICATION_TOKEN_TTL_HOURS ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TOKEN_TTL_HOURS
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}
