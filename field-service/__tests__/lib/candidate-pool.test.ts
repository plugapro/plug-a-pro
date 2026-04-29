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
        phone: '+27823035070',
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
    await loadCandidatePool({
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

    expect(mockDb.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isTestUser: true }),
    }))
  })
})
