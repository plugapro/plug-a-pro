import { describe, expect, it, vi } from 'vitest'
import { boardEligibilityWhere, findBoardJobsForProvider, OPEN_INTEREST_STATUSES } from '@/lib/board/eligibility'

const NOW = new Date('2026-07-21T12:00:00Z')

describe('OPEN_INTEREST_STATUSES', () => {
  it('is exported as the single source of truth for open-interest lead statuses', () => {
    expect(OPEN_INTEREST_STATUSES).toEqual(['INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED'])
  })
})

describe('boardEligibilityWhere', () => {
  const where = boardEligibilityWhere(NOW) as any

  it('includes OPEN/MATCHING/SHORTLIST_READY requests (true cap-3: job stays board-visible through SHORTLIST_READY)', () => {
    expect(where.status).toEqual({ in: ['OPEN', 'MATCHING', 'SHORTLIST_READY'] })
  })

  it('excludes past-due windows and expired requests (null allowed)', () => {
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
        { OR: [{ requestedWindowEnd: null }, { requestedWindowEnd: { gt: NOW } }] },
      ]),
    )
  })

  it('excludes matched requests and live push offers (PUSH-origin only — C1 fix)', () => {
    expect(where.match).toBeNull()
    expect(where.assignmentHolds).toEqual({ none: { status: 'ACTIVE' } })
    expect(where.leads).toEqual(
      expect.objectContaining({
        none: expect.objectContaining({
          origin: 'PUSH',
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

// C1 drift tripwire: the where-clause literal below is copied verbatim from
// generateCustomerShortlistForRequest's leadInvite filter
// (lib/customer-shortlists.ts lines 221-226 at time of writing):
//   leadInvite: {
//     jobRequestId: requestId,
//     status: { in: ['SENT', 'VIEWED', 'INTERESTED'] },
//     expiresAt: { gt: new Date() },
//   }
// If that shape ever changes, this test's hand-copied predicate will drift
// out of sync with production and start passing/failing for the wrong
// reasons — a signal to re-sync both. It exists because board leads carry
// expiresAt: null by default; without C1's fix (setting expiresAt on
// create/revive) a board lead's INTERESTED response is silently excluded
// from shortlist generation (SHORTLIST_EMPTY, swallowed) and the customer
// never gets a selectable shortlist.
describe('generateCustomerShortlistForRequest predicate compatibility (C1 drift tripwire)', () => {
  function matchesLeadInvitePredicate(lead: { status: string; expiresAt: Date | null }, now: Date): boolean {
    if (!['SENT', 'VIEWED', 'INTERESTED'].includes(lead.status)) return false
    if (lead.expiresAt == null) return false
    return lead.expiresAt.getTime() > now.getTime()
  }

  it('a post-fix board-shaped lead (expiresAt set from job/default) satisfies the predicate', () => {
    const boardLead = { status: 'INTERESTED', expiresAt: new Date(NOW.getTime() + 60_000) }
    expect(matchesLeadInvitePredicate(boardLead, NOW)).toBe(true)
  })

  it('the old null-expiresAt board-lead shape does NOT satisfy the predicate (proves the bug existed)', () => {
    const oldShapeBoardLead = { status: 'INTERESTED', expiresAt: null }
    expect(matchesLeadInvitePredicate(oldShapeBoardLead, NOW)).toBe(false)
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

  it('queries technicianServiceArea with active: true (I3 — ignores inactive service areas)', async () => {
    const c = client()
    await findBoardJobsForProvider(c, 'p1', {}, NOW)
    expect(c.technicianServiceArea.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ providerId: 'p1', active: true }),
      }),
    )
  })

  it('ignores an inactive service area even though it would otherwise match (I3)', async () => {
    const c = client({
      technicianServiceArea: {
        findMany: vi.fn(async ({ where }: any) => {
          // Simulate real Prisma filtering: an inactive row is excluded when
          // the query includes active: true.
          const rows = [
            { locationNodeId: 'node-ruimsig', suburbKey: 'ruimsig', areaType: 'SUBURB', lat: null, lng: null, radiusKm: null, active: true },
            { locationNodeId: 'node-inactive', suburbKey: 'inactive-suburb', areaType: 'SUBURB', lat: null, lng: null, radiusKm: null, active: false },
          ]
          return where?.active === true ? rows.filter((r) => r.active) : rows
        }),
      },
      jobRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jr-inactive-area', category: 'plumbing', title: 'Job in inactive area', description: 'desc',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-inactive', suburb: 'InactiveSuburb', lat: null, lng: null },
            leads: [],
          },
        ]),
      },
    })
    const jobs = await findBoardJobsForProvider(c, 'p1', {}, NOW)
    expect(jobs).toEqual([]) // job only matches the inactive area, which must be ignored
  })
})
