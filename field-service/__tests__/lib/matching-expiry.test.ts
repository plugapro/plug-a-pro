import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expireAssignmentOffer, processPendingAssignmentWorkflows } from '../../lib/matching/service'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb, mockEmitMatchEvent } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    assignmentHold: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    matchAttempt: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    dispatchDecision: {
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    jobRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    provider: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    technicianScheduleItem: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    scheduleItem: {
      updateMany: vi.fn(),
    },
  },
  mockEmitMatchEvent: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeActiveHold(overrides: Partial<{
  id: string
  status: string
  expiresAt: Date
  matchAttemptId: string
  dispatchDecisionId: string
  jobRequestId: string
  providerId: string
}> = {}) {
  return {
    id: 'hold-1',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() - 1_000), // already expired
    matchAttemptId: 'attempt-1',
    dispatchDecisionId: 'decision-1',
    jobRequestId: 'job-1',
    providerId: 'provider-1',
    ...overrides,
  }
}

function makeMatchingJobRequest() {
  return {
    id: 'job-1',
    customerId: 'customer-1',
    category: 'electrical',
    title: 'Fix lights',
    description: null,
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 60,
    requiredSkillTags: [],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status: 'MATCHING',
    customer: { id: 'customer-1', name: 'Bob', phone: '+27831234567' },
    address: {
      street: '1 Main St',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      lat: -26.1,
      lng: 28.05,
      locationNodeId: null,
      locationNode: null,
    },
  }
}

function setupBaseTransaction() {
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
    callback(mockDb as any)
  )
  mockDb.assignmentHold.update.mockResolvedValue({})
  mockDb.assignmentHold.updateMany.mockResolvedValue({ count: 0 })
  mockDb.assignmentHold.create.mockResolvedValue({
    id: 'hold-new',
    expiresAt: new Date(Date.now() + 15 * 60_000),
  })
  mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
  mockDb.lead.update.mockResolvedValue({})
  mockDb.lead.upsert.mockResolvedValue({ id: 'lead-new' })
  mockDb.matchAttempt.update.mockResolvedValue({})
  mockDb.technicianScheduleItem.updateMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.create.mockResolvedValue({})
  mockDb.matchAttempt.count.mockResolvedValue(1)
  mockDb.dispatchDecision.update.mockResolvedValue({})
  mockDb.jobRequest.update.mockResolvedValue({})
  // loadMatchingJobRequest inside createOfferForAttempt
  mockDb.jobRequest.findUnique.mockResolvedValue(makeMatchingJobRequest())
  // loadProviderOfferContact inside createOfferForAttempt
  mockDb.provider.findUniqueOrThrow.mockResolvedValue({
    id: 'provider-2', name: 'Bob', phone: '+27829876543',
    availableNow: true, serviceAreas: [], skills: [],
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('expireAssignmentOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupBaseTransaction()
  })

  it('returns expired:false when hold is not found', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(null)

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-unknown' })

    expect(result.expired).toBe(false)
    expect(result.nextOfferedProviderId).toBeNull()
  })

  it('returns expired:false when hold is already resolved (ACCEPTED)', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(
      makeActiveHold({ status: 'ACCEPTED', expiresAt: new Date(Date.now() - 1_000) })
    )

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(false)
  })

  it('returns expired:false when hold has not yet expired', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(
      makeActiveHold({ expiresAt: new Date(Date.now() + 5 * 60_000) })
    )

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(false)
  })

  it('expires the hold and cascades to next ranked candidate', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBe('provider-2')
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.hold_expired', holdId: 'hold-1', cascaded: true })
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.rematch', jobRequestId: 'job-1' })
    )
  })

  it('expires the hold and marks job EXPIRED when no next candidate', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    // No RANKED attempts remaining
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ phone: '+27821234567' })

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBeNull()
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.exhausted', jobRequestId: 'job-1' })
    )
  })

  it('marks lead as EXPIRED in the same transaction as the hold', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignmentHoldId: 'hold-1' }),
        data: expect.objectContaining({ status: 'EXPIRED' }),
      })
    )
  })
})

// ── processPendingAssignmentWorkflows ─────────────────────────────────────────

describe('processPendingAssignmentWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupBaseTransaction()
  })

  it('returns zero counts when no holds are expired', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([])

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(0)
    expect(result.expiredOffers).toBe(0)
    expect(result.reoffered).toBe(0)
  })

  it('processes a single expired hold with no next candidate', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([{ id: 'hold-1' }])
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(1)
    expect(result.expiredOffers).toBe(1)
    expect(result.reoffered).toBe(0)
  })

  it('counts reoffered when cascade succeeds', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([{ id: 'hold-1' }])
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(1)
    expect(result.expiredOffers).toBe(1)
    expect(result.reoffered).toBe(1)
  })

  it('processes multiple expired holds in sequence', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([
      { id: 'hold-1' },
      { id: 'hold-2' },
    ])

    // Both holds are expired but have no next candidate
    mockDb.assignmentHold.findUnique
      .mockResolvedValueOnce(makeActiveHold({ id: 'hold-1' }))
      .mockResolvedValueOnce(makeActiveHold({ id: 'hold-2', providerId: 'provider-2' }))

    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(2)
    expect(result.expiredOffers).toBe(2)
    expect(result.reoffered).toBe(0)
  })
})
