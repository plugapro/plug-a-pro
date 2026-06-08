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
