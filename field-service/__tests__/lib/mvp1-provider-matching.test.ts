import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJobRequest,
  mockDispatchDecision,
  mockMatchAttempt,
  mockProvider,
  mockRankCandidatesForJobRequest,
} = vi.hoisted(() => ({
  mockJobRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockDispatchDecision: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  mockMatchAttempt: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
  mockProvider: {
    findMany: vi.fn(),
  },
  mockRankCandidatesForJobRequest: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    dispatchDecision: mockDispatchDecision,
    matchAttempt: mockMatchAttempt,
    provider: mockProvider,
    // Simulate $transaction by running the callback with the same db proxy
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        jobRequest: mockJobRequest,
        dispatchDecision: mockDispatchDecision,
        matchAttempt: mockMatchAttempt,
        provider: mockProvider,
      }),
    ),
  },
}))

vi.mock('@/lib/matching/service', () => ({
  rankCandidatesForJobRequest: mockRankCandidatesForJobRequest,
}))

const BASE_REQUEST = {
  id: 'jr-1',
  status: 'PENDING_VALIDATION',
  category: 'plumbing',
  assignmentMode: 'OPS_REVIEW',
  latestDispatchDecisionId: null,
  address: {
    suburb: 'Bromhof',
    city: 'Johannesburg',
    region: 'jhb_west',
    locationNodeId: 'loc-1',
    locationNode: { regionKey: 'jhb_west' },
  },
}

function candidate(providerId: string, score: number, reason = 'Area + skill match') {
  return {
    providerId,
    score,
    selectionReason: reason,
    travelMinutes: 20,
    canMeetWindow: true,
    feasibilityNotes: [reason],
    scoreBreakdown: { total: score },
  }
}

