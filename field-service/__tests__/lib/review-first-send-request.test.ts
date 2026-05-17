import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJobRequest,
  mockLead,
  mockMessageEvent,
  mockAuditLog,
  mockTransaction,
  mockSendJobOffer,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
  mockGetProviderLeadAccessUrl,
  mockGetJobRequestAccessUrl,
  mockHasSuccessfulMessageForRecipient,
} = vi.hoisted(() => ({
  mockJobRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  mockLead: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  mockMessageEvent: {
    findFirst: vi.fn(),
  },
  mockAuditLog: {
    create: vi.fn(),
  },
  mockTransaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    jobRequest: mockJobRequest,
    lead: mockLead,
    auditLog: mockAuditLog,
  })),
  mockSendJobOffer: vi.fn(),
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockGetProviderLeadAccessUrl: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
  mockHasSuccessfulMessageForRecipient: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    lead: mockLead,
    messageEvent: mockMessageEvent,
    auditLog: mockAuditLog,
    $transaction: mockTransaction,
  },
}))

vi.mock('@/lib/whatsapp', () => ({
  sendJobOffer: mockSendJobOffer,
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: mockSendButtons,
  sendCtaUrl: mockSendCtaUrl,
}))

vi.mock('@/lib/provider-lead-access', () => ({
  getProviderLeadAccessUrl: mockGetProviderLeadAccessUrl,
}))

vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: mockGetJobRequestAccessUrl,
}))

