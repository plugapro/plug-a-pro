import type { IdentityBasis, VerificationChannel, VerificationStatus } from '@prisma/client'

import { db } from '@/lib/db'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'
import { issueProviderVerificationToken } from '@/lib/provider-verification-token'

const NON_TERMINAL_VERIFICATION_STATUSES: VerificationStatus[] = [
  'NOT_STARTED',
  'STARTED',
  'CONSENTED',
  'AWAITING_IDENTIFIER',
  'AWAITING_DOCUMENT',
  'AWAITING_SELFIE',
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_MANUAL_REVIEW',
  'RETRY_REQUIRED',
]

export class ProviderIdentityVerificationLinkError extends Error {
  constructor(
    public readonly code: 'PROVIDER_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderIdentityVerificationLinkError'
  }
}

export type IssueProviderIdentityVerificationLinkInput = {
  providerId: string
  providerApplicationId?: string | null
  channel?: VerificationChannel
  identityBasis?: IdentityBasis
  now?: Date
}

export type IssueProviderIdentityVerificationLinkResult = {
  verificationId: string
  verificationUrl: string | null
  expiresAt: Date
  reused: boolean
  status: VerificationStatus
}

export async function issueProviderIdentityVerificationLink(
  input: IssueProviderIdentityVerificationLinkInput,
): Promise<IssueProviderIdentityVerificationLinkResult> {
  const channel = input.channel ?? 'PWA'
  const provider = await db.provider.findUnique({
    where: { id: input.providerId },
    select: { id: true },
  })

  if (!provider) {
    throw new ProviderIdentityVerificationLinkError(
      'PROVIDER_NOT_FOUND',
      'Provider account not found for identity verification link.',
    )
  }

  const existing = await db.providerIdentityVerification.findFirst({
    where: {
      providerId: input.providerId,
      channel,
      status: { in: NON_TERMINAL_VERIFICATION_STATUSES },
    },
    select: { id: true, status: true },
    orderBy: { updatedAt: 'desc' },
  })

  const verification = existing ?? await db.providerIdentityVerification.create({
    data: {
      providerId: input.providerId,
      providerApplicationId: input.providerApplicationId ?? null,
      channel,
      identityBasis: input.identityBasis ?? 'SA_ID',
      status: 'NOT_STARTED',
      assuranceLevel: 'LOW',
    },
    select: { id: true, status: true },
  })

  const { token, expiresAt } = await issueProviderVerificationToken({
    verificationId: verification.id,
    now: input.now,
  })

  const verificationUrl = getPublicAppUrl(`/provider/verify/${encodeURIComponent(token)}`) || null

  return {
    verificationId: verification.id,
    verificationUrl,
    expiresAt,
    reused: Boolean(existing),
    status: verification.status,
  }
}
