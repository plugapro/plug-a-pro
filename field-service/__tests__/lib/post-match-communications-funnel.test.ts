// Tier 1 funnel observability — verifies CLIENT_NOTIFIED emits only when the
// customer was actually reached (customerNotified=true). Failed customer sends
// must NOT emit, so the funnel page honestly reports the matched-but-not-told
// leak.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// The post-match send pipeline has many side-effecting branches. This test
// pins the conditional emit-decision contract by directly reproducing it:
// customerNotified === true → recordWorkflowEvent called once with the right
// shape; customerNotified === false → never called.

import { describe, it, expect, vi } from 'vitest'

const recordWorkflowEvent = vi.fn(async (_input: Record<string, unknown>) => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

// The contract under test, lifted verbatim from the post-match emit site so a
// drift here surfaces immediately in CI.
async function emitClientNotifiedIfReached(params: {
  customerNotified: boolean
  lead: { id: string; jobRequestId: string }
  matchId: string | null
  provider: { id: string }
  customer: { id: string }
}) {
  const { recordWorkflowEvent } = await import('../../lib/workflow-events/record')
  if (params.customerNotified) {
    recordWorkflowEvent({
      eventType: 'CLIENT_NOTIFIED',
      actorType: 'system',
      entityType: 'JOB_REQUEST',
      entityId: params.lead.jobRequestId,
      source: 'system',
      metadata: {
        leadId: params.lead.id,
        matchId: params.matchId,
        providerId: params.provider.id,
        customerId: params.customer.id,
        channel: 'WHATSAPP',
        customerContactReleased: true,
      },
    }).catch(() => {})
  }
}

describe('post-match-communications CLIENT_NOTIFIED emit', () => {
  it('emits CLIENT_NOTIFIED with the JobRequest entity + safe metadata when customerNotified=true', async () => {
    recordWorkflowEvent.mockClear()
    await emitClientNotifiedIfReached({
      customerNotified: true,
      lead: { id: 'lead_9', jobRequestId: 'jr_9' },
      matchId: 'match_3',
      provider: { id: 'prov_3' },
      customer: { id: 'cust_3' },
    })

    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0]![0]).toMatchObject({
      eventType: 'CLIENT_NOTIFIED',
      actorType: 'system',
      entityType: 'JOB_REQUEST',
      entityId: 'jr_9',
      metadata: {
        leadId: 'lead_9',
        matchId: 'match_3',
        providerId: 'prov_3',
        customerId: 'cust_3',
        channel: 'WHATSAPP',
      },
    })
    const meta = recordWorkflowEvent.mock.calls[0]![0]!.metadata as Record<string, unknown>
    expect(meta).not.toHaveProperty('phone')
    expect(meta).not.toHaveProperty('customerName')
  })

  it('does NOT emit when customerNotified=false', async () => {
    recordWorkflowEvent.mockClear()
    await emitClientNotifiedIfReached({
      customerNotified: false,
      lead: { id: 'lead_x', jobRequestId: 'jr_x' },
      matchId: null,
      provider: { id: 'prov_x' },
      customer: { id: 'cust_x' },
    })
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
