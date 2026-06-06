/**
 * Funnel tests for the staged matching narrowing introduced 2026-06-06.
 *
 * Covers the seven acceptance scenarios from the matching-funnel task:
 *   1. Eligible providers found → DISPATCHED
 *   2. Location match, no skill → NO_SKILL_MATCH_IN_LOCATION
 *   3. No location match → NO_LOCATION_MATCH, no DB-wide provider scan
 *   4. Missing location/category → INSUFFICIENT_REQUEST_DATA (SKIP)
 *   5. Inactive/unapproved excluded → NO_APPROVED_PROVIDER
 *   6. Suburb → province fallback works
 *   7. Direct-scan never runs a blanket query (location filter is always in WHERE)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockDb,
  mockLoadMatchingJobRequest,
  mockLoadCandidatePool,
  mockCountProvidersInLocation,
  mockFilterEligibleProviders,
  mockScoreAndRankCandidates,
  mockReserveBestProviderAtomically,
  mockDispatchMatchLead,
  mockEmitMatchEvent,
  mockIsEnabled,
} = vi.hoisted(() => ({
  mockDb: {
    assignmentHold: { findFirst: vi.fn() },
    dispatchDecision: { create: vi.fn(), update: vi.fn() },
    matchAttempt: { create: vi.fn(), update: vi.fn() },
    jobRequest: { update: vi.fn(), findUnique: vi.fn() },
    lead: { findMany: vi.fn() },
    provider: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
  mockLoadMatchingJobRequest: vi.fn(),
  mockLoadCandidatePool: vi.fn(),
  mockCountProvidersInLocation: vi.fn(),
  mockFilterEligibleProviders: vi.fn(),
  mockScoreAndRankCandidates: vi.fn(),
  mockReserveBestProviderAtomically: vi.fn(),
  mockDispatchMatchLead: vi.fn(),
  mockEmitMatchEvent: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/service', () => ({ loadMatchingJobRequest: mockLoadMatchingJobRequest }))
vi.mock('../../lib/matching/candidate-pool', () => ({
  loadCandidatePool: mockLoadCandidatePool,
  countProvidersInLocation: mockCountProvidersInLocation,
  // buildLocationConditions is re-exported but unused here; tested directly via dynamic import.
  buildLocationConditions: vi.fn(),
}))
vi.mock('../../lib/matching/filter', () => ({ filterEligibleProviders: mockFilterEligibleProviders }))
vi.mock('../../lib/matching/scoring', () => ({ scoreAndRankCandidates: mockScoreAndRankCandidates }))
vi.mock('../../lib/matching/reservation', () => ({ reserveBestProviderAtomically: mockReserveBestProviderAtomically }))
vi.mock('../../lib/matching/dispatch', () => ({ dispatchMatchLead: mockDispatchMatchLead }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/whatsapp', () => ({
  sendCustomerMatchFoundNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerMatchingInProgress: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/job-requests/expire-job-request', () => ({ expireOpenJobRequest: vi.fn() }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeJobRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'OPEN',
    category: 'electrical',
    assignmentMode: 'AUTO_ASSIGN',
    isTestRequest: false,
    cohortName: null,
    address: {
      suburb: 'Sandton',
      city: 'Johannesburg',
      regionKey: 'gauteng_jhb_north',
      provinceKey: 'gauteng',
      locationNodeId: 'ln_sandton',
      lat: -26.1,
      lng: 28.05,
    },
    customer: { id: 'cust-1', name: 'Test Customer', phone: '+27800000000' },
    ...overrides,
  }
}

function makeCandidate(id = 'provider-1') {
  return {
    id,
    name: 'Alice',
    phone: '+27821234567',
    skills: ['electrical'],
    serviceAreas: ['sandton'],
    maxTravelMinutes: 60,
    reliabilityScore: 0.9,
    averageRating: 4.5,
    active: true,
    verified: true,
    availableNow: true,
    lastKnownLat: -26.1,
    lastKnownLng: 28.05,
    isOnline: true,
    liveLocationLat: null,
    liveLocationLng: null,
    lastHeartbeatAt: new Date(),
    scoreBase: 0.8,
    fromPool: true,
  }
}

function makeEligibleCandidate(id = 'provider-1') {
  return {
    ...makeCandidate(id),
    scheduleFitScore: 0.9,
    travelMinutes: 15,
    canMeetWindow: true,
    estimatedStartAt: new Date(),
    estimatedEndAt: new Date(),
    feasibilityNotes: [],
    coverageTier: 'primary' as const,
  }
}

function commonBeforeEach() {
  vi.clearAllMocks()
  mockIsEnabled.mockResolvedValue(false)
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb as any))
  mockDb.assignmentHold.findFirst.mockResolvedValue(null)
  mockDb.lead.findMany.mockResolvedValue([])
  mockDb.jobRequest.findUnique.mockResolvedValue({
    altSlotNegotiationSentAt: null,
    altSlotNegotiationOutcome: null,
  })
  mockDb.dispatchDecision.create.mockResolvedValue({ id: 'decision-1' })
  mockDb.dispatchDecision.update.mockResolvedValue({})
  mockDb.matchAttempt.create.mockImplementation(async ({ data }: any) => ({
    id: `attempt-${data.providerId}`,
    ...data,
  }))
  mockDb.matchAttempt.update.mockResolvedValue({})
  mockDb.jobRequest.update.mockResolvedValue({})
  mockDispatchMatchLead.mockResolvedValue(undefined)
  mockEmitMatchEvent.mockReturnValue(undefined)
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostics module — unit tests for the reason classifier
// ═══════════════════════════════════════════════════════════════════════════

describe('diagnoseNoMatchReason', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns INSUFFICIENT_REQUEST_DATA when hasUsableInputs is false', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: false,
      skillCandidates: 0,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [],
      address: null,
      isTestRequest: false,
    })
    expect(result.reason).toBe('INSUFFICIENT_REQUEST_DATA')
    expect(mockCountProvidersInLocation).not.toHaveBeenCalled()
  })

  it('returns NO_LOCATION_MATCH when skill pool is 0 and location count is 0', async () => {
    mockCountProvidersInLocation.mockResolvedValue(0)
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 0,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [],
      address: { suburb: 'Bellville', city: null, lat: null, lng: null, locationNodeId: 'ln_bellville', provinceKey: 'wc' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_LOCATION_MATCH')
    expect(result.stageCounts.locationCandidates).toBe(0)
    expect(mockCountProvidersInLocation).toHaveBeenCalledTimes(1)
  })

  it('returns NO_SKILL_MATCH_IN_LOCATION when skill pool is 0 but providers serve the area', async () => {
    mockCountProvidersInLocation.mockResolvedValue(7)
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 0,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [],
      address: { suburb: 'Bellville', city: null, lat: null, lng: null, locationNodeId: 'ln_bellville', provinceKey: 'wc' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_SKILL_MATCH_IN_LOCATION')
    expect(result.stageCounts.locationCandidates).toBe(7)
  })

  it('returns NO_APPROVED_PROVIDER when every filtered provider failed for status reasons only', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 3,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['TECHNICIAN_PAUSED'] },
        { providerId: 'p2', filteredReasonCodes: ['CATEGORY_NOT_APPROVED'] },
        { providerId: 'p3', filteredReasonCodes: ['TECHNICIAN_HEARTBEAT_STALE'] },
      ],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_APPROVED_PROVIDER')
    expect(mockCountProvidersInLocation).not.toHaveBeenCalled()
  })

  it('returns generic NO_MATCH when mixed filter reasons are present', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 2,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['TECHNICIAN_PAUSED'] },
        { providerId: 'p2', filteredReasonCodes: ['SCHEDULE_CONFLICT'] },
      ],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_MATCH')
  })
})

describe('classifyNoMatch', () => {
  const baseStageCounts = {
    locationCandidates: 0,
    skillCandidates: 0,
    eligibleCount: 0,
    rankedCount: 0,
  }

  it('classifies an empty pool with no location providers as EMPTY_POOL / NO_LOCATION_MATCH', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 0,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [],
      nearMissCount: 0,
      reservationFailureReasons: [],
      noMatchReason: 'NO_LOCATION_MATCH',
      stageCounts: baseStageCounts,
    })

    expect(result.failureClass).toBe('EMPTY_POOL')
    expect(result.primaryReason).toBe('NO_LOCATION_MATCH')
    expect(result.evidence).toContain('considered_count=0')
    expect(result.evidence).toContain('location_candidates=0')
  })

  it('classifies an empty skill pool with location providers as EMPTY_POOL / NO_SKILL_MATCH_IN_LOCATION', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 0,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [],
      nearMissCount: 0,
      reservationFailureReasons: [],
      noMatchReason: 'NO_SKILL_MATCH_IN_LOCATION',
      stageCounts: { ...baseStageCounts, locationCandidates: 4 },
    })

    expect(result.failureClass).toBe('EMPTY_POOL')
    expect(result.primaryReason).toBe('NO_SKILL_MATCH_IN_LOCATION')
  })

  it('classifies all permanent filtered reasons as STRUCTURAL and normalizes prefixed codes', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 3,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['MISSING_REQUIRED_CERTIFICATION:wiremans'] },
        { providerId: 'p2', filteredReasonCodes: ['MISSING_REQUIRED_CERTIFICATION:coc'] },
        { providerId: 'p3', filteredReasonCodes: ['MISSING_REQUIRED_EQUIPMENT:ladder'] },
      ],
      nearMissCount: 0,
      reservationFailureReasons: [],
      noMatchReason: 'NO_MATCH',
      stageCounts: { ...baseStageCounts, locationCandidates: 3, skillCandidates: 3 },
    })

    expect(result.failureClass).toBe('STRUCTURAL')
    expect(result.primaryReason).toBe('MISSING_REQUIRED_CERTIFICATION')
    expect(result.evidence).toContain('permanent_filtered_providers=3/3')
  })

  it('keeps a mixed permanent/transient pool retryable even when permanent reasons are the majority', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 3,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['MISSING_REQUIRED_SKILL'] },
        { providerId: 'p2', filteredReasonCodes: ['OUTSIDE_SERVICE_AREA'] },
        { providerId: 'p3', filteredReasonCodes: ['TECHNICIAN_PAUSED'] },
      ],
      nearMissCount: 0,
      reservationFailureReasons: [],
      noMatchReason: 'NO_MATCH',
      stageCounts: { ...baseStageCounts, locationCandidates: 3, skillCandidates: 3 },
    })

    expect(result.failureClass).toBe('TRANSIENT')
    expect(result.primaryReason).toBe('MISSING_REQUIRED_SKILL')
  })

  it('classifies near misses as TRANSIENT so alternative-slot negotiation stays ahead of expiry', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 2,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['SCHEDULE_CONFLICT'] },
      ],
      nearMissCount: 1,
      reservationFailureReasons: [],
      noMatchReason: 'NO_MATCH',
      stageCounts: { ...baseStageCounts, locationCandidates: 2, skillCandidates: 2 },
    })

    expect(result.failureClass).toBe('TRANSIENT')
    expect(result.primaryReason).toBe('SCHEDULE_CONFLICT')
    expect(result.evidence).toContain('near_miss_count=1')
  })

  it('classifies reservation failures as TRANSIENT / RESERVATION_FAILED', async () => {
    const { classifyNoMatch } = await import('../../lib/matching/diagnostics')

    const result = classifyNoMatch({
      consideredCount: 10,
      eligibleCount: 10,
      rankedCount: 10,
      filteredOut: [],
      nearMissCount: 0,
      reservationFailureReasons: ['PROVIDER_LOCKED', 'AT_CAPACITY'],
      noMatchReason: 'NO_MATCH',
      stageCounts: { ...baseStageCounts, locationCandidates: 10, skillCandidates: 10, eligibleCount: 10, rankedCount: 10 },
    })

    expect(result.failureClass).toBe('TRANSIENT')
    expect(result.primaryReason).toBe('RESERVATION_FAILED')
    expect(result.evidence).toContain('reservation_failures=2')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator funnel — end-to-end with sub-modules mocked
// ═══════════════════════════════════════════════════════════════════════════

describe('orchestrateMatch — funnel reasons', () => {
  beforeEach(commonBeforeEach)

  it('SKIPs with NO_ADDRESS and INSUFFICIENT_REQUEST_DATA reason when address is null', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest({ address: null }))
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('NO_ADDRESS')
    expect((result as any).noMatchReason).toBe('INSUFFICIENT_REQUEST_DATA')
    // Critical: no provider query of any kind ran.
    expect(mockLoadCandidatePool).not.toHaveBeenCalled()
    expect(mockDb.provider.findMany).not.toHaveBeenCalled()
  })

  it('SKIPs with NO_CATEGORY and INSUFFICIENT_REQUEST_DATA reason when category is empty', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest({ category: '   ' }))
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('NO_CATEGORY')
    expect((result as any).noMatchReason).toBe('INSUFFICIENT_REQUEST_DATA')
    expect(mockLoadCandidatePool).not.toHaveBeenCalled()
    expect(mockDb.provider.findMany).not.toHaveBeenCalled()
  })

  it('returns NO_LOCATION_MATCH when no providers serve the area at all', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([])
    mockCountProvidersInLocation.mockResolvedValue(0)
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [], filteredOut: [], nearMiss: [] })
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('NO_MATCH')
    expect((result as any).noMatchReason).toBe('NO_LOCATION_MATCH')
    expect((result as any).stageCounts.locationCandidates).toBe(0)
    // The DispatchDecision row carries the reason for ops visibility.
    expect(mockDb.dispatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          noMatchReason: 'NO_LOCATION_MATCH',
          stageCounts: expect.objectContaining({ locationCandidates: 0 }),
        }),
      }),
    )
  })

  it('returns NO_SKILL_MATCH_IN_LOCATION when providers serve the area but none have the skill', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([])
    // 4 providers serve Sandton but none in the "electrical" category.
    mockCountProvidersInLocation.mockResolvedValue(4)
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [], filteredOut: [], nearMiss: [] })
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('NO_MATCH')
    expect((result as any).noMatchReason).toBe('NO_SKILL_MATCH_IN_LOCATION')
    expect((result as any).stageCounts.locationCandidates).toBe(4)
  })

  it('returns NO_APPROVED_PROVIDER when candidates exist but all fail status checks', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([makeCandidate('p1'), makeCandidate('p2')])
    mockFilterEligibleProviders.mockResolvedValue({
      eligible: [],
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['TECHNICIAN_PAUSED'] },
        { providerId: 'p2', filteredReasonCodes: ['CATEGORY_NOT_APPROVED'] },
      ],
      nearMiss: [],
    })
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('NO_MATCH')
    expect((result as any).noMatchReason).toBe('NO_APPROVED_PROVIDER')
    // We do NOT issue a location count when we already had skill candidates.
    expect(mockCountProvidersInLocation).not.toHaveBeenCalled()
  })

  it('dispatches when eligible candidates are found', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([makeCandidate('p1')])
    const eligible = makeEligibleCandidate('p1')
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [eligible], filteredOut: [], nearMiss: [] })
    mockScoreAndRankCandidates.mockReturnValue([
      { providerId: 'p1', rank: 1, score: 0.9, scoreBreakdown: {} },
    ])
    mockReserveBestProviderAtomically.mockResolvedValue({
      ok: true,
      hold: { id: 'hold-1', expiresAt: new Date(Date.now() + 900_000) },
      provider: { id: 'p1', name: 'Alice', phone: '+27800000001' },
    })
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('DISPATCHED')
    expect(mockCountProvidersInLocation).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Candidate-pool direct-scan — verify queries are always location-narrowed
// ═══════════════════════════════════════════════════════════════════════════

describe('loadFromDirectScan — query bounding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module mocks: this suite needs the real candidate-pool module.
    vi.doUnmock('../../lib/matching/candidate-pool')
  })

  it('exits early without querying providers when no location signal is present', async () => {
    vi.resetModules()
    vi.doMock('../../lib/db', () => ({ db: mockDb }))
    const { loadCandidatePool } = await import('../../lib/matching/candidate-pool')

    const result = await loadCandidatePool({
      category: 'plumbing',
      address: { suburb: null, city: null, lat: null, lng: null, locationNodeId: null, provinceKey: null },
      usePool: false,
    })

    expect(result).toEqual([])
    // Critical bounded-query check: the rewrite must not perform a blanket scan.
    expect(mockDb.provider.findMany).not.toHaveBeenCalled()
  })

  it('queries SUBURB-LEVEL ONLY when the suburb scope returns providers (no province fallback)', async () => {
    vi.resetModules()
    vi.doMock('../../lib/db', () => ({ db: mockDb }))
    // Suburb scope returns at least one provider — fallback must NOT run.
    mockDb.provider.findMany.mockResolvedValueOnce([
      {
        id: 'p1', name: 'A', phone: '+27800000001', skills: ['plumbing'], serviceAreas: [],
        maxTravelMinutes: 60, reliabilityScore: 0.9, averageRating: 4.5,
        active: true, verified: true, availableNow: true, isTestUser: false, cohortName: null,
        lastKnownLat: null, lastKnownLng: null, liveStatus: null,
      },
    ])
    const { loadCandidatePool } = await import('../../lib/matching/candidate-pool')

    await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Bellville',
        city: 'Cape Town',
        lat: -33.93,
        lng: 18.63,
        locationNodeId: 'ln_bellville',
        provinceKey: 'wc',
      },
      usePool: false,
    })

    // Exactly ONE query — the suburb-level one.
    expect(mockDb.provider.findMany).toHaveBeenCalledTimes(1)
    const call = (mockDb.provider.findMany as any).mock.calls[0][0]
    expect(call.where.skills).toEqual({ has: 'plumbing' })
    const orConditions = call.where.OR as Array<Record<string, unknown>>
    // Contains suburb-level conditions only — NO provinceKey condition.
    expect(orConditions.some((c) => JSON.stringify(c).includes('"locationNodeId":"ln_bellville"'))).toBe(true)
    expect(orConditions.some((c) => JSON.stringify(c).includes('"provinceKey"'))).toBe(false)
    expect(call.take).toBe(30)
  })

  it('falls back to PROVINCE-LEVEL only when the suburb scope returns zero', async () => {
    vi.resetModules()
    vi.doMock('../../lib/db', () => ({ db: mockDb }))
    // First call (suburb) returns 0; second call (province) returns one.
    mockDb.provider.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'p1', name: 'A', phone: '+27800000001', skills: ['plumbing'], serviceAreas: [],
          maxTravelMinutes: 60, reliabilityScore: 0.9, averageRating: 4.5,
          active: true, verified: true, availableNow: true, isTestUser: false, cohortName: null,
          lastKnownLat: null, lastKnownLng: null, liveStatus: null,
        },
      ])
    const { loadCandidatePool } = await import('../../lib/matching/candidate-pool')

    await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Bellville',
        city: 'Cape Town',
        lat: -33.93,
        lng: 18.63,
        locationNodeId: 'ln_bellville',
        provinceKey: 'wc',
      },
      usePool: false,
    })

    expect(mockDb.provider.findMany).toHaveBeenCalledTimes(2)
    const suburbCall = (mockDb.provider.findMany as any).mock.calls[0][0]
    const provinceCall = (mockDb.provider.findMany as any).mock.calls[1][0]

    // Suburb call has no provinceKey condition.
    expect((suburbCall.where.OR as any[]).some((c) => JSON.stringify(c).includes('"provinceKey"'))).toBe(false)
    // Province call has ONLY the provinceKey condition.
    expect((provinceCall.where.OR as any[]).every((c) => JSON.stringify(c).includes('"provinceKey":"wc"'))).toBe(true)
    expect((provinceCall.where.OR as any[]).some((c) => JSON.stringify(c).includes('"locationNodeId"'))).toBe(false)
  })

  it('returns empty without a province query when both suburb scope misses and no provinceKey exists', async () => {
    vi.resetModules()
    vi.doMock('../../lib/db', () => ({ db: mockDb }))
    mockDb.provider.findMany.mockResolvedValueOnce([])
    const { loadCandidatePool } = await import('../../lib/matching/candidate-pool')

    const result = await loadCandidatePool({
      category: 'plumbing',
      address: {
        suburb: 'Newtown',
        city: 'Johannesburg',
        lat: null,
        lng: null,
        locationNodeId: null,
        provinceKey: null,
      },
      usePool: false,
    })

    expect(result).toEqual([])
    // Suburb-level query ran once (legacy strings only). No province retry.
    expect(mockDb.provider.findMany).toHaveBeenCalledTimes(1)
  })

  it('produces only legacy-string conditions in the suburb call when no structured location node is known', async () => {
    vi.resetModules()
    vi.doMock('../../lib/db', () => ({ db: mockDb }))
    mockDb.provider.findMany.mockResolvedValueOnce([])
    const { loadCandidatePool } = await import('../../lib/matching/candidate-pool')

    await loadCandidatePool({
      category: 'painting',
      address: {
        suburb: 'Newtown',
        city: 'Johannesburg',
        lat: null,
        lng: null,
        locationNodeId: null,
        provinceKey: null,
      },
      usePool: false,
    })

    const call = (mockDb.provider.findMany as any).mock.calls[0][0]
    const orConditions = call.where.OR as Array<Record<string, unknown>>
    expect(orConditions).toEqual(
      expect.arrayContaining([
        { serviceAreas: { has: 'Newtown' } },
        { serviceAreas: { has: 'Johannesburg' } },
      ]),
    )
    expect(orConditions.some((c) => 'technicianServiceAreas' in c)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostics — STATUS_REASON_CODES coverage regression tests
// ═══════════════════════════════════════════════════════════════════════════

describe('diagnoseNoMatchReason — STATUS_REASON_CODES coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies PROVIDER_PREVIOUSLY_DECLINED as NO_APPROVED_PROVIDER', async () => {
    // Regression: orchestrator merges declinedFilteredOut INTO filteredOut, so
    // this code regularly appears in the diagnostic input. If it's not in the
    // status set, a solo declined provider lands in the generic NO_MATCH bucket.
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 1,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [{ providerId: 'p1', filteredReasonCodes: ['PROVIDER_PREVIOUSLY_DECLINED'] }],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_APPROVED_PROVIDER')
  })

  it('classifies DAILY_MAX_REACHED as NO_APPROVED_PROVIDER', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 4,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['DAILY_MAX_REACHED'] },
        { providerId: 'p2', filteredReasonCodes: ['DAILY_MAX_REACHED'] },
        { providerId: 'p3', filteredReasonCodes: ['DAILY_MAX_REACHED'] },
        { providerId: 'p4', filteredReasonCodes: ['DAILY_MAX_REACHED'] },
      ],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_APPROVED_PROVIDER')
  })

  it('classifies OFFER_COOLDOWN_ACTIVE + SAME_DAY_NOT_AVAILABLE as NO_APPROVED_PROVIDER', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 2,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['OFFER_COOLDOWN_ACTIVE'] },
        { providerId: 'p2', filteredReasonCodes: ['SAME_DAY_NOT_AVAILABLE'] },
      ],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_APPROVED_PROVIDER')
  })

  it('sets locationCandidates: null in NO_APPROVED_PROVIDER stageCounts (no skillCandidates conflation)', async () => {
    const { diagnoseNoMatchReason } = await import('../../lib/matching/diagnostics')
    const result = await diagnoseNoMatchReason({
      hasUsableInputs: true,
      skillCandidates: 3,
      eligibleCount: 0,
      rankedCount: 0,
      filteredOut: [
        { providerId: 'p1', filteredReasonCodes: ['TECHNICIAN_PAUSED'] },
        { providerId: 'p2', filteredReasonCodes: ['DAILY_MAX_REACHED'] },
        { providerId: 'p3', filteredReasonCodes: ['CATEGORY_NOT_APPROVED'] },
      ],
      address: { suburb: 'Sandton', city: null, lat: null, lng: null, locationNodeId: 'ln_sandton', provinceKey: 'gauteng' },
      isTestRequest: false,
    })
    expect(result.reason).toBe('NO_APPROVED_PROVIDER')
    // Critical: don't mislabel skillCandidates as locationCandidates.
    expect(result.stageCounts.locationCandidates).toBeNull()
    expect(result.stageCounts.skillCandidates).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// emitSkippedNoMatch — triggeredBy is forwarded into the match.skipped event
// ═══════════════════════════════════════════════════════════════════════════

describe('match.skipped event includes triggeredBy', () => {
  beforeEach(commonBeforeEach)

  it('forwards triggeredBy through emitMatchEvent on INSUFFICIENT_REQUEST_DATA paths', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest({ category: '' }))
    const { orchestrateMatch } = await import('../../lib/matching/orchestrator')

    await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'match.skipped',
        reason: 'NO_CATEGORY',
        triggeredBy: 'cron',
      }),
    )
  })
})
