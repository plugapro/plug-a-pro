import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockResolveToken,
  mockVerifyToken,
  mockGetAccessUrl,
  mockSendText,
  mockSendCtaUrl,
  mockProviderLeadTokenAllowsScope,
} = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn() },
    match: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mockResolveToken: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockGetAccessUrl: vi.fn(),
  mockSendText: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockProviderLeadTokenAllowsScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/provider-lead-access', () => ({
  resolveProviderLeadAccessToken: mockResolveToken,
  verifyProviderLeadAccessToken: mockVerifyToken,
  getProviderSignedJobHandoverUrl: mockGetAccessUrl,
  providerLeadTokenAllowsScope: mockProviderLeadTokenAllowsScope,
  LEAD_RESPONSE_SCOPES: ['view_lead', 'accept_lead', 'decline_lead'],
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendCtaUrl: mockSendCtaUrl,
}))

import {
  markAcceptedLeadAction,
  saveAcceptedLeadArrival,
  sendFreshAcceptedJobLink,
} from '@/lib/accepted-job-actions'

function futureAt(hour: number, minute = 0) {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  date.setHours(hour, minute, 0, 0)
  return date
}

const plannedStart = futureAt(15, 30)
const plannedEnd = futureAt(16, 0)

function acceptedLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    jobRequestId: 'jr-12345678',
    status: 'ACCEPTED',
    provider: { id: 'provider-1', name: 'Jacob Hesser', phone: '+27770000001' },
    jobRequest: {
      id: 'jr-12345678',
      status: 'MATCHED',
      category: 'Plumbing',
      description: 'Preferred availability: Afternoons only',
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
      customer: { id: 'cust-1', name: 'Tiffany Nkosi', phone: '+27820000001' },
      address: { suburb: 'Bromhof', city: 'Johannesburg' },
      match: {
        id: 'match-1',
        providerId: 'provider-1',
        status: 'MATCHED',
        customerContactedAt: null,
        plannedArrivalStart: null,
        plannedArrivalEnd: null,
        plannedArrivalNote: null,
        providerOnTheWayAt: null,
        providerArrivedAt: null,
        providerStartedAt: null,
        providerCompletedAt: null,
        ...overrides,
      },
    },
  }
}

