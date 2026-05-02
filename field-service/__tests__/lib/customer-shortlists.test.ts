import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelRequestFromShortlist,
  declineSelectedProviderJob,
  generateCustomerShortlistForRequest,
  getCustomerShortlistForRequest,
  requestMoreShortlistOptions,
  selectShortlistedProviderForRequest,
} from '../../lib/customer-shortlists'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; shortlistItem: any; declineLead: any } = {
    tx: null,
    shortlistItem: null,
    declineLead: null,
  }
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
    },
    lead: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/provider-wallet', () => ({
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue({ totalCreditBalance: 3 }),
}))
vi.mock('../../lib/provider-lead-access', () => ({
  getProviderLeadAccessUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.test/leads/access/token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.test/requests/access/customer-token'),
}))
vi.mock('../../lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue('wamid-1'),
}))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendButtons: vi.fn().mockResolvedValue('wamid-buttons'),
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

describe('customer shortlists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'SHORTLIST_READY',
      category: 'plumbing',
      customer: { phone: '+27222222222' },
      address: { suburb: 'Ruimsig', city: 'Johannesburg' },
    })
    mockDb.providerLeadResponse.findMany.mockResolvedValue([makeInterestedResponse()])
    state.tx = {
      providerShortlist: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'shortlist-1', items: [{ id: 'item-1' }] }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      lead: {
        update: vi.fn().mockResolvedValue({ id: 'lead-1' }),
      },
      providerShortlistItem: {
        update: vi.fn().mockResolvedValue({ id: 'item-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
    state.shortlistItem = {
      id: 'item-1',
      shortlistId: 'shortlist-1',
      leadInviteId: 'lead-1',
      providerId: 'provider-1',
      shortlist: { id: 'shortlist-1', requestId: 'request-1', status: 'PUBLISHED' },
      provider: { id: 'provider-1', name: 'Alice Plumbing', phone: '+27111111111' },
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
    mockDb.providerShortlistItem.findUnique.mockResolvedValue(state.shortlistItem)
  })

  it('generates a shortlist from interested provider responses only', async () => {
    const shortlist = await generateCustomerShortlistForRequest('request-1')

    expect(shortlist).toMatchObject({ id: 'shortlist-1' })
    expect(mockDb.providerLeadResponse.findMany).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
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
      items: [{
        id: 'item-1',
        rank: 1,
        leadInviteId: 'lead-1',
        providerId: 'provider-1',
        customerSelectedAt: null,
        displayCallOutFee: 250,
        displayArrivalTime: new Date('2026-05-02T12:00:00.000Z'),
        leadInvite: {
          providerResponses: [{
            callOutFee: 250,
            estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
            rateType: 'hourly',
            rateAmount: 400,
            negotiable: false,
            providerNote: 'Can arrive after lunch',
          }],
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
      }],
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
    const { sendButtons } = await import('../../lib/whatsapp-interactive')
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
    expect(state.tx).not.toHaveProperty('walletLedgerEntry')
  })

  it('notifies the customer when a shortlist becomes ready', async () => {
    const { sendText } = await import('../../lib/whatsapp')
    state.tx.providerShortlist.create = vi.fn().mockResolvedValue({
      id: 'shortlist-1',
      items: [{ id: 'item-1' }, { id: 'item-2' }],
    })
    await generateCustomerShortlistForRequest('request-1')
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27222222222',
      text: expect.stringContaining('shortlist is ready'),
      templateName: 'interactive:client_shortlist_ready',
    }))
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
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))

    const result = await cancelRequestFromShortlist({ requestId: 'request-1' })
    expect(result).toEqual({ ok: true })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      }),
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalled()
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

  it('returns the request to MATCHING when more options are requested', async () => {
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
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))

    const result = await requestMoreShortlistOptions({ requestId: 'request-1' })
    expect(result).toEqual({ ok: true })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'MATCHING' },
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
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))

    const result = await declineSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
    })
    expect(result).toEqual({ ok: true, leadId: 'lead-1', jobRequestId: 'request-1' })
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
    await generateCustomerShortlistForRequest('request-1').catch(() => undefined)
    expect(mockDb.providerLeadResponse.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: expect.objectContaining({
          active: true,
          status: 'ACTIVE',
          verified: true,
        }),
      }),
    }))
  })
})
