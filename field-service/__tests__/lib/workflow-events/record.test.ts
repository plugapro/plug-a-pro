// Hermetic: never touch the real OpenBrain file sink during tests.
process.env.OPENBRAIN_AILOOP_SINK = 'null'

import { describe, it, expect, vi } from 'vitest'
import {
  recordWorkflowEvent,
  type RecordWorkflowEventInput,
} from '../../../lib/workflow-events/record'
import type { OperationalEvent } from '../../../lib/ai-loop'

const FIXED = new Date('2026-06-21T09:00:00.000Z')

/** Minimal in-memory stand-in for the slice of PrismaClient we touch. */
function makeClient() {
  const rows: Array<Record<string, unknown>> = []
  let seq = 0
  const client = {
    workflowEvent: {
      create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: unknown }) => {
        const id = `we_${++seq}`
        const row = { id, ...data }
        rows.push(row)
        void select
        return { id, occurredAt: data.occurredAt }
      }),
    },
  }
  return { client, rows }
}

const baseInput: RecordWorkflowEventInput = {
  eventType: 'PROVIDER_APPLICATION_SUBMITTED',
  actorType: 'provider',
  actorId: 'prov_1',
  entityType: 'PROVIDER_APPLICATION',
  entityId: 'app_1',
  source: 'whatsapp',
  metadata: { step: 'final' },
}

describe('recordWorkflowEvent', () => {
  it('persists a workflow event row with the provided fields', async () => {
    const { client, rows } = makeClient()
    const capture = vi.fn(async () => {})

    const res = await recordWorkflowEvent(baseInput, {
       
      client: client as any,
      now: () => FIXED,
      capture,
    })

    expect(res.id).toBe('we_1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      eventType: 'PROVIDER_APPLICATION_SUBMITTED',
      actorType: 'provider',
      actorId: 'prov_1',
      entityType: 'PROVIDER_APPLICATION',
      entityId: 'app_1',
      source: 'whatsapp',
      occurredAt: FIXED,
    })
  })

  it('defaults occurredAt to the injected clock', async () => {
    const { client, rows } = makeClient()
    await recordWorkflowEvent(baseInput, {
       
      client: client as any,
      now: () => FIXED,
      capture: vi.fn(async () => {}),
    })
    expect(rows[0].occurredAt).toEqual(FIXED)
  })

  it('mirrors a redacted copy to OpenBrain via capture', async () => {
    const { client } = makeClient()
    let captured: OperationalEvent | undefined
    const capture = vi.fn(async (e: OperationalEvent) => {
      captured = e
    })

    await recordWorkflowEvent(baseInput, {
       
      client: client as any,
      now: () => FIXED,
      capture,
    })

    expect(capture).toHaveBeenCalledTimes(1)
    expect(captured?.name).toBe('workflow.event')
    expect(captured?.actorType).toBe('provider')
    expect(captured?.entityRefs).toEqual({ providerApplicationId: 'app_1' })
    expect(captured?.metadata).toMatchObject({
      workflowEventType: 'PROVIDER_APPLICATION_SUBMITTED',
      source: 'whatsapp',
      step: 'final',
    })
    expect(captured?.occurredAt).toBe(FIXED.toISOString())
  })

  it('maps known entity types to camelCase entityRefs keys', async () => {
    const { client } = makeClient()
    let captured: OperationalEvent | undefined
    const capture = vi.fn(async (e: OperationalEvent) => {
      captured = e
    })

    await recordWorkflowEvent(
      { ...baseInput, entityType: 'JOB_REQUEST', entityId: 'jr_9' },
      {
         
        client: client as any,
        now: () => FIXED,
        capture,
      },
    )

    expect(captured?.entityRefs).toEqual({ jobRequestId: 'jr_9' })
  })

  it('still resolves when the OpenBrain mirror rejects', async () => {
    const { client, rows } = makeClient()
    const capture = vi.fn(async () => {
      throw new Error('sink down')
    })

    const res = await recordWorkflowEvent(baseInput, {
       
      client: client as any,
      now: () => FIXED,
      capture,
    })

    expect(res.id).toBe('we_1')
    expect(rows).toHaveLength(1)
  })
})
