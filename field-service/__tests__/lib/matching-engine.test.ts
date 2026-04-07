import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findCandidateProviders, dispatchLeads, expireStaleLeads } from '../../lib/matching-engine'

vi.mock('../../lib/db', () => ({
  db: {
    jobRequest: { findUnique: vi.fn() },
    provider: { findMany: vi.fn() },
    lead: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    match: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}))

// Mock notifyProviderNewJob — it's in whatsapp-bot which has many imports we don't want
vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: vi.fn().mockResolvedValue(undefined),
}))

describe('findCandidateProviders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns providers matching skill and serviceArea', async () => {
    const { db } = await import('../../lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'Sipho', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
      { id: 'p2', phone: '+27711000002', name: 'Thabo', skills: ['Electrical'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('returns empty when no providers match skill', async () => {
    const { db } = await import('../../lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', skills: ['Electrical'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(0)
  })

  it('returns empty when no providers match area', async () => {
    const { db } = await import('../../lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', skills: ['Plumbing'], serviceAreas: ['Centurion'], availableNow: true },
    ])
    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(0)
  })

  it('matches provider when city matches serviceArea (partial match)', async () => {
    const { db } = await import('../../lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', skills: ['Plumbing'], serviceAreas: ['Johannesburg'], availableNow: true },
    ])
    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(1)
  })
})

describe('dispatchLeads', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates Lead + Match and sends WA notification', async () => {
    const { db } = await import('../../lib/db')
    const { notifyProviderNewJob } = await import('../../lib/whatsapp-bot')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_1',
      category: 'Plumbing',
      title: 'Leaking tap',
      description: 'Kitchen tap',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Zanele' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    ;(db.lead.findFirst as any).mockResolvedValue(null)
    ;(db.match.findFirst as any).mockResolvedValue(null)
    ;(db.lead.create as any).mockResolvedValue({ id: 'lead_1' })
    ;(db.match.create as any).mockResolvedValue({ id: 'match_1' })

    const result = await dispatchLeads('jr_1')

    expect(result.leadsDispatched).toBe(1)
    expect(result.noMatch).toBe(false)
    expect(db.lead.create).toHaveBeenCalledTimes(1)
    expect(notifyProviderNewJob).toHaveBeenCalledTimes(1)
  })

  it('skips dispatch if lead already exists (idempotency)', async () => {
    const { db } = await import('../../lib/db')
    const { notifyProviderNewJob } = await import('../../lib/whatsapp-bot')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_1', category: 'Plumbing', title: 'Test', description: '',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Test' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    ;(db.lead.findFirst as any).mockResolvedValue({ id: 'existing_lead' })

    const result = await dispatchLeads('jr_1')
    expect(result.leadsDispatched).toBe(0)
    expect(notifyProviderNewJob).not.toHaveBeenCalled()
  })

  it('returns noMatch=true when no candidates found', async () => {
    const { db } = await import('../../lib/db')
    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_1', category: 'Plumbing', title: 'Test', description: '',
      address: { suburb: 'Unknown', city: 'Unknown' },
      customer: { name: 'Test' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([])

    const result = await dispatchLeads('jr_1')
    expect(result.noMatch).toBe(true)
    expect(result.leadsDispatched).toBe(0)
  })

  it('returns noMatch=true when jobRequest not found', async () => {
    const { db } = await import('../../lib/db')
    ;(db.jobRequest.findUnique as any).mockResolvedValue(null)
    ;(db.provider.findMany as any).mockResolvedValue([])

    const result = await dispatchLeads('nonexistent')
    expect(result.noMatch).toBe(true)
  })
})

describe('provider eligibility filter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT return an inactive provider (active: false)', async () => {
    const { db } = await import('../../lib/db')
    // db.provider.findMany already filters active:true/availableNow:true/verified:true at the DB level.
    // Simulate that: the mock returns nothing because the DB WHERE clause excluded it.
    ;(db.provider.findMany as any).mockResolvedValue([])

    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(0)
  })

  it('returns an active, available, verified provider that matches skill and area', async () => {
    const { db } = await import('../../lib/db')
    // Simulate a provider that passed the DB WHERE filter (active:true, availableNow:true, verified:true)
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p_approved', phone: '+27711000099', name: 'Verified Pro', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])

    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p_approved')
  })

  it('calls db.provider.findMany with active:true, availableNow:true, verified:true', async () => {
    const { db } = await import('../../lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([])

    await findCandidateProviders({ category: 'Plumbing', suburb: 'Sandton', city: 'Johannesburg' })

    expect(db.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, availableNow: true, verified: true },
      })
    )
  })
})

