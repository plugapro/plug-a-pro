import { describe, it, expect } from 'vitest'
import { isKnownEvent, getEventDefinition } from '../../../lib/ai-loop/taxonomy'
import { validateEvent, type OperationalEvent } from '../../../lib/ai-loop/events'

const OPS_EVENTS = [
  'ops.agent.run',
  'ops.recommendation.evaluated',
  'ops.recommendation.reviewed',
  'ops.draft.sent',
  'ops.draft.blocked',
  'ops.escalation',
] as const

describe('ops agent taxonomy', () => {
  it('registers every ops.* event in the closed allowlist', () => {
    for (const name of OPS_EVENTS) {
      expect(isKnownEvent(name)).toBe(true)
      expect(getEventDefinition(name)?.openBrainEligible).toBe(true)
    }
  })

  it('accepts a well-formed ops.agent.run event with safe metadata', () => {
    const event: OperationalEvent = {
      name: 'ops.agent.run',
      actorType: 'system',
      occurredAt: '2026-06-20T08:00:00.000Z',
      entityRefs: { runId: 'run_1' },
      metadata: { phase: 'finish', agentKey: 'SERVICE_REQUEST_FRICTION', status: 'SUCCESS', candidates: 3 },
    }
    expect(validateEvent(event).ok).toBe(true)
  })

  it('rejects an unregistered ops event name', () => {
    const event: OperationalEvent = {
      name: 'ops.agent.unregistered',
      actorType: 'system',
      occurredAt: '2026-06-20T08:00:00.000Z',
    }
    expect(validateEvent(event).ok).toBe(false)
  })
})
