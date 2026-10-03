// Tests for lib/customer-serviceability.ts — the single source of truth for
// "is this skill bookable in this area?" used by the home page autocomplete,
// the provider-count card, and the request-creation backend guard.
//
// We mock the Prisma db client so the tests exercise the predicate-building
// logic and the count-bounding behaviour without touching Postgres.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    locationNode: { findUnique: vi.fn() },
    category: { findMany: vi.fn() },
    provider: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import {
  buildAreaProviderWhere,
  buildCategoryProviderWhere,
  countActiveProvidersFor,
  isAreaCategoryServiceable,
  listServiceableCategoriesForArea,
  resolveAreaScope,
  resolveAreaScopeByNodeId,
  SERVICEABILITY_COUNT_BOUND,
} from '@/lib/customer-serviceability'
import { PILOT_SKILL_TAGS } from '@/lib/service-categories'

const BROMHOF = {
  id: 'node_bromhof',
  slug: 'gauteng__johannesburg__jhb_north__bromhof',
  label: 'Bromhof',
  nodeType: 'SUBURB' as const,
  provinceKey: 'gauteng',
  cityKey: 'johannesburg',
  regionKey: 'jhb_north',
  active: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.locationNode.findUnique.mockReset()
  mockDb.category.findMany.mockReset()
  mockDb.provider.findMany.mockReset()
})

describe('resolveAreaScope', () => {
  it('returns null for empty / inactive slugs', async () => {
    expect(await resolveAreaScope(null)).toBeNull()
    expect(await resolveAreaScope('   ')).toBeNull()
    mockDb.locationNode.findUnique.mockResolvedValueOnce({ ...BROMHOF, active: false })
    expect(await resolveAreaScope('whatever')).toBeNull()
  })

  it('returns the node scope (without active flag) for a real slug', async () => {
    mockDb.locationNode.findUnique.mockResolvedValueOnce(BROMHOF)
    const scope = await resolveAreaScope(BROMHOF.slug)
    expect(scope).toEqual({ node: { ...BROMHOF, active: undefined } })
    // active should not leak into the exposed node shape
    expect((scope?.node as Record<string, unknown>).active).toBeUndefined()
  })
})

describe('resolveAreaScopeByNodeId', () => {
  it('honours the same active-only contract', async () => {
    expect(await resolveAreaScopeByNodeId(undefined)).toBeNull()
    mockDb.locationNode.findUnique.mockResolvedValueOnce({ ...BROMHOF, active: false })
    expect(await resolveAreaScopeByNodeId('node_inactive')).toBeNull()
    mockDb.locationNode.findUnique.mockResolvedValueOnce(BROMHOF)
    const scope = await resolveAreaScopeByNodeId(BROMHOF.id)
    expect(scope?.node.id).toBe(BROMHOF.id)
  })
})

describe('countActiveProvidersFor', () => {
  it('caps the result at COUNT_BOUND so we never walk huge result sets', async () => {
    const oversized = Array.from({ length: SERVICEABILITY_COUNT_BOUND }, (_, i) => ({ id: `p${i}` }))
    mockDb.provider.findMany.mockResolvedValueOnce(oversized)
    const count = await countActiveProvidersFor({ area: { node: BROMHOF } })
    expect(count).toBe(SERVICEABILITY_COUNT_BOUND)
    expect(mockDb.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: SERVICEABILITY_COUNT_BOUND }),
    )
  })

  it('passes through a category filter when provided', async () => {
    mockDb.provider.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    const count = await countActiveProvidersFor({
      area: { node: BROMHOF },
      categoryTag: 'handyman',
    })
    expect(count).toBe(3)
    const call = mockDb.provider.findMany.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    expect(where).toContain('handyman')
  })

  it('returns 0 when no providers match', async () => {
    mockDb.provider.findMany.mockResolvedValueOnce([])
    expect(await countActiveProvidersFor({ area: { node: BROMHOF }, categoryTag: 'carpentry' })).toBe(0)
  })
})