describe('accepted job actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderLeadTokenAllowsScope.mockReturnValue(true)
    mockResolveToken.mockResolvedValue({ status: 'active', lead: { id: 'lead-1' } })
    mockVerifyToken.mockReturnValue({
      status: 'active',
      payload: { leadId: 'lead-1', providerId: 'provider-1', scopes: ['view_job', 'confirm_arrival', 'mark_on_the_way', 'mark_arrived', 'start_job', 'complete_job', 'mark_customer_contacted', 'contact_customer'] },
    })
    mockDb.lead.findUnique.mockResolvedValue(acceptedLead())
    mockDb.match.update.mockResolvedValue({})
    mockDb.auditLog.create.mockResolvedValue({})
    mockSendText.mockResolvedValue('wamid.customer')
    mockSendCtaUrl.mockResolvedValue('wamid.provider')
  })

  it('saves the planned arrival window and notifies the customer once', async () => {
    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
      note: 'I will call from the gate.',
    })

    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: {
        plannedArrivalStart: plannedStart,
        plannedArrivalEnd: plannedEnd,
        plannedArrivalNote: 'I will call from the gate.',
      },
    })
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('Jacob plans to arrive'),
      expect.objectContaining({
        templateName: 'post_match_customer_arrival_planned',
        metadata: expect.objectContaining({ action: 'arrival_planned', leadId: 'lead-1' }),
      }),
    )
  })

  it('does not resend the arrival WhatsApp update for an identical duplicate save', async () => {
    mockDb.lead.findUnique.mockResolvedValue(acceptedLead({
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
      plannedArrivalNote: 'I will call from the gate.',
    }))

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
      note: 'I will call from the gate.',
    })

    expect(result).toMatchObject({ ok: true, duplicate: true })
    expect(mockDb.match.update).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('rejects arrival outside customer availability without updating or notifying', async () => {
    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: futureAt(9, 0),
      plannedArrivalEnd: futureAt(10, 0),
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
    expect(mockDb.match.update).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'match.arrival_plan_rejected',
      }),
    }))
  })

  it('blocks provider not assigned to the accepted job', async () => {
    mockResolveToken.mockResolvedValue({ status: 'active', lead: { id: 'lead-1' } })
    mockDb.lead.findUnique.mockResolvedValue(null)

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB',
    })
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })

  it('marks on the way and sends the customer update once', async () => {
    const result = await markAcceptedLeadAction({
      leadId: 'lead-1',
      token: 'signed-token',
      action: 'on_the_way',
    })

    expect(result).toEqual({ ok: true, duplicate: false })
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { providerOnTheWayAt: expect.any(Date) },
    })
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('Jacob is on the way for your Plumbing request'),
      expect.objectContaining({
        templateName: 'post_match_customer_provider_on_the_way',
      }),
    )
  })

  it('blocks old signed links when the lead is no longer accepted by that provider', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      ...acceptedLead(),
      status: 'EXPIRED',
    })

    const result = await markAcceptedLeadAction({
      leadId: 'lead-1',
      token: 'signed-token',
      action: 'arrived',
    })

    expect(result).toEqual({ ok: false, reason: 'UNAVAILABLE' })
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })

  it('rejects an arrival window where end time is before start time', async () => {
    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: new Date('2026-04-30T15:00:00+02:00'),
      plannedArrivalEnd: new Date('2026-04-30T13:00:00+02:00'),
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'ARRIVAL_END_BEFORE_START',
    })
    expect(mockDb.match.update).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('returns PROVIDER_NOT_ASSIGNED_TO_JOB when the lead has no associated match', async () => {
    // loadAcceptedLead returns null when jobRequest.match is null,
    // so saveAcceptedLeadArrival surfaces PROVIDER_NOT_ASSIGNED_TO_JOB.
    mockDb.lead.findUnique.mockResolvedValue({
      ...acceptedLead(),
      jobRequest: {
        ...acceptedLead().jobRequest,
        match: null,
      },
    })

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB',
    })
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })

  it('returns CUSTOMER_NOTIFICATION_FAILED and saves the window when WhatsApp throws', async () => {
    mockSendText.mockRejectedValue(new Error('WhatsApp API timeout'))

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'signed-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'CUSTOMER_NOTIFICATION_FAILED',
    })
    // The match update still happened before the notification attempt
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: expect.objectContaining({
        plannedArrivalStart: plannedStart,
        plannedArrivalEnd: plannedEnd,
      }),
    })
  })

  it('blocks a LEAD_RESPONSE_SCOPES-only token (original WhatsApp invite URL) from saving arrival', async () => {
    // Security boundary: the original "View Lead" URL carries LEAD_RESPONSE_SCOPES
    // (view_lead/accept_lead/decline_lead) which does NOT include 'confirm_arrival'.
    // tokenAllowsAcceptedJobScope must require the exact accepted-job scope; a
    // lower-scoped lead invite token must not be able to mutate arrival times.
    mockVerifyToken.mockReturnValue({
      status: 'active',
      payload: {
        leadId: 'lead-1',
        providerId: 'provider-1',
        scopes: ['view_lead', 'accept_lead', 'decline_lead'],
      },
    })
    mockProviderLeadTokenAllowsScope.mockReturnValue(false) // 'confirm_arrival' not in LEAD_RESPONSE_SCOPES

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'original-invite-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
    })

    expect(result).toMatchObject({ ok: false, reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB' })
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid/tampered token before hitting the database', async () => {
    mockVerifyToken.mockReturnValue({ status: 'invalid', payload: null })

    const result = await saveAcceptedLeadArrival({
      leadId: 'lead-1',
      token: 'tampered-token',
      plannedArrivalStart: plannedStart,
      plannedArrivalEnd: plannedEnd,
    })

    expect(result).toMatchObject({ ok: false, reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB' })
    expect(mockDb.lead.findUnique).not.toHaveBeenCalled()
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })

  it('sends a fresh signed job link for an expired accepted-job token', async () => {
    mockVerifyToken.mockReturnValue({
      status: 'expired',
      payload: { leadId: 'lead-1', providerId: 'provider-1' },
    })
    mockGetAccessUrl.mockResolvedValue('https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=fresh-token')

    const result = await sendFreshAcceptedJobLink({ token: 'expired-token' })

    expect(result).toEqual({ ok: true })
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('fresh secure link'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=fresh-token',
      expect.any(Object),
      expect.objectContaining({
        templateName: 'post_match_provider_fresh_job_link',
      }),
    )
  })
})
