import { resolveServiceCategoryTag, SERVICE_CATEGORY_OPTIONS } from './service-categories'

export type ServiceCategoryCanonicalizationSource = 'tag' | 'label' | 'pass-through'
export type ServiceCategoryCanonicalizationWarning = 'unmapped_service_category'

export type ServiceCategoryCanonicalizationResult = {
  raw: string
  canonical: string | null
  source: ServiceCategoryCanonicalizationSource
  warning?: ServiceCategoryCanonicalizationWarning
}

const KNOWN_TAGS = new Set(SERVICE_CATEGORY_OPTIONS.map((option) => option.tag))

export function canonicalizeServiceCategoryValue(
  value: string | null | undefined,
): ServiceCategoryCanonicalizationResult {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return {
      raw,
      canonical: null,
      source: 'pass-through',
      warning: 'unmapped_service_category',
    }
  }

  const resolvedTag = resolveServiceCategoryTag(raw)
  if (resolvedTag) {
    return {
      raw,
      canonical: resolvedTag,
      source: KNOWN_TAGS.has(raw) ? 'tag' : 'label',
    }
  }

  return {
    raw,
    canonical: raw,
    source: 'pass-through',
    warning: 'unmapped_service_category',
  }
}

export function canonicalizeServiceCategoryValues(values: string[] | null | undefined): string[] {
  const canonicalValues = new Set<string>()
  for (const value of values ?? []) {
    const canonical = canonicalizeServiceCategoryValue(value).canonical
    if (canonical) canonicalValues.add(canonical)
  }
  return [...canonicalValues]
}

export function countChangedCanonicalValues(before: string[], after: string[]) {
  let count = Math.abs(before.length - after.length)
  const length = Math.min(before.length, after.length)
  for (let index = 0; index < length; index += 1) {
    if (before[index] !== after[index]) count += 1
  }
  return count
}
