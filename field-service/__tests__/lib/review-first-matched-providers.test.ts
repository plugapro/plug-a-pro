import { beforeEach, describe, expect, it, vi } from 'vitest'

// Heavy dynamic imports under full-suite parallel load can exceed the
// default 5s testTimeout. Bump per-file (validated 2026-06-08).
vi.setConfig({ testTimeout: 15_000 })

const {
  mockJobRequest,
  mockDispatchDecision,
  mockMatchAttempt,
} = vi.hoisted(() => ({
  mockJobRequest: {
    findUnique: vi.fn(),
  },
  mockDispatchDecision: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  mockMatchAttempt: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    dispatchDecision: mockDispatchDecision,
    matchAttempt: mockMatchAttempt,
  },
}))

describe('getMatchedProvidersForCustomerRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.REVIEW_PROVIDER_PROFILE_ACCESS_SECRET = 'test-review-profile-secret'
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    mockDispatchDecision.findUnique.mockResolvedValue({
      id: 'dd-1',
      mode: 'OPS_REVIEW',
      status: 'RANKED',
    })
    mockDispatchDecision.findFirst.mockResolvedValue(null)
  })

  it('happy path: customer can fetch matched providers', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Lovemore Sibanda',
          bio: 'Reliable plumbing support',
          experience: '5+ years',
          skills: ['plumbing', 'handyman'],
          serviceAreas: ['Bromhof', 'Roodepoort'],
          avatarUrl: null,
          verified: true,
          averageRating: 4.8,
          completedJobsCount: 22,
          portfolioUrls: [],
          technicianServiceAreas: [{ active: true, label: 'Bromhof', city: 'Johannesburg' }],
          providerRates: [{ callOutFee: 300, hourlyRate: 220, rateNegotiable: true }],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toMatchObject({
      providerId: 'p-1',
      displayName: 'Lovemore Sibanda',
      mainSkill: 'plumbing',
      trustLevel: 'reviewed',
      labourRateText: 'from R220/hr',
      availabilityIndicator: 'available_now',
    })
  })

  it('returns useful empty state when no matches exist', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
    expect(result.totalEligibleCount).toBe(0)
  })

  it('does not generate matches from the customer read path when candidates are not ready', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: null,
      leads: [],
    })
    mockDispatchDecision.findFirst.mockResolvedValue(null)

    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    const err = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    }).catch((error) => error)

    expect(err).toBeInstanceOf(ReviewFirstError)
    expect(err.code).toBe('MATCHES_NOT_READY')
    expect(mockMatchAttempt.findMany).not.toHaveBeenCalled()
  })

  it('falls back to latest usable OPS_REVIEW decision when latest cached decision is stale', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-stale',
      leads: [],
    })
    mockDispatchDecision.findUnique.mockResolvedValue({
      id: 'dd-stale',
      mode: 'AUTO_ASSIGN',
      status: 'ASSIGNED',
    })
    mockDispatchDecision.findFirst.mockResolvedValue({
      id: 'dd-fallback',
    })
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Lovemore Sibanda',
          bio: 'Reliable plumbing support',
          experience: '5+ years',
          skills: ['plumbing', 'handyman'],
          serviceAreas: ['Bromhof', 'Roodepoort'],
          avatarUrl: null,
          verified: true,
          averageRating: 4.8,
          completedJobsCount: 22,
          portfolioUrls: [],
          technicianServiceAreas: [{ active: true, label: 'Bromhof', city: 'Johannesburg' }],
          providerRates: [{ callOutFee: 300, hourlyRate: 220, rateNegotiable: true }],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(mockDispatchDecision.findFirst).toHaveBeenCalledTimes(1)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0].providerId).toBe('p-1')
  })

  it('throws when service request does not exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(null)

    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'missing',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_NOT_MATCHABLE when request is already accepted', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'MATCHED',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'jr-1',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_NOT_MATCHABLE when request is cancelled', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'CANCELLED',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'jr-1',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_MISSING_CATEGORY when category is missing', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: '',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'jr-1',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_MISSING_LOCATION when location data is missing', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: null,
        city: null,
        region: null,
        locationNodeId: null,
        locationNode: null,
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'jr-1',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws FORBIDDEN when customer does not own request', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'other-customer',
      category: 'plumbing',
      latestDispatchDecisionId: 'dd-1',
      leads: [],
    })
    mockMatchAttempt.findMany.mockResolvedValue([])

    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({
        requestId: 'jr-1',
        customerId: 'cust-1',
        batch: 1,
      }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('excludes inactive provider from display results', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: false,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Inactive Provider',
          bio: null,
          experience: null,
          skills: ['plumbing'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: false,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
  })

  it('excludes suspended provider from display results', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'SUSPENDED',
          availableNow: true,
          name: 'Suspended Provider',
          bio: null,
          experience: null,
          skills: ['plumbing'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: false,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
  })

  it('excludes provider missing service area from display results', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'No Area Provider',
          bio: null,
          experience: null,
          skills: ['plumbing'],
          serviceAreas: [],
          avatarUrl: null,
          verified: false,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
  })

  it('excludes provider with mismatched skills from display results', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.91,
        feasibilityNotes: ['Area match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Painter Provider',
          bio: null,
          experience: null,
          skills: ['painting'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: false,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [
            { active: true, label: 'Bromhof', city: 'Johannesburg', suburbKey: null, regionKey: 'jhb-west', locationNodeId: null },
          ],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
  })

  it('handles missing optional profile fields without breaking', async () => {
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: null,
        feasibilityNotes: [],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Minimal Provider',
          bio: null,
          experience: null,
          skills: ['plumbing'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: false,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toMatchObject({
      displayName: 'Minimal Provider',
      summary: null,
      labourRateText: 'rate negotiable',
      profilePhotoUrl: null,
    })
  })

  it('throws INVALID_BATCH for batch=0', async () => {
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({ requestId: 'jr-1', customerId: 'cust-1', batch: 0 }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws INVALID_BATCH for NaN batch', async () => {
    const { getMatchedProvidersForCustomerRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      getMatchedProvidersForCustomerRequest({ requestId: 'jr-1', customerId: 'cust-1', batch: NaN }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('excludes providers with active shortlist lead from display results', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      customerId: 'cust-1',
      category: 'plumbing',
      status: 'PENDING_VALIDATION',
      address: {
        suburb: 'Bromhof',
        city: 'Johannesburg',
        region: 'JHB West',
        locationNodeId: null,
        locationNode: { regionKey: 'jhb-west' },
      },
      latestDispatchDecisionId: 'dd-1',
      leads: [{ providerId: 'p-1', status: 'SHORTLISTED' }],
    })
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        providerId: 'p-1',
        rankedPosition: 1,
        createdAt: new Date(),
        score: 0.9,
        feasibilityNotes: ['Area match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Shortlisted Provider',
          bio: null,
          experience: null,
          skills: ['plumbing'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: true,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { getMatchedProvidersForCustomerRequest } = await import('@/lib/review-first')
    const result = await getMatchedProvidersForCustomerRequest({
      requestId: 'jr-1',
      customerId: 'cust-1',
      batch: 1,
    })

    expect(result.providers).toEqual([])
    expect(result.totalEligibleCount).toBe(0)
  })
})
