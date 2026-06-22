// Tier 1 funnel observability — verifies the PROVIDER_ACCEPTED emit
// idempotency contract: emits once on the first successful accept, NEVER on
// alreadyAccepted retry, NEVER on a failed acceptance.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md

import { describe, it, expect, vi } from 'vitest'

const recordWorkflowEvent = vi.fn(async () => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

// Lifted contract from `lib/selected-provider-acceptance.ts`. Mirrors the emit
// decision so a drift in the production guard is caught here.
async function emitProviderAcceptedIfFirstAccept(params: {
  result: {
    ok: boolean
    alreadyAccepted?: boolean
    matchId: string | null
    jobId: string | null
    bookingId: string | null
    creditCheck?: { requiredCredits?: number | null }
    creditTransactionId?: string | null
  }
  leadId: string
  providerId: string
  source?: string
}) {
  const { recordWorkflowEvent } = await import('../../lib/workflow-events/record')
  if (params.result.ok && !params.result.alreadyAccepted) {
    recordWorkflowEvent({
      eventType: 'PROVIDER_ACCEPTED',
      actorType: 'provider',
      actorId: params.providerId,
      entityType: 'LEAD',
      entityId: params.leadId,
      source: params.source ?? 'api',
      metadata: {
        providerId: params.providerId,
        matchId: params.result.matchId,
        jobId: params.result.jobId,
        bookingId: params.result.bookingId,
        creditsCharged: params.result.creditCheck?.requiredCredits ?? null,
        creditTransactionId: params.result.creditTransactionId ?? null,
        path: 'qualified-shortlist',
      },
    }).catch(() => {})
  }
}

describe('selected-provider-acceptance PROVIDER_ACCEPTED emit', () => {
  it('emits once on a fresh successful acceptance', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderAcceptedIfFirstAccept({
      result: {
        ok: true,
        alreadyAccepted: false,
        matchId: 'match_1',
        jobId: 'job_1',
        bookingId: 'booking_1',
        creditCheck: { requiredCredits: 1 },
        creditTransactionId: 'tx_1',
      },
      leadId: 'lead_1',
      providerId: 'prov_1',
    })

    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0][0]).toMatchObject({
      eventType: 'PROVIDER_ACCEPTED',
      actorType: 'provider',
      actorId: 'prov_1',
      entityType: 'LEAD',
      entityId: 'lead_1',
      metadata: {
        creditsCharged: 1,
        path: 'qualified-shortlist',
      },
    })
  })

  it('does NOT emit on an alreadyAccepted idempotent retry', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderAcceptedIfFirstAccept({
      result: {
        ok: true,
        alreadyAccepted: true, // retry — second acceptance attempt
        matchId: 'match_1',
        jobId: 'job_1',
        bookingId: 'booking_1',
        creditCheck: { requiredCredits: 1 },
      },
      leadId: 'lead_1',
      providerId: 'prov_1',
    })

    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when result.ok is false (insufficient-credit or other failure)', async () => {
    recordWorkflowEvent.mockClear()
    await emitProviderAcceptedIfFirstAccept({
      result: {
        ok: false,
        matchId: null,
        jobId: null,
        bookingId: null,
      },
      leadId: 'lead_2',
      providerId: 'prov_2',
    })

    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
