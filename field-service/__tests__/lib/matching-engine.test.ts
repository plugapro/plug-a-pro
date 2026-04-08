import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptLead,
  declineLead,
  dispatchLeads,
  expireStaleLeads,
  findCandidateProviders,
} from '../../lib/matching-engine'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    jobRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    provider: { findMany: vi.fn() },
    lead: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    match: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: vi.fn().mockResolvedValue(undefined),
}))

describe('findCandidateProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns providers matching skill and serviceArea', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'Sipho', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
      { id: 'p2', phone: '+27711000002', name: 'Thabo', skills: ['Electrical'], serviceAreas: ['Sandton'], availableNow: true },
    ])

    const result = await findCandidateProviders({
      category: 'Plumbing',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('ranks exact suburb matches ahead of city-only matches', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      { id: 'p_city', phone: '+27711000003', name: 'City Pro', skills: ['Plumbing'], serviceAreas: ['Johannesburg'], availableNow: true },
      { id: 'p_suburb', phone: '+27711000004', name: 'Suburb Pro', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])

    const result = await findCandidateProviders({
      category: 'Plumbing',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })

    expect(result.map((provider) => provider.id)).toEqual(['p_suburb', 'p_city'])
  })

  it('calls db.provider.findMany with active:true, availableNow:true, verified:true', async () => {
    mockDb.provider.findMany.mockResolvedValue([])

    await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })

    expect(mockDb.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, availableNow: true, verified: true },
      })
    )
  })
})

describe('dispatchLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches up to three leads and sends three notifications', async () => {
    const { notifyProviderNewJob } = await import('../../lib/whatsapp-bot')

    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr_1',
      category: 'Plumbing',
      title: 'Leaking tap',
      description: 'Kitchen tap',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Zanele' },
    })
    mockDb.provider.findMany.mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'A', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
      { id: 'p2', phone: '+27711000002', name: 'B', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
      { id: 'p3', phone: '+27711000003', name: 'C', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
      { id: 'p4', phone: '+27711000004', name: 'D', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    mockDb.lead.findFirst.mockResolvedValue(null)
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.lead.create
      .mockResolvedValueOnce({ id: 'lead_1' })
      .mockResolvedValueOnce({ id: 'lead_2' })
      .mockResolvedValueOnce({ id: 'lead_3' })

    const result = await dispatchLeads('jr_1')

    expect(result.leadsDispatched).toBe(3)
    expect(result.candidatesFound).toBe(4)
    expect(result.noMatch).toBe(false)
    expect(mockDb.lead.create).toHaveBeenCalledTimes(3)
    expect(mockDb.match.create).not.toHaveBeenCalled()
    expect(notifyProviderNewJob).toHaveBeenCalledTimes(3)
  })

  it('returns noMatch=true when no candidates found', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr_1',
      category: 'Plumbing',
      title: 'Test',
      description: '',
      address: { suburb: 'Unknown', city: 'Unknown' },
      customer: { name: 'Test' },
    })
    mockDb.provider.findMany.mockResolvedValue([])

    const result = await dispatchLeads('jr_1')

    expect(result.noMatch).toBe(true)
    expect(result.leadsDispatched).toBe(0)
  })
})

describe('acceptLead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )
  })

  it('creates a match only when the provider accepts a live lead', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      providerId: 'p1',
      jobRequestId: 'jr_1',
      expiresAt: new Date(Date.now() + 60_000),
      jobRequest: { id: 'jr_1', status: 'MATCHING' },
    })
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.lead.update.mockResolvedValue({})
    mockDb.match.create.mockResolvedValue({ id: 'match_1' })
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDb.lead.updateMany.mockResolvedValue({})

    const result = await acceptLead({ leadId: 'lead_1', providerId: 'p1' })

    expect(result).toEqual({
      ok: true,
      leadId: 'lead_1',
      matchId: 'match_1',
      inspectionNeeded: false,
    })
    expect(mockDb.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'jr_1',
          providerId: 'p1',
          status: 'MATCHED',
        }),
      })
    )
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'jr_1' },
      data: { status: 'MATCHED' },
    })
  })
})

describe('declineLead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reopens the job request when the last active lead is declined', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      providerId: 'p1',
      jobRequestId: 'jr_1',
    })
    mockDb.lead.updateMany.mockResolvedValue({})
    mockDb.lead.count.mockResolvedValue(0)
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.jobRequest.update.mockResolvedValue({})

    const result = await declineLead({ leadId: 'lead_1', providerId: 'p1' })

    expect(result).toEqual({ ok: true })
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'jr_1' },
      data: { status: 'OPEN' },
    })
  })
})

describe('expireStaleLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks expired leads as EXPIRED and reopens the request when no active leads remain', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      { id: 'lead_1', jobRequestId: 'jr_1', providerId: 'p1' },
    ])
    mockDb.lead.update.mockResolvedValue({})
    mockDb.lead.count.mockResolvedValue(0)
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.jobRequest.update.mockResolvedValue({})

    const count = await expireStaleLeads()

    expect(count).toBe(1)
    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: { status: 'EXPIRED', respondedAt: expect.any(Date) },
    })
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'jr_1' },
      data: { status: 'OPEN' },
    })
  })
})
