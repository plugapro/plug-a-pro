import type { IdentityBasis, VerificationChannel, VerificationStatus } from '@prisma/client'

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  checkCanStartNewVerification,
  type VerificationStartBlockReason,
  type VerificationStartPurpose,
} from '@/lib/identity-verification/gate'
import { NON_TERMINAL_VERIFICATION_STATUSES } from '@/lib/identity-verification/types'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'
import { issueProviderVerificationToken } from '@/lib/provider-verification-token'

export class ProviderIdentityVerificationLinkError extends Error {
  constructor(
    public readonly code: 'PROVIDER_NOT_FOUND' | 'VERIFICATION_NOT_RESUMABLE' | VerificationStartBlockReason,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderIdentityVerificationLinkError'
  }
}

export type IssueProviderIdentityVerificationLinkInput = {
  providerId: string
  // When set, the caller has already selected the exact verification row to
  // resume (e.g. the in-flight re-nudge cron): the fail-safe gate and the
  // channel-scoped legacy lookup are both skipped.
  verificationId?: string
  providerApplicationId?: string | null
  channel?: VerificationChannel
  identityBasis?: IdentityBasis
  purpose?: VerificationStartPurpose
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

  if (input.verificationId) {
    const selected = await db.providerIdentityVerification.findFirst({
      where: {
        id: input.verificationId,
        providerId: input.providerId,
        status: { in: [...NON_TERMINAL_VERIFICATION_STATUSES] },
      },
      select: { id: true, status: true },
    })
    if (!selected) {
      throw new ProviderIdentityVerificationLinkError(
        'VERIFICATION_NOT_RESUMABLE',
        'The requested identity verification is not resumable for this provider.',
      )
    }
    const { token, expiresAt } = await issueProviderVerificationToken({
      verificationId: selected.id,
      now: input.now,
    })
    return {
      verificationId: selected.id,
      verificationUrl: getPublicAppUrl(`/provider/verify/${encodeURIComponent(token)}`) || null,
      expiresAt,
      reused: true,
      status: selected.status,
    }
  }

  const failSafeEnabled = await isEnabled('provider.identity.verification.fail_safe', {
    userId: input.providerId,
  })

  let reused = false
  let verification: { id: string; status: VerificationStatus }

  if (failSafeEnabled) {
    const gate = await checkCanStartNewVerification(input.providerId, {
      purpose: input.purpose ?? 'GENERAL_IDENTITY',
      now: input.now,
    })

    if (gate.ok === false) {
      throw new ProviderIdentityVerificationLinkError(gate.reason, gate.message)
    }

    if (gate.ok === 'RESUME') {
      reused = true
      verification = { id: gate.verificationId, status: gate.status }
    } else {
      verification = await db.providerIdentityVerification.create({
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
    }
  } else {
    const existing = await db.providerIdentityVerification.findFirst({
      where: {
        providerId: input.providerId,
        channel,
        status: { in: [...NON_TERMINAL_VERIFICATION_STATUSES] },
      },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    })

    reused = Boolean(existing)
    verification = existing ?? await db.providerIdentityVerification.create({
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
    status: verification.status,
  }
}
