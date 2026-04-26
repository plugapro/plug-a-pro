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

  it('includes active providers that are not formally marketplace-reviewed yet', async () => {
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
        verified: false,
        availableNow: true,
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
      verified: false,
      availableNow: true,
    })
    expect(mockDb.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ verified: true }),
    }))
  })
})
