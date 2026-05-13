import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJobRequest,
  mockLead,
  mockSendJobOffer,
  mockSendText,
  mockGetProviderLeadAccessUrl,
} = vi.hoisted(() => ({
  mockJobRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockLead: {
    update: vi.fn(),
  },
  mockSendJobOffer: vi.fn(),
  mockSendText: vi.fn(),
  mockGetProviderLeadAccessUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    lead: mockLead,
  },
}))

vi.mock('@/lib/whatsapp', () => ({
  sendJobOffer: mockSendJobOffer,
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
}))

vi.mock('@/lib/provider-lead-access', () => ({
  getProviderLeadAccessUrl: mockGetProviderLeadAccessUrl,
}))

vi.mock('@/lib/matching/service', () => ({
  rankCandidatesForJobRequest: vi.fn(),
}))

describe('sendRequestToShortlistedProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      customerId: 'customer-1',
      category: 'DIY & Assembly',
      title: 'Cupboard repair',
      description: 'Fix cupboard hinges',
      subcategory: null,
      urgency: 'SOON',
      requestedWindowStart: new Date('2026-05-14T08:00:00.000Z'),
      requestedArrivalLatest: null,
      providerPreference: null,
      budgetPreference: null,
      requestRef: 'PAP-123',
      address: { suburb: 'Bromhof', city: 'Johannesburg', province: 'Gauteng' },
      customer: { phone: '+27820000000' },
      leads: [
        {
          id: 'lead-1',
          status: 'SHORTLISTED',
          provider: {
            id: 'provider-1',
            phone: '+27821111111',
            name: 'Lovemore Sibanda',
          },
        },
      ],
    })
    mockJobRequest.update.mockResolvedValue({})
    mockLead.update.mockResolvedValue({})
    mockGetProviderLeadAccessUrl.mockResolvedValue('https://app.plugapro.co.za/leads/access/signed-token')
    mockSendJobOffer.mockResolvedValue(undefined)
    mockSendText.mockResolvedValue('customer-message-id')
  })

  it('uses the approved job_offer template to notify shortlisted providers', async () => {
    const { sendRequestToShortlistedProviders } = await import('@/lib/review-first')

    const result = await sendRequestToShortlistedProviders({
      requestId: 'request-1',
      customerId: 'customer-1',
    })

    expect(result.invitedCount).toBe(1)
    expect(mockJobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
      },
    })
    expect(mockSendJobOffer).toHaveBeenCalledWith(expect.objectContaining({
      providerPhone: '+27821111111',
      providerFirstName: 'Lovemore',
      serviceName: 'DIY & Assembly',
      area: 'Bromhof, Johannesburg',
      jobUrl: 'https://app.plugapro.co.za/leads/access/signed-token',
      metadata: expect.objectContaining({
        requestId: 'request-1',
        leadId: 'lead-1',
        providerId: 'provider-1',
        source: 'review_first_send_request',
      }),
    }))
    expect(mockLead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        status: 'SENT',
        sentAt: expect.any(Date),
      }),
    }))
    expect(mockLead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        notifiedAt: expect.any(Date),
        notificationAttemptedAt: expect.any(Date),
      }),
    }))
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Your request has been sent to 1 selected provider'),
      expect.objectContaining({
        templateName: 'interactive:rfp_sent_to_shortlist',
      }),
    )
  })
})
