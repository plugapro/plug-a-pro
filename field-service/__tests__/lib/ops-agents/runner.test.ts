// Hermetic: never touch the real OpenBrain file sink during tests.
process.env.OPENBRAIN_AILOOP_SINK = 'null'

import { describe, it, expect } from 'vitest'
import { runAgent, type AgentDefinition } from '../../../lib/ops-agents/runner'
import type { OpsAgentStore } from '../../../lib/ops-agents/store'
import {
  buildDedupeKey,
  type Evaluation,
  type DraftMessageSpec,
} from '../../../lib/ops-agents/types'

const AGENT = 'SERVICE_REQUEST_FRICTION' as const
const fixedNow = () => '2026-06-20T08:00:00.000Z'

interface Candidate {
  id: string
  /** When set, the stub evaluator throws for this candidate. */
  boom?: boolean
  /** When false, the stub evaluator returns null (nothing to recommend). */
  recommend?: boolean
  draft?: DraftMessageSpec
  severity?: Evaluation['severity']
}

function evaluation(c: Candidate): Evaluation {
  return {
    agentKey: AGENT,
    entityType: 'JOB_REQUEST',
    entityId: c.id,
    classification: 'no_matching_provider',
    score: 42,
    severity: c.severity ?? 'MEDIUM',
    signals: [{ code: 'no_offer', label: 'No offer sent', weight: 50 }],
    summary: `request ${c.id} stuck`,
    recommendedActions: [{ code: 'manual_assign', label: 'Manually assign', href: '/admin/dispatch' }],
    draft: c.draft,
    dedupeKey: buildDedupeKey(AGENT, c.id, 'stuck'),
  }
}

function makeAgent(
  candidates: Candidate[],
  opts: { loadThrows?: boolean; policyCheck?: AgentDefinition<Candidate>['policyCheck'] } = {},
): AgentDefinition<Candidate> {
  return {
    agentKey: AGENT,
    async loadCandidates() {
      if (opts.loadThrows) throw new Error('db down')
      return candidates
    },
    evaluate(c) {
      if (c.boom) throw new Error(`evaluate failed for ${c.id}`)
      if (c.recommend === false) return null
      return evaluation(c)
    },
    policyCheck: opts.policyCheck,
  }
}

// ─── In-memory store mirroring the Prisma store's dedupe + draft semantics ────
function createMemoryStore() {
  const runs = new Map<string, Record<string, unknown>>()
  const recsByDedupe = new Map<string, { id: string; runId: string; status: string; severity: string }>()
  const draftsByRec = new Map<string, Array<{ id: string; status: string; policyReason: string | null }>>()
  let runSeq = 0
  let recSeq = 0
  let draftSeq = 0
  let createRunThrows = false

  const store: OpsAgentStore = {
    async createRun(input) {
      if (createRunThrows) throw new Error('cannot open run')
      const id = `run_${++runSeq}`
      runs.set(id, { id, ...input, status: 'RUNNING' })
      return id
    },
    async finishRun(runId, patch) {
      Object.assign(runs.get(runId)!, patch)
    },
    async upsertRecommendation(runId, e) {
      const existing = recsByDedupe.get(e.dedupeKey)
      if (existing) {
        existing.severity = e.severity // runId intentionally preserved
        return { id: existing.id, created: false }
      }
      const id = `rec_${++recSeq}`
      recsByDedupe.set(e.dedupeKey, { id, runId, status: 'PENDING', severity: e.severity })
      return { id, created: true }
    },
    async replaceDraft(recommendationId, draft) {
      const kept = (draftsByRec.get(recommendationId) ?? []).filter(
        (d) => d.status !== 'PENDING_APPROVAL' && d.status !== 'BLOCKED_POLICY',
      )
      if (!draft) {
        draftsByRec.set(recommendationId, kept)
        return { created: false }
      }
      const id = `draft_${++draftSeq}`
      kept.push({ id, status: draft.status, policyReason: draft.policyReason })
      draftsByRec.set(recommendationId, kept)
      return { created: true, draftId: id }
    },
  }

  return {
    store,
    runs,
    recsByDedupe,
    draftsByRec,
    setCreateRunThrows: (v: boolean) => {
      createRunThrows = v
    },
  }
}

const draftSpec = (): DraftMessageSpec => ({
  channel: 'WHATSAPP',
  recipientRole: 'CUSTOMER',
  recipientPhone: '+27600000001',
  template: 'customer_abandoned_recovery',
  templateParams: { name: 'Thabo' },
  rationale: 'recover stuck request',
})

