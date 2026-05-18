import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderOpportunityResponseError,
  getSafeProviderOpportunityPreview,
  respondToProviderOpportunity,
} from '../../lib/provider-opportunity-responses'

const { mockDb, state } = vi.hoisted(() => {
  const state: { lead: any; previewLead: any; tx: any } = { lead: null, previewLead: null, tx: null }
  const mockDb = {
    lead: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    providerLeadResponse: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    providerShortlistItem: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    jobRequest: {
      findUnique: vi.fn().mockResolvedValue({ id: 'request-1', status: 'MATCHING' }),
    },
    $transaction: vi.fn(),
  }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(false) }))
vi.mock('../../lib/customer-shortlists', () => ({
  generateCustomerShortlistForRequest: vi.fn().mockResolvedValue({ id: 'shortlist-1' }),
}))

function makePreviewLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    status: 'SENT',
    expiresAt: new Date(Date.now() + 60_000),
    jobRequest: {
      id: 'request-1',
      category: 'plumbing',
      subcategory: 'leak',
      title: 'Leaking tap',
      description: `${'Kitchen tap is dripping. '.repeat(12)}Gate code 1234 after final acceptance.`,
      urgency: 'soon',
      budgetPreference: 'balanced_value',
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
      address: {
        suburb: 'Ruimsig',
        region: 'JHB West',
        city: 'Johannesburg',
        province: 'Gauteng',
      },
      attachments: [{ id: 'att-1', label: 'customer_photo', caption: null }],
    },
    ...overrides,
  }
}

