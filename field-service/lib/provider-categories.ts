// lib/provider-categories.ts
import { db } from '@/lib/db'
import { CategoryRiskTier } from '@prisma/client'

export type CategoryApprovalStatus = 'APPROVED' | 'PENDING_REVIEW'

/**
 * Minimal structural shape of the Prisma client surface used by
 * reconcileProviderCategoriesForSkills, so callers can pass either the
 * singleton `db` or an interactive transaction client.
 */
type ProviderCategoryReconcileClient = {
  providerCategory: {
    findMany: (...args: any[]) => Promise<Array<{ categorySlug: string }>>
    createMany: (...args: any[]) => Promise<unknown>
  }
  provider: { findUnique: (...args: any[]) => Promise<{ status: string } | null> }
  category: {
    findMany: (...args: any[]) => Promise<Array<{ slug: string; id: string; riskTier: CategoryRiskTier }>>
  }
  auditLog: { createMany: (...args: any[]) => Promise<unknown> }
}

/**
 * Ensures every skill in `skillTags` has a provider_categories row. Rows are
 * only ever CREATED for skills with no existing row — existing rows (including
 * APPROVED ones) are never modified or downgraded. New rows use the same
 * initial-status rule as onboarding (resolveInitialApprovalStatus): APPROVED
 * only for an ACTIVE provider + LOW-risk category, otherwise PENDING_REVIEW.
 *
 * This closes the post-approval skill-addition gap: a provider (or admin) who
 * adds a high-risk skill after approval gets a PENDING_REVIEW row, which the
 * matching gate (filter.ts / service.ts) excludes until an admin approves it.
 * Skill removals are intentionally not handled here.
 */
export async function reconcileProviderCategoriesForSkills(
  client: ProviderCategoryReconcileClient,
  providerId: string,
  skillTags: string[],
  opts: { actorId?: string; actorRole?: string } = {},
): Promise<{ created: Array<{ categorySlug: string; approvalStatus: CategoryApprovalStatus }> }> {
  if (skillTags.length === 0) return { created: [] }

  const existing = await client.providerCategory.findMany({
    where: { providerId, categorySlug: { in: skillTags } },
    select: { categorySlug: true },
  })
  const existingSlugs = new Set(existing.map((row) => row.categorySlug))
  const newSlugs = skillTags.filter((slug) => !existingSlugs.has(slug))
  if (newSlugs.length === 0) return { created: [] }

  const [provider, categories] = await Promise.all([
    client.provider.findUnique({ where: { id: providerId }, select: { status: true } }),
    client.category.findMany({
      where: { slug: { in: newSlugs } },
      select: { slug: true, id: true, riskTier: true },
    }),
  ])
  const providerActive = provider?.status === 'ACTIVE'
  const riskBySlug = new Map(categories.map((c) => [c.slug, c.riskTier]))
  const idBySlug = new Map(categories.map((c) => [c.slug, c.id]))

  const created = newSlugs.map((slug) => ({
    categorySlug: slug,
    categoryId: idBySlug.get(slug) ?? null,
    approvalStatus: (providerActive && riskBySlug.get(slug) === CategoryRiskTier.LOW
      ? 'APPROVED'
      : 'PENDING_REVIEW') as CategoryApprovalStatus,
  }))

  await client.providerCategory.createMany({
    data: created.map((row) => ({
      providerId,
      categoryId: row.categoryId,
      categorySlug: row.categorySlug,
      approvalStatus: row.approvalStatus,
    })),
    skipDuplicates: true,
  })

  await client.auditLog.createMany({
    data: created.map((row) => ({
      actorId: opts.actorId ?? 'system',
      actorRole: opts.actorRole ?? 'SYSTEM',
      action: 'provider_category.created_on_skill_add',
      entityType: 'ProviderCategory',
      entityId: `${providerId}:${row.categorySlug}`,
      after: {
        approvalStatus: row.approvalStatus,
        categorySlug: row.categorySlug,
        providerId,
      },
    })),
  })

  return { created: created.map(({ categorySlug, approvalStatus }) => ({ categorySlug, approvalStatus })) }
}

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
