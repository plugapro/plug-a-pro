import { db } from '../db'
import { buildHighAssuranceCreditVerificationWhere } from './credit-gate'
import {
  NON_TERMINAL_VERIFICATION_STATUSES,
  type VerificationChannel,
  type VerificationStatus,
} from './types'

export type VerificationStartPurpose = 'GENERAL_IDENTITY' | 'CREDIT_TOP_UP'

export type VerificationStartBlockReason =
  | 'PROVIDER_ALREADY_VERIFIED'
  | 'VERIFICATION_LOCKED'

export type VerificationStartCheck =
  | { ok: 'CREATE' }
  | {
      ok: 'RESUME'
      verificationId: string
      status: VerificationStatus
      channel: VerificationChannel
    }
  | {
      ok: false
      reason: VerificationStartBlockReason
      message: string
    }

export type VerificationStartGateClient = {
  providerIdentityVerification: {
    findFirst(args: unknown): Promise<unknown>
    count(args: unknown): Promise<number>
  }
}

export type CheckCanStartNewVerificationOptions = {
  purpose: VerificationStartPurpose
  now?: Date
  client?: VerificationStartGateClient
}

const MAX_FAILED_ATTEMPTS = 3

export async function checkCanStartNewVerification(
  providerId: string,
  options: CheckCanStartNewVerificationOptions,
): Promise<VerificationStartCheck> {
  const client = (options.client ?? db) as VerificationStartGateClient

  const inProgress = await client.providerIdentityVerification.findFirst({
    where: {
      providerId,
      status: { in: [...NON_TERMINAL_VERIFICATION_STATUSES] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, channel: true },
  }) as { id: string; status: VerificationStatus; channel: VerificationChannel } | null

  if (inProgress) {
    return {
      ok: 'RESUME',
      verificationId: inProgress.id,
      status: inProgress.status,
      channel: inProgress.channel,
    }
  }

  const existingVerifiedWhere = options.purpose === 'CREDIT_TOP_UP'
    ? buildHighAssuranceCreditVerificationWhere(providerId, options.now)
    : { providerId, status: 'PASSED' as const }

  const existingVerified = await client.providerIdentityVerification.findFirst({
    where: existingVerifiedWhere,
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  }) as { id: string } | null

  if (existingVerified) {
    return {
      ok: false,
      reason: 'PROVIDER_ALREADY_VERIFIED',
      message: options.purpose === 'CREDIT_TOP_UP'
        ? 'Your identity is already verified for credit top-ups. No new verification is needed.'
        : 'Your identity is already verified. No new verification is needed.',
    }
  }

  const failedAttempts = await client.providerIdentityVerification.count({
    where: {
      providerId,
      status: 'FAILED',
      countsTowardAttemptCap: true,
    },
  })

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return {
      ok: false,
      reason: 'VERIFICATION_LOCKED',
      message: 'Identity verification is locked after multiple failed attempts. Please contact support.',
    }
  }

  return { ok: 'CREATE' }
}