describe('matchEligibleProvidersForServiceRequest (MVP1 workflow 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRequest.update.mockResolvedValue({})
    mockDispatchDecision.create.mockResolvedValue({ id: 'dd-1' })
    mockDispatchDecision.findFirst.mockResolvedValue(null)
    mockMatchAttempt.create.mockResolvedValue({})
    mockMatchAttempt.createMany.mockResolvedValue({ count: 0 })
    mockDispatchDecision.findUnique.mockResolvedValue(null)
    mockMatchAttempt.findMany.mockResolvedValue([])
  })

  it('happy path: returns eligible providers for request category/location and persists match results', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 2,
      eligibleCount: 2,
      filteredOut: [],
      candidates: [candidate('p-1', 0.93), candidate('p-2', 0.88)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: 'Experienced plumber',
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof', 'Roodepoort'],
        technicianServiceAreas: [],
      },
      {
        id: 'p-2',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider Two',
        bio: 'General maintenance',
        avatarUrl: null,
        skills: ['plumbing', 'handyman'],
        serviceAreas: ['Johannesburg'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.status).toBe('MATCHES_FOUND')
    expect(result.providers).toHaveLength(2)
    expect(mockDispatchDecision.create).toHaveBeenCalledTimes(1)
    expect(mockMatchAttempt.createMany).toHaveBeenCalledTimes(1)
    expect(mockJobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'jr-1' },
        data: expect.objectContaining({ status: 'PENDING_VALIDATION' }),
      }),
    )
  })

  it('no providers found returns NO_MATCH and keeps request in review-first pending state', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 0,
      eligibleCount: 0,
      filteredOut: [],
      candidates: [],
    })
    mockProvider.findMany.mockResolvedValue([])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.status).toBe('NO_MATCH')
    expect(result.providers).toHaveLength(0)
    expect(mockJobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'jr-1' },
        data: expect.objectContaining({ status: 'PENDING_VALIDATION' }),
      }),
    )
  })

  it('throws REQUEST_NOT_FOUND when service request does not exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(null)

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'missing' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_MISSING_CATEGORY when request category is empty', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, category: '  ' })

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_MISSING_LOCATION when request has no suburb/city/region/locationNodeId', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      ...BASE_REQUEST,
      address: {
        suburb: '',
        city: '',
        region: '',
        locationNodeId: null,
        locationNode: { regionKey: null },
      },
    })

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('throws REQUEST_MISSING_LOCATION when request address object is null', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, address: null })

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('rejects matching when request status is MATCHED (locked)', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, status: 'MATCHED' })

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('rejects matching when request is cancelled', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, status: 'CANCELLED' })

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    await expect(
      matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }),
    ).rejects.toThrow(ReviewFirstError)
  })

  it('excludes inactive providers', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: false,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('excludes providers without matching skill', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['painting'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('excludes suspended providers', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'SUSPENDED',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('excludes providers with incomplete profile data', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: '   ',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('excludes providers outside request area', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Midrand'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('excludes providers with availableNow=false even when all other criteria are met', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: false,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(0)
    expect(result.status).toBe('NO_MATCH')
  })

  it('structured-area-only provider (no legacy serviceAreas) is not excluded by area guard', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: [],
        technicianServiceAreas: [
          { active: true, label: 'Bromhof', city: 'Johannesburg', regionKey: 'jhb_west', suburbKey: 'bromhof', locationNodeId: 'loc-1' },
        ],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.providers).toHaveLength(1)
    expect(result.status).toBe('MATCHES_FOUND')
  })

  it('stale non-OPS_REVIEW decision does not block re-matching - creates new decision', async () => {
    mockJobRequest.findUnique.mockResolvedValue({
      ...BASE_REQUEST,
      latestDispatchDecisionId: 'dd-stale',
    })
    // Stale AUTO_ASSIGN decision - cache check must fall through
    mockDispatchDecision.findUnique.mockResolvedValue({
      id: 'dd-stale',
      mode: 'AUTO_ASSIGN',
      status: 'ASSIGNED',
    })
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.wasCached).toBe(false)
    expect(result.status).toBe('MATCHES_FOUND')
    expect(mockRankCandidatesForJobRequest).toHaveBeenCalledTimes(1)
    expect(mockDispatchDecision.create).toHaveBeenCalledTimes(1)
  })

  it('retry is idempotent: reuses cached OPS_REVIEW decision and does not create duplicates', async () => {
    // After a first matching run the request sits in PENDING_VALIDATION with a cached decision.
    // A second call should return the cached result without re-running ranking.
    mockJobRequest.findUnique.mockResolvedValue({
      ...BASE_REQUEST,
      latestDispatchDecisionId: 'dd-existing',
      status: 'PENDING_VALIDATION',
    })
    mockDispatchDecision.findUnique.mockResolvedValue({
      id: 'dd-existing',
      mode: 'OPS_REVIEW',
      status: 'RANKED',
    })
    mockMatchAttempt.findMany.mockResolvedValue([
      {
        rankedPosition: 1,
        createdAt: new Date('2026-05-10T09:00:00.000Z'),
        score: 0.9,
        feasibilityNotes: ['Area + skill match'],
        provider: {
          id: 'p-1',
          active: true,
          status: 'ACTIVE',
          availableNow: true,
          name: 'Provider One',
          bio: null,
          experience: null,
          avatarUrl: null,
          verified: true,
          averageRating: null,
          completedJobsCount: 0,
          portfolioUrls: [],
          skills: ['plumbing'],
          serviceAreas: ['Bromhof'],
          technicianServiceAreas: [],
          providerRates: [],
        },
      },
    ])

    const { matchEligibleProvidersForServiceRequest } = await import('@/lib/review-first')
    const result = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' })

    expect(result.wasCached).toBe(true)
    expect(result.providers).toHaveLength(1)
    expect(mockDispatchDecision.create).not.toHaveBeenCalled()
    expect(mockMatchAttempt.create).not.toHaveBeenCalled()
    expect(mockRankCandidatesForJobRequest).not.toHaveBeenCalled()
  })

  it('returns MATCHING_FAILED when ranking service layer throws', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockRejectedValue(new Error('ranking failed'))

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    const err = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }).catch((e) => e)
    expect(err).toBeInstanceOf(ReviewFirstError)
    expect(err.code).toBe('MATCHING_FAILED')
  })

  it('returns MATCHING_FAILED when matching persistence fails', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockRankCandidatesForJobRequest.mockResolvedValue({
      consideredCount: 1,
      eligibleCount: 1,
      filteredOut: [],
      candidates: [candidate('p-1', 0.9)],
    })
    mockProvider.findMany.mockResolvedValue([
      {
        id: 'p-1',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
        verified: true,
        name: 'Provider One',
        bio: null,
        avatarUrl: null,
        skills: ['plumbing'],
        serviceAreas: ['Bromhof'],
        technicianServiceAreas: [],
      },
    ])
    mockMatchAttempt.createMany.mockRejectedValue(new Error('transaction insert failed'))

    const { matchEligibleProvidersForServiceRequest, ReviewFirstError } = await import('@/lib/review-first')
    const err = await matchEligibleProvidersForServiceRequest({ serviceRequestId: 'jr-1' }).catch((e) => e)
    expect(err).toBeInstanceOf(ReviewFirstError)
    expect(err.code).toBe('MATCHING_FAILED')
  })
})
