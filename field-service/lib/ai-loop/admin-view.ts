/**
 * Plug-A-Pro AI operating loop — admin read model.
 *
 * Read-only projection of improvement candidates for the admin surface. Returns
 * only the summary columns the ops/admin view needs — no draft instructions,
 * no metadata, nothing actionable from the UI. The loop stays advisory.
 */

import { resolveDefaultSink, type AiLoopSink } from './sink'
import type { EventCategory } from './taxonomy'
import type { CandidateOwnerRole, CandidateRiskLevel, ImprovementCandidate } from './types'

export interface AdminCandidateRow {
  id: string
  title: string
  category: EventCategory
  riskLevel: CandidateRiskLevel
  status: ImprovementCandidate['status']
  affectedFlow: string
  evidenceCount: number
  createdAt: string
  recommendedOwnerRole: CandidateOwnerRole
  humanReviewRequired: boolean
}

const RISK_ORDER: Record<CandidateRiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export function buildAdminCandidateView(candidates: ImprovementCandidate[]): AdminCandidateRow[] {
  return candidates
    .map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      riskLevel: c.riskLevel,
      status: c.status,
      affectedFlow: c.affectedFlow,
      evidenceCount: c.evidenceCount,
      createdAt: c.createdAt,
      recommendedOwnerRole: c.recommendedOwnerRole,
      humanReviewRequired: c.humanReviewRequired,
    }))
    .sort((a, b) => {
      const r = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel]
      return r !== 0 ? r : b.evidenceCount - a.evidenceCount
    })
}

/**
 * Read candidates from the configured sink and project them for the admin view.
 * Degrades safely: a sink failure returns an empty list rather than throwing.
 */
export async function listImprovementCandidatesForAdmin(
  sink: AiLoopSink = resolveDefaultSink(),
): Promise<AdminCandidateRow[]> {
  try {
    const candidates = await sink.listCandidates()
    return buildAdminCandidateView(candidates)
  } catch (err) {
    console.warn('[ai-loop] failed to list candidates for admin (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