describe('duplicate dispatch guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-dispatches a provider whose previous lead has EXPIRED (bug fix)', async () => {
    // Before the fix, any existing lead (incl. EXPIRED) blocked re-dispatch.
    // After the fix, only SENT or ACCEPTED leads block it.
    const { db } = await import('../../lib/db')
    const { notifyProviderNewJob } = await import('../../lib/whatsapp-bot')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_retry',
      category: 'Plumbing',
      title: 'Leaking pipe',
      description: '',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Zola' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p_expired', phone: '+27711000099', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    // The DB returns null because the status filter { in: ['SENT','ACCEPTED'] } excludes the EXPIRED lead
    ;(db.lead.findFirst as any).mockResolvedValue(null)
    ;(db.match.findFirst as any).mockResolvedValue(null)
    ;(db.lead.create as any).mockResolvedValue({ id: 'lead_new' })
    ;(db.match.create as any).mockResolvedValue({ id: 'match_new' })

    const result = await dispatchLeads('jr_retry')

    expect(result.leadsDispatched).toBe(1)
    expect(db.lead.create).toHaveBeenCalledOnce()
    expect(notifyProviderNewJob).toHaveBeenCalledOnce()
  })

  it('does NOT create a new lead when a SENT lead already exists for the same job+provider', async () => {
    const { db } = await import('../../lib/db')
    const { notifyProviderNewJob } = await import('../../lib/whatsapp-bot')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_dup',
      category: 'Electrical',
      title: 'Fix sockets',
      description: '',
      address: { suburb: 'Rosebank', city: 'Johannesburg' },
      customer: { name: 'Thandi' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([
      { id: 'p_elec', phone: '+27711000010', skills: ['Electrical'], serviceAreas: ['Rosebank'], availableNow: true },
    ])
    // Existing SENT lead already exists — guard should skip
    ;(db.lead.findFirst as any).mockResolvedValue({ id: 'lead_existing', status: 'SENT' })

    const result = await dispatchLeads('jr_dup')

    expect(result.leadsDispatched).toBe(0)
    expect(db.lead.create).not.toHaveBeenCalled()
    expect(notifyProviderNewJob).not.toHaveBeenCalled()
  })
})

describe('dispatchLeads — empty provider pool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 leadsDispatched and noMatch:true when no eligible providers exist', async () => {
    const { db } = await import('../../lib/db')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr_empty',
      category: 'Roofing',
      title: 'Roof leak',
      description: '',
      address: { suburb: 'Soweto', city: 'Johannesburg' },
      customer: { name: 'Moses' },
    })
    ;(db.provider.findMany as any).mockResolvedValue([])

    const result = await dispatchLeads('jr_empty')

    expect(result.leadsDispatched).toBe(0)
    expect(result.candidatesFound).toBe(0)
    expect(result.noMatch).toBe(true)
  })
})

describe('expireStaleLeads', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks expired SENT leads as EXPIRED and deletes provisional match', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findMany as any).mockResolvedValue([
      { id: 'lead_1', jobRequestId: 'jr_1', providerId: 'p1', provider: { name: 'Sipho' }, jobRequest: { category: 'Plumbing', address: {}, customer: {} } },
    ])
    ;(db.lead.update as any).mockResolvedValue({})
    ;(db.match.deleteMany as any).mockResolvedValue({})

    const count = await expireStaleLeads()
    expect(count).toBe(1)
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: 'lead_1' }, data: { status: 'EXPIRED' } })
  })

  it('returns 0 when no stale leads', async () => {
    const { db } = await import('../../lib/db')
    ;(db.lead.findMany as any).mockResolvedValue([])
    const count = await expireStaleLeads()
    expect(count).toBe(0)
  })
})
