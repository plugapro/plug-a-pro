import type { OpsQueueType } from '@prisma/client'

type OpsQueueAssignmentRecord = {
  id: string
  queueType: OpsQueueType
  entityId: string
  claimedById: string | null
  claimedByRole: string | null
  claimedByLabel: string | null
  claimedAt: Date | null
}

type OpsQueueClient = {
  opsQueueAssignment: {
    findMany: (...args: any[]) => Promise<OpsQueueAssignmentRecord[]>
    upsert: (...args: any[]) => Promise<OpsQueueAssignmentRecord>
    updateMany: (...args: any[]) => Promise<{ count: number }>
  }
}

export const OPS_QUEUE_TYPES = {
  VALIDATION: 'VALIDATION',
  DISPATCH: 'DISPATCH',
  QUOTE_APPROVAL: 'QUOTE_APPROVAL',
  FIELD_EXCEPTION: 'FIELD_EXCEPTION',
  DISPUTE: 'DISPUTE',
  PAYMENT_FOLLOW_UP: 'PAYMENT_FOLLOW_UP',
  PROVIDER_ONBOARDING: 'PROVIDER_ONBOARDING',
} as const satisfies Record<string, OpsQueueType>

export async function listOpsQueueAssignments(
  client: OpsQueueClient,
  queueType: OpsQueueType,
  entityIds: string[],
) {
  if (entityIds.length === 0) return new Map<string, OpsQueueAssignmentRecord>()

  const assignments = await client.opsQueueAssignment.findMany({
    where: {
      queueType,
      entityId: { in: entityIds },
    },
    select: {
      id: true,
      queueType: true,
      entityId: true,
      claimedById: true,
      claimedByRole: true,
      claimedByLabel: true,
      claimedAt: true,
    },
  })

  return new Map(assignments.map((assignment) => [assignment.entityId, assignment]))
}

export async function claimOpsQueueItem(
  client: OpsQueueClient,
  params: {
    queueType: OpsQueueType
    entityId: string
    claimedById: string
    claimedByRole: string
    claimedByLabel: string
  },
) {
  return client.opsQueueAssignment.upsert({
    where: {
      queueType_entityId: {
        queueType: params.queueType,
        entityId: params.entityId,
      },
    },
    create: {
      queueType: params.queueType,
      entityId: params.entityId,
      claimedById: params.claimedById,
      claimedByRole: params.claimedByRole,
      claimedByLabel: params.claimedByLabel,
      claimedAt: new Date(),
    },
    update: {
      claimedById: params.claimedById,
      claimedByRole: params.claimedByRole,
      claimedByLabel: params.claimedByLabel,
      claimedAt: new Date(),
    },
    select: {
      id: true,
      queueType: true,
      entityId: true,
      claimedById: true,
      claimedByRole: true,
      claimedByLabel: true,
      claimedAt: true,
    },
  })
}

export async function releaseOpsQueueItem(
  client: OpsQueueClient,
  params: {
    queueType: OpsQueueType
    entityId: string
  },
) {
  return client.opsQueueAssignment.updateMany({
    where: {
      queueType: params.queueType,
      entityId: params.entityId,
    },
    data: {
      claimedById: null,
      claimedByRole: null,
      claimedByLabel: null,
      claimedAt: null,
    },
  })
}

export function formatOpsQueueOwnerLabel(
  assignment: OpsQueueAssignmentRecord | undefined,
  currentActorId?: string | null,
) {
  if (!assignment?.claimedById) return 'Unclaimed'
  if (currentActorId && assignment.claimedById === currentActorId) return 'Claimed by you'
  return assignment.claimedByLabel ? `Claimed by ${assignment.claimedByLabel}` : 'Claimed'
}
