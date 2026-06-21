// ─── Service Request Friction Agent (basic) — pure evaluator ─────────────────
// Looks at cancelled or stale/incomplete service requests, infers the most
// likely drop-off stage in the request-building funnel, and produces a friction
// reason, severity, and a recommended product/ops fix. No drafts (this agent is
// internal-signal only). Pure: no I/O.
//
// Pre-submission abandonment (started-but-never-submitted) is sourced from the
// WorkflowEvent stream in a later phase; Phase 1 reads terminal/stale JobRequests.
//
// See outputs/ops-agent-workflow-team/PlugAPro-Ops-Agent-Workflow-Team.md (Agent C).

import {
  buildDedupeKey,
  type Evaluation,
  type Evaluator,
  type RecommendedAction,
  type Signal,
} from '../../types'

const AGENT_KEY = 'SERVICE_REQUEST_FRICTION' as const

/** Drop-off stages, ordered earliest→latest in the request funnel. */
export type FrictionStage =
  | 'category'
  | 'address'
  | 'description'
  | 'photo'
  | 'urgency'
  | 'slot'
  | 'whatsapp_handoff'

export interface FrictionCandidate {
  id: string
  /** 'cancelled' = customer cancelled; 'incomplete' = stale unsubmitted/validation. */
  kind: 'cancelled' | 'incomplete'
  hasCategory: boolean
  hasAddress: boolean
  descriptionLength: number
  photoCount: number
  hasUrgency: boolean
  hasSlot: boolean
}

/** Earliest unsatisfied funnel field is the most likely drop-off stage. */
export function detectFrictionStage(c: FrictionCandidate): FrictionStage {
  if (!c.hasCategory) return 'category'
  if (!c.hasAddress) return 'address'
  if (c.descriptionLength < 10) return 'description'
  if (c.photoCount === 0) return 'photo'
  if (!c.hasUrgency) return 'urgency'
  if (!c.hasSlot) return 'slot'
  return 'whatsapp_handoff'
}

const STAGE_LABEL: Record<FrictionStage, string> = {
  category: 'service category selection',
  address: 'location / address entry',
  description: 'issue description',
  photo: 'photo upload',
  urgency: 'urgency selection',
  slot: 'slot selection',
  whatsapp_handoff: 'WhatsApp hand-off',
}

const STAGE_FIX: Record<FrictionStage, string> = {
  category: 'Simplify category picker / add popular categories up front',
  address: 'Improve address autocomplete and serviceability hinting',
  description: 'Add guided prompts / examples for the issue description',
  photo: 'Make photo upload optional or add a clearer “why photos help” nudge',
  urgency: 'Default urgency to a sensible option to reduce a required step',
  slot: 'Surface more slots / clearer availability at slot selection',
  whatsapp_handoff: 'Tighten the WhatsApp hand-off and confirmation copy',
}

export interface FrictionResult {
  stage: FrictionStage
  reasonCode: string
  severity: Evaluation['severity']
}

export function classifyFriction(c: FrictionCandidate): FrictionResult {
  const stage = detectFrictionStage(c)
  if (c.kind === 'cancelled') {
    return { stage, reasonCode: 'customer_cancelled', severity: 'MEDIUM' }
  }
  return { stage, reasonCode: 'incomplete_submission', severity: 'LOW' }
}

export const evaluateFriction: Evaluator<FrictionCandidate> = (c) => {
  const { stage, reasonCode, severity } = classifyFriction(c)
  const stageLabel = STAGE_LABEL[stage]

  const signals: Signal[] = [
    { code: `friction_${stage}`, label: `Drop-off at ${stageLabel}`, weight: 60 },
    { code: reasonCode, label: reasonCode.replace(/_/g, ' '), weight: 40 },
  ]

  const actions: RecommendedAction[] = [
    { code: 'review_request', label: 'Open request', href: '/admin/bookings' },
    { code: `fix_${stage}`, label: STAGE_FIX[stage] },
  ]

  const summary =
    c.kind === 'cancelled'
      ? `Request cancelled; likely friction at ${stageLabel}. Fix: ${STAGE_FIX[stage]}.`
      : `Incomplete request; stalled at ${stageLabel}. Fix: ${STAGE_FIX[stage]}.`

  return {
    agentKey: AGENT_KEY,
    entityType: 'JOB_REQUEST',
    entityId: c.id,
    classification: `friction_${stage}`,
    severity,
    signals,
    summary,
    recommendedActions: actions,
    // friction intent keyed by stage so a request that drops at a different
    // stage on re-evaluation produces a distinct recommendation.
    dedupeKey: buildDedupeKey(AGENT_KEY, c.id, `friction:${stage}`),
  }
}
