// ─── Service Request Friction Agent — definition ─────────────────────────────

import type { AgentDefinition } from '../../runner'
import { evaluateFriction, type FrictionCandidate } from './evaluator'
import { loadFrictionCandidates, persistFrictionSignal } from './loader'

export const serviceRequestFrictionAgent: AgentDefinition<FrictionCandidate> = {
  agentKey: 'SERVICE_REQUEST_FRICTION',
  loadCandidates: loadFrictionCandidates,
  evaluate: evaluateFriction,
  persistArtifacts: ({ evaluation }) => persistFrictionSignal(evaluation),
}

export * from './evaluator'
export { loadFrictionCandidates, persistFrictionSignal } from './loader'
