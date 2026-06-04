// DISCLAIMER: Plug A Pro is a marketplace platform that connects customers with independent
// service providers. Plug A Pro does not verify, guarantee or take responsibility for
// ensuring that providers hold any trade certifications, licences or regulatory approvals
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

function standardRequirement(serviceKey: string, label: string): ServiceComplianceRequirement {
  return {
    serviceKey,
    label,
    riskLevel: 'standard',
    certificationRecommended: false,
    certificationRequiredForApproval: false,
    blocksAutoApproval: false,
    evidencePrompt: '',
  }
}

function highRiskRequirement(
  serviceKey: string,
  label: string,
  evidencePrompt: string,
  certificationRequiredForApproval = false,
): ServiceComplianceRequirement {
  return {
    serviceKey,
    label,
    riskLevel: 'high_risk',
    certificationRecommended: true,
    certificationRequiredForApproval,
    blocksAutoApproval: true,
    evidencePrompt,
  }
}

export const SERVICE_COMPLIANCE_REQUIREMENTS: Record<string, ServiceComplianceRequirement> = {
  plumbing: highRiskRequirement(
    'plumbing',
    'Plumbing',
    'Plumbing work can affect water, drainage and geyser-adjacent systems. Please add any plumbing qualification, trade proof, references or insurance proof you have.',
  ),
  gas: highRiskRequirement(
    'gas',
    'Gas',
    'Gas work is safety-sensitive. Please add any gas installer registration, licence, qualification or trade proof you have.',
    true,
  ),
  geyser: highRiskRequirement(
    'geyser',
    'Geyser',
    'Geyser work is safety-sensitive and may involve plumbing and electrical risk. Please add relevant certification, trade proof, references or insurance proof.',
  ),
  locksmith: highRiskRequirement(
    'locksmith',
    'Locksmith',
    'Locksmith work affects property access and security. Please add trade proof, references, registration or identity-backed business proof.',
  ),
  appliance_repair: highRiskRequirement(
    'appliance_repair',
    'Appliance Repair',
    'Appliance repair can involve electrical and product-safety risk. Please add relevant qualification, manufacturer training, references or trade proof.',
  ),
  painting: standardRequirement('painting', 'painting'),
  garden: standardRequirement('garden', 'garden'),
  handyman: standardRequirement('handyman', 'handyman'),
  appliances: standardRequirement('appliances', 'appliances'),
  diy: standardRequirement('diy', 'diy'),
  cleaning: standardRequirement('cleaning', 'cleaning'),
  tiling: standardRequirement('tiling', 'tiling'),
  carpentry: standardRequirement('carpentry', 'carpentry'),
  waterproofing: standardRequirement('waterproofing', 'waterproofing'),
  plastering: standardRequirement('plastering', 'plastering'),
  rhinoliting: standardRequirement('rhinoliting', 'rhinoliting'),
  other: standardRequirement('other', 'other'),
  electrical: {
    serviceKey: 'electrical',
    label: 'Electrical',
    riskLevel: 'regulated',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Because you selected Electrical, please upload proof of your electrical certification, licence or trade qualification if you have it. This helps our review team assess your application.',
  },
  pest_control: {
    serviceKey: 'pest_control',
    label: 'Pest Control',
    riskLevel: 'regulated',
    certificationRecommended: true,
    certificationRequiredForApproval: true,
    blocksAutoApproval: true,
    evidencePrompt:
      'Pest Control work may require certification. Please add any certificate, licence, qualification or reference proof you have.',
  },
  air_conditioning: highRiskRequirement(
    'air_conditioning',
    'Air Conditioning',
    'Air Conditioning and refrigeration work can require specialist proof. Please add any relevant certificate, licence or qualification you have.',
    true,
  ),
  roofing: highRiskRequirement(
    'roofing',
    'Roofing',
    'Roofing and working-at-heights jobs are higher risk. Please add proof of relevant experience, references or safety training if you have it.',
    true,
  ),
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
    // Certification and equipment requirements relaxed - providers are not blocked from
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
  // the closest real tag the client selected - this entry guards against
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
  'gas installation': 'gas',
  'gas installations': 'gas',
  'gas_installation': 'gas',
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
      riskLevel: 'high_risk',
      certificationRecommended: true,
      certificationRequiredForApproval: false,
      blocksAutoApproval: true,
      evidencePrompt:
        'This service has not been classified yet. Please add trade proof, references or certification so our review team can assess it before approval.',
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
