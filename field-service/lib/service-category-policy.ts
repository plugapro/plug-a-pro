type CategoryPolicy = {
  normalizedCategory: string
  bookingOnAssignment: boolean
  requiredCertificationCodes: string[]
  requiredEquipmentTags: string[]
  requiredVehicleTypes: string[]
  regulated: boolean
}

const CATEGORY_POLICIES: Record<string, CategoryPolicy> = {
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
    requiredCertificationCodes: ['wireman'],
    requiredEquipmentTags: ['multimeter'],
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