describe('buildAreaProviderWhere (mirrors matching coverage)', () => {
  // Reference: providerCoversAddress in lib/matching/filter.ts. A zero count
  // must mean matching would find no one, so the predicate may only accept the
  // coverage shapes matching accepts (or a conservative superset of RADIUS).
  const serviceAreaBranches = (node: Parameters<typeof buildAreaProviderWhere>[0]['node']) => {
    const where = buildAreaProviderWhere({ node })
    const or = where.OR as Array<{ technicianServiceAreas?: { some: Record<string, unknown> } }>
    return or.map((branch) => branch.technicianServiceAreas?.some)
  }

  it('accepts exactly the node row, the REGION row for its region, and RADIUS rows in its province', () => {
    expect(buildAreaProviderWhere({ node: BROMHOF })).toEqual({
      OR: [
        { technicianServiceAreas: { some: { active: true, locationNodeId: BROMHOF.id } } },
        { technicianServiceAreas: { some: { active: true, areaType: 'REGION', regionKey: 'jhb_north' } } },
        { technicianServiceAreas: { some: { active: true, areaType: 'RADIUS', provinceKey: 'gauteng' } } },
      ],
    })
  })

  it('does not count a SUBURB-only row that merely shares the region (no regionKey branch without areaType REGION)', () => {
    const regionBranches = serviceAreaBranches(BROMHOF).filter((b) => b && 'regionKey' in b)
    expect(regionBranches).toHaveLength(1)
    expect(regionBranches[0]).toMatchObject({ areaType: 'REGION' })
  })

  it('has no cityKey branch, no provinceKey branch without RADIUS, and no legacy string branches', () => {
    const branches = serviceAreaBranches(BROMHOF)
    expect(branches.some((b) => b && 'cityKey' in b)).toBe(false)
    const provinceBranches = branches.filter((b) => b && 'provinceKey' in b)
    expect(provinceBranches.length).toBeGreaterThan(0)
    expect(provinceBranches.every((b) => b?.areaType === 'RADIUS')).toBe(true)
    expect(JSON.stringify(buildAreaProviderWhere({ node: BROMHOF }))).not.toContain('serviceAreas":{"has"')
    expect((buildAreaProviderWhere({ node: BROMHOF }).OR as Array<Record<string, unknown>>).every(
      (b) => 'technicianServiceAreas' in b,
    )).toBe(true)
  })

  it('yields only the exact-node branch when the node has no regionKey and no provinceKey', () => {
    const bare = { ...BROMHOF, regionKey: null, provinceKey: null }
    expect(buildAreaProviderWhere({ node: bare })).toEqual({
      OR: [{ technicianServiceAreas: { some: { active: true, locationNodeId: BROMHOF.id } } }],
    })
  })

  it('adds the REGION branch only when regionKey is set and the RADIUS branch only when provinceKey is set', () => {
    const noRegion = serviceAreaBranches({ ...BROMHOF, regionKey: null })
    expect(noRegion.some((b) => b?.areaType === 'REGION')).toBe(false)
    expect(noRegion.some((b) => b?.areaType === 'RADIUS')).toBe(true)
    const noProvince = serviceAreaBranches({ ...BROMHOF, provinceKey: null })
    expect(noProvince.some((b) => b?.areaType === 'RADIUS')).toBe(false)
    expect(noProvince.some((b) => b?.areaType === 'REGION')).toBe(true)
  })

  describe('non-SUBURB scopes (home AreaSelector can pick REGION / CITY / PROVINCE)', () => {
    const REGION_NODE = { ...BROMHOF, id: 'node_jhb_north', slug: 'gauteng__johannesburg__jhb_north', label: 'JHB North', nodeType: 'REGION' as const }
    const CITY_NODE = { ...BROMHOF, id: 'node_jhb', slug: 'gauteng__johannesburg', label: 'Johannesburg', nodeType: 'CITY' as const, regionKey: null }
    const PROVINCE_NODE = { ...BROMHOF, id: 'node_gp', slug: 'gauteng', label: 'Gauteng', nodeType: 'PROVINCE' as const, regionKey: null, cityKey: null }

    it('REGION node: exact node + any-areaType regionKey row, nothing at city/province level', () => {
      expect(buildAreaProviderWhere({ node: REGION_NODE })).toEqual({
        OR: [
          { technicianServiceAreas: { some: { active: true, locationNodeId: REGION_NODE.id } } },
          { technicianServiceAreas: { some: { active: true, regionKey: 'jhb_north' } } },
        ],
      })
    })

    it('CITY node: exact node + any-areaType cityKey row, nothing at region/province level', () => {
      expect(buildAreaProviderWhere({ node: CITY_NODE })).toEqual({
        OR: [
          { technicianServiceAreas: { some: { active: true, locationNodeId: CITY_NODE.id } } },
          { technicianServiceAreas: { some: { active: true, cityKey: 'johannesburg' } } },
        ],
      })
    })

    it('PROVINCE node: exact node + any-areaType provinceKey row, no legacy strings', () => {
      const where = buildAreaProviderWhere({ node: PROVINCE_NODE })
      expect(where).toEqual({
        OR: [
          { technicianServiceAreas: { some: { active: true, locationNodeId: PROVINCE_NODE.id } } },
          { technicianServiceAreas: { some: { active: true, provinceKey: 'gauteng' } } },
        ],
      })
      expect(JSON.stringify(where)).not.toContain('"serviceAreas"')
    })
  })
})

