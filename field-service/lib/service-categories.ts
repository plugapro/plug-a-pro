export type ServiceCategoryOption = {
  tag: string
  label: string
  description: string
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
    description: 'Wiring, fault-finding, and compliance certificates.',
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
