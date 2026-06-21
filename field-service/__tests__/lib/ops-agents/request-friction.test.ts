import { describe, it, expect } from 'vitest'
import {
  detectFrictionStage,
  classifyFriction,
  evaluateFriction,
  type FrictionCandidate,
} from '../../../lib/ops-agents/agents/request-friction/evaluator'

const ctx = { nowIso: '2026-06-21T09:00:00.000Z' }

function candidate(overrides: Partial<FrictionCandidate> = {}): FrictionCandidate {
  return {
    id: 'jr_1',
    kind: 'cancelled',
    hasCategory: true,
    hasAddress: true,
    descriptionLength: 50,
    photoCount: 2,
    hasUrgency: true,
    hasSlot: true,
    ...overrides,
  }
}

describe('request-friction stage detection', () => {
  it('returns the earliest unsatisfied stage', () => {
    expect(detectFrictionStage(candidate({ hasCategory: false }))).toBe('category')
    expect(detectFrictionStage(candidate({ hasAddress: false }))).toBe('address')
    expect(detectFrictionStage(candidate({ descriptionLength: 3 }))).toBe('description')
    expect(detectFrictionStage(candidate({ photoCount: 0 }))).toBe('photo')
    expect(detectFrictionStage(candidate({ hasUrgency: false }))).toBe('urgency')
    expect(detectFrictionStage(candidate({ hasSlot: false }))).toBe('slot')
  })

  it('falls through to whatsapp_handoff when everything is present', () => {
    expect(detectFrictionStage(candidate())).toBe('whatsapp_handoff')
  })

  it('prioritises the earliest stage when several are missing', () => {
    expect(detectFrictionStage(candidate({ hasAddress: false, photoCount: 0 }))).toBe('address')
  })
})

describe('request-friction classification', () => {
  it('cancelled requests get customer_cancelled / MEDIUM', () => {
    const r = classifyFriction(candidate({ kind: 'cancelled', photoCount: 0 }))
    expect(r.reasonCode).toBe('customer_cancelled')
    expect(r.severity).toBe('MEDIUM')
    expect(r.stage).toBe('photo')
  })

  it('incomplete requests get incomplete_submission / LOW', () => {
    const r = classifyFriction(candidate({ kind: 'incomplete', hasCategory: false }))
    expect(r.reasonCode).toBe('incomplete_submission')
    expect(r.severity).toBe('LOW')
    expect(r.stage).toBe('category')
  })
})

describe('request-friction evaluator output', () => {
  it('produces an Evaluation with a stage-keyed dedupeKey and no draft', () => {
    const e = evaluateFriction(candidate({ photoCount: 0 }), ctx)!
    expect(e.agentKey).toBe('SERVICE_REQUEST_FRICTION')
    expect(e.entityType).toBe('JOB_REQUEST')
    expect(e.classification).toBe('friction_photo')
    expect(e.dedupeKey).toBe('SERVICE_REQUEST_FRICTION:jr_1:friction:photo')
    expect(e.draft).toBeUndefined()
  })
})
