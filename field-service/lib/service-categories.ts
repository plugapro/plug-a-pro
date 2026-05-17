export type ServiceCategoryOption = {
  tag: string
  label: string
  description: string
}

/**
 * Skills available for provider selection during the current pilot.
 * Regulated or high-compliance trades are excluded until the vetting
 * pipeline is ready for them.
 */
export const PILOT_SKILL_TAGS = new Set([
  'plumbing',
  'painting',
  'garden',
  'handyman',
  'diy',
  'cleaning',
  'tiling',
  'carpentry',
])

/**
 * WhatsApp warning messages sent when a provider tries to add a skill
 * that is known but restricted from the current pilot.
 */
export const RESTRICTED_SKILL_NOTICE: Record<string, string> = {
  electrical:
    '⚡ *Electrical work is not available on Plug A Pro right now.*\n\n' +
    'Electrical services in South Africa require a Certificate of Compliance (COC) issued by a registered electrician. ' +
    'Verifying those credentials takes longer than our standard review — we are not accepting electrical providers during the current pilot.\n\n' +
    'If you also do handyman, plumbing, tiling, carpentry, gardening, or cleaning work, please add those skills from the list.',
  appliances:
    '🔌 *Appliance repairs are not available on Plug A Pro right now.*\n\n' +
    'We are not accepting appliance repair providers during the current pilot.\n\n' +
    'If you do other work such as handyman, carpentry, or plumbing, please add those skills from the list.',
  roofing:
    '🏚️ *Roofing is not available on Plug A Pro right now.*\n\n' +
    'Roofing is a higher-risk trade that requires additional vetting. We are not accepting roofing providers during the current pilot.\n\n' +
    'If you do other work, please add those skills from the list.',
  pest_control:
    '🐛 *Pest Control is not available on Plug A Pro right now.*\n\n' +
    'Pest control requires a registered PCO licence. We are not accepting pest control providers during the current pilot.\n\n' +
    'If you do other work, please add those skills from the list.',
  air_conditioning:
    '❄️ *Air Conditioning services are not available on Plug A Pro right now.*\n\n' +
    'HVAC work requires specialist certification. We are not accepting air conditioning providers during the current pilot.\n\n' +
    'If you do other work, please add those skills from the list.',
  waterproofing:
    '💧 *Waterproofing is not available on Plug A Pro right now.*\n\n' +
    'We are not accepting waterproofing providers during the current pilot.\n\n' +
    'If you do other work, please add those skills from the list.',
}

/** Returns only the skill options available for selection in the current pilot. */
export function getPilotServiceCategories(): ServiceCategoryOption[] {
  return SERVICE_CATEGORY_OPTIONS.filter((o) => PILOT_SKILL_TAGS.has(o.tag))
}

export const SERVICE_CATEGORY_OPTIONS: ServiceCategoryOption[] = [
  {
    tag: 'plumbing',
    label: 'Plumbing',
    description: 'Leaks, installations, drain clearing and more.',
  },
  {
    tag: 'painting',
    label: 'Painting',
    description: 'Interior and exterior painting services.',
  },
  {
    tag: 'garden',
    label: 'Garden & Landscaping',
    description: 'Lawn care, landscaping, and tree trimming.',
  },
  {
    tag: 'handyman',
    label: 'Handyman',
    description: 'General repairs and odd jobs around the home.',
  },
  {
    tag: 'appliances',
    label: 'Appliances',
    description: 'Repairs and installation of home appliances.',
  },
  {
    tag: 'electrical',
    label: 'Electrical',
    description: 'Wiring, fault-finding, and general electrical repairs.',
  },
  {
    tag: 'diy',
    label: 'DIY & Assembly',
    description: 'Flat-pack assembly, shelving, and mounting.',
  },
  {
    tag: 'roofing',
    label: 'Roofing',
    description: 'Roof repairs, waterproofing, and inspections.',
  },
  {
    tag: 'cleaning',
    label: 'Cleaning',
    description: 'Domestic, deep-clean, and post-construction cleaning.',
  },
  {
    tag: 'tiling',
    label: 'Tiling',
    description: 'Floor and wall tiling, grouting, and waterproofing.',
  },
  {
    tag: 'pest_control',
    label: 'Pest Control',
    description: 'Fumigation, rodent control, and pest prevention.',
  },
  {
    tag: 'carpentry',
    label: 'Carpentry',
    description: 'Doors, built-in cupboards, wooden floors, and woodwork.',
  },
  {
    tag: 'waterproofing',
    label: 'Waterproofing',
    description: 'Basement sealing, roof membranes, and wet room treatment.',
  },
  {
    tag: 'air_conditioning',
    label: 'Air Conditioning',
    description: 'AC installation, servicing, and repairs.',
  },
  {
    // "Other" lets clients post jobs that don't fit a specific category.
    // At booking time the UI requires them to pick the closest real category
    // so the matching engine can find a suitable provider.
    tag: 'other',
    label: 'Other',
    description: "Something else? Tell us what you need and we'll find the right person.",
  },
]

const TAG_TO_LABEL = new Map(
  SERVICE_CATEGORY_OPTIONS.map((option) => [option.tag, option.label]),
)

const NORMALIZED_INPUT_TO_TAG = new Map<string, string>()

for (const option of SERVICE_CATEGORY_OPTIONS) {
  const normalizedLabel = option.label.trim().toLowerCase()
  const normalizedTag = option.tag.trim().toLowerCase()
  NORMALIZED_INPUT_TO_TAG.set(normalizedTag, option.tag)
  NORMALIZED_INPUT_TO_TAG.set(normalizedLabel, option.tag)
}

NORMALIZED_INPUT_TO_TAG.set('garden & landscaping', 'garden')
NORMALIZED_INPUT_TO_TAG.set('garden and landscaping', 'garden')
NORMALIZED_INPUT_TO_TAG.set('garden', 'garden')
NORMALIZED_INPUT_TO_TAG.set('diy & assembly', 'diy')
NORMALIZED_INPUT_TO_TAG.set('diy and assembly', 'diy')
NORMALIZED_INPUT_TO_TAG.set('diy', 'diy')

export function resolveServiceCategoryTag(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return NORMALIZED_INPUT_TO_TAG.get(normalized) ?? null
}

export function getServiceCategoryLabel(tag: string): string {
  return TAG_TO_LABEL.get(tag) ?? tag
}

export function normalizeServiceCategorySelections(values: string[]): string[] {
  const tags = new Set<string>()
  for (const value of values) {
    const tag = resolveServiceCategoryTag(value)
    if (tag) tags.add(tag)
  }
  return [...tags]
}

export function labelsFromServiceCategoryTags(tags: string[]): string[] {
  return normalizeServiceCategorySelections(tags).map(getServiceCategoryLabel)
}

export function getServiceCategorySelectionSummary(tags: string[]): string {
  return labelsFromServiceCategoryTags(tags).join(', ')
}
