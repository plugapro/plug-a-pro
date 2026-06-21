// Hermetic: never touch the real OpenBrain file sink during tests.
process.env.OPENBRAIN_AILOOP_SINK = 'null'

import { describe, it, expect, vi } from 'vitest'
import { runAgent, type AgentDefinition } from '../../../lib/ops-agents/runner'
import type { OpsAgentStore } from '../../../lib/ops-agents/store'
import { buildDedupeKey, type Evaluation } from '../../../lib/ops-agents/types'

const AGENT = 'PROVIDER_PROFILE_COACH' as const
const fixedNow = () => '2026-06-21T08:00:00.000Z'

interface Candidate {
  id: string
}

function evaluation(id: string): Evaluation {
  return {
    agentKey: AGENT,
    entityType: 'PROVIDER',
    entityId: id,
    classification: 'profile_incomplete',
    score: 60,
    severity: 'LOW',
    signals: [{ code: 'completeness_score', label: 'Completeness', weight: 60 }],
    summary: `provider ${id}`,
    recommendedActions: [],
    dedupeKey: buildDedupeKey(AGENT, id, 'coach'),
  }
}

function memStore(): OpsAgentStore {
  let n = 0
  return {
    async createRun() {
      return 'run_1'
    },
    async finishRun() {},
    async upsertRecommendation(_runId, e) {
      return { id: `rec_${e.entityId}_${++n}`, created: true }
    },
    async replaceDraft() {
      return { created: false }
    },
  }
}

function agentWithPersist(
  persistArtifacts: AgentDefinition<Candidate>['persistArtifacts'],
): AgentDefinition<Candidate> {
  return {
    agentKey: AGENT,
    async loadCandidates() {
      return [{ id: 'a' }, { id: 'b' }]
    },
    evaluate: (c) => evaluation(c.id),
    persistArtifacts,
  }
}

describe('runAgent persistArtifacts hook', () => {
  it('invokes persistArtifacts with the evaluation and recommendation id for each candidate', async () => {
    const persist = vi.fn(async (_a: { evaluation: Evaluation; recommendationId: string; nowIso: string }) => {})
    const summary = await runAgent(agentWithPersist(persist), { trigger: 'manual', now: fixedNow, store: memStore() })

    expect(summary.status).toBe('SUCCESS')
    expect(persist).toHaveBeenCalledTimes(2)
    const firstArg = persist.mock.calls[0][0]
    expect(firstArg.evaluation.entityId).toBe('a')
    expect(firstArg.recommendationId).toMatch(/^rec_a_/)
    expect(firstArg.nowIso).toBe(fixedNow())
  })

  it('treats a persistArtifacts throw as a soft error (run → PARTIAL) without losing the recommendation', async () => {
    const persist = vi.fn(async (_a: { evaluation: Evaluation; recommendationId: string; nowIso: string }) => {
      throw new Error('write failed')
    })
    const summary = await runAgent(agentWithPersist(persist), { trigger: 'manual', now: fixedNow, store: memStore() })

    expect(summary.status).toBe('PARTIAL')
    expect(summary.recommended).toBe(2) // recommendations still upserted
    expect(summary.errors.length).toBe(2)
    expect(summary.errors[0]).toContain('persistArtifacts')
  })
})
