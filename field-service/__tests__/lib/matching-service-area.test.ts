import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findCandidateProviders } from '../../lib/matching-engine'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    provider: { findMany: vi.fn() },
    jobRequest: { findUnique: vi.fn() },
    lead: { findMany: vi.fn(), create: vi.fn() },
    match: { findUnique: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/matching/service', () => ({
  runAssignmentForJobRequest: vi.fn(),
  acceptAssignmentOffer: vi.fn(),
  rejectAssignmentOffer: vi.fn(),
  processPendingAssignmentWorkflows: vi.fn(),
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: vi.fn(),
}))

vi.mock('../../lib/provider-record', () => ({
  reconcileProviderRecordsFromApplications: vi.fn().mockResolvedValue({ reconciled: 0 }),
}))

// Pin config so tests are not affected by future changes to allowLegacyStringFallback
vi.mock('../../lib/matching/config', () => ({
  MATCHING_CONFIG: {
    offerTtlMinutes: 15,
    retryDelayMinutes: 1,
    staleLocationThresholdHours: 8,
    scheduleBufferMinutes: 15,
    defaultDurationMinutes: 120,
    travel: {
      defaultSpeedKmh: 35,
      minTravelMinutes: 10,
      sameSuburbMinutes: 15,
      sameCityMinutes: 35,
      unknownLocationMinutes: 45,
      crossCityMinutes: 60,
    },
    weights: {
      skillMatch: 0.3,
      scheduleFit: 0.2,
      travelEfficiency: 0.2,
      reliability: 0.15,
      customerPreference: 0.1,
      marginEfficiency: 0.05,
    },
    regionFallbackPenalty: 0.12,
    allowLegacyStringFallback: true,
  },
}))

// Base provider template
function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    phone: '+27821234567',
    availableNow: true,
    skills: ['plumbing'],
    serviceAreas: [],
    technicianServiceAreas: [],
    ...overrides,
  }
}

const BASE_INPUT = {
  category: 'plumbing',
  suburb: 'Sandton',
  city: 'Johannesburg',
  regionKey: 'sandton_region',
}

describe('findCandidateProviders — tiered coverage logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes provider with matching suburbKey (SUBURB_EXACT tier)', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [
          { areaType: 'SUBURB', label: 'Sandton', city: 'Johannesburg', locationNodeId: 'node-1', regionKey: 'sandton_region', suburbKey: 'sandton' },
        ],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('provider-1')
  })

  it('includes provider with matching regionKey but no suburbKey match (REGION_FALLBACK tier)', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [
          // suburbKey doesn't match, but regionKey does
          { areaType: 'REGION', label: 'Sandton Region', city: 'Johannesburg', locationNodeId: 'node-2', regionKey: 'sandton_region', suburbKey: null },
        ],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('provider-1')
  })

  it('excludes provider when structured areas exist but neither suburb nor region matches', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [
          { areaType: 'SUBURB', label: 'Rosebank', city: 'Johannesburg', locationNodeId: 'node-3', regionKey: 'rosebank_region', suburbKey: 'rosebank' },
        ],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(0)
  })

  it('includes provider with no structured areas when legacy serviceAreas string matches suburb (allowLegacyStringFallback=true)', async () => {
    // MATCHING_CONFIG.allowLegacyStringFallback is true in config.ts — no need to mock
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [],
        serviceAreas: ['sandton', 'johannesburg'],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(1)
  })

  it('includes provider when legacy serviceAreas matches city (not suburb)', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [],
        serviceAreas: ['johannesburg'],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(1)
  })

  it('excludes provider with no structured areas when legacy string does not match', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [],
        serviceAreas: ['cape_town', 'atlantic_seaboard'],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(0)
  })

  it('excludes provider with availableNow: false regardless of matching areas', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        availableNow: false,
        technicianServiceAreas: [
          { areaType: 'SUBURB', label: 'Sandton', city: 'Johannesburg', locationNodeId: 'node-1', regionKey: 'sandton_region', suburbKey: 'sandton' },
        ],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(0)
  })

  it('excludes provider without the required skill/category', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        skills: ['electrical', 'painting'], // no plumbing
        technicianServiceAreas: [
          { areaType: 'SUBURB', label: 'Sandton', city: 'Johannesburg', locationNodeId: 'node-1', regionKey: 'sandton_region', suburbKey: 'sandton' },
        ],
      }),
    ])

    const results = await findCandidateProviders(BASE_INPUT)

    expect(results).toHaveLength(0)
  })

  it('handles suburb normalisation — space to underscore for suburbKey lookup', async () => {
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider({
        technicianServiceAreas: [
          { areaType: 'SUBURB', label: 'Sea Point', city: 'Cape Town', locationNodeId: 'node-4', regionKey: 'sea_point_region', suburbKey: 'sea_point' },
        ],
      }),
    ])

    const results = await findCandidateProviders({
      category: 'plumbing',
      suburb: 'Sea Point',
      city: 'Cape Town',
      regionKey: null,
    })

    expect(results).toHaveLength(1)
  })
})
