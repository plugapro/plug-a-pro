// Tier 1 funnel observability — verifies PROVIDER_DECLINED emits from both
// declineLead paths (qualified-shortlist + standard) and skips the
// already-declined idempotency path.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the recorder before importing the SUT so vi can intercept the module.
const recordWorkflowEvent = vi.fn(async () => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

// Mock the inner shortlist / rejection helpers — declineLead delegates to them.
const declineSelectedProviderJob = vi.fn()
const rejectAssignmentOffer = vi.fn()
vi.mock('../../lib/customer-shortlists', () => ({ declineSelectedProviderJob }))
vi.mock('../../lib/matching/service', () => ({
  rejectAssignmentOffer,
  processPendingAssignmentWorkflows: vi.fn(),
  runAssignmentForJobRequest: vi.fn(),
}))

// Mock the Prisma client surface declineLead reads up-front.
vi.mock('../../lib/db', () => ({
  db: {
    lead: {
      findUnique: vi.fn(),
    },
  },
}))

beforeEach(() => {
  recordWorkflowEvent.mockClear()
  declineSelectedProviderJob.mockReset()
  rejectAssignmentOffer.mockReset()
})

describe('declineLead — PROVIDER_DECLINED emit', () => {
  it('emits on the qualified-shortlist path when not already declined', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findUnique as any).mockResolvedValue({
      id: 'lead_1',
      status: 'CUSTOMER_SELECTED', // pushes the call into the qualified-shortlist branch
      providerId: 'prov_1',
      jobRequest: { status: 'PROVIDER_CONFIRMATION_PENDING', selectedLeadInviteId: null },
    })
    declineSelectedProviderJob.mockResolvedValue({ ok: true })

    const { declineLead } = await import('../../lib/matching-engine')
    const result = await declineLead({ leadId: 'lead_1', providerId: 'prov_1' })

    expect(result.ok).toBe(true)
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0][0]).toMatchObject({
      eventType: 'PROVIDER_DECLINED',
      actorType: 'provider',
      actorId: 'prov_1',
      entityType: 'LEAD',
      entityId: 'lead_1',
      metadata: { path: 'qualified-shortlist' },
    })
  })

  it('does NOT emit when the qualified-shortlist path returns alreadyDeclined', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findUnique as any).mockResolvedValue({
      id: 'lead_2',
      status: 'CUSTOMER_SELECTED',
      providerId: 'prov_2',
      jobRequest: { status: 'PROVIDER_CONFIRMATION_PENDING', selectedLeadInviteId: null },
    })
    declineSelectedProviderJob.mockResolvedValue({ ok: true, alreadyDeclined: true })

    const { declineLead } = await import('../../lib/matching-engine')
    const result = await declineLead({ leadId: 'lead_2', providerId: 'prov_2' })

    expect(result).toEqual({ ok: true, alreadyDeclined: true })
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })

  it('emits on the standard path on success', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findUnique as any).mockResolvedValue({
      id: 'lead_3',
      status: 'SENT',
      providerId: 'prov_3',
      jobRequest: { status: 'OPEN', selectedLeadInviteId: null },
    })
    rejectAssignmentOffer.mockResolvedValue({ ok: true })

    const { declineLead } = await import('../../lib/matching-engine')
    const result = await declineLead({ leadId: 'lead_3', providerId: 'prov_3' })

    expect(result.ok).toBe(true)
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0][0]).toMatchObject({
      eventType: 'PROVIDER_DECLINED',
      metadata: { path: 'standard' },
    })
  })

  it('does NOT emit when the standard path returns alreadyClosed (EXPIRED)', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findUnique as any).mockResolvedValue({
      id: 'lead_4',
      status: 'SENT',
      providerId: 'prov_4',
      jobRequest: { status: 'OPEN', selectedLeadInviteId: null },
    })
    rejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'EXPIRED' })

    const { declineLead } = await import('../../lib/matching-engine')
    const result = await declineLead({ leadId: 'lead_4', providerId: 'prov_4' })

    expect(result).toEqual({ ok: true, alreadyClosed: true })
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