vi.mock('@/lib/message-events', () => ({
  hasSuccessfulMessageForRecipient: mockHasSuccessfulMessageForRecipient,
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
    mockJobRequest.updateMany.mockResolvedValue({ count: 1 })
    mockLead.update.mockResolvedValue({})
    mockLead.updateMany.mockResolvedValue({ count: 1 })
    mockLead.findMany.mockResolvedValue([])
    mockLead.count.mockResolvedValue(0)
    mockMessageEvent.findFirst.mockResolvedValue(null)
    mockAuditLog.create.mockResolvedValue({})
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      jobRequest: mockJobRequest,
      lead: mockLead,
      auditLog: mockAuditLog,
    }))
    mockGetProviderLeadAccessUrl.mockResolvedValue('https://app.plugapro.co.za/leads/access/signed-token')
    mockGetJobRequestAccessUrl.mockResolvedValue('https://app.plugapro.co.za/requests/access/token?view=matching_status')
    mockHasSuccessfulMessageForRecipient.mockResolvedValue(false)
    mockSendJobOffer.mockResolvedValue('wamid.provider')
    mockSendText.mockResolvedValue('customer-message-id')
    mockSendButtons.mockResolvedValue('customer-buttons-message-id')
    mockSendCtaUrl.mockResolvedValue('customer-failure-message-id')
  })

  it('uses the approved job_offer template and waits for WhatsApp status before marking sent', async () => {
    const { sendRequestToShortlistedProviders } = await import('@/lib/review-first')

    const result = await sendRequestToShortlistedProviders({
      requestId: 'request-1',
      customerId: 'customer-1',
    })

    expect(result.invitedCount).toBe(1)
    expect(result.pendingCount).toBe(1)
    expect(mockJobRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1' },
      data: expect.objectContaining({ status: 'MATCHING' }),
    }))
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
        status: 'SEND_PENDING',
        expiresAt: null,
      }),
    }))
    expect(mockLead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        notifiedAt: null,
        notificationAttemptedAt: expect.any(Date),
      }),
    }))
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining("We're sending your request to Lovemore Sibanda"),
      expect.objectContaining({
        templateName: 'interactive:rfp_sent_to_shortlist',
      }),
    )
  })

  it('marks failed provider sends as send_failed and does not tell the customer a response timer started', async () => {
    mockSendJobOffer.mockRejectedValue(new Error('WhatsApp send failed: {"error":{"code":131042,"message":"Business eligibility payment issue"}}'))
    const { sendRequestToShortlistedProviders } = await import('@/lib/review-first')

    await expect(sendRequestToShortlistedProviders({
      requestId: 'request-1',
      customerId: 'customer-1',
    })).rejects.toMatchObject({ code: 'PROVIDER_NOTIFICATION_FAILED' })

    expect(mockLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        status: 'SEND_PENDING',
        expiresAt: null,
        notifiedAt: null,
      }),
    })
    expect(mockLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        status: 'SEND_FAILED',
        expiresAt: null,
        expiredAt: null,
        respondedAt: null,
        viewedAt: null,
        notifiedAt: null,
        notificationAttemptedAt: null,
      },
    })
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining("couldn't notify Lovemore Sibanda right now"),
      expect.objectContaining({
        templateName: 'interactive:rfp_send_failed',
      }),
    )
    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('They have 15 minutes to respond'),
      expect.any(Object),
    )
  })

  it('marks delivered provider notifications as notified from the webhook status', async () => {
    mockMessageEvent.findFirst.mockResolvedValue({
      id: 'message-1',
      templateName: 'technician_job_reminder',
      metadata: {
        source: 'review_first_send_request',
        requestId: 'request-1',
        leadId: 'lead-1',
        providerId: 'provider-1',
      },
    })
    mockLead.findUnique.mockResolvedValue({
      provider: { name: 'Lovemore Sibanda' },
      jobRequest: {
        customer: { phone: '+27820000000' },
      },
    })
    const { handleReviewFirstProviderNotificationStatus } = await import('@/lib/review-first')

    const result = await handleReviewFirstProviderNotificationStatus({
      externalId: 'wamid.1',
      status: 'delivered',
    })

    expect(result).toEqual(expect.objectContaining({ handled: true, result: 'delivered' }))
    expect(mockLead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead-1',
        jobRequestId: 'request-1',
        providerId: 'provider-1',
        status: 'SEND_PENDING',
      },
      data: {
        status: 'SENT',
        sentAt: expect.any(Date),
        expiresAt: expect.any(Date),
        notifiedAt: expect.any(Date),
        notificationAttemptedAt: null,
      },
    })
    expect(mockJobRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        assignmentMode: 'OPS_REVIEW',
        status: 'PENDING_VALIDATION',
      },
      data: { status: 'MATCHING' },
    })
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Your request was sent to'),
      expect.objectContaining({
        templateName: 'interactive:rfp_provider_notification_accepted',
      }),
    )
  })

  it('repairs a failed provider notification so the lead can be retried instead of expiring as no response', async () => {
    mockMessageEvent.findFirst.mockResolvedValue({
      id: 'message-1',
      templateName: 'technician_job_reminder',
      metadata: {
        source: 'review_first_send_request',
        requestId: 'request-1',
        leadId: 'lead-1',
        providerId: 'provider-1',
      },
    })
    mockLead.findUnique.mockResolvedValue({
      id: 'lead-1',
      jobRequestId: 'request-1',
      providerId: 'provider-1',
      status: 'SENT',
      notifiedAt: null,
      jobRequest: {
        id: 'request-1',
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
        customer: { phone: '+27820000000' },
      },
    })
    const { handleReviewFirstProviderNotificationStatus } = await import('@/lib/review-first')

    const result = await handleReviewFirstProviderNotificationStatus({
      externalId: 'wamid.1',
      status: 'failed',
      failureReason: 'Business eligibility payment issue',
    })

    expect(result).toEqual({ handled: true, result: 'failed_repaired' })
    expect(mockLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        status: 'SEND_FAILED',
        expiresAt: null,
        expiredAt: null,
        respondedAt: null,
        viewedAt: null,
        notifiedAt: null,
        notificationAttemptedAt: null,
      },
    })
    expect(mockJobRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
      },
      data: { status: 'PENDING_VALIDATION' },
    })
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining("couldn't complete the WhatsApp notification"),
      'View request',
      'https://app.plugapro.co.za/requests/access/token?view=matching_status',
      undefined,
      expect.objectContaining({
        templateName: 'interactive:rfp_provider_notification_failed',
        metadata: expect.objectContaining({
          requestId: 'request-1',
          leadId: 'lead-1',
          providerId: 'provider-1',
        }),
      }),
    )
  })

  it('only expires review-first provider leads after a confirmed provider notification', async () => {
    const { expireRfpInvitations } = await import('@/lib/review-first')

    await expireRfpInvitations()

    expect(mockLead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['SENT', 'VIEWED'] },
        respondedAt: null,
        notifiedAt: { not: null },
        expiresAt: expect.any(Object),
        jobRequest: {
          status: 'MATCHING',
          assignmentMode: 'OPS_REVIEW',
        },
      }),
    }))
    expect(mockLead.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('None of the selected providers responded in time'),
      expect.any(Object),
    )
  })
})
