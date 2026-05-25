import type { Prisma, KycStatus } from '@prisma/client'
import { db } from '../db'
import type { VerificationDecision, VerificationStatus } from './types'

const ALLOWED_TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  NOT_STARTED: ['STARTED'],
  STARTED: ['CONSENTED', 'CANCELLED', 'EXPIRED'],
  CONSENTED: ['AWAITING_IDENTIFIER', 'CANCELLED', 'EXPIRED'],
  AWAITING_IDENTIFIER: ['AWAITING_DOCUMENT', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  AWAITING_DOCUMENT: ['AWAITING_SELFIE', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  AWAITING_SELFIE: ['SUBMITTED', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  SUBMITTED: ['PROCESSING', 'NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'RETRY_REQUIRED'],
  PROCESSING: ['NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'RETRY_REQUIRED'],
  NEEDS_MANUAL_REVIEW: ['PASSED', 'FAILED', 'RETRY_REQUIRED', 'CANCELLED'],
  RETRY_REQUIRED: ['AWAITING_IDENTIFIER', 'AWAITING_DOCUMENT', 'AWAITING_SELFIE', 'CANCELLED', 'EXPIRED'],
  PASSED: ['EXPIRED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
}

type IdentityVerificationClient = {
  providerIdentityVerification: {
    findUnique(args: {
      where: { id: string }
      select: { id: true; providerId: true; status: true; decision: true }
    }): Promise<{
      id: string
      providerId: string | null
      status: VerificationStatus
      decision: VerificationDecision | null
    } | null>
    update(args: {
      where: { id: string }
      data: Prisma.ProviderIdentityVerificationUpdateInput
    }): Promise<unknown>
  }
  providerVerificationEvent: {
    create(args: { data: Prisma.ProviderVerificationEventUncheckedCreateInput }): Promise<unknown>
  }
  provider: {
    update(args: { where: { id: string }; data: { kycStatus: KycStatus } }): Promise<unknown>
  }
}

export type TransitionIdentityVerificationInput = {
  verificationId: string
  toStatus: VerificationStatus
  decision?: VerificationDecision
  reasonCode?: string
  actorId?: string
  actorRole?: string
  metadata?: Record<string, unknown>
  data?: Prisma.ProviderIdentityVerificationUpdateInput
}

export class IdentityVerificationTransitionError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_TRANSITION',
    message: string,
  ) {
    super(message)
    this.name = 'IdentityVerificationTransitionError'
  }
}

export async function transitionIdentityVerification(
  input: TransitionIdentityVerificationInput,
  client: IdentityVerificationClient = db,
) {
  const current = await client.providerIdentityVerification.findUnique({
    where: { id: input.verificationId },
    select: { id: true, providerId: true, status: true, decision: true },
  })

  if (!current) {
    throw new IdentityVerificationTransitionError(
      'NOT_FOUND',
      `Identity verification ${input.verificationId} was not found.`,
    )
  }

  if (!ALLOWED_TRANSITIONS[current.status].includes(input.toStatus)) {
    throw new IdentityVerificationTransitionError(
      'INVALID_TRANSITION',
      `Cannot move identity verification ${input.verificationId} from ${current.status} to ${input.toStatus}.`,
    )
  }

  const updated = await client.providerIdentityVerification.update({
    where: { id: input.verificationId },
    data: {
      ...(input.data ?? {}),
      status: input.toStatus,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.reasonCode ? { failureReasonCode: input.reasonCode } : {}),
    },
  })

  await client.providerVerificationEvent.create({
    data: {
      verificationId: input.verificationId,
      fromStatus: current.status,
      toStatus: input.toStatus,
      actorId: input.actorId,
      actorRole: input.actorRole,
      decision: input.decision,
      reasonCode: input.reasonCode,
      metadata: toJson(input.metadata),
    },
  })

  if (current.providerId) {
    const kycStatus = kycStatusForTransition(input.toStatus, input.decision)
    if (kycStatus) {
      await client.provider.update({
        where: { id: current.providerId },
        data: { kycStatus },
      })
    }
  }

  return updated
}

function kycStatusForTransition(
  status: VerificationStatus,
  decision?: VerificationDecision,
): KycStatus | null {
  if (status === 'PASSED' && decision === 'PASS') return 'VERIFIED'
  if (status === 'FAILED') return 'REJECTED'
  if (status === 'EXPIRED') return 'EXPIRED'
  return null
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
