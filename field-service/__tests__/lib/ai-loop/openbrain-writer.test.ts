import { describe, it, expect } from 'vitest'
import { writeOperationalEvent, safeCapture } from '../../../lib/ai-loop/openbrain-writer'
import { createMemorySink, type AiLoopSink } from '../../../lib/ai-loop/sink'
import type { OperationalEvent } from '../../../lib/ai-loop/events'

const fixedNow = () => '2026-06-13T12:00:00.000Z'

function validEvent(overrides: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    name: 'whatsapp.message_delivery_failed',
    actorType: 'system',
    occurredAt: '2026-06-13T11:00:00.000Z',
    entityRefs: { messageEventId: 'msg_1' },
    metadata: { templateName: 'lead_intro', failureReason: 'rate_limited' },
    ...overrides,
  }
}

describe('writeOperationalEvent', () => {
  it('writes a redacted observation to the sink', async () => {
    const sink = createMemorySink()
    const result = await writeOperationalEvent(validEvent(), { sink, now: fixedNow })
    expect(result).toMatchObject({ ok: true, written: true, rejected: false })
    expect(sink.observations).toHaveLength(1)
    expect(sink.observations[0]).toMatchObject({
      event: 'whatsapp.message_delivery_failed',
      category: 'whatsapp',
      severity: 'medium',
      recordedAt: '2026-06-13T12:00:00.000Z',
    })
  })

  it('masks a phone carried in metadata before storing', async () => {
    const sink = createMemorySink()
    await writeOperationalEvent(
      validEvent({ metadata: { phone: '+27821234567', failureReason: 'x' } }),
      { sink },
    )
    const stored = sink.observations[0].metadata as Record<string, string>
    expect(stored.phone).not.toContain('821234567')
  })

  it('hashes a phone-like actorRef', async () => {
    const sink = createMemorySink()
    await writeOperationalEvent(validEvent({ actorRef: '+27821234567' }), { sink })
    expect(sink.observations[0].actorRef).toMatch(/^phash_/)
  })

  it('REJECTS an event carrying a raw token and writes nothing', async () => {
    const sink = createMemorySink()
    const result = await writeOperationalEvent(
      validEvent({ metadata: { accessToken: 'secret.jwt.here' } }),
      { sink },
    )
    expect(result.rejected).toBe(true)
    expect(result.written).toBe(false)
    expect(sink.observations).toHaveLength(0)
  })

  it('REJECTS an unknown event and writes nothing', async () => {
    const sink = createMemorySink()
    const result = await writeOperationalEvent(validEvent({ name: 'made.up' }), { sink })
    expect(result.rejected).toBe(true)
    expect(sink.observations).toHaveLength(0)
  })

  it('degrades safely (no throw) when the sink fails, and still does not block', async () => {
    const explodingSink: AiLoopSink = {
      async writeObservation() {
        throw new Error('OpenBrain unavailable')
      },
      async writeCandidate() {},
      async listCandidates() {
        return []
      },
    }
    const result = await writeOperationalEvent(validEvent(), { sink: explodingSink })
    expect(result.ok).toBe(true)
    expect(result.written).toBe(false)
    expect(result.reasons).toContain('sink_unavailable')
  })

  it('safeCapture never throws even with garbage input', async () => {
    // @ts-expect-error intentionally malformed
    await expect(safeCapture({})).resolves.toBeUndefined()
  })
})
