import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptLead,
  declineLead,
  dispatchLeads,
  expireStaleLeads,
  sendLeadReminders,
} from '../../lib/matching-engine'

const {
  mockDb,
  mockRunAssignmentForJobRequest,
  mockAcceptAssignmentOffer,
  mockAcceptSelectedProviderJob,
  mockDeclineSelectedProviderJob,
  mockRejectAssignmentOffer,
  mockProcessPendingAssignmentWorkflows,
  mockNotifyProviderNewJob,
  mockReconcileProviderRecordsFromApplications,
  mockSendCtaUrl,
  mockGetProviderLeadAccessUrl,
} = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    provider: { findMany: vi.fn() },
    lead: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    match: { findUnique: vi.fn(), create: vi.fn() },
  },
  mockRunAssignmentForJobRequest: vi.fn(),
  mockAcceptAssignmentOffer: vi.fn(),
  mockAcceptSelectedProviderJob: vi.fn(),
  mockDeclineSelectedProviderJob: vi.fn(),
  mockRejectAssignmentOffer: vi.fn(),
  mockProcessPendingAssignmentWorkflows: vi.fn(),
  mockNotifyProviderNewJob: vi.fn(),
  mockReconcileProviderRecordsFromApplications: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockGetProviderLeadAccessUrl: vi.fn(),
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

vi.mock('../../lib/selected-provider-acceptance', () => ({
  acceptSelectedProviderJob: mockAcceptSelectedProviderJob,
}))

vi.mock('../../lib/customer-shortlists', () => ({
  declineSelectedProviderJob: mockDeclineSelectedProviderJob,
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: mockNotifyProviderNewJob,
}))

vi.mock('../../lib/provider-record', () => ({
  reconcileProviderRecordsFromApplications: mockReconcileProviderRecordsFromApplications,
}))

vi.mock('../../lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
}))

vi.mock('../../lib/provider-lead-access', () => ({
  getProviderLeadAccessUrl: mockGetProviderLeadAccessUrl,
}))

