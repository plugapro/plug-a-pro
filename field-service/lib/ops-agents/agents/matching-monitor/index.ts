// ─── Matching Journey Monitor Agent — definition ─────────────────────────────

import type { AgentDefinition } from '../../runner'
import { evaluateMatching, type MatchingCandidate } from './evaluator'
import { loadMatchingCandidates } from './loader'

export const matchingJourneyMonitorAgent: AgentDefinition<MatchingCandidate> = {
  agentKey: 'MATCHING_JOURNEY_MONITOR',
  loadCandidates: loadMatchingCandidates,
  evaluate: evaluateMatching,
}

export * from './evaluator'
export { loadMatchingCandidates } from './loader'