describe('provider opportunity responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.previewLead = makePreviewLead()
    state.lead = {
      id: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'request-1',
      status: 'SENT',
      expiresAt: new Date(Date.now() + 60_000),
      unlock: null,
    }
    mockDb.lead.findUnique.mockImplementation(async () => state.previewLead)
    mockDb.providerLeadResponse.findUnique.mockResolvedValue(null)
    mockDb.providerLeadResponse.findFirst.mockResolvedValue(null)
    mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
    state.tx = {
      providerLeadResponse: {
        create: vi.fn().mockResolvedValue({ id: 'response-1', response: 'INTERESTED' }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: 'response-1', response: 'INTERESTED' }),
      },
      lead: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('returns only safe opportunity preview fields', async () => {
    const preview = await getSafeProviderOpportunityPreview('lead-1', 'provider-1')

    expect(preview).toMatchObject({
      request: {
        category: 'plumbing',
        area: {
          suburb: 'Ruimsig',
          city: 'Johannesburg',
        },
      },
    })
    expect(JSON.stringify(preview)).not.toContain('phone')
    expect(JSON.stringify(preview)).not.toContain('street')
    expect(JSON.stringify(preview)).not.toContain('lat')
    expect(JSON.stringify(preview)).not.toContain('lng')
    expect(JSON.stringify(preview)).not.toContain('accessNotes')
    expect(JSON.stringify(preview)).not.toContain('Gate code 1234')
    expect(mockDb.lead.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({
        customer: expect.anything(),
      }),
    }))
    expect(mockDb.lead.findUnique.mock.calls[0][0].select.jobRequest.select.address.select).not.toHaveProperty('street')
    expect(mockDb.lead.findUnique.mock.calls[0][0].select.jobRequest.select.address.select).not.toHaveProperty('latitude')
    expect(mockDb.lead.findUnique.mock.calls[0][0].select.jobRequest.select.address.select).not.toHaveProperty('accessNotes')
  })

  it('safe-preview excludes attachments flagged safeForPreview = false', async () => {
    await getSafeProviderOpportunityPreview('lead-1', 'provider-1')
    const attachmentsClause = mockDb.lead.findUnique.mock.calls[0][0].select.jobRequest.select.attachments
    expect(attachmentsClause.where).toEqual({ safeForPreview: true })
  })

  it('captures interested response without debiting credits or accepting lead', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)

    const result = await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: 'R250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      negotiable: false,
      idempotencyKey: 'lead-1:provider-1',
    })

    expect(result).toMatchObject({ response: { id: 'response-1' }, creditsDeducted: 0 })
    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(state.tx.providerLeadResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadInviteId: 'lead-1',
        providerId: 'provider-1',
        response: 'INTERESTED',
        callOutFee: 250,
        estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
        negotiable: false,
      }),
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'lead-1', status: { in: ['SENT', 'VIEWED'] } }),
      data: expect.objectContaining({
        status: 'INTERESTED',
        respondedAt: expect.any(Date),
      }),
    }))
  })

  it('requires estimated arrival for interested responses', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)

    await expect(
      respondToProviderOpportunity({
        leadId: 'lead-1',
        providerId: 'provider-1',
        response: 'INTERESTED',
        callOutFeeText: '250',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARRIVAL_TIME',
    } satisfies Partial<ProviderOpportunityResponseError>)
  })

  it('captures not interested response without charging credits', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)
    state.tx.providerLeadResponse.create.mockResolvedValueOnce({ id: 'response-2', response: 'NOT_INTERESTED' })

    const result = await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'NOT_INTERESTED',
      providerNote: 'Too far',
      idempotencyKey: 'decline-key',
    })

    expect(result).toMatchObject({ response: { id: 'response-2' }, creditsDeducted: 0 })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'lead-1', status: { in: ['SENT', 'VIEWED'] } }),
      data: expect.objectContaining({
        status: 'DECLINED',
        respondedAt: expect.any(Date),
      }),
    }))
  })

  it('updates an existing response instead of creating a duplicate row', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)
    state.tx.providerLeadResponse.findFirst.mockResolvedValueOnce({
      id: 'response-existing',
      idempotencyKey: 'old-key',
    })
    state.tx.providerLeadResponse.update.mockResolvedValueOnce({
      id: 'response-existing',
      response: 'INTERESTED',
    })

    const result = await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: '250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      idempotencyKey: 'repeat-key',
    })

    expect(result).toMatchObject({ response: { id: 'response-existing' } })
    expect(state.tx.providerLeadResponse.findFirst).toHaveBeenCalledWith({
      where: {
        leadInviteId: 'lead-1',
        providerId: 'provider-1',
      },
      select: { id: true, idempotencyKey: true },
    })
    expect(state.tx.providerLeadResponse.update).toHaveBeenCalledWith({
      where: { id: 'response-existing' },
      data: expect.objectContaining({
        response: 'INTERESTED',
        callOutFee: 250,
        estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
        idempotencyKey: 'repeat-key',
      }),
    })
    expect(state.tx.providerLeadResponse.create).not.toHaveBeenCalled()
  })

  it('switches from interested to not interested on overwrite without creating a new row', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)
    state.tx.providerLeadResponse.findFirst.mockResolvedValueOnce({
      id: 'response-existing',
      idempotencyKey: 'old-key',
    })
    state.tx.providerLeadResponse.update.mockResolvedValueOnce({
      id: 'response-existing',
      response: 'NOT_INTERESTED',
    })

    const result = await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'NOT_INTERESTED',
      providerNote: 'Too far',
      idempotencyKey: 'decline-key',
    })

    expect(result).toMatchObject({ response: { id: 'response-existing' } })
    expect(state.tx.providerLeadResponse.update).toHaveBeenCalledWith({
      where: { id: 'response-existing' },
      data: expect.objectContaining({
        response: 'NOT_INTERESTED',
        callOutFee: null,
        estimatedArrivalAt: null,
        providerNote: 'Too far',
      }),
    })
    expect(state.tx.providerLeadResponse.create).not.toHaveBeenCalled()
  })

  it('rejects expired opportunities', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce({
      ...state.lead,
      expiresAt: new Date(Date.now() - 60_000),
    })

    await expect(
      respondToProviderOpportunity({
        leadId: 'lead-1',
        providerId: 'provider-1',
        response: 'INTERESTED',
        callOutFeeText: '250',
      }),
    ).rejects.toMatchObject({
      code: 'EXPIRED',
    } satisfies Partial<ProviderOpportunityResponseError>)
    expect(mockDb.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: { in: ['SENT', 'VIEWED'] } },
      data: expect.objectContaining({ status: 'EXPIRED', expiredAt: expect.any(Date) }),
    })
  })

  it('auto-triggers shortlist generation when threshold is met and flag is on', async () => {
    const flags = await import('../../lib/flags')
    const customerShortlists = await import('../../lib/customer-shortlists')
    ;(flags.isEnabled as any).mockResolvedValueOnce(true)
    mockDb.providerLeadResponse.count.mockResolvedValueOnce(2)
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)

    await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: '250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      idempotencyKey: 'auto-trigger-key',
    })

    expect(customerShortlists.generateCustomerShortlistForRequest).toHaveBeenCalledWith('request-1')
  })

  it('does not auto-trigger when feature flag is off', async () => {
    const customerShortlists = await import('../../lib/customer-shortlists')
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)

    await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: '250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      idempotencyKey: 'auto-trigger-flag-off',
    })

    expect(customerShortlists.generateCustomerShortlistForRequest).not.toHaveBeenCalled()
  })

  it('does not auto-trigger when interested count is below threshold', async () => {
    const flags = await import('../../lib/flags')
    const customerShortlists = await import('../../lib/customer-shortlists')
    ;(flags.isEnabled as any).mockResolvedValueOnce(true)
    mockDb.providerLeadResponse.count.mockResolvedValueOnce(1)
    mockDb.lead.findUnique.mockResolvedValueOnce(state.lead)

    await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: '250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      idempotencyKey: 'auto-trigger-below-threshold',
    })

    expect(customerShortlists.generateCustomerShortlistForRequest).not.toHaveBeenCalled()
  })

  it('returns existing response for duplicate idempotency keys', async () => {
    mockDb.providerLeadResponse.findFirst.mockResolvedValueOnce({
      id: 'response-existing',
      idempotencyKey: 'same-event',
    })

    const result = await respondToProviderOpportunity({
      leadId: 'lead-1',
      providerId: 'provider-1',
      response: 'INTERESTED',
      callOutFeeText: '250',
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      idempotencyKey: 'same-event',
    })

    expect(result).toMatchObject({
      response: { id: 'response-existing' },
      creditsDeducted: 0,
    })
    expect(mockDb.lead.findUnique).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})
