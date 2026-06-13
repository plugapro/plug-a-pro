// __tests__/lib/provider-categories.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    provider: { findUnique: vi.fn() },
    category: { findUnique: vi.fn(), findMany: vi.fn() },
    providerCategory: { findMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    auditLog: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@prisma/client', () => ({
  CategoryRiskTier: { LOW: 'LOW', STANDARD: 'STANDARD' },
}))

import {
  resolveInitialApprovalStatus,
  autoApproveLowRiskCategories,
  autoApproveProvidersForCategory,
  reconcileProviderCategoriesForSkills,
} from '@/lib/provider-categories'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) {
      return Promise.all(ops)
    }
    return (ops as () => unknown)()
  })
  mockDb.auditLog.createMany.mockResolvedValue({ count: 0 })
  mockDb.providerCategory.updateMany.mockResolvedValue({ count: 0 })
  mockDb.providerCategory.createMany.mockResolvedValue({ count: 0 })
})

// ─── resolveInitialApprovalStatus ────────────────────────────────────────────

describe('resolveInitialApprovalStatus', () => {
  it('returns APPROVED for an ACTIVE provider with a LOW-risk category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'LOW' })

    const result = await resolveInitialApprovalStatus('prov-1', 'garden')

    expect(result).toBe('APPROVED')
  })

  it('returns PENDING_REVIEW for an ACTIVE provider with a STANDARD category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'STANDARD' })

    const result = await resolveInitialApprovalStatus('prov-1', 'plumbing')

    expect(result).toBe('PENDING_REVIEW')
  })

  it('returns PENDING_REVIEW for a non-ACTIVE provider even with LOW-risk category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'APPLICATION_PENDING' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'LOW' })

    const result = await resolveInitialApprovalStatus('prov-1', 'garden')

    expect(result).toBe('PENDING_REVIEW')
  })

  it('returns PENDING_REVIEW when no Category row exists (unknown slug = STANDARD)', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue(null)

    const result = await resolveInitialApprovalStatus('prov-1', 'unknown-service')

    expect(result).toBe('PENDING_REVIEW')
  })
})

// ─── autoApproveLowRiskCategories ─────────────────────────────────────────────

describe('autoApproveLowRiskCategories', () => {
  it('approves only LOW-risk pending rows, leaves STANDARD rows untouched', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'garden' },
      { id: 'pc-2', categorySlug: 'plumbing' },
    ])
    mockDb.category.findMany.mockResolvedValue([
      { slug: 'garden' }, // only garden is LOW
    ])

    await autoApproveLowRiskCategories('prov-1')

    // The transaction receives the updateMany and createMany calls
    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    const [ops] = mockDb.$transaction.mock.calls[0]
    // First op should be updateMany with only the LOW-risk row
    expect(mockDb.providerCategory.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pc-1'] } },
      data: { approvalStatus: 'APPROVED' },
    })
    expect(mockDb.providerCategory.updateMany).toHaveBeenCalledOnce()
  })

  it('writes AuditLog entries via $transaction', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'garden' },
      { id: 'pc-2', categorySlug: 'cleaning' },
    ])
    mockDb.category.findMany.mockResolvedValue([
      { slug: 'garden' },
      { slug: 'cleaning' },
    ])

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(mockDb.auditLog.createMany).toHaveBeenCalledOnce()
    const { data } = mockDb.auditLog.createMany.mock.calls[0][0]
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      entityId: 'pc-1',
      after: expect.objectContaining({ reason: 'LOW_RISK_CATEGORY', categorySlug: 'garden' }),
    })
  })

  it('no-ops cleanly when provider has no PENDING_REVIEW rows', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
    expect(mockDb.auditLog.createMany).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('no-ops when all pending rows are STANDARD risk', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'plumbing' },
    ])
    mockDb.category.findMany.mockResolvedValue([]) // no LOW-risk matches

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})

// ─── autoApproveProvidersForCategory ─────────────────────────────────────────

describe('autoApproveProvidersForCategory', () => {
  it("approves all ACTIVE providers' PENDING_REVIEW rows for the given slug", async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', providerId: 'prov-1' },
      { id: 'pc-2', providerId: 'prov-2' },
    ])

    const count = await autoApproveProvidersForCategory('garden')

    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(mockDb.providerCategory.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pc-1', 'pc-2'] } },
      data: { approvalStatus: 'APPROVED' },
    })
    expect(count).toBe(2)
  })

  it('writes AuditLog entries with CATEGORY_RISK_TIER_CHANGED_TO_LOW reason', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', providerId: 'prov-1' },
    ])

    await autoApproveProvidersForCategory('garden')

    expect(mockDb.auditLog.createMany).toHaveBeenCalledOnce()
    const { data } = mockDb.auditLog.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      after: expect.objectContaining({ reason: 'CATEGORY_RISK_TIER_CHANGED_TO_LOW', categorySlug: 'garden' }),
    })
  })

  it('returns 0 and skips DB writes when no matching rows exist', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])

    const count = await autoApproveProvidersForCategory('garden')

    expect(count).toBe(0)
    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
    expect(mockDb.auditLog.createMany).not.toHaveBeenCalled()
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})

