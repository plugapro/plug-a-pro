// ─── Ops Agent Workflow Team — OpenBrain bridge ──────────────────────────────
// Thin mapping layer from agent moments onto the existing ai-loop writer. Every
// helper is fire-and-forget via safeCapture (never throws, PII-redacting). We
// pass internal IDs through entityRefs and small safe summaries through
// metadata — never raw phones, message bodies, or identity fields.
//
// The event names used here are registered in lib/ai-loop/taxonomy.ts.

import { safeCapture, type OperationalEvent } from '@/lib/ai-loop'
import type {
  OpsAgentKey,
  OpsRecommendationSeverity,
} from '@prisma/client'
import type { Signal } from './types'

/** Severity → ai-loop severity. ai-loop uses lowercase. */
function toEventSeverity(
  s: OpsRecommendationSeverity,
): OperationalEvent['severity'] {
  switch (s) {
    case 'INFO':
      return 'info'
    case 'LOW':
      return 'low'
    case 'MEDIUM':
      return 'medium'
    case 'HIGH':
      return 'high'
    case 'CRITICAL':
      return 'critical'
    default:
      return 'info'
  }
}

function signalCodes(signals: Signal[]): string[] {
  return signals.map((s) => s.code)
}

/**
 * Maps an entity type to the camelCase entityRefs key the rest of the codebase
 * uses (e.g. `jobRequestId`, not `job_requestId`), so ops events join cleanly
 * with existing observations.
 */
const ENTITY_REF_KEY: Record<string, string> = {
  PROVIDER_APPLICATION: 'providerApplicationId',
  PROVIDER: 'providerId',
  JOB_REQUEST: 'jobRequestId',
  MATCH: 'matchId',
  BOOKING: 'bookingId',
  OPS_BRIEFING: 'opsBriefingId',
}

function entityRefKey(entityType: string): string {
  return (
    ENTITY_REF_KEY[entityType] ??
    `${entityType.toLowerCase().replace(/_(.)/g, (_m, c: string) => c.toUpperCase())}Id`
  )
}

export interface RunStartInput {
  runId: string
  agentKey: OpsAgentKey
  trigger: string
  occurredAtIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

export function captureRunStart(input: RunStartInput): Promise<void> {
  return safeCapture({
    name: 'ops.agent.run',
    actorType: 'system',
    occurredAt: input.occurredAtIso,
    affectedFlow: 'ops_agents',
    entityRefs: { runId: input.runId },
    metadata: {
      phase: 'start',
      agentKey: input.agentKey,
      trigger: input.trigger,
      windowFrom: input.windowFromIso ?? null,
      windowTo: input.windowToIso ?? null,
    },
  })
}

export interface RunFinishInput {
  runId: string
  agentKey: OpsAgentKey
  status: string
  occurredAtIso: string
  candidates: number
  recommended: number
  draftsCreated: number
  error?: string | null
}

export function captureRunFinish(input: RunFinishInput): Promise<void> {
  return safeCapture({
    name: 'ops.agent.run',
    actorType: 'system',
    severity: input.status === 'FAILED' ? 'high' : 'info',
    occurredAt: input.occurredAtIso,
    affectedFlow: 'ops_agents',
    entityRefs: { runId: input.runId },
    metadata: {
      phase: 'finish',
      agentKey: input.agentKey,
      status: input.status,
      candidates: input.candidates,
      recommended: input.recommended,
      draftsCreated: input.draftsCreated,
      error: input.error ?? null,
    },
  })
}

export interface RecommendationInput {
  recommendationId: string
  runId: string
  agentKey: OpsAgentKey
  entityType: string
  entityId: string
  classification: string
  severity: OpsRecommendationSeverity
  score?: number | null
  signals: Signal[]
  hasDraft: boolean
  occurredAtIso: string
}

export function captureRecommendation(input: RecommendationInput): Promise<void> {
  return safeCapture({
    name: 'ops.recommendation.evaluated',
    actorType: 'system',
    severity: toEventSeverity(input.severity),
    occurredAt: input.occurredAtIso,
    affectedFlow: 'ops_agents',
    entityRefs: {
      recommendationId: input.recommendationId,
      runId: input.runId,
      // entity reference scoped by type so we never collide IDs across tables
      [entityRefKey(input.entityType)]: input.entityId,
    },
    metadata: {
      agentKey: input.agentKey,
      entityType: input.entityType,
      classification: input.classification,
      severity: input.severity,
      score: input.score ?? null,
      signalCodes: signalCodes(input.signals),
      hasDraft: input.hasDraft,
    },
  })
}

export interface EscalationInput {
  recommendationId: string
  agentKey: OpsAgentKey
  entityType: string
  entityId: string
  classification: string
  severity: OpsRecommendationSeverity
  reason: string
  occurredAtIso: string
}

export function captureEscalation(input: EscalationInput): Promise<void> {
  return safeCapture({
    name: 'ops.escalation',
    actorType: 'system',
    severity: toEventSeverity(input.severity),
    occurredAt: input.occurredAtIso,
    affectedFlow: 'ops_agents',
    entityRefs: {
      recommendationId: input.recommendationId,
      [entityRefKey(input.entityType)]: input.entityId,
    },
    metadata: {
      agentKey: input.agentKey,
      entityType: input.entityType,
      classification: input.classification,
      severity: input.severity,
      reason: input.reason,
    },
  })
}
