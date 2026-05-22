'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { autoApproveProvidersForCategory } from '@/lib/provider-categories'
import { CategoryRiskTier } from '@prisma/client'

const FLAG = 'admin.crud.categories'
const MUTATION_ROLES = ['ADMIN', 'OWNER'] as const
const DELETE_ROLES = ['OWNER'] as const

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseList(value: string) {
  return [...new Set(
    value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  )]
}

const CategorySchema = z.object({
  slug: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal('')),
  active: z.boolean(),
  regulated: z.boolean(),
  bookingOnAssignment: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  requiredCertifications: z.string().optional().or(z.literal('')),
  requiredEquipment: z.string().optional().or(z.literal('')),
  requiredVehicleTypes: z.string().optional().or(z.literal('')),
})

const CreateCategorySchema = CategorySchema
const UpdateCategorySchema = CategorySchema.extend({
  categoryId: z.string().min(1),
})
const DeleteCategorySchema = z.object({
  categoryId: z.string().min(1),
})

type CreateCategoryInput = z.infer<typeof CreateCategorySchema>
type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>
type DeleteCategoryInput = z.infer<typeof DeleteCategorySchema>

export async function createCategoryAction(input: CreateCategoryInput) {
  const normalizedSlug = normalizeSlug(input.slug)
  const requiredCertifications = input.requiredCertifications ?? ''
  const requiredEquipment = input.requiredEquipment ?? ''
  const requiredVehicleTypes = input.requiredVehicleTypes ?? ''
  if (!normalizedSlug) {
    throw new CrudActionError('VALIDATION', 'Slug must contain at least one alphanumeric character.')
  }

  const result = await crudAction<CreateCategoryInput, { id: string }>({
    entity: 'Category',
    action: 'category.create',
    requiredRole: [...MUTATION_ROLES],
    requiredFlag: FLAG,
    schema: CreateCategorySchema,
    input: {
      ...input,
      slug: normalizedSlug,
      requiredCertifications,
      requiredEquipment,
      requiredVehicleTypes,
    },
    run: async (data, tx) => {
      const existing = await tx.category.findUnique({
        where: { slug: data.slug },
        select: { id: true },
      })

      if (existing) {
        throw new CrudActionError('CONFLICT', `Category slug ${data.slug} already exists.`)
      }

      const category = await tx.category.create({
        data: {
          slug: data.slug,
          label: data.label,
          description: data.description || null,
          active: data.active,
          regulated: data.regulated,
          bookingOnAssignment: data.bookingOnAssignment,
          sortOrder: data.sortOrder,
          requiredCertifications: {
            createMany: {
              data: parseList(data.requiredCertifications ?? '').map((code) => ({ code })),
            },
          },
          requiredEquipment: {
            createMany: {
              data: parseList(data.requiredEquipment ?? '').map((tag) => ({ tag })),
            },
          },
          requiredVehicleTypes: {
            createMany: {
              data: parseList(data.requiredVehicleTypes ?? '').map((vehicleType) => ({ vehicleType })),
            },
          },
        },
        select: { id: true },
      })

      return { id: category.id }
    },
  })

  revalidatePath('/admin/categories')
  return result
}

