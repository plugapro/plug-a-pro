import type { IdentityBasis, VerificationChannel } from '@prisma/client'

import { db } from '@/lib/db'
import { NON_TERMINAL_VERIFICATION_STATUSES } from '@/lib/identity-verification/types'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'
import { issueProviderVerificationToken } from '@/lib/provider-verification-token'

export type IssueProviderApplicationVerificationLinkInput = {
  providerApplicationDraftId: string
  channel: VerificationChannel
  identityBasis?: IdentityBasis
  now?: Date
}

export type IssueProviderApplicationVerificationLinkResult = {
  verificationId: string
  verificationUrl: string | null
  expiresAt: Date
  reused: boolean
}

/**
 * Issues a verification link anchored to a ProviderApplicationDraft.
 *
 * Unlike issueProviderIdentityVerificationLink, there is no Provider row yet at
 * application stage, so this function:
 * - does NOT load a Provider or call checkCanStartNewVerification
 * - sets providerId: null on the created ProviderIdentityVerification row
 * - sets providerApplicationDraftId to anchor to the draft
 *
 * Re-issues idempotently: if an existing non-terminal verification for this
 * draft exists, it is reused rather than creating a duplicate.
 */
export async function issueProviderApplicationVerificationLink(
  input: IssueProviderApplicationVerificationLinkInput,
  client = db,
): Promise<IssueProviderApplicationVerificationLinkResult> {
  const existing = await client.providerIdentityVerification.findFirst({
    where: {
      providerApplicationDraftId: input.providerApplicationDraftId,
      status: { in: [...NON_TERMINAL_VERIFICATION_STATUSES] },
    },
    select: { id: true, status: true },
    orderBy: { updatedAt: 'desc' },
  })

  let reused: boolean
  let verification: { id: string; status: string }

  if (existing) {
    reused = true
    verification = existing
  } else {
    reused = false
    verification = await client.providerIdentityVerification.create({
      data: {
        providerId: null,
        providerApplicationDraftId: input.providerApplicationDraftId,
        channel: input.channel,
        identityBasis: input.identityBasis ?? 'SA_ID',
        status: 'NOT_STARTED',
        assuranceLevel: 'LOW',
        countsTowardAttemptCap: true,
      },
      select: { id: true, status: true },
    })
  }

  const { token, expiresAt } = await issueProviderVerificationToken({
    verificationId: verification.id,
    now: input.now,
  })

  const verificationUrl = getPublicAppUrl(`/provider/verify/${encodeURIComponent(token)}`) || null

  return {
    verificationId: verification.id,
    verificationUrl,
    expiresAt,
    reused,
  }
}