describe('matching-engine compatibility wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReconcileProviderRecordsFromApplications.mockResolvedValue({ reconciled: 0 })
    mockGetProviderLeadAccessUrl.mockResolvedValue('https://app.plugapro.co.za/leads/access/signed.token')
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: 'SENT',
      providerId: 'provider-1',
      jobRequest: {
        status: 'MATCHING',
        selectedLeadInviteId: null,
      },
    })
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

  it('acceptLead accepts only through selected-provider final confirmation', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      customerSelectedAt: new Date('2026-05-10T08:00:00.000Z'),
      jobRequest: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      leadId: 'lead-1',
      matchId: null,
      creditTransactionId: 'ledger-1',
      currentCreditBalance: 4,
      alreadyAccepted: false,
      alreadyUnlocked: false,
      creditApplied: true,
      creditCheck: {
        ok: true,
        result: 'SUFFICIENT_CREDITS',
        requiredCredits: 1,
        currentCreditBalance: 4,
        providerMessage: 'Accepted. Credit check passed.',
      },
      notificationSent: true,
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({
      ok: true,
      leadId: 'lead-1',
      matchId: null,
      creditTransactionId: 'ledger-1',
      currentCreditBalance: 4,
      alreadyAccepted: false,
      alreadyUnlocked: false,
      creditApplied: true,
      creditCheck: {
        ok: true,
        reason: undefined,
        requiredCredits: 1,
        currentCreditBalance: 4,
        providerMessage: 'Accepted. Credit check passed.',
      },
      inspectionNeeded: false,
      notificationSent: true,
    })
    expect(mockAcceptSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: undefined,
    })
    expect(mockAcceptAssignmentOffer).not.toHaveBeenCalled()
  })

  it('acceptLead returns accepted with CREDIT_REQUIRED from selected-provider acceptance path', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      customerSelectedAt: new Date('2026-05-10T08:00:00.000Z'),
      jobRequest: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      leadId: 'lead-1',
      matchId: undefined,
      creditTransactionId: null,
      currentCreditBalance: 0,
      alreadyUnlocked: false,
      creditApplied: false,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        requiredCredits: 1,
        currentCreditBalance: 0,
        providerMessage: 'Not enough credits.',
      },
      notificationSent: false,
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })

    expect(result).toEqual({
      ok: true,
      leadId: 'lead-1',
      creditTransactionId: null,
      currentCreditBalance: 0,
      alreadyAccepted: undefined,
      alreadyUnlocked: false,
      creditApplied: false,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        requiredCredits: 1,
        currentCreditBalance: 0,
        providerMessage: 'Not enough credits.',
      },
      inspectionNeeded: false,
      notificationSent: false,
    })
    expect(mockAcceptSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })
    expect(mockAcceptAssignmentOffer).not.toHaveBeenCalled()
  })

  it('acceptLead preserves identity-verification blocks from selected-provider acceptance', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      customerSelectedAt: new Date('2026-05-10T08:00:00.000Z'),
      jobRequest: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'IDENTITY_NOT_VERIFIED',
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1', source: 'pwa' })

    expect(result).toEqual({
      ok: false,
      reason: 'IDENTITY_NOT_VERIFIED',
    })
    expect(mockAcceptAssignmentOffer).not.toHaveBeenCalled()
  })

  it('acceptLead blocks non-selected legacy accepts and never charges', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      customerSelectedAt: null,
      jobRequest: {
        status: 'MATCHING',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      },
    })

    const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })

    expect(result).toEqual({
      ok: false,
      reason: 'EXPIRED',
    })
    expect(mockAcceptSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockAcceptAssignmentOffer).not.toHaveBeenCalled()
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
    mockDb.lead.findUnique.mockResolvedValueOnce(null)
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'NOT_FOUND' })

    const result = await declineLead({ leadId: 'lead-missing', providerId: 'provider-1' })

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('declineLead returns FORBIDDEN when provider access is denied', async () => {
    mockRejectAssignmentOffer.mockResolvedValue({ ok: false, reason: 'FORBIDDEN' })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-other' })

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' })
  })

  it('declineLead uses selected-provider decline for notified leads', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce({
      id: 'lead-1',
      status: 'CUSTOMER_SELECTED',
      providerId: 'provider-1',
      jobRequest: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedLeadInviteId: 'lead-1',
      },
    })
    mockDeclineSelectedProviderJob.mockResolvedValueOnce({ ok: true, alreadyDeclined: true })

    const result = await declineLead({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: true, alreadyDeclined: true })
    expect(mockDeclineSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
    })
    expect(mockRejectAssignmentOffer).not.toHaveBeenCalled()
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

  it('sendLeadReminders marks lead viewed reminders with a safe expiring-soon copy and no 0-minute countdown', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        providerId: 'provider-1',
        expiresAt: new Date(Date.now() + 20_000),
        provider: { phone: '+27820000000' },
        jobRequest: { category: 'Handyman', address: { suburb: 'Bromhof', city: 'Johannesburg' } },
      },
    ])

    const sent = await sendLeadReminders()

    expect(sent).toBe(1)
    expect(mockSendCtaUrl).toHaveBeenCalledTimes(1)
    const message = mockSendCtaUrl.mock.calls[0][1] as string
    expect(message).toContain('Reminder - Lead Expires Soon')
    expect(message).not.toContain('0 min left')
    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { reminderSentAt: expect.any(Date) },
    })
  })

  it('sendLeadReminders applies active-provider and active-request guards in the lead query', async () => {
    mockDb.lead.findMany.mockResolvedValue([])

    await sendLeadReminders()

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: {
          active: true,
          status: 'ACTIVE',
        },
        jobRequest: {
          status: { in: ['OPEN', 'MATCHING', 'SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'] },
        },
      }),
    }))
  })
})
