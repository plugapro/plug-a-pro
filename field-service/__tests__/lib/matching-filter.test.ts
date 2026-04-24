// Tests for cooldown and daily-load filter paths in filterEligibleProviders.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filterEligibleProviders } from '../../lib/matching/filter'
import type { CandidatePoolEntry } from '../../lib/matching/candidate-pool'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
    provider: { findMany: vi.fn() },
    technicianSkill: { findMany: vi.fn() },
    technicianCertification: { findMany: vi.fn() },
    technicianServiceArea: { findMany: vi.fn() },
    technicianAvailability: { findMany: vi.fn() },
    providerSchedule: { findMany: vi.fn() },
    technicianScheduleItem: { findMany: vi.fn() },
    providerCertification: { findMany: vi.fn() },
    providerEquipment: { findMany: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/category-config', () => ({
  resolveCategoryRequirements: vi.fn().mockResolvedValue({
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
  }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidatePoolEntry> = {}): CandidatePoolEntry {
  return {
    id: 'p1',
    name: 'Test Provider',
    phone: '+27800000001',
    active: true,
    verified: true,
    availableNow: true,
    skills: ['electrical'],
    serviceAreas: ['Sandton'],
    reliabilityScore: 0.9,
    averageRating: 4.5,
    maxTravelMinutes: 60,
    lastKnownLat: -26.1,
    lastKnownLng: 28.05,
    lastHeartbeatAt: null,
    isOnline: true,
    liveLocationLat: null,
    liveLocationLng: null,
    scoreBase: 0.8,
    fromPool: false,
    ...overrides,
  }
}

function makeJobRequest() {
  return {
    id: 'job-1',
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
    assignmentMode: 'AUTO_ASSIGN' as const,
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status: 'OPEN' as const,
    address: {
      street: '1 Main St',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      lat: -26.1,
      lng: 28.05,
      locationNodeId: null,
      regionKey: null,
      provinceKey: null,
    },
  }
}

function setupDefaultBatchMocks() {
  // Default: all extra findMany calls return empty arrays
  mockDb.provider.findMany.mockResolvedValue([{
    id: 'p1',
    completedJobsCount: 5,
    onTimeRate: 0.9,
    acceptanceRate: 0.85,
    complaintCount: 0,
    complaintRate: 0,
    cancellationRate: 0,
    punctualityScore: 0.9,
    lastKnownLocationAt: new Date(),
    equipmentTags: [],
    vehicleTypes: [],
  }])
  mockDb.technicianSkill.findMany.mockResolvedValue([
    { providerId: 'p1', skillTag: 'electrical' },
  ])
  mockDb.technicianCertification.findMany.mockResolvedValue([])
  mockDb.technicianServiceArea.findMany.mockResolvedValue([{
    providerId: 'p1',
    label: 'Sandton',
    city: 'Johannesburg',
    active: true,
    areaType: 'SUBURB',
    lat: -26.1,
    lng: 28.05,
    radiusKm: null,
    locationNodeId: null,
    regionKey: null,
  }])
  mockDb.technicianAvailability.findMany.mockResolvedValue([])
  mockDb.providerSchedule.findMany.mockResolvedValue([])
  mockDb.technicianScheduleItem.findMany.mockResolvedValue([])
  mockDb.providerCertification.findMany.mockResolvedValue([])
  mockDb.providerEquipment.findMany.mockResolvedValue([])
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('filterEligibleProviders — cooldown and daily-load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultBatchMocks()
  })

  it('excludes provider with OFFER_COOLDOWN_ACTIVE when they timed out within 12h', async () => {
    // $queryRaw: first call = cooldown (timed-out row present), second = daily jobs (empty)
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ providerId: 'p1' }])   // timedOutRows
      .mockResolvedValueOnce([])                        // dailyJobRows

    const { eligible, filteredOut } = await filterEligibleProviders(
      [makeCandidate()],
      makeJobRequest(),
    )

    expect(eligible).toHaveLength(0)
    const filtered = filteredOut.find((f) => f.providerId === 'p1')
    expect(filtered?.filteredReasonCodes).toContain('OFFER_COOLDOWN_ACTIVE')
  })

  it('does not exclude provider who timed out more than 12h ago', async () => {
    // $queryRaw: cooldown returns empty (outside window), daily jobs empty
    mockDb.$queryRaw
      .mockResolvedValueOnce([])   // timedOutRows — no rows within cooldown window
      .mockResolvedValueOnce([])   // dailyJobRows

    const { eligible, filteredOut } = await filterEligibleProviders(
      [makeCandidate()],
      makeJobRequest(),
    )

    expect(eligible).toHaveLength(1)
    const filtered = filteredOut.find((f) => f.providerId === 'p1')
    expect(filtered).toBeUndefined()
  })

  it('excludes provider with DAILY_MAX_REACHED when dailyJobs >= hardDailyMax', async () => {
    // $queryRaw: cooldown empty, daily jobs = 2 (hardDailyMax is 2)
    mockDb.$queryRaw
      .mockResolvedValueOnce([])                                            // timedOutRows
      .mockResolvedValueOnce([{ providerId: 'p1', cnt: BigInt(2) }])       // dailyJobRows

    const { eligible, filteredOut } = await filterEligibleProviders(
      [makeCandidate()],
      makeJobRequest(),
    )

    expect(eligible).toHaveLength(0)
    const filtered = filteredOut.find((f) => f.providerId === 'p1')
    expect(filtered?.filteredReasonCodes).toContain('DAILY_MAX_REACHED')
  })

  it('includes dailyAssignedJobs in eligible provider', async () => {
    // $queryRaw: cooldown empty, daily jobs = 1 (below hardDailyMax of 2)
    mockDb.$queryRaw
      .mockResolvedValueOnce([])                                            // timedOutRows
      .mockResolvedValueOnce([{ providerId: 'p1', cnt: BigInt(1) }])       // dailyJobRows

    const { eligible } = await filterEligibleProviders(
      [makeCandidate()],
      makeJobRequest(),
    )

    expect(eligible).toHaveLength(1)
    expect(eligible[0].dailyAssignedJobs).toBe(1)
  })
})
