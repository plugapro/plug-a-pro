import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockProviderFindMany,
  mockAdminAuditEventFindMany,
} = vi.hoisted(() => ({
  mockProviderFindMany: vi.fn(),
  mockAdminAuditEventFindMany: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: { findMany: mockProviderFindMany },
    adminAuditEvent: { findMany: mockAdminAuditEventFindMany },
  },
}))

import { listNudgeCandidates, NUDGE_MARK_SENT_BATCH_CAP } from '@/lib/nudges/queue'

const baseProvider = {
  id: 'p',
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
  updatedAt: new Date('2026-06-01'),
  identityVerifications: [{ assuranceLevel: 'HIGH' as const }],
  applications: [],
}

describe('listNudgeCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuditEventFindMany.mockResolvedValue([])
  })

  it('exposes NUDGE_MARK_SENT_BATCH_CAP default of 200', () => {
    expect(NUDGE_MARK_SENT_BATCH_CAP).toBe(200)
  })

  it('orders R5-plumbing first, then R5, then R4, then PENDING_R1', async () => {
    mockProviderFindMany.mockResolvedValue([
      // R4: 1 missing field (equipmentTags)
      {
        ...baseProvider,
        id: 'r4-painter',
        skills: ['painting'],
        equipmentTags: [],
      },
      // R5: kyc not verified + at least 1 profile gap so it qualifies as a candidate
      {
        ...baseProvider,
        id: 'r5-painter',
        skills: ['painting'],
        kycStatus: 'IN_PROGRESS',
        equipmentTags: [],
      },
      // R5 + plumbing → highest priority
      {
        ...baseProvider,
        id: 'r5-plumber',
        skills: ['plumbing'],
        kycStatus: 'IN_PROGRESS',
        equipmentTags: [],
      },
      // PENDING_R1 (application in review)
      {
        ...baseProvider,
        id: 'pending',
        skills: ['plumbing'],
        status: 'APPLICATION_PENDING',
        applications: [{ status: 'SUBMITTED' }],
        equipmentTags: [],
      },
    ])

    const result = await listNudgeCandidates({})
    const ids = result.map((r) => r.providerId)

    // r5-plumber first, then r5-painter, then r4-painter, then pending
    expect(ids[0]).toBe('r5-plumber')
    expect(ids[1]).toBe('r5-painter')
    expect(ids[2]).toBe('r4-painter')
    expect(ids[3]).toBe('pending')
  })

  it('orders within-tier by oldest last-nudge (nulls first), then oldest updatedAt', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'a-recently-nudged',
        skills: ['plumbing'],
        kycStatus: 'IN_PROGRESS', // R5
        equipmentTags: [],
      },
      {
        ...baseProvider,
        id: 'b-never-nudged',
        skills: ['plumbing'],
        kycStatus: 'IN_PROGRESS', // R5
        equipmentTags: [],
      },
    ])
    mockAdminAuditEventFindMany.mockResolvedValue([
      {
        entityId: 'a-recently-nudged',
        timestamp: new Date('2026-06-05'),
        metadata: {} as any,
      },
    ])

    const result = await listNudgeCandidates({})
    const ids = result.map((r) => r.providerId)

    expect(ids).toEqual(['b-never-nudged', 'a-recently-nudged'])
  })

  it('excludes providers with no missing items (complete profiles)', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'complete',
        skills: ['plumbing'],
        identityVerifications: [{ assuranceLevel: 'HIGH' as const }],
      },
      {
        ...baseProvider,
        id: 'incomplete',
        skills: ['plumbing'],
        equipmentTags: [], // 1 missing field → R4 candidate
      },
    ])

    const result = await listNudgeCandidates({})
    const ids = result.map((r) => r.providerId)

    expect(ids).toEqual(['incomplete'])
  })

  it('filters by suburbSlug when provided', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'in-honeydew',
        equipmentTags: [],
        serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
      },
      {
        ...baseProvider,
        id: 'in-florida',
        equipmentTags: [],
        serviceAreas: ['gauteng__johannesburg__jhb_west__florida'],
      },
    ])

    const result = await listNudgeCandidates({
      suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
    })

    expect(result.map((r) => r.providerId)).toEqual(['in-honeydew'])
  })

  it('filters by tier when provided', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'r5-only',
        kycStatus: 'IN_PROGRESS',
        equipmentTags: [],
      },
      {
        ...baseProvider,
        id: 'r4-only',
        equipmentTags: [],
      },
    ])

    const result = await listNudgeCandidates({ tier: 'R5' })
    expect(result.map((r) => r.providerId)).toEqual(['r5-only'])
  })

  it('includes the rendered missing items label per row', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        ...baseProvider,
        id: 'r4',
        equipmentTags: [],
        payoutVerifiedAt: null,
        kycStatus: 'IN_PROGRESS', // also makes it R5 — pushes 3 missing-field count
        skills: [],
      },
    ])

    const result = await listNudgeCandidates({})

    expect(result).toHaveLength(1)
    expect(result[0].missingItems.length).toBeGreaterThan(0)
    expect(result[0].missingItemsLabel).toContain('skills list')
  })
})
