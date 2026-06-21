// ─── Provider Application Review Agent — definition ──────────────────────────
// Wires the pure evaluator to its loader for the shared runAgent() spine.
//
// No policyCheck is attached: drafts are created as PENDING_APPROVAL and stay
// visible to ops. The real WhatsApp policy gate (canSend) runs at SEND time in
// the admin action, never here — so an incomplete-profile draft is always shown
// to ops even if the provider currently has no open session.

import type { AgentDefinition } from '../../runner'
import { evaluateApplication, type ApplicationCandidate } from './evaluator'
import { loadApplicationCandidates } from './loader'

export const providerApplicationReviewAgent: AgentDefinition<ApplicationCandidate> = {
  agentKey: 'PROVIDER_APPLICATION_REVIEW',
  loadCandidates: loadApplicationCandidates,
  evaluate: evaluateApplication,
}

export * from './evaluator'
export { loadApplicationCandidates } from './loader'
