// DISCLAIMER: Plug A Pro is a marketplace platform that connects customers with independent
// service providers. Plug A Pro does not verify, guarantee, or take responsibility for
// ensuring that providers hold any trade certifications, licences, or regulatory approvals
// required by law for a given category of work (including but not limited to wireman's
// licences for electrical work). It is the responsibility of the customer and the provider
// to satisfy themselves that all applicable legal and safety requirements are met before
// work commences. Plug A Pro expressly disclaims any liability arising from work performed
// without the required certifications.

type CategoryPolicy = {
  normalizedCategory: string
  bookingOnAssignment: boolean
  requiredCertificationCodes: string[]
  requiredEquipmentTags: string[]
  requiredVehicleTypes: string[]
  regulated: boolean
}

export const CATEGORY_POLICIES: Record<string, CategoryPolicy> = {
  plumbing: {
    normalizedCategory: 'plumbing',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['plumbing-kit'],
    requiredVehicleTypes: [],
    regulated: false,
  },
  electrical: {
    normalizedCategory: 'electrical',
    bookingOnAssignment: false,
    // Certification and equipment requirements relaxed — providers are not blocked from
    // receiving leads for lacking a wireman's licence or multimeter. Plug A Pro does not
    // take responsibility for verifying regulatory compliance; see disclaimer above.
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: true,
  },
  painting: {
    normalizedCategory: 'painting',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  'garden & landscaping': {
    normalizedCategory: 'garden & landscaping',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['garden-tools'],
    requiredVehicleTypes: [],
    regulated: false,
  },
  handyman: {
    normalizedCategory: 'handyman',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['basic-toolkit'],
    requiredVehicleTypes: [],
    regulated: false,
  },
  appliances: {
    normalizedCategory: 'appliances',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['multimeter'],
    requiredVehicleTypes: [],
    regulated: false,
  },
  'diy & assembly': {
    normalizedCategory: 'diy & assembly',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['basic-toolkit'],
    requiredVehicleTypes: [],
    regulated: false,
  },
  roofing: {
    normalizedCategory: 'roofing',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['ladder'],
    requiredVehicleTypes: ['bakkie', 'van'],
    regulated: false,
  },
  cleaning: {
    normalizedCategory: 'cleaning',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: ['cleaning-kit'],
    requiredVehicleTypes: [],
    regulated: false,
  },
}

function normalizeCategory(input: string) {
  return input.trim().toLowerCase()
}

export function getCategoryPolicy(category: string): CategoryPolicy {
  return (
    CATEGORY_POLICIES[normalizeCategory(category)] ?? {
      normalizedCategory: normalizeCategory(category),
      bookingOnAssignment: false,
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      regulated: false,
    }
  )
}

export function listCategoryPolicies(): CategoryPolicy[] {
  return Object.values(CATEGORY_POLICIES).map((policy) => ({
    ...policy,
    requiredCertificationCodes: [...policy.requiredCertificationCodes],
    requiredEquipmentTags: [...policy.requiredEquipmentTags],
    requiredVehicleTypes: [...policy.requiredVehicleTypes],
  }))
}

export function mergeCategoryRequirements(params: {
  category: string
  requiredCertificationCodes?: string[]
  requiredEquipmentTags?: string[]
  requiredVehicleTypes?: string[]
}) {
  const policy = getCategoryPolicy(params.category)

  const mergeUnique = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))]

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
}

export type { CategoryPolicy }
