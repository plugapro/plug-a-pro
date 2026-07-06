import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

import { getProviderMatchabilityReadiness, formatMatchabilityWarning } from '@/lib/matching/readiness'
import { KYC_GRACE_CUTOFF } from '@/lib/matching/kyc-grace'

function baseProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    active: true,
    verified: true,
    status: 'ACTIVE',
    kycStatus: 'VERIFIED',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    skills: ['plumbing'],
    technicianSkills: [{ skillTag: 'plumbing' }],
    technicianServiceAreas: [{ active: true }],
    providerCategories: [],
    ...overrides,
  }
}

function clientWith(provider: Record<string, unknown> | null) {
  return { provider: { findUnique: vi.fn().mockResolvedValue(provider) } }
}

describe('getProviderMatchabilityReadiness', () => {
  beforeEach(() => {
    mockIsEnabled.mockReset().mockResolvedValue(false)
  })

  it('reports a fully-provisioned provider as matchable with all checks passing', async () => {
    const readiness = await getProviderMatchabilityReadiness('prov-1', clientWith(baseProvider()))

    expect(readiness.providerFound).toBe(true)
    expect(readiness.matchable).toBe(true)
    expect(readiness.failReasonCodes).toEqual([])
    expect(readiness.checks.every((c) => c.ok)).toBe(true)
    expect(formatMatchabilityWarning(readiness)).toBeNull()
  })

  it('flags a provider with zero active service areas — the PJ-01 failure mode', async () => {
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(baseProvider({ technicianServiceAreas: [] })),
    )

    expect(readiness.matchable).toBe(false)
    expect(readiness.failReasonCodes).toEqual(['ACTIVE_SERVICE_AREA'])
    expect(formatMatchabilityWarning(readiness)).toBe('ACTIVE_SERVICE_AREA')
  })

  it('flags inactive / unverified / non-ACTIVE providers', async () => {
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(baseProvider({ active: false, verified: false, status: 'APPLICATION_PENDING' })),
    )

    expect(readiness.matchable).toBe(false)
    expect(readiness.failReasonCodes).toEqual(
      expect.arrayContaining(['PROVIDER_ACTIVE', 'PROVIDER_VERIFIED', 'PROVIDER_STATUS_ACTIVE']),
    )
  })

  it('fails KYC when not VERIFIED and grace flag is off', async () => {
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(baseProvider({ kycStatus: 'NOT_STARTED' })),
    )

    expect(readiness.failReasonCodes).toEqual(['KYC_VERIFIED_OR_GRACE'])
  })

  it('admits a pre-cutoff legacy provider under the grace flag (same predicate as the filter)', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(
        baseProvider({
          kycStatus: 'NOT_STARTED',
          createdAt: new Date(KYC_GRACE_CUTOFF.getTime() - 1000),
        }),
      ),
    )

    expect(readiness.failReasonCodes).toEqual([])
    expect(readiness.matchable).toBe(true)
  })

  it('never grandfathers REJECTED KYC even under grace', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(
        baseProvider({
          kycStatus: 'REJECTED',
          createdAt: new Date(KYC_GRACE_CUTOFF.getTime() - 1000),
        }),
      ),
    )

    expect(readiness.failReasonCodes).toEqual(['KYC_VERIFIED_OR_GRACE'])
  })

  it('fails only when EVERY skill category is explicitly blocked (permissive default preserved)', async () => {
    const partiallyBlocked = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(
        baseProvider({
          skills: ['plumbing', 'electrical'],
          providerCategories: [{ categorySlug: 'electrical', approvalStatus: 'PENDING_REVIEW' }],
        }),
      ),
    )
    expect(partiallyBlocked.matchable).toBe(true)

    const fullyBlocked = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(
        baseProvider({
          skills: ['plumbing'],
          providerCategories: [{ categorySlug: 'plumbing', approvalStatus: 'REJECTED' }],
        }),
      ),
    )
    expect(fullyBlocked.matchable).toBe(false)
    expect(fullyBlocked.failReasonCodes).toEqual(['CATEGORY_APPROVAL'])
  })

  it('flags providers with no skills at all', async () => {
    const readiness = await getProviderMatchabilityReadiness(
      'prov-1',
      clientWith(baseProvider({ skills: [], technicianSkills: [] })),
    )

    expect(readiness.failReasonCodes).toEqual(['SKILLS_PRESENT'])
  })

  it('returns providerFound=false for an unknown provider', async () => {
    const readiness = await getProviderMatchabilityReadiness('missing', clientWith(null))

    expect(readiness.providerFound).toBe(false)
    expect(readiness.matchable).toBe(false)
    expect(formatMatchabilityWarning(readiness)).toBeNull()
  })
})
