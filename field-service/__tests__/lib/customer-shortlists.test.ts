import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelRequestFromShortlist,
  declineSelectedProviderJob,
  generateCustomerShortlistForRequest,
  getCustomerShortlistForRequest,
  requestMoreShortlistOptions,
  selectProviderForCustomerRequest,
  selectShortlistedProviderForRequest,
} from '../../lib/customer-shortlists'

const { mockDb, state, mockOrchestrateMatch } = vi.hoisted(() => {
const state: { tx: any; shortlistItem: any; declineLead: any } = {
    tx: null,
    shortlistItem: null,
    declineLead: null,
  }
  const mockOrchestrateMatch = vi.fn()
  const mockDb = {
    jobRequest: {
      findUnique: vi.fn(),
    },
    providerLeadResponse: {
      findMany: vi.fn(),
    },
    providerShortlist: {
      findFirst: vi.fn(),
    },
    providerShortlistItem: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    matchAttempt: {
      findFirst: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    $transaction: vi.fn(),
  }
  return { mockDb, state, mockOrchestrateMatch }
})
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/provider-wallet', () => ({
  getProviderWalletBalanceReadOnly: vi
    .fn()
    .mockResolvedValue({ totalCreditBalance: 3 }),
}))
vi.mock('../../lib/provider-lead-access', () => ({
  getProviderLeadAccessUrlByLeadId: vi
    .fn()
    .mockResolvedValue('https://app.plugapro.test/leads/access/token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi
    .fn()
    .mockImplementation((_id: string, view?: string) =>
      Promise.resolve(
        `https://app.plugapro.test/requests/access/customer-token${view ? `?view=${view}` : ''}`,
      ),
    ),
}))
vi.mock('../../lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue('wamid-1'),
}))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendButtons: vi.fn().mockResolvedValue('wamid-buttons'),
  sendCtaUrl: vi.fn().mockResolvedValue('wamid-cta'),
}))
vi.mock('../../lib/matching/orchestrator', () => ({
  orchestrateMatch: mockOrchestrateMatch,
}))

function makeInterestedResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response-1',
    leadInviteId: 'lead-1',
    providerId: 'provider-1',
    response: 'INTERESTED',
    callOutFee: 250,
    estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
    leadInvite: {
      id: 'lead-1',
      matchScore: 0.9,
      status: 'VIEWED',
    },
    provider: {
      id: 'provider-1',
      name: 'Alice Plumbing',
      phone: '+27111111111',
      verified: true,
    },
    ...overrides,
  }
}

function makeRequestForProviderSelection(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'request-1',
    customerId: 'customer-1',
    category: 'plumbing',
    status: 'SHORTLIST_READY',
    latestDispatchDecisionId: 'dispatch-1',
    selectedProviderId: null,
    selectedLeadInviteId: null,
    address: { suburb: 'Ruimsig' },
    leads: [
      {
        id: 'lead-1',
        status: 'VIEWED',
        dispatchDecisionId: 'dispatch-1',
        matchAttemptId: 'match-1',
        matchScore: 0.71,
        rankingPosition: 1,
        customerSelectedAt: null,
        provider: {
          id: 'provider-1',
          active: true,
          status: 'ACTIVE',
          verified: true,
          name: 'Alice Plumbing',
          phone: '+27111111111',
        },
      },
    ],
    ...overrides,
  }
}

function makeLeadForSelectedProviderNotification(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'lead-1',
    status: 'SENT',
    providerId: 'provider-1',
    jobRequestId: 'request-1',
    provider: {
      id: 'provider-1',
      phone: '+27111111111',
      active: true,
      status: 'ACTIVE',
      name: 'Alice Plumbing',
    },
    jobRequest: {
      id: 'request-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      category: 'plumbing',
      title: 'Leak test',
      description: 'Leaking pipe under kitchen sink',
      urgency: 'NORMAL',
      requestedWindowStart: new Date('2026-05-02T10:00:00.000Z'),
      requestedWindowEnd: null,
      _count: { attachments: 1 },
      address: {
        suburb: 'Ruimsig',
        city: 'Johannesburg',
      },
    },
    ...overrides,
  }
}

