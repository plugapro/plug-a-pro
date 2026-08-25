import type { OpsQueueType } from '@prisma/client'
import { recordAuditLog } from '@/lib/audit'

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
    findUnique: (...args: any[]) => Promise<OpsQueueAssignmentRecord | null>
    upsert: (...args: any[]) => Promise<OpsQueueAssignmentRecord>
    updateMany: (...args: any[]) => Promise<{ count: number }>
  }
}

type OpsQueueActor = {
  actorId: string
  actorRole: string
}

export const OPS_QUEUE_TYPES = {
  VALIDATION: 'VALIDATION',
  DISPATCH: 'DISPATCH',
  QUOTE_APPROVAL: 'QUOTE_APPROVAL',
  FIELD_EXCEPTION: 'FIELD_EXCEPTION',
  DISPUTE: 'DISPUTE',
  PAYMENT_FOLLOW_UP: 'PAYMENT_FOLLOW_UP',
  PROVIDER_ONBOARDING: 'PROVIDER_ONBOARDING',
  IDENTITY_VERIFICATION: 'IDENTITY_VERIFICATION',
  // CJ-06: durable record of a booking reschedule request (entityId = bookingId)
  RESCHEDULE_REQUEST: 'RESCHEDULE_REQUEST',
  // CJ-03 backstop: post-match customer notification failed (entityId = jobRequestId)
  CUSTOMER_NOTIFY_FAILED: 'CUSTOMER_NOTIFY_FAILED',
} as const satisfies Record<string, OpsQueueType>

/**
 * Ensure a durable, unclaimed ops-queue item exists for (queueType, entityId).
 *
 * Idempotent: if the item already exists (claimed or not), it is left
 * untouched so an existing claim is never clobbered. Use this from system
 * paths (webhooks, bots, lifecycle functions) that need a durable "ops must
 * look at this" record rather than a best-effort notification.
 */
export async function ensureOpsQueueItem(
  client: OpsQueueClient,
  params: {
    queueType: OpsQueueType
    entityId: string
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
    },
    update: {},
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
    actor?: OpsQueueActor
  },
) {
  const before = params.actor
    ? await client.opsQueueAssignment.findUnique({
        where: {
          queueType_entityId: {
            queueType: params.queueType,
            entityId: params.entityId,
          },
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
    : null

  const assignment = await client.opsQueueAssignment.upsert({
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

  if (params.actor) {
    await recordAuditLog(
      {
        actorId: params.actor.actorId,
        actorRole: params.actor.actorRole,
        action: 'ops_queue.claim',
        entityType: 'ops_queue_item',
        entityId: `${params.queueType}:${params.entityId}`,
        before: before
          ? {
              queueType: before.queueType,
              entityId: before.entityId,
              claimedById: before.claimedById,
              claimedByRole: before.claimedByRole,
              claimedByLabel: before.claimedByLabel,
              claimedAt: before.claimedAt?.toISOString() ?? null,
            }
          : {
              queueType: params.queueType,
              entityId: params.entityId,
              claimedById: null,
              claimedByRole: null,
              claimedByLabel: null,
              claimedAt: null,
            },
        after: {
          queueType: assignment.queueType,
          entityId: assignment.entityId,
          claimedById: assignment.claimedById,
          claimedByRole: assignment.claimedByRole,
          claimedByLabel: assignment.claimedByLabel,
          claimedAt: assignment.claimedAt?.toISOString() ?? null,
        },
      },
      client as never,
    )
  }

  return assignment
}

export async function releaseOpsQueueItem(
  client: OpsQueueClient,
  params: {
    queueType: OpsQueueType
    entityId: string
    actor?: OpsQueueActor
  },
) {
  const before = params.actor
    ? await client.opsQueueAssignment.findUnique({
        where: {
          queueType_entityId: {
            queueType: params.queueType,
            entityId: params.entityId,
          },
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
    : null

  const result = await client.opsQueueAssignment.updateMany({
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

  if (params.actor && before && result.count > 0) {
    await recordAuditLog(
      {
        actorId: params.actor.actorId,
        actorRole: params.actor.actorRole,
        action: 'ops_queue.release',
        entityType: 'ops_queue_item',
        entityId: `${params.queueType}:${params.entityId}`,
        before: {
          queueType: before.queueType,
          entityId: before.entityId,
          claimedById: before.claimedById,
          claimedByRole: before.claimedByRole,
          claimedByLabel: before.claimedByLabel,
          claimedAt: before.claimedAt?.toISOString() ?? null,
        },
        after: {
          queueType: params.queueType,
          entityId: params.entityId,
          claimedById: null,
          claimedByRole: null,
          claimedByLabel: null,
          claimedAt: null,
        },
      },
      client as never,
    )
  }

  return result
}

export function formatOpsQueueOwnerLabel(
  assignment: OpsQueueAssignmentRecord | undefined,
  currentActorId?: string | null,
) {
  if (!assignment?.claimedById) return 'Unclaimed'
  if (currentActorId && assignment.claimedById === currentActorId) return 'Claimed by you'
  return assignment.claimedByLabel ? `Claimed by ${assignment.claimedByLabel}` : 'Claimed'
}
