// lib/provider-categories.ts
import { db } from '@/lib/db'
import { CategoryRiskTier } from '@prisma/client'

export type CategoryApprovalStatus = 'APPROVED' | 'PENDING_REVIEW'

/**
 * Determines the initial approvalStatus for a new provider_categories row.
 * Returns APPROVED only when the provider is ACTIVE and the category is LOW risk.
 * Falls back to PENDING_REVIEW for any unknown category slug.
 */
export async function resolveInitialApprovalStatus(
  providerId: string,
  categorySlug: string,
): Promise<CategoryApprovalStatus> {
  const [provider, category] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { status: true } }),
    db.category.findUnique({ where: { slug: categorySlug }, select: { riskTier: true } }),
  ])

  if (provider?.status === 'ACTIVE' && category?.riskTier === CategoryRiskTier.LOW) {
    return 'APPROVED'
  }
  return 'PENDING_REVIEW'
}

/**
 * On provider approval: sets all PENDING_REVIEW provider_categories rows for
 * LOW-risk categories to APPROVED. Called after provider status transitions to ACTIVE.
 */
export async function autoApproveLowRiskCategories(providerId: string): Promise<void> {
  const pendingRows = await db.providerCategory.findMany({
    where: { providerId, approvalStatus: 'PENDING_REVIEW' },
    select: { id: true, categorySlug: true },
  })
  if (pendingRows.length === 0) return

  const lowRiskCategories = await db.category.findMany({
    where: {
      slug: { in: pendingRows.map((r) => r.categorySlug) },
      riskTier: CategoryRiskTier.LOW,
    },
    select: { slug: true },
  })
  const lowRiskSlugs = new Set(lowRiskCategories.map((c) => c.slug))
  const toApprove = pendingRows.filter((r) => lowRiskSlugs.has(r.categorySlug))
  if (toApprove.length === 0) return

  await db.$transaction([
    db.providerCategory.updateMany({
      where: { id: { in: toApprove.map((r) => r.id) } },
      data: { approvalStatus: 'APPROVED' },
    }),
    db.auditLog.createMany({
      data: toApprove.map((row) => ({
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: 'provider_category.auto_approved',
        entityType: 'ProviderCategory',
        entityId: row.id,
        after: {
          approvalStatus: 'APPROVED',
          reason: 'LOW_RISK_CATEGORY',
          categorySlug: row.categorySlug,
          providerId,
        },
      })),
    }),
  ])

  console.log('[provider-categories] auto-approved', {
    providerId,
    count: toApprove.length,
    slugs: toApprove.map((r) => r.categorySlug),
  })
}

/**
 * When ops changes a category from STANDARD → LOW: bulk-approves all
 * ACTIVE providers' PENDING_REVIEW rows for this specific slug.
 * Returns the count of rows approved.
 */
export async function autoApproveProvidersForCategory(categorySlug: string): Promise<number> {
  const rows = await db.providerCategory.findMany({
    where: {
      categorySlug,
      approvalStatus: 'PENDING_REVIEW',
      provider: { status: 'ACTIVE' },
    },
    select: { id: true, providerId: true },
  })
  if (rows.length === 0) return 0

  await db.$transaction([
    db.providerCategory.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { approvalStatus: 'APPROVED' },
    }),
    db.auditLog.createMany({
      data: rows.map((row) => ({
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: 'provider_category.auto_approved',
        entityType: 'ProviderCategory',
        entityId: row.id,
        after: {
          approvalStatus: 'APPROVED',
          reason: 'CATEGORY_RISK_TIER_CHANGED_TO_LOW',
          categorySlug,
          providerId: row.providerId,
        },
      })),
    }),
  ])

  console.log('[provider-categories] bulk auto-approved on tier change', {
    categorySlug,
    count: rows.length,
  })

  return rows.length
}