describe('runAgent', () => {
  it('persists one recommendation per candidate and reports SUCCESS', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(makeAgent([{ id: 'jr1' }, { id: 'jr2' }]), {
      trigger: 'manual',
      now: fixedNow,
      store: mem.store,
    })

    expect(summary.status).toBe('SUCCESS')
    expect(summary.candidates).toBe(2)
    expect(summary.created).toBe(2)
    expect(summary.updated).toBe(0)
    expect(summary.recommended).toBe(2)
    expect(summary.errors).toEqual([])
    expect(mem.recsByDedupe.size).toBe(2)
    expect(mem.runs.get(summary.runId)!.status).toBe('SUCCESS')
  })

  it('is idempotent: a second run updates rather than duplicating', async () => {
    const mem = createMemoryStore()
    const agent = makeAgent([{ id: 'jr1' }, { id: 'jr2' }])

    await runAgent(agent, { trigger: 'cron', now: fixedNow, store: mem.store })
    const second = await runAgent(agent, { trigger: 'cron', now: fixedNow, store: mem.store })

    expect(second.created).toBe(0)
    expect(second.updated).toBe(2)
    expect(second.recommended).toBe(2)
    expect(mem.recsByDedupe.size).toBe(2) // no duplicates
    // creation run preserved on update
    expect(mem.recsByDedupe.get(buildDedupeKey(AGENT, 'jr1', 'stuck'))!.runId).toBe('run_1')
  })

  it('degrades to PARTIAL when some candidates throw but others succeed', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(
      makeAgent([{ id: 'ok1' }, { id: 'bad', boom: true }, { id: 'ok2' }]),
      { trigger: 'event', now: fixedNow, store: mem.store },
    )

    expect(summary.status).toBe('PARTIAL')
    expect(summary.created).toBe(2)
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]).toContain('bad')
    expect(mem.runs.get(summary.runId)!.status).toBe('PARTIAL')
  })

  it('is FAILED when every candidate throws and nothing persists', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(makeAgent([{ id: 'bad', boom: true }]), {
      trigger: 'manual',
      now: fixedNow,
      store: mem.store,
    })

    expect(summary.status).toBe('FAILED')
    expect(summary.recommended).toBe(0)
    expect(summary.errors).toHaveLength(1)
  })

  it('reports SUCCESS with zero candidates', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(makeAgent([]), { trigger: 'cron', now: fixedNow, store: mem.store })
    expect(summary.status).toBe('SUCCESS')
    expect(summary.candidates).toBe(0)
    expect(summary.recommended).toBe(0)
  })

  it('skips candidates the evaluator declines (null)', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(
      makeAgent([{ id: 'jr1', recommend: false }, { id: 'jr2' }]),
      { trigger: 'cron', now: fixedNow, store: mem.store },
    )
    expect(summary.created).toBe(1)
    expect(mem.recsByDedupe.size).toBe(1)
  })

  it('marks FAILED (with a runId) when loadCandidates throws', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(makeAgent([{ id: 'jr1' }], { loadThrows: true }), {
      trigger: 'cron',
      now: fixedNow,
      store: mem.store,
    })

    expect(summary.status).toBe('FAILED')
    expect(summary.runId).not.toBe('')
    expect(summary.errors[0]).toContain('loadCandidates')
    expect(mem.runs.get(summary.runId)!.status).toBe('FAILED')
  })

  it('returns FAILED without throwing when the run cannot even be opened', async () => {
    const mem = createMemoryStore()
    mem.setCreateRunThrows(true)
    const summary = await runAgent(makeAgent([{ id: 'jr1' }]), {
      trigger: 'manual',
      now: fixedNow,
      store: mem.store,
    })
    expect(summary.status).toBe('FAILED')
    expect(summary.runId).toBe('')
    expect(summary.errors[0]).toContain('createRun')
  })

  it('creates a PENDING_APPROVAL draft when policy allows', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(
      makeAgent([{ id: 'jr1', draft: draftSpec() }], {
        policyCheck: () => ({ allowed: true }),
      }),
      { trigger: 'cron', now: fixedNow, store: mem.store },
    )

    expect(summary.draftsCreated).toBe(1)
    const recId = mem.recsByDedupe.get(buildDedupeKey(AGENT, 'jr1', 'stuck'))!.id
    expect(mem.draftsByRec.get(recId)![0].status).toBe('PENDING_APPROVAL')
  })

  it('creates a BLOCKED_POLICY draft (not counted as sendable) when policy denies', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(
      makeAgent([{ id: 'jr1', draft: draftSpec() }], {
        policyCheck: () => ({ allowed: false, reason: 'service_opted_out' }),
      }),
      { trigger: 'cron', now: fixedNow, store: mem.store },
    )

    expect(summary.draftsCreated).toBe(0) // blocked drafts are not "created" sendables
    const recId = mem.recsByDedupe.get(buildDedupeKey(AGENT, 'jr1', 'stuck'))!.id
    const draft = mem.draftsByRec.get(recId)![0]
    expect(draft.status).toBe('BLOCKED_POLICY')
    expect(draft.policyReason).toBe('service_opted_out')
  })

  it('defaults drafts to PENDING_APPROVAL when no policy check is supplied', async () => {
    const mem = createMemoryStore()
    const summary = await runAgent(makeAgent([{ id: 'jr1', draft: draftSpec() }]), {
      trigger: 'manual',
      now: fixedNow,
      store: mem.store,
    })
    expect(summary.draftsCreated).toBe(1)
  })
})

describe('buildDedupeKey', () => {
  it('is stable and namespaced by agent, entity, and intent', () => {
    expect(buildDedupeKey(AGENT, 'jr1', 'stuck')).toBe('SERVICE_REQUEST_FRICTION:jr1:stuck')
    expect(buildDedupeKey(AGENT, 'jr1', 'stuck')).toBe(buildDedupeKey(AGENT, 'jr1', 'stuck'))
    expect(buildDedupeKey(AGENT, 'jr1', 'stuck')).not.toBe(buildDedupeKey(AGENT, 'jr2', 'stuck'))
  })
})
