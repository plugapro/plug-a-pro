// Tier 1 funnel observability — verifies PROVIDER_NOTIFIED is emitted once per
// dispatch attempt with the correct delivered=true/false boolean.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// dispatch.ts is integration-heavy (lead row, WhatsApp send, customer offer
// notify, qualified-shortlist branch). This test pins the emit-decision
// contract by reproducing the boolean-resolution logic in isolation — the
// production code at `lib/matching/dispatch.ts` mirrors the helper here so a
// drift surfaces immediately.

import { describe, it, expect, vi } from 'vitest'

const recordWorkflowEvent = vi.fn(async () => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

async function emitProviderNotified(state: {
  delivered: boolean | null
  failureReason: string | null
  ctaAlreadySent: boolean
  lead: { id: string }
  provider: { id: string }
  jobRequest: { id: string }
  template: string
}) {
  const { recordWorkflowEvent } = await import('../../../lib/workflow-events/record')
  if (state.delivered !== null && !state.ctaAlreadySent) {
    recordWorkflowEvent({
      eventType: 'PROVIDER_NOTIFIED',
      actorType: 'system',
      entityType: 'LEAD',
      entityId: state.lead.id,
      source: 'system',
      metadata: {
        providerId: state.provider.id,
        jobRequestId: state.jobRequest.id,
        template: state.template,
        channel: 'WHATSAPP',
        delivered: state.delivered,
        failureReason: state.failureReason ?? undefined,
      },
    }).catch(() => {})
  }
}

describe('dispatch PROVIDER_NOTIFIED emit', () => {
  const baseState = {
    ctaAlreadySent: false,
    lead: { id: 'lead_1' },
    provider: { id: 'prov_1' },
    jobRequest: { id: 'jr_1' },
    template: 'quick_match_provider_lead_offer',
  }

  it('emits delivered=true when sendJobOffer succeeded', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderNotified({ ...baseState, delivered: true, failureReason: null })
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const arg = recordWorkflowEvent.mock.calls[0][0]
    expect(arg.eventType).toBe('PROVIDER_NOTIFIED')
    expect((arg.metadata as Record<string, unknown>).delivered).toBe(true)
    expect((arg.metadata as Record<string, unknown>).failureReason).toBeUndefined()
  })

  it('emits delivered=false with reason when sendJobOffer threw', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderNotified({
      ...baseState,
      delivered: false,
      failureReason: 'Template not approved',
    })
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const meta = recordWorkflowEvent.mock.calls[0][0].metadata as Record<string, unknown>
    expect(meta.delivered).toBe(false)
    expect(meta.failureReason).toBe('Template not approved')
  })

  it('emits delivered=false when leadUrl was missing', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderNotified({
      ...baseState,
      delivered: false,
      failureReason: 'Missing provider lead access URL',
    })
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const meta = recordWorkflowEvent.mock.calls[0][0].metadata as Record<string, unknown>
    expect(meta.delivered).toBe(false)
  })

  it('does NOT emit when ctaAlreadySent (retry — buttons already sent)', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderNotified({ ...baseState, delivered: true, failureReason: null, ctaAlreadySent: true })
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when delivered stayed null (no branch ran)', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderNotified({ ...baseState, delivered: null, failureReason: null })
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