export async function updateCategoryAction(input: UpdateCategoryInput) {
  const normalizedSlug = normalizeSlug(input.slug)
  const requiredCertifications = input.requiredCertifications ?? ''
  const requiredEquipment = input.requiredEquipment ?? ''
  const requiredVehicleTypes = input.requiredVehicleTypes ?? ''
  if (!normalizedSlug) {
    throw new CrudActionError('VALIDATION', 'Slug must contain at least one alphanumeric character.')
  }

  const result = await crudAction<UpdateCategoryInput, { id: string }>({
    entity: 'Category',
    entityId: input.categoryId,
    action: 'category.update',
    requiredRole: [...MUTATION_ROLES],
    requiredFlag: FLAG,
    schema: UpdateCategorySchema,
    input: {
      ...input,
      slug: normalizedSlug,
      requiredCertifications,
      requiredEquipment,
      requiredVehicleTypes,
    },
    run: async (data, tx) => {
      const category = await tx.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true, slug: true },
      })
      if (!category) {
        throw new CrudActionError('NOT_FOUND', `Category ${data.categoryId} not found.`)
      }

      // Guard: slug is immutable once provider_categories rows reference it
      if (data.slug !== category.slug) {
        const linkedRows = await tx.providerCategory.count({
          where: { categorySlug: category.slug },
        })
        if (linkedRows > 0) {
          throw new CrudActionError(
            'CONFLICT',
            `Slug "${category.slug}" cannot be changed — ${linkedRows} provider category row(s) reference it.`,
          )
        }
      }

      const duplicate = await tx.category.findUnique({
        where: { slug: data.slug },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== data.categoryId) {
        throw new CrudActionError('CONFLICT', `Category slug ${data.slug} already exists.`)
      }

      await tx.category.update({
        where: { id: data.categoryId },
        data: {
          slug: data.slug,
          label: data.label,
          description: data.description || null,
          active: data.active,
          regulated: data.regulated,
          bookingOnAssignment: data.bookingOnAssignment,
          sortOrder: data.sortOrder,
          requiredCertifications: {
            deleteMany: {},
            createMany: {
              data: parseList(data.requiredCertifications ?? '').map((code) => ({ code })),
            },
          },
          requiredEquipment: {
            deleteMany: {},
            createMany: {
              data: parseList(data.requiredEquipment ?? '').map((tag) => ({ tag })),
            },
          },
          requiredVehicleTypes: {
            deleteMany: {},
            createMany: {
              data: parseList(data.requiredVehicleTypes ?? '').map((vehicleType) => ({ vehicleType })),
            },
          },
        },
      })

      return { id: data.categoryId }
    },
  })

  revalidatePath('/admin/categories')
  return result
}

export async function deleteCategoryAction(input: DeleteCategoryInput) {
  const result = await crudAction<DeleteCategoryInput, { id: string }>({
    entity: 'Category',
    entityId: input.categoryId,
    action: 'category.delete',
    requiredRole: [...DELETE_ROLES],
    requiredFlag: FLAG,
    schema: DeleteCategorySchema,
    input,
    run: async (data, tx) => {
      const category = await tx.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true },
      })
      if (!category) {
        throw new CrudActionError('NOT_FOUND', `Category ${data.categoryId} not found.`)
      }

      await tx.category.delete({
        where: { id: data.categoryId },
      })

      return { id: data.categoryId }
    },
  })

  revalidatePath('/admin/categories')
  return result
}

// ─── updateCategoryRiskTier ───────────────────────────────────────────────────

const UpdateCategoryRiskTierSchema = z.object({
  categoryId: z.string().min(1),
  riskTier: z.nativeEnum(CategoryRiskTier),
})

type UpdateRiskTierInput = z.infer<typeof UpdateCategoryRiskTierSchema>

export async function updateCategoryRiskTierAction(input: UpdateRiskTierInput) {
  // Fetch old tier before the transaction so crudAction can write it to AdminAuditEvent.before
  const existing = await db.category.findUnique({
    where: { id: input.categoryId },
    select: { slug: true, riskTier: true },
  })

  const result = await crudAction<UpdateRiskTierInput, { id: string; slug: string; riskTier: string; bulkApproved: number }>({
    entity: 'Category',
    entityId: input.categoryId,
    action: 'category.update_risk_tier',
    requiredRole: ['OWNER'],
    requiredFlag: 'admin.categories.risk_tier',
    schema: UpdateCategoryRiskTierSchema,
    input,
    before: existing ? { riskTier: existing.riskTier } : null,
    run: async (data, tx) => {
      const category = await tx.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true, slug: true, riskTier: true },
      })
      if (!category) {
        throw new CrudActionError('NOT_FOUND', `Category ${data.categoryId} not found.`)
      }
      if (category.riskTier === data.riskTier) {
        return { id: category.id, slug: category.slug, riskTier: category.riskTier as string, bulkApproved: 0 }
      }

      await tx.category.update({
        where: { id: data.categoryId },
        data: { riskTier: data.riskTier },
      })

      return { id: category.id, slug: category.slug, riskTier: data.riskTier as string, bulkApproved: 0 }
    },
  })

  // Bulk-approve all ACTIVE providers' PENDING_REVIEW rows for this slug when downgrading to LOW
  if (result.ok && result.data.riskTier === CategoryRiskTier.LOW && existing?.riskTier !== CategoryRiskTier.LOW) {
    const bulkApproved = await autoApproveProvidersForCategory(result.data.slug)
    revalidatePath('/admin/categories')
    return { ...result, data: { ...result.data, bulkApproved } }
  }

  revalidatePath('/admin/categories')
  return result
}
