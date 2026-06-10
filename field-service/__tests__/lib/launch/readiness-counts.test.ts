import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockProviderFindMany,
  mockGetElectricalReadiness,
} = vi.hoisted(() => ({
  mockProviderFindMany: vi.fn(),
  mockGetElectricalReadiness: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: { findMany: mockProviderFindMany },
  },
}))

vi.mock('@/lib/launch/electrical-readiness', () => ({
  getElectricalReadiness: mockGetElectricalReadiness,
}))

import { loadLaunchReadiness } from '@/lib/launch/readiness-counts'

const baseProvider = {
  id: 'p1',
  verified: true,
  kycStatus: 'VERIFIED',
  status: 'ACTIVE',
  strikes: 0,
  name: 'P',
  phone: '+27821234567',
  email: 'p@example.com',
  payoutVerifiedAt: new Date('2026-01-01'),
  skills: ['plumbing'],
  equipmentTags: ['tools'],
  serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
  identityVerifications: [{ assuranceLevel: 'HIGH', status: 'PASSED' }],
  applications: [],
}

describe('loadLaunchReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetElectricalReadiness.mockResolvedValue({
      ready: false,
      approvedCount: 0,
      threshold: 3,
      shortfall: 3,
    })
  })

  it('returns electrical readiness from the helper', async () => {
    mockProviderFindMany.mockResolvedValue([])

    const result = await loadLaunchReadiness()

    expect(result.electrical).toEqual({
      ready: false,
      approvedCount: 0,
      threshold: 3,
      shortfall: 3,
    })
  })

  it('flags categories with < 3 approved providers as thin coverage', async () => {
    mockProviderFindMany.mockResolvedValue([
      { ...baseProvider, id: 'p1', skills: ['plumbing'] },
      { ...baseProvider, id: 'p2', skills: ['plumbing'] },
      { ...baseProvider, id: 'p3', skills: ['plumbing'] },
      { ...baseProvider, id: 'p4', skills: ['painting'] }, // only 1 painter → thin
      // appliances + carpentry + tiling + handyman all absent → also thin
    ])

    const result = await loadLaunchReadiness()

    // plumbing has 3 — at threshold, not thin
    expect(result.thinCoverageCategories).not.toContain('plumbing')
    expect(result.thinCoverageCategories).toContain('painting')
    expect(result.thinCoverageCategories).toContain('appliances')
    expect(result.thinCoverageCategories).toContain('carpentry')
    expect(result.thinCoverageCategories).toContain('handyman')
    expect(result.thinCoverageCategories).toContain('tiling')
  })

  it('rolls up tier counts across all returned providers', async () => {
    mockProviderFindMany.mockResolvedValue([
      // R1
      { ...baseProvider, id: 'p1' },
      // R5 (no payoutVerifiedAt)
      { ...baseProvider, id: 'p2', payoutVerifiedAt: null },
      // PENDING_R1
      {
        ...baseProvider,
        id: 'p3',
        status: 'APPLICATION_PENDING',
        applications: [{ status: 'SUBMITTED' }],
      },
      // Excluded (banned) — should not appear in tier counts
      { ...baseProvider, id: 'p4', status: 'BANNED' },
    ])

    const result = await loadLaunchReadiness()

    const byTier = Object.fromEntries(result.tierBreakdown.map((t) => [t.tier, t.count]))
    expect(byTier.R1).toBe(1)
    expect(byTier.R5).toBe(1)
    expect(byTier.PENDING_R1).toBe(1)
    expect(byTier.OTHER).toBeUndefined() // excluded providers are dropped entirely
  })

  it('rolls up per-suburb-per-category approved-provider counts', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'p1',
        skills: ['plumbing'],
        serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
      },
      {
        ...baseProvider,
        id: 'p2',
        skills: ['plumbing'],
        serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
      },
      {
        ...baseProvider,
        id: 'p3',
        skills: ['painting'],
        serviceAreas: ['gauteng__johannesburg__jhb_west__florida'],
      },
    ])

    const result = await loadLaunchReadiness()

    const honeydewPlumbing = result.suburbCategoryCounts.find(
      (r) =>
        r.suburbSlug === 'gauteng__johannesburg__jhb_west__honeydew' &&
        r.categorySlug === 'plumbing',
    )
    expect(honeydewPlumbing?.approvedProviderCount).toBe(2)

    const floridaPainting = result.suburbCategoryCounts.find(
      (r) =>
        r.suburbSlug === 'gauteng__johannesburg__jhb_west__florida' &&
        r.categorySlug === 'painting',
    )
    expect(floridaPainting?.approvedProviderCount).toBe(1)
  })
})
