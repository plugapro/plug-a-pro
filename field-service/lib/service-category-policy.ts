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

export type ServiceRiskLevel = 'standard' | 'high_risk' | 'regulated'

export type ServiceComplianceRequirement = {
  serviceKey: string
  label: string
  riskLevel: ServiceRiskLevel
  certificationRecommended: boolean
  certificationRequiredForApproval?: boolean
  blocksAutoApproval?: boolean
  evidencePrompt: string
}

export const SERVICE_COMPLIANCE_REQUIREMENTS: Record<string, ServiceComplianceRequirement> = {
  electrical: {
    serviceKey: 'electrical',
    label: 'Electrical',
    riskLevel: 'regulated',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Because you selected Electrical, please upload proof of your electrical certification, licence, or trade qualification if you have it. This helps our review team assess your application.',
  },
  pest_control: {
    serviceKey: 'pest_control',
    label: 'Pest Control',
    riskLevel: 'regulated',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Pest Control work may require certification. Please add any certificate, licence, qualification, or reference proof you have.',
  },
  air_conditioning: {
    serviceKey: 'air_conditioning',
    label: 'Air Conditioning',
    riskLevel: 'high_risk',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Air Conditioning and refrigeration work can require specialist proof. Please add any relevant certificate, licence, or qualification you have.',
  },
  roofing: {
    serviceKey: 'roofing',
    label: 'Roofing',
    riskLevel: 'high_risk',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Roofing and working-at-heights jobs are higher risk. Please add proof of relevant experience, references, or safety training if you have it.',
  },
}

export const CATEGORY_POLICIES: Record<string, CategoryPolicy> = {
  plumbing: {
    normalizedCategory: 'plumbing',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
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
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  handyman: {
    normalizedCategory: 'handyman',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  appliances: {
    normalizedCategory: 'appliances',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  'diy & assembly': {
    normalizedCategory: 'diy & assembly',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  roofing: {
    normalizedCategory: 'roofing',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  cleaning: {
    normalizedCategory: 'cleaning',
    bookingOnAssignment: true,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  tiling: {
    normalizedCategory: 'tiling',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  pest_control: {
    normalizedCategory: 'pest_control',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  carpentry: {
    normalizedCategory: 'carpentry',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  waterproofing: {
    normalizedCategory: 'waterproofing',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  air_conditioning: {
    normalizedCategory: 'air_conditioning',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
  // "Other" is a UI-level escape hatch only. The stored category is always
  // the closest real tag the client selected — this entry guards against
  // the literal string 'other' ever reaching the matching engine.
  other: {
    normalizedCategory: 'other',
    bookingOnAssignment: false,
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    regulated: false,
  },
}

// Map short tag keys used in service-categories.ts to the policy table keys.
// e.g. 'garden' (tag) → 'garden & landscaping' (policy key).
// This prevents bookingOnAssignment from silently falling back to false
// when the job category arrives in tag form rather than label form.
const TAG_ALIAS_TO_POLICY_KEY: Record<string, string> = {
  'garden': 'garden & landscaping',
  'diy': 'diy & assembly',
}

const COMPLIANCE_LABEL_TO_KEY: Record<string, string> = {
  'garden & landscaping': 'garden',
  'garden and landscaping': 'garden',
  'diy & assembly': 'diy',
  'diy and assembly': 'diy',
  'pest control': 'pest_control',
  'air conditioning': 'air_conditioning',
}

function normalizeCategory(input: string) {
  return input.trim().toLowerCase()
}

function normalizeComplianceKey(input: string) {
  const normalized = normalizeCategory(input)
  return COMPLIANCE_LABEL_TO_KEY[normalized] ?? normalized.replace(/[\s-]+/g, '_')
}

export function getCategoryPolicy(category: string): CategoryPolicy {
  const normalized = normalizeCategory(category)
  // Resolve tag alias (e.g. 'garden' → 'garden & landscaping') before lookup.
  const policyKey = TAG_ALIAS_TO_POLICY_KEY[normalized] ?? normalized
  return (
    CATEGORY_POLICIES[policyKey] ?? {
      normalizedCategory: normalized,
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

export function getServiceComplianceRequirement(category: string): ServiceComplianceRequirement {
  const key = normalizeComplianceKey(category)
  return (
    SERVICE_COMPLIANCE_REQUIREMENTS[key] ?? {
      serviceKey: key,
      label: category.trim() || key,
      riskLevel: 'standard',
      certificationRecommended: false,
      certificationRequiredForApproval: false,
      blocksAutoApproval: false,
      evidencePrompt: '',
    }
  )
}

export function getHighRiskServiceRequirements(categories: string[]): ServiceComplianceRequirement[] {
  const seen = new Set<string>()
  const requirements: ServiceComplianceRequirement[] = []
  for (const category of categories) {
    const requirement = getServiceComplianceRequirement(category)
    if (requirement.riskLevel === 'standard' || seen.has(requirement.serviceKey)) continue
    seen.add(requirement.serviceKey)
    requirements.push(requirement)
  }
  return requirements
}

export function hasHighRiskServiceSelection(categories: string[]) {
  return getHighRiskServiceRequirements(categories).length > 0
}

export function hasAutoApprovalBlockingServiceSelection(categories: string[]) {
  return getHighRiskServiceRequirements(categories).some((requirement) => requirement.blocksAutoApproval)
}

export type { CategoryPolicy }
