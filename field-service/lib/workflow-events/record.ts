// ─── Workflow event recorder (Ops Agent Workflow Team) ───────────────────────
// One entry point for the durable operational funnel log. recordWorkflowEvent()
//   1. writes a WorkflowEvent row (system of record for the funnel), and
//   2. mirrors a redacted copy into the AI loop / OpenBrain (best-effort).
//
// It is deliberately forgiving: the OpenBrain mirror is fire-and-forget and the
// DB write is the only thing that can surface an error to the caller. Callers on
// hot paths should still `void`-wrap or try/catch as they prefer; nothing here
// throws on the OpenBrain side.
//
// PII rules: never pass a raw phone/email/idNumber through actorId or metadata.
// actorId is an internal id; metadata is small, structured, safe context.

import { Prisma, type PrismaClient, type WorkflowEventType } from '@prisma/client'
import { db } from '@/lib/db'
import { safeCapture, type OperationalEvent, type ActorType } from '@/lib/ai-loop'

// Conservative allowlist guard. Callers must use internal IDs and structured
// flags in metadata — never raw customer/provider identifiers. Keys listed
// here are denied at runtime to fail loud rather than leak silently.
const FORBIDDEN_METADATA_KEYS = new Set([
  'phone',
  'phoneNumber',
  'email',
  'emailAddress',
  'idNumber',
  'identityNumber',
  'address',
  'customerName',
  'providerName',
  'name',
  'fullName',
])

function assertNoPiiKeys(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      throw new Error(
        `recordWorkflowEvent: metadata key "${key}" is forbidden (PII). Use an internal id or a structured flag instead.`,
      )
    }
  }
}

/** Actor strings we persist. Superset of the AI-loop ActorType allowlist. */
export type WorkflowActorType =
  | 'customer'
  | 'provider'
  | 'admin'
  | 'system'
  | 'anonymous'

/** Entity kinds a funnel event can be about. Free-form by design, but these are the known ones. */
export type WorkflowEntityType =
  | 'PROVIDER_APPLICATION'
  | 'PROVIDER'
  | 'CUSTOMER'
  | 'JOB_REQUEST'
  | 'MATCH'
  | 'BOOKING'
  | 'PAYMENT'
  | 'INVOICE'
  | 'REVIEW'

export interface RecordWorkflowEventInput {
  eventType: WorkflowEventType
  actorType: WorkflowActorType
  /** Internal actor id (never a raw phone). */
  actorId?: string | null
  entityType: WorkflowEntityType | string
  entityId: string
  /** Origin surface: "pwa" | "whatsapp" | "admin" | "cron" | "system" | … */
  source: string
  /** Small, safe, structured context. No raw PII. */
  metadata?: Record<string, unknown>
  /** Defaults to now(). */
  occurredAt?: Date
}

export interface RecordWorkflowEventOptions {
  /** Injected Prisma client / transaction. Defaults to the singleton. */
  client?: PrismaClient | Prisma.TransactionClient
  /** Injected clock. Defaults to wall-clock. Tests pass a fixed function. */
  now?: () => Date
  /** Injected OpenBrain capture. Defaults to safeCapture. Tests pass a spy. */
  capture?: (event: OperationalEvent) => Promise<void>
}

export interface RecordWorkflowEventResult {
  id: string
  occurredAt: Date
}

/** Maps an entity type to the camelCase entityRefs key used across the codebase. */
const ENTITY_REF_KEY: Record<string, string> = {
  PROVIDER_APPLICATION: 'providerApplicationId',
  PROVIDER: 'providerId',
  CUSTOMER: 'customerId',
  JOB_REQUEST: 'jobRequestId',
  MATCH: 'matchId',
  BOOKING: 'bookingId',
  PAYMENT: 'paymentId',
  INVOICE: 'invoiceId',
  REVIEW: 'reviewId',
}

function entityRefKey(entityType: string): string {
  return (
    ENTITY_REF_KEY[entityType] ??
    `${entityType
      .toLowerCase()
      .replace(/_(.)/g, (_m, c: string) => c.toUpperCase())}Id`
  )
}

/** AI-loop only knows a fixed actor allowlist; our superset already matches it. */
function toAiLoopActorType(actor: WorkflowActorType): ActorType {
  return actor
}

/**
 * Record a key operational funnel event. Persists a durable WorkflowEvent row and
 * mirrors a redacted copy to OpenBrain. Only the DB write can reject to the caller.
 */
export async function recordWorkflowEvent(
  input: RecordWorkflowEventInput,
  options: RecordWorkflowEventOptions = {},
): Promise<RecordWorkflowEventResult> {
  const client = options.client ?? db
  const now = options.now ?? (() => new Date())
  const capture = options.capture ?? safeCapture
  const occurredAt = input.occurredAt ?? now()
  const metadata = input.metadata ?? {}

  assertNoPiiKeys(metadata)

  const row = await client.workflowEvent.create({
    data: {
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      source: input.source,
      metadata: metadata as Prisma.InputJsonValue,
      occurredAt,
    },
    select: { id: true, occurredAt: true },
  })

  // Best-effort OpenBrain mirror. Never blocks or fails the funnel write.
  void capture({
    name: 'workflow.event',
    actorType: toAiLoopActorType(input.actorType),
    actorRef: input.actorId ?? null,
    occurredAt: occurredAt.toISOString(),
    affectedFlow: 'workflow_events',
    entityRefs: { [entityRefKey(input.entityType)]: input.entityId },
    metadata: {
      ...metadata,
      workflowEventType: input.eventType,
      source: input.source,
    },
  }).catch(() => {})

  return { id: row.id, occurredAt: row.occurredAt }
}
