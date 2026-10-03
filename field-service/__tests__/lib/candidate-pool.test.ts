import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
    provider: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

describe('loadCandidatePool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads only active approved providers from direct scan', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      {
        id: 'provider-1',
        name: 'Sipho',
        phone: '+27821234567',
        skills: ['plumbing'],
        serviceAreas: ['Sandton'],
        maxTravelMinutes: 60,
        reliabilityScore: 0.5,
        averageRating: 0,
        active: true,
        verified: true,
        availableNow: true,
        isTestUser: false,
        cohortName: null,
        lastKnownLat: null,
        lastKnownLng: null,
        liveStatus: null,
      },
    ])

    const { loadCandidatePool } = await import('@/lib/matching/candidate-pool')
    const candidates = await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Sandton',
        city: 'Johannesburg',
        lat: null,
        lng: null,
        locationNodeId: null,
      },
      usePool: false,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      id: 'provider-1',
      active: true,
      isTestUser: false,
      cohortName: null,
      verified: true,
      availableNow: true,
    })
    expect(mockDb.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isTestUser: false }),
    }))
    expect(mockDb.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ verified: true, status: 'ACTIVE' }),
    }))
  })

  it('loads only internal test providers for test requests', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      {
        id: 'provider-test',
        name: 'Internal Test',
        phone: '+27821234567',
        skills: ['plumbing'],
        serviceAreas: ['Sandton'],
        maxTravelMinutes: 60,
        reliabilityScore: 0.5,
        averageRating: 0,
        active: true,
        verified: true,
        availableNow: true,
        isTestUser: true,
        cohortName: 'internal_staff_test',
        lastKnownLat: null,
        lastKnownLng: null,
        liveStatus: null,
      },
    ])

    const { loadCandidatePool } = await import('@/lib/matching/candidate-pool')
    const candidates = await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Sandton',
        city: 'Johannesburg',
        lat: null,
        lng: null,
        locationNodeId: null,
      },
      usePool: false,
      isTestRequest: true,
    })

    expect(candidates[0]).toMatchObject({
      id: 'provider-test',
      isTestUser: true,
      cohortName: 'internal_staff_test',
    })
    expect(mockDb.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isTestUser: true }),
    }))
  })
})

describe('buildSuburbLevelConditions', () => {
  it('includes a REGION-row branch when the address regionKey is known', async () => {
    const { buildSuburbLevelConditions } = await import('@/lib/matching/candidate-pool')
    const conditions = buildSuburbLevelConditions({
      suburb: 'Roodepoort',
      city: 'Johannesburg',
      lat: null,
      lng: null,
      locationNodeId: 'node-suburb-1',
      provinceKey: 'gauteng',
      regionKey: 'jhb_west',
    })

    expect(conditions).toContainEqual({
      technicianServiceAreas: {
        some: { active: true, areaType: 'REGION', regionKey: 'jhb_west' },
      },
    })
  })

  it('omits the REGION-row branch when no regionKey is known', async () => {
    const { buildSuburbLevelConditions } = await import('@/lib/matching/candidate-pool')
    const conditions = buildSuburbLevelConditions({
      suburb: 'Roodepoort',
      city: null,
      lat: null,
      lng: null,
      locationNodeId: 'node-suburb-1',
      provinceKey: 'gauteng',
    })

    expect(JSON.stringify(conditions)).not.toContain('REGION')
  })
})

describe('loadCandidatePool pool query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ranks covering providers before applying the LIMIT', async () => {
    mockDb.$queryRaw.mockResolvedValue([{ id: 'provider-1' }])

    const { loadCandidatePool } = await import('@/lib/matching/candidate-pool')
    await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Roodepoort',
        city: 'Johannesburg',
        lat: null,
        lng: null,
        locationNodeId: 'node-suburb-1',
        provinceKey: 'gauteng',
        regionKey: 'jhb_west',
      },
      limit: 30,
      usePool: true,
    })

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = mockDb.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?').replace(/\s+/g, ' ')

    // DISTINCT ON stays in an inner query; the outer query ranks then limits.
    expect(sql).toMatch(/SELECT DISTINCT ON \(p\.id\)/)
    expect(sql).toMatch(/EXISTS \( SELECT 1 FROM technician_service_areas/)
    expect(sql).toContain(`"areaType" = 'REGION'`)
    const outerOrder = sql.lastIndexOf('ORDER BY')
    const limitAt = sql.lastIndexOf('LIMIT')
    expect(outerOrder).toBeGreaterThan(sql.indexOf('DISTINCT ON'))
    expect(sql.slice(outerOrder, limitAt)).toMatch(/"coverageRank" ASC, ranked\."scoreBase" DESC, ranked\.id/)
    // The LIMIT is applied once, after ranking (outer query only).
    expect(sql.match(/LIMIT/g)).toHaveLength(1)
    expect(limitAt).toBeGreaterThan(outerOrder)
    expect(values).toContain('node-suburb-1')
    expect(values).toContain('jhb_west')
    expect(values.at(-1)).toBe(30)
  })

  it('does not leak the coverage rank onto returned entries', async () => {
    mockDb.$queryRaw.mockResolvedValue([{ id: 'provider-1', coverageRank: 0, scoreBase: 0.7 }])

    const { loadCandidatePool } = await import('@/lib/matching/candidate-pool')
    const result = await loadCandidatePool({
      category: 'plumbing',
      address: { suburb: null, city: null, lat: null, lng: null, locationNodeId: 'node-suburb-1', provinceKey: 'gauteng' },
      usePool: true,
    })

    expect(result[0]).not.toHaveProperty('coverageRank')
    expect(result[0]).toMatchObject({ id: 'provider-1', fromPool: true })
  })
})
