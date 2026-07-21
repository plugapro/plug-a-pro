import { describe, expect, it, vi } from 'vitest'
import { boardEligibilityWhere, findBoardJobsForProvider } from '@/lib/board/eligibility'

const NOW = new Date('2026-07-21T12:00:00Z')

describe('boardEligibilityWhere', () => {
  const where = boardEligibilityWhere(NOW) as any

  it('only OPEN/MATCHING requests', () => {
    expect(where.status).toEqual({ in: ['OPEN', 'MATCHING'] })
  })

  it('excludes past-due windows and expired requests (null allowed)', () => {
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
        { OR: [{ requestedWindowEnd: null }, { requestedWindowEnd: { gt: NOW } }] },
      ]),
    )
  })

  it('excludes matched requests and live push offers', () => {
    expect(where.match).toBeNull()
    expect(where.assignmentHolds).toEqual({ none: { status: 'ACTIVE' } })
    expect(where.leads).toEqual(
      expect.objectContaining({
        none: expect.objectContaining({
          status: { in: ['SENT', 'VIEWED'] },
          expiresAt: { gt: NOW },
        }),
      }),
    )
  })

  it('requires at least one push attempt via the some-leads clause', () => {
    expect(where.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ leads: { some: {} } })]),
    )
  })
})

describe('findBoardJobsForProvider', () => {
  function client(overrides: Record<string, any> = {}) {
    return {
      provider: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'p1', active: true, verified: true,
          skills: ['plumbing', 'painting'],
        }),
      },
      technicianServiceArea: {
        findMany: vi.fn().mockResolvedValue([
          { locationNodeId: 'node-ruimsig', suburbKey: 'ruimsig', areaType: 'SUBURB', lat: null, lng: null, radiusKm: null },
        ]),
      },
      jobRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jr1', category: 'plumbing', title: 'Burst geyser', description: 'Geyser burst in roof',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-ruimsig', suburb: 'Ruimsig', lat: null, lng: null },
            leads: [{ status: 'INTERESTED' }],
          },
          {
            id: 'jr2', category: 'plumbing', title: 'Tap', description: 'Leaky tap',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-elsewhere', suburb: 'Sandton', lat: null, lng: null },
            leads: [],
          },
          {
            id: 'jr3', category: 'garden', title: 'Lawn', description: 'Mow lawn',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-ruimsig', suburb: 'Ruimsig', lat: null, lng: null },
            leads: [],
          },
        ]),
      },
      ...overrides,
    } as any // TODO: fake client for unit test
  }

  it('returns only in-area, skill-matched jobs with interest counts', async () => {
    const jobs = await findBoardJobsForProvider(client(), 'p1', {}, NOW)
    expect(jobs.map((j) => j.id)).toEqual(['jr1']) // jr2 out of area, jr3 not a skill
    expect(jobs[0]).toMatchObject({ suburbLabel: 'Ruimsig', interestCount: 1 })
    expect(jobs[0]).not.toHaveProperty('address') // privacy: no raw address object leaves the lib
  })

  it('applies the category filter on top of skills', async () => {
    const jobs = await findBoardJobsForProvider(client(), 'p1', { category: 'painting' }, NOW)
    expect(jobs).toEqual([]) // jr1 is plumbing
  })

  it('returns [] for inactive or unverified providers', async () => {
    const c = client()
    c.provider.findUnique.mockResolvedValue({ id: 'p1', active: false, verified: true, skills: ['plumbing'] })
    expect(await findBoardJobsForProvider(c, 'p1', {}, NOW)).toEqual([])
  })
})
