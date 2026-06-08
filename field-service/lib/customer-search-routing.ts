import { normaliseLocationDisplayName } from './location-format'
import { getPilotServiceCategories, resolveServiceCategoryTag } from './service-categories'

const PILOT_SERVICE_TAGS = new Set(getPilotServiceCategories().map((option) => option.tag))

type CustomerSearchInput = {
  searchTerm?: string | null
  category?: string | null
  area?: string | null
}

function clean(value: string | null | undefined) {
  return value?.trim() ?? ''
}

export function resolvePilotServiceCategoryTag(value: string | null | undefined): string | null {
  const resolved = resolveServiceCategoryTag(clean(value))
  return resolved && PILOT_SERVICE_TAGS.has(resolved) ? resolved : null
}

export function resolveCustomerSearchCategoryTag(input: CustomerSearchInput): string | null {
  return resolvePilotServiceCategoryTag(input.category) ?? resolvePilotServiceCategoryTag(input.searchTerm)
}

export function resolveCustomerRequestServiceId(input: CustomerSearchInput): string | null {
  const categoryTag = resolveCustomerSearchCategoryTag(input)
  if (categoryTag) return categoryTag
  return clean(input.searchTerm) ? 'other' : null
}

export function buildCustomerRequestUrl(input: CustomerSearchInput): string | null {
  const serviceId = resolveCustomerRequestServiceId(input)
  if (!serviceId) return null

  const params = new URLSearchParams()
  const area = clean(input.area)
  const searchTerm = clean(input.searchTerm)
  const category = clean(input.category)
  if (area) params.set('area', area)
  if (searchTerm) params.set('q', searchTerm)
  if (category) params.set('category', category)

  const query = params.toString()
  return `/book/${serviceId}${query ? `?${query}` : ''}`
}

export function formatAreaSearchLabel(area: string | null | undefined): string {
  const value = clean(area)
  if (!value) return 'your area'

  const lastSlugSegment = value.split('__').filter(Boolean).at(-1)
  const readable = lastSlugSegment ? lastSlugSegment.replace(/_/g, ' ') : value
  return normaliseLocationDisplayName(readable) || normaliseLocationDisplayName(value) || 'your area'
}
