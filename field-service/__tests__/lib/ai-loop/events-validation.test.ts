import { describe, it, expect } from 'vitest'
import { validateEvent } from '../../../lib/ai-loop/events'
import type { OperationalEvent } from '../../../lib/ai-loop/events'

const base: OperationalEvent = {
  name: 'booking.failed',
  actorType: 'customer',
  occurredAt: '2026-06-13T10:00:00.000Z',
  entityRefs: { jobRequestId: 'creq_123' },
  metadata: { errorCode: 'SLOT_TAKEN' },
}

describe('validateEvent', () => {
  it('accepts a well-formed, known event', () => {
    expect(validateEvent(base)).toEqual({ ok: true, errors: [] })
  })

  it('rejects an unknown event name', () => {
    const result = validateEvent({ ...base, name: 'booking.exploded' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/unknown event name/)
  })

  it('rejects an actor type the taxonomy does not allow for the event', () => {
    const result = validateEvent({ ...base, name: 'matching.no_providers', actorType: 'customer' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/actorType customer not allowed/)
  })

  it('rejects a category that disagrees with the taxonomy', () => {
    const result = validateEvent({ ...base, category: 'payment' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/does not match taxonomy/)
  })

  it('rejects a non-ISO occurredAt', () => {
    const result = validateEvent({ ...base, occurredAt: 'yesterday' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/occurredAt/)
  })

  it('rejects a raw ID number carried in metadata', () => {
    const result = validateEvent({ ...base, metadata: { idNumber: '9001015009087' } })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/raw sensitive field/)
  })

  it('rejects an access token carried in metadata', () => {
    const result = validateEvent({ ...base, metadata: { accessToken: 'abc.def.ghi' } })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/raw sensitive field/)
  })

  it('rejects a raw phone used as actorRef? — no, phones are soft and allowed as refs', () => {
    // Phones are masked/hashed downstream, not rejected. actorRef is fine.
    const result = validateEvent({ ...base, actorRef: '+27821234567' })
    expect(result.ok).toBe(true)
  })

  it('ignores an empty-valued sensitive key (present but blank is not a leak)', () => {
    const result = validateEvent({ ...base, metadata: { token: '' } })
    expect(result.ok).toBe(true)
  })
})
