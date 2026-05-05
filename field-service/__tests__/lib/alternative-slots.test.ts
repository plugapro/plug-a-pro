import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { findAlternativeSlots } from '../../lib/matching/alternative-slots'
import type { NearMissProvider } from '../../lib/matching/filter'
import type { MatchingJobRequest, MatchingAddress } from '../../lib/matching/types'

// ── Stable probe date ─────────────────────────────────────────────────────────
// Fix "now" so the probe windows are deterministic across timezones.
const NOW = new Date('2026-04-24T08:00:00.000Z')   // Thu 24 Apr 2026 10:00 SAST

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

// ── Mock scheduling module ─────────────────────────────────────────────────────
vi.mock('../../lib/matching/scheduling', () => ({
  buildWorkingWindow: vi.fn(({ schedule, requestStartAt }) => {
    if (!schedule) return null
    const start = new Date(requestStartAt)
    start.setUTCHours(5, 0, 0, 0)   // 7am SAST
    const end = new Date(requestStartAt)
    end.setUTCHours(12, 0, 0, 0)   // 2pm SAST
    return { startAt: start, endAt: end }
  }),
  evaluateScheduleFit: vi.fn(),
  normalizeCommitments: vi.fn(() => []),
  deriveRequestWindow: vi.fn(({ requestedWindowStart, estimatedDurationMinutes }) => {
    const startAt = requestedWindowStart ?? NOW
    return {
      startAt,
      endAt: new Date(startAt.getTime() + (estimatedDurationMinutes ?? 120) * 60_000),
      durationMinutes: estimatedDurationMinutes ?? 120,
    }
  }),
}))

const { evaluateScheduleFit } = await import('../../lib/matching/scheduling')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNearMissProvider(overrides: Partial<NearMissProvider> = {}): NearMissProvider {
  return {
    id: 'prov_001',
    name: 'Alice Plumber',
    phone: '+27821000001',
    skills: ['plumbing'],
    serviceAreas: ['Sandton'],
    maxTravelMinutes: 30,
    reliabilityScore: 0.9,
    averageRating: 4.5,
    active: true,
    verified: true,
    availableNow: true,
    lastKnownLat: -26.1,
    lastKnownLng: 28.0,
    isOnline: true,
    liveLocationLat: null,
    liveLocationLng: null,
    lastHeartbeatAt: null,
    scoreBase: 0.8,
    fromPool: true,
    missReasonCodes: ['WINDOW_NOT_FEASIBLE'],
    schedule: [
      // Works Mon–Fri (dayOfWeek 1–5)
      ...[1, 2, 3, 4, 5].map((d) => ({
        dayOfWeek: d,
        startTime: '07:00',
        endTime: '17:00',
        active: true,
      })),
    ],
    scheduleItems: [],
    technicianAvailability: null,
    technicianServiceAreas: [
      {
        label: 'Sandton',
        city: 'Johannesburg',
        active: true,
        areaType: 'SUBURB',
        lat: -26.1,
        lng: 28.0,
        radiusKm: null,
        locationNodeId: null,
        regionKey: null,
      },
    ],
    dailyAssignedJobs: 0,
    ...overrides,
  }
}

function makeJobRequest(overrides: Partial<MatchingJobRequest> = {}): MatchingJobRequest {
  return {
    id: 'jr_test001',
    category: 'plumbing',
    title: 'Fix leaking tap',
    description: 'Tap in bathroom is leaking.',
    requestedWindowStart: NOW,        // original window is "now" — near-miss failed on this
    requestedWindowEnd: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 120,
    requiredSkillTags: ['plumbing'],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status: 'OPEN',
    expiresAt: null,
    ...overrides,
  }
}

