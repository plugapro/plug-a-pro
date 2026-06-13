/**
 * Plug-A-Pro AI operating loop — persisted record shapes.
 *
 * Kept in one module so the sink and the generators stay decoupled (no import
 * cycles). These are the only shapes that ever reach an OpenBrain sink, and by
 * construction they hold references + safe metadata, never raw PII.
 */

import type { ActorType, EventCategory, EventSeverity } from './taxonomy'

/** A single safe operational observation derived from an OperationalEvent. */
export interface ObservationRecord {
  id: string
  event: string
  category: EventCategory
  severity: EventSeverity
  actorType: ActorType
  /** Hashed if it looked like a phone; otherwise an internal id. */
  actorRef: string | null
  entityRefs: Record<string, string>
  affectedFlow: string | null
  occurredAt: string
  recordedAt: string
  /** Already redacted. Safe to read. */
  metadata: Record<string, unknown>
  isTestEvent: boolean
}

export type CandidateRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type CandidateOwnerRole =
  | 'ENGINEERING'
  | 'OPS'
  | 'TRUST'
  | 'FINANCE'
  | 'SECURITY'
  | 'PRODUCT'

/**
 * A reviewable improvement candidate. This is NEVER an executable change — it is
 * a structured brief plus a draft Claude Code task instruction for a human to
 * approve and dispatch.
 */
export interface ImprovementCandidate {
  id: string
  title: string
  problemSummary: string
  affectedFlow: string
  category: EventCategory
  evidenceCount: number
  /** Safe internal references only (no PII). */
  exampleRefs: string[]
  suspectedCause: string | null
  suggestedInvestigation: string
  riskLevel: CandidateRiskLevel
  recommendedOwnerRole: CandidateOwnerRole
  humanReviewRequired: boolean
  draftTaskInstruction: string
  createdAt: string
  status: 'new'
}
