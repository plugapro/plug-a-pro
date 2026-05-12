import { db } from './db'
import { listCategoryPolicies, mergeCategoryRequirements } from './service-category-policy'

type CategoryRequirementsInput = {
  category: string
  requiredCertificationCodes?: string[]
  requiredEquipmentTags?: string[]
  requiredVehicleTypes?: string[]
}

type CategoryRequirementsResult = ReturnType<typeof mergeCategoryRequirements>
export type CategoryAdminRecord = {
  id: string
  slug: string
  label: string
  description: string | null
  active: boolean
  bookingOnAssignment: boolean
  regulated: boolean
  sortOrder: number
  requiredCertifications: Array<{ code: string }>
  requiredEquipment: Array<{ tag: string }>
  requiredVehicleTypes: Array<{ vehicleType: string }>
}

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'P2021' || code === 'P2022'
}

function mergeUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export async function resolveCategoryRequirements(
  params: CategoryRequirementsInput,
): Promise<CategoryRequirementsResult> {
  try {
    const category = await (db as any).category?.findUnique?.({
      where: { slug: params.category.trim().toLowerCase() },
      select: {
        slug: true,
        label: true,
        description: true,
        active: true,
        bookingOnAssignment: true,
        regulated: true,
        requiredCertifications: { select: { code: true } },
        requiredEquipment: { select: { tag: true } },
        requiredVehicleTypes: { select: { vehicleType: true } },
      },
    })

    if (!category) {
      return mergeCategoryRequirements(params)
    }

    const policy = {
      normalizedCategory: category.slug,
      bookingOnAssignment: category.bookingOnAssignment,
      requiredCertificationCodes: category.requiredCertifications.map((entry: { code: string }) => entry.code),
      requiredEquipmentTags: category.requiredEquipment.map((entry: { tag: string }) => entry.tag),
      requiredVehicleTypes: category.requiredVehicleTypes.map(
        (entry: { vehicleType: string }) => entry.vehicleType,
      ),
      regulated: category.regulated,
    }

    return {
      policy,
      requiredCertificationCodes: mergeUnique([
        ...policy.requiredCertificationCodes,
        ...(params.requiredCertificationCodes ?? []),
      ]),
      requiredEquipmentTags: mergeUnique([
        ...policy.requiredEquipmentTags,
        ...(params.requiredEquipmentTags ?? []),
      ]),
      requiredVehicleTypes: mergeUnique([
        ...policy.requiredVehicleTypes,
        ...(params.requiredVehicleTypes ?? []),
      ]),
    }
  } catch (error) {
    // Same defensive policy as listCategoriesForAdmin: any DB-side issue with
    // the Category tables falls through to the static policy file rather than
    // breaking matching. Schema-compat errors (P2021/P2022) used to be the
    // only handled case; broaden to all errors so transient blips don't fail
    // the customer-facing booking flow.
    if (!isSchemaCompatError(error)) {
      console.error('[category-config] resolveCategoryRequirements failed, using policy fallback', error)
    }
    return mergeCategoryRequirements(params)
  }
}

export async function listCategoriesForAdmin(): Promise<CategoryAdminRecord[]> {
  try {
    const categories = await (db as any).category?.findMany?.({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        slug: true,
        label: true,
        description: true,
        active: true,
        bookingOnAssignment: true,
        regulated: true,
        sortOrder: true,
        requiredCertifications: { select: { code: true }, orderBy: { code: 'asc' } },
        requiredEquipment: { select: { tag: true }, orderBy: { tag: 'asc' } },
        requiredVehicleTypes: { select: { vehicleType: true }, orderBy: { vehicleType: 'asc' } },
      },
    })

    if (categories) return categories
  } catch (error) {
    // Never let a Category-table problem crash the admin page. Schema-compat
    // errors (P2021/P2022) already fall through to the legacy policy fallback;
    // anything else (connection blip, missing related-row table, transient
    // Prisma error) is logged and we still render the policy fallback so the
    // operator can read the current effective config and recover.
    console.error('[category-config] listCategoriesForAdmin failed, using policy fallback', error)
  }

  return listCategoryPolicies().map((policy, index) => ({
    id: policy.normalizedCategory,
    slug: policy.normalizedCategory,
    label: policy.normalizedCategory,
    description: null,
    active: true,
    bookingOnAssignment: policy.bookingOnAssignment,
    regulated: policy.regulated,
    sortOrder: index,
    requiredCertifications: policy.requiredCertificationCodes.map((code) => ({ code })),
    requiredEquipment: policy.requiredEquipmentTags.map((tag) => ({ tag })),
    requiredVehicleTypes: policy.requiredVehicleTypes.map((vehicleType) => ({ vehicleType })),
  }))
}
