// ─── Ops Agent Workflow Team — shared contract ───────────────────────────────
// Six operational monitoring agents share one shape. Evaluators are PURE: they
// receive a pre-loaded, minimised projection of an entity plus an injected
// `now`, and return an Evaluation. They never touch Prisma, the network, or the
// clock. The runner (runner.ts) does all I/O and persistence.
//
// See outputs/ops-agent-workflow-team/PlugAPro-Ops-Agent-Workflow-Team.md §2.

import type {
  OpsAgentKey,
  OpsRecommendationSeverity,
  OpsDraftStatus,
} from '@prisma/client'

export type { OpsAgentKey }

/** What kind of entity a recommendation is about. Mirrors OpsRecommendation.entityType. */
export type OpsEntityType =
  | 'PROVIDER_APPLICATION'
  | 'PROVIDER'
  | 'JOB_REQUEST'
  | 'MATCH'
  | 'BOOKING'
  | 'OPS_BRIEFING'

export type OpsTrigger = 'cron' | 'event' | 'manual'

/** A structured, machine-readable reason behind a classification or score. */
export interface Signal {
  /** Stable code, e.g. "missing_profile_photo". Never renamed. */
  code: string
  /** Human-readable label for the admin console. */
  label: string
  /** Contribution to the score / weight of this signal (0–100 scale, agent-defined). */
  weight: number
  /** Optional extra context. Must never contain raw PII. */
  detail?: string
}

/** A typed action chip the admin console can render and link. */
export interface RecommendedAction {
  /** Stable code, e.g. "manual_assign". */
  code: string
  label: string
  /** Optional deep link into existing admin tooling, e.g. "/admin/dispatch". */
  href?: string
}

/**
 * A WhatsApp message an agent proposes. The runner persists this as an
 * OpsDraftMessage in PENDING_APPROVAL (or BLOCKED_POLICY when canSend() fails).
 * No agent ever sends directly.
 */
export interface DraftMessageSpec {
  channel: 'WHATSAPP'
  recipientRole: 'PROVIDER' | 'CUSTOMER'
  /** E.164 phone. Used for the canSend() policy check; never logged raw to OpenBrain. */
  recipientPhone: string
  /** Registered Meta template name, or 'FREEFORM' for an open-session message. */
  template: string | 'FREEFORM'
  templateParams?: Record<string, string>
  /** Only valid when a live 24h customer-care session is confirmed open. */
  freeformBody?: string
  /** Why this message — shown to ops alongside the draft. */
  rationale: string
}

/** The pure output of an agent evaluator for a single candidate. */
export interface Evaluation {
  agentKey: OpsAgentKey
  entityType: OpsEntityType
  entityId: string
  classification: string
  /** 0–100 where the agent scores; omitted otherwise. */
  score?: number
  severity: OpsRecommendationSeverity
  signals: Signal[]
  /** Internal, human-readable ops recommendation. */
  summary: string
  recommendedActions: RecommendedAction[]
  /** Optional WhatsApp draft tied to this recommendation. */
  draft?: DraftMessageSpec
  /**
   * Stable per (agent, entity, intent). Re-running the agent over the same
   * entity with the same intent MUST produce the same dedupeKey so the runner
   * updates rather than duplicates. Build with `buildDedupeKey()`.
   */
  dedupeKey: string
}

/**
 * A pure evaluator. Given a minimised candidate and an injected clock, returns
 * zero or one Evaluation (null = nothing worth recommending for this candidate).
 *
 * @typeParam TCandidate - the agent-specific minimised projection
 */
export type Evaluator<TCandidate> = (
  candidate: TCandidate,
  ctx: EvaluatorContext,
) => Evaluation | null

export interface EvaluatorContext {
  /** Injected current time as an ISO-8601 string. Evaluators must use this, not Date.now(). */
  nowIso: string
}

/** Builds the canonical dedupeKey for an Evaluation. */
export function buildDedupeKey(
  agentKey: OpsAgentKey,
  entityId: string,
  intent: string,
): string {
  return `${agentKey}:${entityId}:${intent}`
}

export type { OpsRecommendationSeverity, OpsDraftStatus }
