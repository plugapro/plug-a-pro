import { beforeEach, describe, expect, it, vi } from 'vitest'
import { orchestrateMatch } from '../../lib/matching/orchestrator'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockDb,
  mockLoadMatchingJobRequest,
  mockLoadCandidatePool,
  mockFilterEligibleProviders,
  mockScoreAndRankCandidates,
  mockReserveBestProviderAtomically,
  mockDispatchMatchLead,
  mockEmitMatchEvent,
  mockIsEnabled,
} = vi.hoisted(() => ({
  mockDb: {
    assignmentHold: { findFirst: vi.fn() },
    dispatchDecision: { create: vi.fn() },
    jobRequest: { update: vi.fn() },
  },
  mockLoadMatchingJobRequest: vi.fn(),
  mockLoadCandidatePool: vi.fn(),
  mockFilterEligibleProviders: vi.fn(),
  mockScoreAndRankCandidates: vi.fn(),
  mockReserveBestProviderAtomically: vi.fn(),
  mockDispatchMatchLead: vi.fn(),
  mockEmitMatchEvent: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/service', () => ({ loadMatchingJobRequest: mockLoadMatchingJobRequest }))
vi.mock('../../lib/matching/candidate-pool', () => ({ loadCandidatePool: mockLoadCandidatePool }))
vi.mock('../../lib/matching/filter', () => ({ filterEligibleProviders: mockFilterEligibleProviders }))
vi.mock('../../lib/matching/scoring', () => ({ scoreAndRankCandidates: mockScoreAndRankCandidates }))
vi.mock('../../lib/matching/reservation', () => ({ reserveBestProviderAtomically: mockReserveBestProviderAtomically }))
vi.mock('../../lib/matching/dispatch', () => ({ dispatchMatchLead: mockDispatchMatchLead }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJobRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'OPEN',
    category: 'electrical',
    assignmentMode: 'AUTO_ASSIGN',
    address: { suburb: 'Sandton', regionKey: 'gauteng', provinceKey: 'GP' },
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
    availabilityState: 'available',
    completedJobsCount: 42,
    onTimeRate: 0.92,
    acceptanceRate: 0.88,
    complaintCount: 1,
    complaintRate: 0.02,
    cancellationRate: 0.05,
    punctualityScore: 0.9,
    lastKnownLocationAt: new Date(),
    technicianSkills: [],
    technicianCertifications: [],
    technicianServiceAreas: [],
    technicianAvailability: null,
    scheduleItems: [],
    schedule: [],
    adminCertifications: [],
    equipment: [],
  }
}

function makeHold(jobRequestId = 'job-1', providerId = 'provider-1') {
  return {
    id: 'hold-1',
    jobRequestId,
    providerId,
    status: 'ACTIVE',
    offeredAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('orchestrateMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(false)
    mockDb.assignmentHold.findFirst.mockResolvedValue(null)
    mockDb.dispatchDecision.create.mockResolvedValue({ id: 'decision-1' })
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDispatchMatchLead.mockResolvedValue(undefined)
    mockEmitMatchEvent.mockReturnValue(undefined)
  })

  // ── SKIP paths ──────────────────────────────────────────────────────────────

  it('returns SKIP when job is not found', async () => {
    mockLoadMatchingJobRequest.mockRejectedValue(new Error('not found'))

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('JOB_NOT_FOUND')
  })

  it('returns SKIP when job has no address', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest({ address: null }))

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('NO_ADDRESS')
  })

  it('returns SKIP when job is not OPEN', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest({ status: 'MATCHING' }))

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('JOB_STATUS_MATCHING')
  })

  it('returns SKIP when an active hold already exists', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockDb.assignmentHold.findFirst.mockResolvedValue({ id: 'existing-hold' })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('SKIP')
    expect((result as any).reason).toBe('ALREADY_HELD')
  })

  // ── NO_MATCH paths ──────────────────────────────────────────────────────────

  it('returns NO_MATCH when candidate pool is empty', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([])
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [], filteredOut: [] })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('NO_MATCH')
    expect((result as any).consideredCount).toBe(0)
    expect(mockDispatchMatchLead).not.toHaveBeenCalled()
  })

  it('returns NO_MATCH when all candidates are filtered out', async () => {
    const candidate = makeCandidate()
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([candidate])
    mockFilterEligibleProviders.mockResolvedValue({
      eligible: [],
      filteredOut: [{ providerId: 'provider-1', filteredReasonCodes: ['NO_AREA_COVERAGE'] }],
    })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('NO_MATCH')
    expect((result as any).filteredOut).toHaveLength(1)
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.no_providers' })
    )
  })

  it('returns NO_MATCH when all top-5 reservations fail', async () => {
    const candidates = [1, 2, 3, 4, 5].map((n) => makeEligibleCandidate(`provider-${n}`))
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue(candidates)
    mockFilterEligibleProviders.mockResolvedValue({ eligible: candidates, filteredOut: [] })
    mockScoreAndRankCandidates.mockReturnValue(
      candidates.map((c, i) => ({ providerId: c.id, score: 1 - i * 0.1, rank: i + 1 }))
    )
    mockReserveBestProviderAtomically.mockResolvedValue({ ok: false, reason: 'PROVIDER_LOCKED' })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('NO_MATCH')
    expect(mockReserveBestProviderAtomically).toHaveBeenCalledTimes(5)
    // Emits reservation.failed for each locked attempt
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reservation.failed' })
    )
  })

  // ── DISPATCHED path ─────────────────────────────────────────────────────────

  it('returns DISPATCHED on successful match', async () => {
    const candidate = makeEligibleCandidate()
    const hold = makeHold()
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([candidate])
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [candidate], filteredOut: [] })
    mockScoreAndRankCandidates.mockReturnValue([{ providerId: 'provider-1', score: 0.9, rank: 1 }])
    mockReserveBestProviderAtomically.mockResolvedValue({ ok: true, hold, provider: candidate })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(result.status).toBe('DISPATCHED')
    expect((result as any).holdId).toBe('hold-1')
    expect((result as any).providerId).toBe('provider-1')
    expect(mockDispatchMatchLead).toHaveBeenCalledOnce()
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.dispatched', holdId: 'hold-1' })
    )
  })

  // ── Retry on reservation failure ────────────────────────────────────────────

  it('falls through to second candidate when first reservation fails', async () => {
    const c1 = makeEligibleCandidate('provider-1')
    const c2 = makeEligibleCandidate('provider-2')
    const hold = makeHold('job-1', 'provider-2')
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([c1, c2])
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [c1, c2], filteredOut: [] })
    mockScoreAndRankCandidates.mockReturnValue([
      { providerId: 'provider-1', score: 0.95, rank: 1 },
      { providerId: 'provider-2', score: 0.85, rank: 2 },
    ])
    mockReserveBestProviderAtomically
      .mockResolvedValueOnce({ ok: false, reason: 'AT_CAPACITY' })
      .mockResolvedValueOnce({ ok: true, hold, provider: c2 })

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('DISPATCHED')
    expect((result as any).providerId).toBe('provider-2')
    expect(mockReserveBestProviderAtomically).toHaveBeenCalledTimes(2)
  })

  // ── Feature flag — candidate pool toggle ────────────────────────────────────

  it('passes usePool=true when matching.v2.candidate_pool flag is on', async () => {
    const candidate = makeEligibleCandidate()
    const hold = makeHold()
    mockIsEnabled.mockResolvedValue(true)
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([candidate])
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [candidate], filteredOut: [] })
    mockScoreAndRankCandidates.mockReturnValue([{ providerId: 'provider-1', score: 0.9, rank: 1 }])
    mockReserveBestProviderAtomically.mockResolvedValue({ ok: true, hold, provider: candidate })

    await orchestrateMatch('job-1', { triggeredBy: 'job_creation' })

    expect(mockLoadCandidatePool).toHaveBeenCalledWith(expect.objectContaining({ usePool: true }))
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  it('returns ERROR status when an unexpected exception is thrown', async () => {
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockRejectedValue(new Error('DB connection timeout'))

    const result = await orchestrateMatch('job-1', { triggeredBy: 'cron' })

    expect(result.status).toBe('ERROR')
    expect((result as any).error).toContain('DB connection timeout')
  })

  // ── triggeredBy propagation ─────────────────────────────────────────────────

  it('records audit trail with the correct triggeredBy', async () => {
    const candidate = makeEligibleCandidate()
    const hold = makeHold()
    mockLoadMatchingJobRequest.mockResolvedValue(makeJobRequest())
    mockLoadCandidatePool.mockResolvedValue([candidate])
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [candidate], filteredOut: [] })
    mockScoreAndRankCandidates.mockReturnValue([{ providerId: 'provider-1', score: 0.9, rank: 1 }])
    mockReserveBestProviderAtomically.mockResolvedValue({ ok: true, hold, provider: candidate })

    await orchestrateMatch('job-1', { triggeredBy: 'manual' })

    // The orchestrator writes an idempotency key that includes triggeredBy
    expect(mockDb.dispatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: expect.stringContaining('manual'),
        }),
      })
    )
  })
})
