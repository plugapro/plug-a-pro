/**
 * Unit tests for the WS-B.1 ProviderCertification and ProviderEquipment
 * check paths in the matching engine.
 *
 * These tests validate the hasRequiredCertifications() and
 * hasRequiredEquipment() logic directly via rankCandidatesForJobRequest(),
 * exercising both the legacy and admin-verified paths.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rankCandidatesForJobRequest } from '../../lib/matching/service'

// ─── Mock wiring ──────────────────────────────────────────────────────────────

const {
  mockDb,
} = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    provider: { findMany: vi.fn() },
    dispatchDecision: {
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    },
    matchAttempt: {
      create: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(),
      findMany: vi.fn(), update: vi.fn(),
    },
    assignmentHold: {
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      findUnique: vi.fn(), findFirst: vi.fn(),
    },
    lead: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    quote: { create: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn(), findMany: vi.fn() },
    technicianScheduleItem: { create: vi.fn(), updateMany: vi.fn() },
    match: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    // WS-B.1 tables (present in this test file)
    providerCertification: { findMany: vi.fn() },
    providerEquipment: { findMany: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp-bot', () => ({ notifyProviderNewJob: vi.fn() }))
vi.mock('../../lib/payments', () => ({ initializeBookingPayment: vi.fn() }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProvider(overrides: object = {}) {
  return {
    id: 'p1',
    name: 'Test Provider',
    phone: '+27800000001',
    active: true,
    verified: true,
    availableNow: true,
    skills: ['PAINTING'],
    serviceAreas: ['Bellville', 'Cape Town'],
    averageRating: 4.5,
    reliabilityScore: 0.9,
    completedJobsCount: 20,
    onTimeRate: 0.9,
    acceptanceRate: 0.85,
    complaintCount: 0,
    complaintRate: 0,
    providerCancellationCount: 0,
    cancellationRate: 0,
    lateArrivalCount: 0,
    punctualityScore: 0.9,
    maxTravelMinutes: 60,
    lastKnownLat: -33.93,
    lastKnownLng: 18.63,
    lastKnownLocationLabel: 'Bellville',
    lastKnownLocationAt: new Date(),
    equipmentTags: [],
    vehicleTypes: [],
    technicianSkills: [],
    technicianCertifications: [],
    technicianServiceAreas: [
      {
        label: 'Bellville',
        city: 'Cape Town',
        active: true,
        areaType: 'SUBURB',
        lat: -33.93,
        lng: 18.63,
        radiusKm: null,
        locationNodeId: null,
        regionKey: 'wc_ct',
      },
    ],
    technicianAvailability: null,
    schedule: [],
    scheduleItems: [],
    matches: [],
    jobs: [],
    status: 'ACTIVE',
    ...overrides,
  }
}

function makeJobRequestRecord(overrides: object = {}) {
  return {
    id: 'jr1',
    customerId: 'cust1',
    category: 'PAINTING',
    title: 'Fix leak',
    description: '',
    status: 'PENDING',
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 60,
    requiredSkillTags: [],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    customer: { id: 'cust1', name: 'Test Customer', phone: '+27800000000' },
    address: {
      street: '1 Test St',
      suburb: 'Bellville',
      city: 'Cape Town',
      province: 'Western Cape',
      lat: -33.93,
      lng: 18.63,
      locationNodeId: null,
      locationNode: null,
    },
    ...overrides,
  }
}

function setupBatchMocks(
  jobRequestOverrides: object = {},
  providers: object[] = [],
  adminCerts: object[] = [],
  adminEquip: object[] = [],
) {
  mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequestRecord(jobRequestOverrides))
  mockDb.provider.findMany.mockResolvedValue(providers)
  mockDb.match.findMany.mockResolvedValue([])
  mockDb.job.findMany.mockResolvedValue([])
  mockDb.dispatchDecision.findMany.mockResolvedValue([])
  mockDb.providerCertification.findMany.mockResolvedValue(adminCerts)
  mockDb.providerEquipment.findMany.mockResolvedValue(adminEquip)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('matching - ProviderCertification (WS-B.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out provider missing both legacy and admin certifications', async () => {
    setupBatchMocks({ requiredCertificationCodes: ['GAS_CERT'] }, [makeProvider()])

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBe(0)
    const filtered = result.filteredOut.find((f) => f.providerId === 'p1')
    expect(filtered).toBeDefined()
    expect(filtered?.filteredReasonCodes).toContain('MISSING_REQUIRED_CERTIFICATION:gas_cert')
  })

  it('accepts provider with verified ProviderCertification matching the required code', async () => {
    setupBatchMocks(
      { requiredCertificationCodes: ['GAS_CERT'] },
      [makeProvider()],
      [{ providerId: 'p1', name: 'GAS_CERT', verifiedAt: new Date() }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBeGreaterThan(0)
    expect(result.candidates.find((c) => c.providerId === 'p1')).toBeDefined()
  })

  it('rejects unverified ProviderCertification (verifiedAt is null)', async () => {
    setupBatchMocks(
      { requiredCertificationCodes: ['GAS_CERT'] },
      [makeProvider()],
      [{ providerId: 'p1', name: 'GAS_CERT', verifiedAt: null }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBe(0)
  })

  it('cert matching is case-insensitive (normalizeTag)', async () => {
    setupBatchMocks(
      { requiredCertificationCodes: ['gas_cert'] },
      [makeProvider()],
      [{ providerId: 'p1', name: 'GAS_CERT', verifiedAt: new Date() }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBeGreaterThan(0)
  })
})

describe('matching - ProviderEquipment (WS-B.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out provider missing both legacy and admin equipment tags', async () => {
    setupBatchMocks({ requiredEquipmentTags: ['drain_snake'] }, [makeProvider()])

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBe(0)
    expect(result.filteredOut.find((f) => f.providerId === 'p1')?.filteredReasonCodes).toContain(
      'MISSING_REQUIRED_EQUIPMENT:drain_snake',
    )
  })

  it('accepts provider with matching active ProviderEquipment label', async () => {
    setupBatchMocks(
      { requiredEquipmentTags: ['drain_snake'] },
      [makeProvider()],
      [],
      [{ providerId: 'p1', label: 'drain_snake', category: null, active: true }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBeGreaterThan(0)
  })

  it('accepts provider when equipment matched via category tag', async () => {
    setupBatchMocks(
      { requiredEquipmentTags: ['drain_snake'] },
      [makeProvider()],
      [],
      [{ providerId: 'p1', label: 'Rothenberger Drain Machine', category: 'drain_snake', active: true }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBeGreaterThan(0)
  })

  it('ignores inactive ProviderEquipment records', async () => {
    setupBatchMocks(
      { requiredEquipmentTags: ['drain_snake'] },
      [makeProvider()],
      [],
      [{ providerId: 'p1', label: 'drain_snake', category: null, active: false }],
    )

    const result = await rankCandidatesForJobRequest('jr1')

    expect(result.eligibleCount).toBe(0)
  })
})
