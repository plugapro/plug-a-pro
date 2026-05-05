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
  mockNotifyProviderNewJob,
  mockReconcileProviderRecordsFromApplications,
  mockNotifyPostMatchAcceptance,
} = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    provider: { findMany: vi.fn() },
    lead: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    match: { findUnique: vi.fn(), create: vi.fn() },
  },
  mockRunAssignmentForJobRequest: vi.fn(),
  mockAcceptAssignmentOffer: vi.fn(),
  mockRejectAssignmentOffer: vi.fn(),
  mockProcessPendingAssignmentWorkflows: vi.fn(),
  mockNotifyProviderNewJob: vi.fn(),
  mockReconcileProviderRecordsFromApplications: vi.fn(),
  mockNotifyPostMatchAcceptance: vi.fn(),
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

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: mockNotifyProviderNewJob,
}))

vi.mock('../../lib/provider-record', () => ({
  reconcileProviderRecordsFromApplications: mockReconcileProviderRecordsFromApplications,
}))

vi.mock('../../lib/post-match-communications', () => ({
  notifyPostMatchAcceptance: mockNotifyPostMatchAcceptance,
}))

describe('matching-engine compatibility wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReconcileProviderRecordsFromApplications.mockResolvedValue({ reconciled: 0 })
    mockNotifyPostMatchAcceptance.mockResolvedValue({ providerNotified: true, customerNotified: true })
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
      creditTransactionId: null,
      inspectionNeeded: false,
      notificationSent: true,
    })
    expect(mockNotifyPostMatchAcceptance).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      matchId: 'match-1',
      creditTransactionId: null,
    })
  })

  it('acceptLead does not notify the customer when unlock credit validation fails', async () => {
    mockAcceptAssignmentOffer.mockResolvedValue({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })

    expect(result).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    })
    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })
    expect(mockNotifyPostMatchAcceptance).not.toHaveBeenCalled()
  })

  it('dispatchLeads propagates non-schema errors from the assignment service', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'OPEN' })
    mockRunAssignmentForJobRequest.mockRejectedValue(new Error('Service unavailable'))

    await expect(dispatchLeads('jr-1')).rejects.toThrow('Service unavailable')
  })

  it('declineLead treats expired or taken offers as a no-op and signals alreadyClosed', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'EXPIRED' })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: true, alreadyClosed: true })
  })

  it('declineLead signals alreadyClosed for TAKEN offers (lead grabbed by another provider)', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'TAKEN' })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: true, alreadyClosed: true })
  })

  it('declineLead returns ok:true without alreadyClosed on a successful decline', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: true })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: true })
    expect(result).not.toHaveProperty('alreadyClosed')
  })

  it('declineLead returns NOT_FOUND when the lead does not belong to this provider', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'NOT_FOUND' })

    const result = await declineLead({ leadId: 'lead-missing', providerId: 'provider-1' })

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('declineLead returns FORBIDDEN when provider access is denied', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'FORBIDDEN' })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-other' })

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' })
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