describe('buildCategoryProviderWhere (mirrors matching category eligibility)', () => {
  // Matching (lib/matching/candidate-pool.ts) requires skills.has(tag); the
  // CATEGORY_NOT_APPROVED filter (lib/matching/filter.ts) then excludes a provider only
  // when a ProviderCategory row for THAT slug exists with a non-APPROVED status. No
  // row is permissive. The count that gates WhatsApp intake must match exactly.
  it('requires the skill tag and excludes only an explicit non-APPROVED row for that slug', () => {
    expect(buildCategoryProviderWhere('plumbing')).toEqual({
      skills: { has: 'plumbing' },
      providerCategories: {
        none: { categorySlug: 'plumbing', approvalStatus: { not: 'APPROVED' } },
      },
    })
  })

  it('does not require any ProviderCategory row, so rows for OTHER slugs never exclude a provider', () => {
    const where = buildCategoryProviderWhere('plumbing')
    // The old shape demanded `providerCategories: { none: {} }` (no rows at all) for the
    // skills fallback, which wrongly dropped providers that only had rows for other slugs.
    expect(JSON.stringify(where)).not.toContain('"none":{}')
    expect(where.providerCategories).toEqual({
      none: { categorySlug: 'plumbing', approvalStatus: { not: 'APPROVED' } },
    })
  })

  it('has no APPROVED-row-without-skills branch (matching needs skills.has either way)', () => {
    const where = buildCategoryProviderWhere('plumbing')
    expect(where.OR).toBeUndefined()
    expect(where.AND).toBeUndefined()
    expect(JSON.stringify(where)).not.toContain('"some"')
    expect(where.skills).toEqual({ has: 'plumbing' })
  })

  it('is applied to the provider count query for the requested category', async () => {
    mockDb.provider.findMany.mockResolvedValueOnce([{ id: 'p1' }])
    await countActiveProvidersFor({ area: { node: BROMHOF }, categoryTag: 'handyman' })
    const where = mockDb.provider.findMany.mock.calls[0][0].where
    expect(where.AND).toContainEqual(buildCategoryProviderWhere('handyman'))
  })
})

describe('listServiceableCategoriesForArea', () => {
  it('returns serviceable categories first, sorted by descending count, then alpha', async () => {
    mockDb.category.findMany.mockResolvedValueOnce([
      { slug: 'handyman', label: 'Handyman', sortOrder: 1 },
      { slug: 'plumbing', label: 'Plumbing', sortOrder: 2 },
      { slug: 'carpentry', label: 'Carpentry', sortOrder: 3 },
    ])
    // handyman = 4 providers, plumbing = 1, carpentry = 0
    mockDb.provider.findMany
      .mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }])
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([])

    const result = await listServiceableCategoriesForArea({ node: BROMHOF })
    expect(result.map((c) => `${c.tag}:${c.activeProviderCount}`)).toEqual([
      'handyman:4',
      'plumbing:1',
      'carpentry:0',
    ])
  })

  it('falls back to the static pilot catalogue when DB returns no categories', async () => {
    mockDb.category.findMany.mockResolvedValueOnce([])
    // Always return 1 provider so every pilot tag is "serviceable"
    mockDb.provider.findMany.mockResolvedValue([{ id: 'p1' }])

    const result = await listServiceableCategoriesForArea({ node: BROMHOF })
    expect(result.length).toBe(PILOT_SKILL_TAGS.size)
    expect(result.every((c) => PILOT_SKILL_TAGS.has(c.tag))).toBe(true)
  })
})

describe('isAreaCategoryServiceable', () => {
  it('rejects non-pilot categories outright', async () => {
    expect(await isAreaCategoryServiceable({ areaSlug: BROMHOF.slug, categoryTag: 'electrical' })).toBe(false)
  })

  it('rejects when area cannot be resolved', async () => {
    mockDb.locationNode.findUnique.mockResolvedValueOnce(null)
    expect(await isAreaCategoryServiceable({ areaSlug: 'unknown', categoryTag: 'handyman' })).toBe(false)
  })

  it('returns true when at least one active provider serves the (area, category)', async () => {
    mockDb.locationNode.findUnique.mockResolvedValueOnce(BROMHOF)
    mockDb.provider.findMany.mockResolvedValueOnce([{ id: 'p1' }])
    expect(await isAreaCategoryServiceable({ areaSlug: BROMHOF.slug, categoryTag: 'handyman' })).toBe(true)
  })

  it('returns false when zero providers match', async () => {
    mockDb.locationNode.findUnique.mockResolvedValueOnce(BROMHOF)
    mockDb.provider.findMany.mockResolvedValueOnce([])
    expect(await isAreaCategoryServiceable({ areaSlug: BROMHOF.slug, categoryTag: 'handyman' })).toBe(false)
  })
})