describe('customer shortlists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrchestrateMatch.mockResolvedValue({
      status: 'SKIP',
      reason: 'JOB_STATUS_OPEN',
    })
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'SHORTLIST_READY',
      category: 'plumbing',
      customer: { phone: '+27222222222' },
      address: { suburb: 'Ruimsig', city: 'Johannesburg' },
    })
    mockDb.matchAttempt.findFirst.mockResolvedValue(null)
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' })
    mockDb.lead.upsert.mockResolvedValue({
      id: 'lead-upserted',
      status: 'VIEWED',
      providerId: 'provider-1',
      matchScore: 0.71,
      rankingPosition: 1,
      dispatchDecisionId: 'dispatch-1',
      matchAttemptId: 'match-1',
      customerSelectedAt: null,
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        verified: true,
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
    })
    mockDb.lead.findUnique.mockResolvedValue(makeLeadForSelectedProviderNotification())
    mockDb.lead.update.mockResolvedValue({
      id: 'lead-1',
      status: 'CUSTOMER_SELECTED',
    })
    mockDb.providerLeadResponse.findMany.mockResolvedValue([
      makeInterestedResponse(),
    ])
    state.tx = {
      providerShortlist: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi
          .fn()
          .mockResolvedValue({ id: 'shortlist-1', items: [{ id: 'item-1' }] }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
        findUnique: vi
          .fn()
          .mockResolvedValue(makeRequestForProviderSelection()),
      },
      lead: {
        update: vi.fn().mockResolvedValue({ id: 'lead-1' }),
        upsert: vi.fn().mockResolvedValue({
          id: 'lead-1',
          status: 'VIEWED',
          providerId: 'provider-1',
        }),
      },
      providerShortlistItem: {
        update: vi.fn().mockResolvedValue({ id: 'item-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: any) => Promise<unknown>) => fn(state.tx),
    )
    state.shortlistItem = {
      id: 'item-1',
      shortlistId: 'shortlist-1',
      leadInviteId: 'lead-1',
      providerId: 'provider-1',
      shortlist: {
        id: 'shortlist-1',
        requestId: 'request-1',
        status: 'PUBLISHED',
      },
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
      leadInvite: {
        id: 'lead-1',
        status: 'VIEWED',
        jobRequest: {
          id: 'request-1',
          category: 'plumbing',
          address: { suburb: 'Ruimsig' },
        },
        provider: { id: 'provider-1' },
      },
    }
    mockDb.providerShortlistItem.findUnique.mockResolvedValue(
      state.shortlistItem,
    )
  })

  it('generates a shortlist from interested provider responses only', async () => {
    const shortlist = await generateCustomerShortlistForRequest('request-1')

    expect(shortlist).toMatchObject({ id: 'shortlist-1' })
    expect(mockDb.providerLeadResponse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          response: 'INTERESTED',
          callOutFee: { not: null },
          estimatedArrivalAt: { not: null },
          leadInvite: expect.objectContaining({
            jobRequestId: 'request-1',
            status: { in: ['SENT', 'VIEWED'] },
          }),
          provider: expect.objectContaining({
            active: true,
            status: 'ACTIVE',
            verified: true,
          }),
        }),
      }),
    )
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'SHORTLIST_READY' },
    })
  })

  it('maps provider card fields from the latest interested response', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue({
      id: 'shortlist-1',
      requestId: 'request-1',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T11:00:00.000Z'),
      items: [
        {
          id: 'item-1',
          rank: 1,
          leadInviteId: 'lead-1',
          providerId: 'provider-1',
          customerSelectedAt: null,
          displayCallOutFee: 250,
          displayArrivalTime: new Date('2026-05-02T12:00:00.000Z'),
          leadInvite: {
            providerResponses: [
              {
                callOutFee: 250,
                estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
                rateType: 'hourly',
                rateAmount: 400,
                negotiable: false,
                providerNote: 'Can arrive after lunch',
              },
            ],
          },
          provider: {
            id: 'provider-1',
            name: 'Alice Plumbing',
            skills: ['plumbing'],
            bio: 'Leaks and geysers',
            experience: '5+ years',
            evidenceNote: null,
            portfolioUrls: ['https://example.com/work'],
            avatarUrl: null,
            verified: true,
            averageRating: 4.8,
            completedJobsCount: 12,
          },
        },
      ],
    })

    const shortlist = await getCustomerShortlistForRequest('request-1')

    expect(shortlist?.items[0]).toMatchObject({
      callOutFee: 250,
      rateAmount: 400,
      negotiable: false,
      provider: {
        name: 'Alice Plumbing',
        completedJobsCount: 12,
      },
    })
  })

  it('selects a provider without deducting credits and notifies the provider with confirm buttons', async () => {
    const { sendButtons, sendCtaUrl } =
      await import('../../lib/whatsapp-interactive')
    const result = await selectShortlistedProviderForRequest({
      requestId: 'request-1',
      shortlistItemId: 'item-1',
    })

    expect(result.selectedItem).toMatchObject({ id: 'item-1' })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { customerSelectedAt: expect.any(Date) },
    })
    expect(sendButtons).toHaveBeenCalledWith(
      '+27111111111',
      expect.stringContaining('Accepting this job uses 1 credit'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'confirm_accept:lead-1' }),
        expect.objectContaining({ id: 'confirm_decline:lead-1' }),
      ]),
      undefined,
      expect.objectContaining({
        templateName: 'interactive:provider_selected_for_confirmation',
      }),
    )
    expect(sendButtons).toHaveBeenCalledTimes(1)
    expect(result.notification).toMatchObject({ sent: true })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { customerSelectedAt: expect.any(Date) },
    })
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27111111111',
      expect.stringContaining('Open this offer'),
      'View details',
      'https://app.plugapro.test/leads/access/token',
      undefined,
      expect.objectContaining({
        templateName: 'interactive:provider_selected_for_confirmation_cta',
      }),
    )
    expect(state.tx).not.toHaveProperty('walletLedgerEntry')
  })

  it('does not send duplicate provider notification after the lead is already marked', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    mockDb.lead.findUnique
      .mockResolvedValueOnce(makeLeadForSelectedProviderNotification())
      .mockResolvedValueOnce(
        makeLeadForSelectedProviderNotification({ status: 'CUSTOMER_SELECTED' }),
      )

    await selectShortlistedProviderForRequest({
      requestId: 'request-1',
      shortlistItemId: 'item-1',
    })
    await selectShortlistedProviderForRequest({
      requestId: 'request-1',
      shortlistItemId: 'item-1',
    })

    expect(sendButtons).toHaveBeenCalledTimes(1)
  })

  it('blocks WhatsApp notification when provider phone is missing', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLeadForSelectedProviderNotification({
        provider: {
          id: 'provider-1',
          phone: null,
          active: true,
          status: 'ACTIVE',
          name: 'Alice Plumbing',
        },
      }),
    )

    const result = await selectShortlistedProviderForRequest({
      requestId: 'request-1',
      shortlistItemId: 'item-1',
    })

    expect(result.notification).toMatchObject({ sent: false, reason: 'missing_provider_phone' })
    expect(sendButtons).not.toHaveBeenCalled()
    expect(mockDb.lead.update).not.toHaveBeenCalled()
  })

  it('does not leak private request fields in the provider notification body', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLeadForSelectedProviderNotification({
        jobRequest: {
          id: 'request-1',
          status: 'PROVIDER_CONFIRMATION_PENDING',
          selectedProviderId: 'provider-1',
          selectedLeadInviteId: 'lead-1',
          category: 'plumbing',
          title: 'Leaking sink in kitchen',
          description: 'Customer phone 082555444, street 14 Main street',
          urgency: 'NORMAL',
          requestedWindowStart: new Date('2026-05-02T10:00:00.000Z'),
          requestedWindowEnd: null,
          _count: { attachments: 1 },
          address: {
            suburb: 'Ruimsig',
            city: 'Johannesburg',
          },
          privateAddress: 'Private address, not to be exposed',
          accessNotes: 'Gate code is 1234',
          customerPhone: '+27821112222',
        } as any,
      }),
    )

    await selectShortlistedProviderForRequest({
      requestId: 'request-1',
      shortlistItemId: 'item-1',
    })

    const body =
      vi.mocked(sendButtons).mock.calls[0]?.[1] as string | undefined
    expect(body).toBeDefined()
    if (!body) return
    expect(body).toContain('Leaking sink in kitchen')
    expect(body).toContain('Ruimsig')
    expect(body).not.toContain('Private address, not to be exposed')
    expect(body).not.toContain('Gate code is 1234')
    expect(body).not.toContain('Customer phone 082555444')
  })

  it('skips notification for inactive provider in the selected-notification replay path', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    state.shortlistItem.provider.active = false
    state.shortlistItem.provider.status = 'ACTIVE'
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(makeRequestForProviderSelection())

    await expect(
      selectShortlistedProviderForRequest({
        requestId: 'request-1',
        shortlistItemId: 'item-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_SELECTION' })
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('prevents notification when selected provider request is cancelled', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection(),
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
    })
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLeadForSelectedProviderNotification({
        jobRequest: {
          id: 'request-1',
          status: 'CANCELLED',
          selectedProviderId: 'provider-1',
          selectedLeadInviteId: 'lead-1',
          category: 'plumbing',
          title: 'Leak test',
          description: 'Leaking pipe under kitchen sink',
          urgency: 'NORMAL',
          requestedWindowStart: new Date('2026-05-02T10:00:00.000Z'),
          requestedWindowEnd: null,
          _count: { attachments: 1 },
          address: {
            suburb: 'Ruimsig',
            city: 'Johannesburg',
          },
        },
      }),
    )

    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect(result.alreadySelected).toBe(true)
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('does not mark lead notified when WhatsApp send fails', async () => {
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
    vi.mocked(sendButtons).mockRejectedValueOnce(new Error('whatsapp down'))
    mockDb.lead.findUnique.mockReset()
    mockDb.jobRequest.findUnique.mockResolvedValue(makeRequestForProviderSelection())
    mockDb.lead.findUnique.mockResolvedValue(
      makeLeadForSelectedProviderNotification({
        status: 'SENT',
        jobRequest: {
          id: 'request-1',
          status: 'PROVIDER_CONFIRMATION_PENDING',
          selectedProviderId: 'provider-1',
          selectedLeadInviteId: 'lead-1',
          category: 'plumbing',
          title: 'Leak test',
          description: 'Leaking pipe under kitchen sink',
          urgency: 'NORMAL',
          requestedWindowStart: new Date('2026-05-02T10:00:00.000Z'),
          requestedWindowEnd: null,
          _count: { attachments: 1 },
          address: {
            suburb: 'Ruimsig',
            city: 'Johannesburg',
          },
        },
      }),
    )

    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect('notification' in result).toBe(true)
    if (!('notification' in result)) return
    expect(result.notification).toMatchObject({
      sent: false,
      reason: 'send_failed',
    })
    expect(mockDb.lead.update).not.toHaveBeenCalled()
  })

  it('notifies the customer when a shortlist becomes ready', async () => {
    const { sendText } = await import('../../lib/whatsapp')
    const { sendCtaUrl } = await import('../../lib/whatsapp-interactive')
    state.tx.providerShortlist.create = vi.fn().mockResolvedValue({
      id: 'shortlist-1',
      items: [{ id: 'item-1' }, { id: 'item-2' }],
    })
    await generateCustomerShortlistForRequest('request-1')
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+27222222222',
        text: expect.stringContaining('shortlist is ready'),
        templateName: 'interactive:client_shortlist_ready',
      }),
    )
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27222222222',
      expect.stringContaining('Provider selection is available below.'),
      'View details',
      'https://app.plugapro.test/requests/access/customer-token?view=shortlist',
      undefined,
      expect.objectContaining({
        templateName: 'interactive:client_shortlist_ready_cta',
      }),
    )
  })

  it('rejects re-selection once the request has advanced past SHORTLIST_READY', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'request-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      category: 'plumbing',
      customer: { phone: '+27222222222' },
      address: { suburb: 'Ruimsig', city: 'Johannesburg' },
    })

    await expect(
      selectShortlistedProviderForRequest({
        requestId: 'request-1',
        shortlistItemId: 'item-1',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })

    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('cancels a request before any provider has been confirmed', async () => {
    state.tx = {
      providerShortlist: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: any) => Promise<unknown>) => fn(state.tx),
    )

    const result = await cancelRequestFromShortlist({ requestId: 'request-1' })
    expect(result).toEqual({ ok: true })
    expect(state.tx.providerShortlist.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request-1', status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: {
        jobRequestId: 'request-1',
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: {
        status: 'EXPIRED',
        cancelledAt: expect.any(Date),
        respondedAt: expect.any(Date),
      },
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      }),
    })
  })

  it('refuses cancellation once a provider is being confirmed', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'request-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      category: 'plumbing',
      customer: { phone: '+27222222222' },
      address: { suburb: 'Ruimsig', city: 'Johannesburg' },
    })
    await expect(
      cancelRequestFromShortlist({ requestId: 'request-1' }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })
  })

  it('returns the request to OPEN when more options are requested', async () => {
    state.tx = {
      providerShortlist: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: any) => Promise<unknown>) => fn(state.tx),
    )

    const result = await requestMoreShortlistOptions({
      requestId: 'request-1',
    })
    expect(result).toEqual({ ok: true })
    expect(state.tx.providerShortlist.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request-1', status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'OPEN' },
    })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('request-1', {
      triggeredBy: 'rematch',
    })
  })

  it('refuses ask-more when the request is not in SHORTLIST_READY', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'request-1',
      status: 'MATCHING',
      category: 'plumbing',
      customer: { phone: '+27222222222' },
      address: { suburb: 'Ruimsig', city: 'Johannesburg' },
    })
    await expect(
      requestMoreShortlistOptions({ requestId: 'request-1' }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })
  })

  it('reopens shortlist when the selected provider declines after selection', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce({
      id: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'request-1',
      jobRequest: {
        id: 'request-1',
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    state.tx = {
      lead: {
        update: vi.fn().mockResolvedValue({ id: 'lead-1' }),
      },
      providerShortlistItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: any) => Promise<unknown>) => fn(state.tx),
    )

    const result = await declineSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
    })
    expect(result).toEqual({
      ok: true,
      leadId: 'lead-1',
      jobRequestId: 'request-1',
    })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ status: 'DECLINED' }),
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: 'SHORTLIST_READY',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      }),
    })
  })

  it('shortlist generation excludes suspended providers via the provider filter', async () => {
    // Suspended providers are filtered at the DB query level; assert that the
    // findMany call requires status: ACTIVE and active: true.
    await generateCustomerShortlistForRequest('request-1').catch(
      () => undefined,
    )
    expect(mockDb.providerLeadResponse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: expect.objectContaining({
            active: true,
            status: 'ACTIVE',
            verified: true,
          }),
        }),
      }),
    )
  })

  it('selects a matched provider by provider id and advances request to provider confirmation', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(
      makeRequestForProviderSelection(),
    )
    mockDb.lead.upsert.mockResolvedValueOnce({
      id: 'lead-1',
      status: 'VIEWED',
      providerId: 'provider-1',
      matchScore: 0.71,
      rankingPosition: 1,
      dispatchDecisionId: 'dispatch-1',
      matchAttemptId: 'match-1',
      customerSelectedAt: null,
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        verified: true,
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
    })
    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect(result).toMatchObject({
      requestId: 'request-1',
      providerId: 'provider-1',
      leadId: expect.any(String),
      alreadySelected: false,
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        customerSelectedAt: expect.any(Date),
      },
    })
  })

  it('creates the lead inside the selection transaction when no lead row exists yet', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection({
        leads: [],
      }),
      status: 'PENDING_VALIDATION',
    })
    mockDb.matchAttempt.findFirst.mockResolvedValueOnce({
      id: 'match-1',
      score: 0.76,
      rankedPosition: 1,
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        verified: true,
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
    })
    state.tx.lead.upsert.mockResolvedValueOnce({
      id: 'lead-tx-1',
      status: 'VIEWED',
      matchScore: 0.76,
      rankingPosition: 1,
      dispatchDecisionId: 'dispatch-1',
      matchAttemptId: 'match-1',
      customerSelectedAt: null,
    })

    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect(mockDb.lead.upsert).not.toHaveBeenCalled()
    expect(state.tx.lead.upsert).toHaveBeenCalledWith({
      where: {
        jobRequestId_providerId: {
          jobRequestId: 'request-1',
          providerId: 'provider-1',
        },
      },
      create: expect.objectContaining({
        jobRequestId: 'request-1',
        providerId: 'provider-1',
        dispatchDecisionId: 'dispatch-1',
        matchAttemptId: 'match-1',
      }),
      update: expect.objectContaining({
        dispatchDecisionId: 'dispatch-1',
        matchAttemptId: 'match-1',
      }),
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-tx-1',
      },
    })
    expect(result).toMatchObject({
      requestId: 'request-1',
      providerId: 'provider-1',
      leadId: 'lead-tx-1',
      alreadySelected: false,
    })
  })

  it('does not mutate state when request update fails while creating selection lead', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection({
        leads: [],
      }),
      status: 'PENDING_VALIDATION',
    })
    mockDb.matchAttempt.findFirst.mockResolvedValueOnce({
      id: 'match-1',
      score: 0.76,
      rankedPosition: 1,
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        verified: true,
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
    })
    state.tx.lead.upsert.mockResolvedValueOnce({
      id: 'lead-tx-1',
      status: 'VIEWED',
      matchScore: 0.76,
      rankingPosition: 1,
      dispatchDecisionId: 'dispatch-1',
      matchAttemptId: 'match-1',
      customerSelectedAt: null,
    })
    state.tx.jobRequest.update.mockRejectedValueOnce(new Error('update failed'))

    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
      }),
    ).rejects.toThrow('update failed')

    expect(state.tx.lead.update).not.toHaveBeenCalled()
  })

  it('rejects provider selection when provider is not in current matches', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'request-1',
      customerId: 'customer-1',
      category: 'plumbing',
      status: 'SHORTLIST_READY',
      latestDispatchDecisionId: 'dispatch-1',
      selectedProviderId: null,
      selectedLeadInviteId: null,
      address: { suburb: 'Ruimsig' },
      leads: [],
    })
    mockDb.matchAttempt.findFirst.mockResolvedValueOnce(null)

    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-unknown',
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
  })

  it('rejects inactive provider selection', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection({
        leads: [
          {
            id: 'lead-1',
            status: 'VIEWED',
            dispatchDecisionId: 'dispatch-1',
            matchAttemptId: 'match-1',
            matchScore: 0.71,
            rankingPosition: 1,
            customerSelectedAt: null,
            provider: {
              id: 'provider-1',
              active: false,
              status: 'ACTIVE',
              verified: true,
              name: 'Alice Plumbing',
              phone: '+27111111111',
            },
          },
        ],
      }),
    })

    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_SELECTION' })
  })

  it('rejects unauthorized customer selection', async () => {
    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'other-customer',
        providerId: 'provider-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects selection for non-open/closed states', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection(),
      status: 'CANCELLED',
    })
    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })
  })

  it('rejects selection when request is already accepted/locked', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection(),
      status: 'MATCHED',
    })
    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })
  })

  it('treats duplicate selection for same provider as idempotent', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection(),
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
    })

    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect(result.alreadySelected).toBe(true)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('blocks switching provider after confirmation is pending', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection(),
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      leads: [
        {
          id: 'lead-1',
          status: 'SENT',
          dispatchDecisionId: 'dispatch-1',
          matchAttemptId: 'match-1',
          matchScore: 0.71,
          rankingPosition: 1,
          customerSelectedAt: new Date(),
          provider: {
            id: 'provider-1',
            active: true,
            status: 'ACTIVE',
            verified: true,
            name: 'Alice Plumbing',
            phone: '+27111111111',
          },
        },
      ],
    })

    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-2',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_AWAITING_SELECTION' })
  })

  it('rejects selection when request has no dispatch decision and no existing lead', async () => {
    // latestDispatchDecisionId = null + empty leads → cannot resolve a provider → ITEM_NOT_FOUND
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection({
        leads: [],
        latestDispatchDecisionId: null,
      }),
      status: 'SHORTLIST_READY',
    })

    await expect(
      selectProviderForCustomerRequest({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-unknown',
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })

    expect(mockDb.matchAttempt.findFirst).not.toHaveBeenCalled()
  })

  it('in-transaction concurrent same-provider selection returns idempotent result without null dereference', async () => {
    // Simulate: no existing lead pre-transaction (selectedLead is null), but a concurrent
    // call committed PROVIDER_CONFIRMATION_PENDING for the same provider before our
    // transaction runs. The in-transaction re-read sees the completed state.
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeRequestForProviderSelection({ leads: [] }),
      status: 'PENDING_VALIDATION',
    })
    mockDb.matchAttempt.findFirst.mockResolvedValueOnce({
      id: 'match-1',
      score: 0.76,
      rankedPosition: 1,
      provider: {
        id: 'provider-1',
        active: true,
        status: 'ACTIVE',
        verified: true,
        name: 'Alice Plumbing',
        phone: '+27111111111',
      },
    })
    // Concurrent call already committed — tx re-read shows PROVIDER_CONFIRMATION_PENDING
    state.tx.jobRequest.findUnique.mockResolvedValueOnce({
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-concurrent',
      latestDispatchDecisionId: 'dispatch-1',
    })

    const result = await selectProviderForCustomerRequest({
      requestId: 'request-1',
      customerId: 'customer-1',
      providerId: 'provider-1',
    })

    expect(result.alreadySelected).toBe(true)
    expect(result.leadId).toBe('lead-concurrent')
    // No jobRequest.update should happen — idempotent path
    expect(state.tx.jobRequest.update).not.toHaveBeenCalled()
  })
})
