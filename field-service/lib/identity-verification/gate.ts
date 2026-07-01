import { db } from '../db'
import { isPassingCreditVerification } from './credit-gate'
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

  if (options.purpose === 'CREDIT_TOP_UP') {
    // LATEST-row semantics, matching the credit purchase gate
    // (credit-gate.ts findEligibleCreditIdentity) exactly: fetch the provider's
    // most recent verification row and block only when THAT row is a current
    // high-assurance pass. An any-historical-PASS check here would deadlock a
    // provider whose old PASS is superseded by a newer adverse row (FAILED /
    // CANCELLED / EXPIRED): the purchase gate rejects the latest adverse row
    // while every re-verification entry point would refuse to start — so they
    // could never buy credits again. Latest-row + fall-through to CREATE keeps
    // both gates in agreement and lets the provider re-verify.
    const latestVerification = await client.providerIdentityVerification.findFirst({
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
    }) as {
      id: string
      providerId: string | null
      status: string | null
      decision: string | null
      assuranceLevel: string | null
      expiresAt: Date | null
    } | null

    if (isPassingCreditVerification(latestVerification, options.now ?? new Date())) {
      return {
        ok: false,
        reason: 'PROVIDER_ALREADY_VERIFIED',
        message: 'Your identity is already verified for credit top-ups. No new verification is needed.',
      }
    }
  } else {
    const existingVerified = await client.providerIdentityVerification.findFirst({
      where: { providerId, status: 'PASSED' as const },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    }) as { id: string } | null

    if (existingVerified) {
      return {
        ok: false,
        reason: 'PROVIDER_ALREADY_VERIFIED',
        message: 'Your identity is already verified. No new verification is needed.',
      }
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
