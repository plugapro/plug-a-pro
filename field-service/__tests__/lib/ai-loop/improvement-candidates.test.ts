import { describe, it, expect } from 'vitest'
import {
  generateImprovementCandidates,
  observationsToEvidence,
  persistImprovementCandidates,
  type CandidateEvidenceEvent,
} from '../../../lib/ai-loop/improvement-candidates'
import { createMemorySink } from '../../../lib/ai-loop/sink'
import type { ObservationRecord } from '../../../lib/ai-loop/types'

const now = () => '2026-06-13T12:00:00.000Z'

function repeat(name: string, count: number, flow: string, refPrefix: string): CandidateEvidenceEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    name,
    affectedFlow: flow,
    entityRefs: { id: `${refPrefix}_${i}` },
  }))
}

describe('generateImprovementCandidates', () => {
  it('produces a candidate once evidence crosses the threshold', () => {
    const events = repeat('payment.failed', 3, 'payment', 'pay')
    const candidates = generateImprovementCandidates(events, { now })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      category: 'payment',
      evidenceCount: 3,
      riskLevel: 'critical',
      humanReviewRequired: true,
      status: 'new',
    })
  })

  it('ignores one-off failures below the threshold (noise control)', () => {
    const events = repeat('booking.failed', 2, 'booking', 'bk')
    expect(generateImprovementCandidates(events, { now })).toHaveLength(0)
  })

  it('drops evidence-free groups (no vague candidates)', () => {
    const events: CandidateEvidenceEvent[] = Array.from({ length: 4 }, () => ({
      name: 'booking.failed',
      affectedFlow: 'booking',
      entityRefs: {},
    }))
    expect(generateImprovementCandidates(events, { now })).toHaveLength(0)
  })

  it('does not generate candidates for non-eligible events', () => {
    const events = repeat('booking.created', 10, 'booking', 'bk')
    expect(generateImprovementCandidates(events, { now })).toHaveLength(0)
  })

  it('separates distinct flows into distinct candidates', () => {
    const events = [
      ...repeat('matching.no_providers', 3, 'plumbing/soweto', 'a'),
      ...repeat('matching.no_providers', 3, 'electrical/sandton', 'b'),
    ]
    const candidates = generateImprovementCandidates(events, { now })
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((c) => c.affectedFlow)).size).toBe(2)
  })

  it('produces deterministic ids for the same (event, flow)', () => {
    const a = generateImprovementCandidates(repeat('payment.failed', 3, 'payment', 'p'), { now })
    const b = generateImprovementCandidates(repeat('payment.failed', 5, 'payment', 'q'), { now })
    expect(a[0].id).toBe(b[0].id)
  })

  it('includes a draft Claude Code task instruction with guardrails but no code', () => {
    const [c] = generateImprovementCandidates(repeat('payment.failed', 3, 'payment', 'p'), { now })
    expect(c.draftTaskInstruction).toMatch(/HUMAN REVIEW REQUIRED/)
    expect(c.draftTaskInstruction).toMatch(/Do NOT deploy to production/)
    expect(c.draftTaskInstruction).toMatch(/Add tests/)
    // advisory only — never an executable diff/patch
    expect(c.draftTaskInstruction).not.toMatch(/```diff|^\+\+\+|^---/m)
  })

  it('caps example references', () => {
    const events = repeat('whatsapp.message_delivery_failed', 10, 'whatsapp', 'w')
    const [c] = generateImprovementCandidates(events, { now, maxExampleRefs: 3 })
    expect(c.exampleRefs.length).toBeLessThanOrEqual(3)
  })

  it('sorts critical candidates ahead of lower-risk ones', () => {
    const events = [
      ...repeat('quote.approval_abandoned', 5, 'quote', 'q'),
      ...repeat('payment.failed', 3, 'payment', 'p'),
    ]
    const candidates = generateImprovementCandidates(events, { now })
    expect(candidates[0].riskLevel).toBe('critical')
  })
})

describe('observationsToEvidence', () => {
  it('adapts observation records into evidence', () => {
    const obs: ObservationRecord[] = [
      {
        id: 'obs_1',
        event: 'payment.failed',
        category: 'payment',
        severity: 'high',
        actorType: 'customer',
        actorRef: null,
        entityRefs: { paymentId: 'pay_1' },
        affectedFlow: 'payment',
        occurredAt: now(),
        recordedAt: now(),
        metadata: {},
        isTestEvent: false,
      },
    ]
    const evidence = observationsToEvidence(obs)
    expect(evidence[0]).toMatchObject({ name: 'payment.failed', affectedFlow: 'payment' })
  })
})

describe('persistImprovementCandidates', () => {
  it('writes each candidate to the sink and counts them', async () => {
    const sink = createMemorySink()
    const candidates = generateImprovementCandidates(repeat('payment.failed', 3, 'payment', 'p'), { now })
    const written = await persistImprovementCandidates(candidates, sink)
    expect(written).toBe(1)
    expect(sink.candidates).toHaveLength(1)
  })

  it('degrades safely when a candidate write fails', async () => {
    const sink = createMemorySink()
    sink.writeCandidate = async () => {
      throw new Error('disk full')
    }
    const candidates = generateImprovementCandidates(repeat('payment.failed', 3, 'payment', 'p'), { now })
    await expect(persistImprovementCandidates(candidates, sink)).resolves.toBe(0)
  })
})
