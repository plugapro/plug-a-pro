// ─── Provider Profile Coach Agent — definition ───────────────────────────────

import type { AgentDefinition } from '../../runner'
import { evaluateProfile, type ProfileCandidate } from './evaluator'
import { loadProfileCandidates, persistProfileScore } from './loader'

export const providerProfileCoachAgent: AgentDefinition<ProfileCandidate> = {
  agentKey: 'PROVIDER_PROFILE_COACH',
  loadCandidates: loadProfileCandidates,
  evaluate: evaluateProfile,
  // Snapshot the profile scores for history / nudge tracking.
  persistArtifacts: ({ evaluation }) => persistProfileScore(evaluation),
}

export * from './evaluator'
export { loadProfileCandidates, persistProfileScore } from './loader'
