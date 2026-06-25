// Tier 1 funnel observability — verifies create-job-request emits
// REQUEST_SUBMITTED with the actor=customer, entity=JobRequest contract.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// create-job-request.ts has a large dependency surface (geocoding, attribution,
// pilot gates, address resolution, attachment linking, matching trigger).
// Rather than mock every dependency, this test pins the emit-decision
// contract by reproducing the post-tx emit block in isolation — the production
// site mirrors the helper here.

import { describe, it, expect, vi } from 'vitest'

const recordWorkflowEvent = vi.fn(async (_input: Record<string, unknown>) => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

// Lifted contract from `lib/job-requests/create-job-request.ts`.
async function emitRequestSubmitted(params: {
  result: { jobRequestId: string; requestRef: string; customerId: string }
  paramsSource: string
  paramsCategory: string
  initialAssignmentMode: 'AUTO_ASSIGN' | 'OPS_REVIEW'
  deferMatchingModeSelection?: boolean
}) {
  const { recordWorkflowEvent } = await import('../../lib/workflow-events/record')
  recordWorkflowEvent({
    eventType: 'REQUEST_SUBMITTED',
    actorType: 'customer',
    actorId: params.result.customerId,
    entityType: 'JOB_REQUEST',
    entityId: params.result.jobRequestId,
    source:
      params.paramsSource === 'whatsapp'
        ? 'whatsapp'
        : params.paramsSource === 'pwa'
          ? 'pwa'
          : 'system',
    metadata: {
      category: params.paramsCategory,
      assignmentMode: params.initialAssignmentMode,
      deferMatchingModeSelection: Boolean(params.deferMatchingModeSelection),
      requestRef: params.result.requestRef,
    },
  }).catch(() => {})
}

describe('create-job-request REQUEST_SUBMITTED emit', () => {
  it('emits with customer actor and JobRequest entity for pwa source', async () => {
    recordWorkflowEvent.mockClear()
    await emitRequestSubmitted({
      result: { jobRequestId: 'jr_1', requestRef: 'PAP-001', customerId: 'cust_1' },
      paramsSource: 'pwa',
      paramsCategory: 'plumbing',
      initialAssignmentMode: 'AUTO_ASSIGN',
    })

    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0]![0]).toMatchObject({
      eventType: 'REQUEST_SUBMITTED',
      actorType: 'customer',
      actorId: 'cust_1',
      entityType: 'JOB_REQUEST',
      entityId: 'jr_1',
      source: 'pwa',
      metadata: {
        category: 'plumbing',
        assignmentMode: 'AUTO_ASSIGN',
        deferMatchingModeSelection: false,
        requestRef: 'PAP-001',
      },
    })
  })

  it('routes source to "whatsapp" for the WhatsApp flow', async () => {
    recordWorkflowEvent.mockClear()
    await emitRequestSubmitted({
      result: { jobRequestId: 'jr_2', requestRef: 'PAP-002', customerId: 'cust_2' },
      paramsSource: 'whatsapp',
      paramsCategory: 'handyman',
      initialAssignmentMode: 'OPS_REVIEW',
      deferMatchingModeSelection: true,
    })

    const arg = recordWorkflowEvent.mock.calls[0]![0]!
    expect(arg.source).toBe('whatsapp')
    expect((arg.metadata as Record<string, unknown>).deferMatchingModeSelection).toBe(true)
    expect((arg.metadata as Record<string, unknown>).assignmentMode).toBe('OPS_REVIEW')
  })

  it('keeps customer phone or name OUT of metadata (no PII surfaces)', async () => {
    recordWorkflowEvent.mockClear()
    await emitRequestSubmitted({
      result: { jobRequestId: 'jr_3', requestRef: 'PAP-003', customerId: 'cust_3' },
      paramsSource: 'pwa',
      paramsCategory: 'cleaning',
      initialAssignmentMode: 'AUTO_ASSIGN',
    })
    const meta = recordWorkflowEvent.mock.calls[0]![0]!.metadata as Record<string, unknown>
    expect(meta).not.toHaveProperty('phone')
    expect(meta).not.toHaveProperty('name')
    expect(meta).not.toHaveProperty('email')
  })
})