const ADDRESS: MatchingAddress = {
  street: '1 Main St',
  suburb: 'Sandton',
  city: 'Johannesburg',
  province: 'Gauteng',
  lat: -26.1,
  lng: 28.0,
  locationNodeId: null,
  regionKey: null,
  provinceKey: null,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('findAlternativeSlots', () => {
  it('returns empty array when no near-miss providers', () => {
    const slots = findAlternativeSlots({
      nearMissProviders: [],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
    })
    expect(slots).toHaveLength(0)
  })

  it('returns slots where evaluateScheduleFit indicates isAvailable', () => {
    const fakeDate = new Date()
    vi.mocked(evaluateScheduleFit)
      .mockReturnValueOnce({ isAvailable: true, score: 0.9, canMeetWindow: true, estimatedStartAt: fakeDate, estimatedEndAt: fakeDate, travelMinutes: 10, notes: [], conflictingCommitmentIds: [] } as any)
      .mockReturnValue({ isAvailable: false, score: 0, canMeetWindow: false, estimatedStartAt: null, estimatedEndAt: null, travelMinutes: 0, notes: [], conflictingCommitmentIds: [] } as any)

    const slots = findAlternativeSlots({
      nearMissProviders: [makeNearMissProvider()],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
      lookAheadDays: 1,
      maxSlots: 3,
    })

    expect(slots).toHaveLength(1)
    expect(slots[0].band).toBe('morning')
    expect(slots[0].providers).toHaveLength(1)
    expect(slots[0].providers[0].id).toBe('prov_001')
  })

  it('excludes bands where no provider fits', () => {
    vi.mocked(evaluateScheduleFit).mockReturnValue({
      isAvailable: false, score: 0, canMeetWindow: false,
      estimatedStartAt: null, estimatedEndAt: null, travelMinutes: 0, notes: [], conflictingCommitmentIds: [],
    })

    const slots = findAlternativeSlots({
      nearMissProviders: [makeNearMissProvider()],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
    })

    expect(slots).toHaveLength(0)
  })

  it('respects maxSlots cap', () => {
    vi.mocked(evaluateScheduleFit).mockReturnValue({
      isAvailable: true, score: 0.9, canMeetWindow: true,
      estimatedStartAt: new Date(), estimatedEndAt: new Date(), travelMinutes: 10, notes: [], conflictingCommitmentIds: [],
    })

    const slots = findAlternativeSlots({
      nearMissProviders: [makeNearMissProvider()],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
      lookAheadDays: 5,
      maxSlots: 2,
    })

    expect(slots).toHaveLength(2)
  })

  it('generates stable slotKey in {yyyy-MM-dd}:{band} format', () => {
    vi.mocked(evaluateScheduleFit).mockReturnValueOnce({
      isAvailable: true, score: 0.9, canMeetWindow: true,
      estimatedStartAt: new Date(), estimatedEndAt: new Date(), travelMinutes: 10, notes: [], conflictingCommitmentIds: [],
    }).mockReturnValue({
      isAvailable: false, score: 0, canMeetWindow: false,
      estimatedStartAt: null, estimatedEndAt: null, travelMinutes: 0, notes: [], conflictingCommitmentIds: [],
    })

    const slots = findAlternativeSlots({
      nearMissProviders: [makeNearMissProvider()],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
      lookAheadDays: 1,
    })

    expect(slots[0].slotKey).toMatch(/^\d{4}-\d{2}-\d{2}:(morning|afternoon)$/)
    expect(slots[0].probeStartUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
  })

  it('collects multiple providers into a single slot when both are available', () => {
    vi.mocked(evaluateScheduleFit).mockReturnValue({
      isAvailable: true, score: 0.9, canMeetWindow: true,
      estimatedStartAt: new Date(), estimatedEndAt: new Date(), travelMinutes: 10, notes: [], conflictingCommitmentIds: [],
    })

    const provA = makeNearMissProvider({ id: 'prov_a', name: 'Alice', phone: '+27821000001' })
    const provB = makeNearMissProvider({ id: 'prov_b', name: 'Bob', phone: '+27821000002' })

    const slots = findAlternativeSlots({
      nearMissProviders: [provA, provB],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
      lookAheadDays: 1,
      maxSlots: 1,
    })

    expect(slots[0].providers).toHaveLength(2)
    expect(slots[0].providers.map((p) => p.id)).toContain('prov_a')
    expect(slots[0].providers.map((p) => p.id)).toContain('prov_b')
  })

  it('includes provider phone in slot options', () => {
    vi.mocked(evaluateScheduleFit).mockReturnValueOnce({
      isAvailable: true, score: 0.9, canMeetWindow: true,
      estimatedStartAt: new Date(), estimatedEndAt: new Date(), travelMinutes: 10, notes: [], conflictingCommitmentIds: [],
    }).mockReturnValue({
      isAvailable: false, score: 0, canMeetWindow: false,
      estimatedStartAt: null, estimatedEndAt: null, travelMinutes: 0, notes: [], conflictingCommitmentIds: [],
    })

    const slots = findAlternativeSlots({
      nearMissProviders: [makeNearMissProvider({ phone: '+27821999999' })],
      jobRequest: makeJobRequest(),
      requestAddress: ADDRESS,
      lookAheadDays: 1,
    })

    expect(slots[0].providers[0].phone).toBe('+27821999999')
  })
})