// ─── reconcileProviderCategoriesForSkills ────────────────────────────────────

describe('reconcileProviderCategoriesForSkills', () => {
  it('creates a PENDING_REVIEW row for a newly added high-risk/standard skill', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([]) // no existing rows
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findMany.mockResolvedValue([{ slug: 'plumbing', id: 'cat-plumb', riskTier: 'STANDARD' }])

    const result = await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['plumbing'])

    expect(mockDb.providerCategory.createMany).toHaveBeenCalledOnce()
    const { data, skipDuplicates } = mockDb.providerCategory.createMany.mock.calls[0][0]
    expect(skipDuplicates).toBe(true)
    expect(data).toEqual([
      expect.objectContaining({
        providerId: 'prov-1',
        categorySlug: 'plumbing',
        categoryId: 'cat-plumb',
        approvalStatus: 'PENDING_REVIEW',
      }),
    ])
    expect(result.created).toEqual([{ categorySlug: 'plumbing', approvalStatus: 'PENDING_REVIEW' }])
  })

  it('creates an APPROVED row for a newly added LOW-risk skill on an ACTIVE provider', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findMany.mockResolvedValue([{ slug: 'garden', id: 'cat-garden', riskTier: 'LOW' }])

    const result = await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['garden'])

    const { data } = mockDb.providerCategory.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({ categorySlug: 'garden', approvalStatus: 'APPROVED' })
    expect(result.created).toEqual([{ categorySlug: 'garden', approvalStatus: 'APPROVED' }])
  })

  it('defaults an unknown slug to PENDING_REVIEW (no Category row)', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findMany.mockResolvedValue([]) // unknown slug

    await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['mystery-trade'])

    const { data } = mockDb.providerCategory.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({ categorySlug: 'mystery-trade', categoryId: null, approvalStatus: 'PENDING_REVIEW' })
  })

  it('never recreates or downgrades a skill that already has a row', async () => {
    // plumbing already APPROVED; only the newly-added geyser should be created
    mockDb.providerCategory.findMany.mockResolvedValue([{ categorySlug: 'plumbing' }])
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findMany.mockResolvedValue([{ slug: 'geyser', id: 'cat-geyser', riskTier: 'STANDARD' }])

    await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['plumbing', 'geyser'])

    const { data } = mockDb.providerCategory.createMany.mock.calls[0][0]
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ categorySlug: 'geyser', approvalStatus: 'PENDING_REVIEW' })
  })

  it('no-ops (no create, no audit) when every skill already has a row', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { categorySlug: 'plumbing' },
      { categorySlug: 'garden' },
    ])

    const result = await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['plumbing', 'garden'])

    expect(mockDb.providerCategory.createMany).not.toHaveBeenCalled()
    expect(mockDb.auditLog.createMany).not.toHaveBeenCalled()
    expect(result.created).toEqual([])
  })

  it('no-ops cleanly for an empty skill list', async () => {
    const result = await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', [])

    expect(mockDb.providerCategory.findMany).not.toHaveBeenCalled()
    expect(mockDb.providerCategory.createMany).not.toHaveBeenCalled()
    expect(result.created).toEqual([])
  })

  it('writes an audit entry for each created row with the actor and resolved status', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findMany.mockResolvedValue([{ slug: 'plumbing', id: 'cat-plumb', riskTier: 'STANDARD' }])

    await reconcileProviderCategoriesForSkills(mockDb, 'prov-1', ['plumbing'], {
      actorId: 'admin-7',
      actorRole: 'admin',
    })

    expect(mockDb.auditLog.createMany).toHaveBeenCalledOnce()
    const { data } = mockDb.auditLog.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({
      actorId: 'admin-7',
      actorRole: 'admin',
      action: 'provider_category.created_on_skill_add',
      entityType: 'ProviderCategory',
      entityId: 'prov-1:plumbing',
      after: expect.objectContaining({ approvalStatus: 'PENDING_REVIEW', categorySlug: 'plumbing' }),
    })
  })
})
