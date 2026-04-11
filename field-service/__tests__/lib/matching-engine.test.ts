import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptLead,
  declineLead,
  dispatchLeads,
  expireStaleLeads,
} from '../../lib/matching-engine'

const {
  mockDb,
  mockRunAssignmentForJobRequest,
  mockAcceptAssignmentOffer,
  mockRejectAssignmentOffer,
  mockProcessPendingAssignmentWorkflows,
} = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
  },
  mockRunAssignmentForJobRequest: vi.fn(),
  mockAcceptAssignmentOffer: vi.fn(),
  mockRejectAssignmentOffer: vi.fn(),
  mockProcessPendingAssignmentWorkflows: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/matching/service', () => ({
  runAssignmentForJobRequest: mockRunAssignmentForJobRequest,
  acceptAssignmentOffer: mockAcceptAssignmentOffer,
  rejectAssignmentOffer: mockRejectAssignmentOffer,
  processPendingAssignmentWorkflows: mockProcessPendingAssignmentWorkflows,
}))

describe('matching-engine compatibility wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatchLeads returns an offered hold for the top ranked technician', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'OPEN' })
    mockRunAssignmentForJobRequest.mockResolvedValue({
      jobRequestId: 'jr-1',
      candidates: [{ providerId: 'provider-1' }],
      assignmentHoldId: 'hold-1',
    })

    const result = await dispatchLeads('jr-1')

    expect(result).toEqual({
      jobRequestId: 'jr-1',
      leadsDispatched: 1,
      candidatesFound: 1,
      noMatch: false,
    })
    expect(mockRunAssignmentForJobRequest).toHaveBeenCalledWith({
      jobRequestId: 'jr-1',
      actor: { actorId: 'system', actorRole: 'system' },
      mode: 'AUTO_ASSIGN',
    })
  })

  it('acceptLead delegates to the assignment offer acceptance service', async () => {
    mockAcceptAssignmentOffer.mockResolvedValue({
      ok: true,
      responseOutcome: 'ACCEPTED',
      matchId: 'match-1',
      assignmentHoldId: 'hold-1',
      nextOfferedProviderId: null,
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({
      ok: true,
      leadId: 'lead-1',
      matchId: 'match-1',
      inspectionNeeded: false,
    })
  })

  it('declineLead treats expired or taken offers as a no-op for compatibility', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'EXPIRED' })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: true })
  })

  it('expireStaleLeads expires all active assignment holds that timed out', async () => {
    mockProcessPendingAssignmentWorkflows.mockResolvedValue({
      processed: 2,
      expiredOffers: 2,
      reoffered: 1,
    })

    const result = await expireStaleLeads()

    expect(result).toBe(2)
    expect(mockProcessPendingAssignmentWorkflows).toHaveBeenCalledTimes(1)
  })
})
