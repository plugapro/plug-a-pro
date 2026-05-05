export type ProviderProfileCompletenessInput = {
  name?: string | null
  phone?: string | null
  email?: string | null
  bio?: string | null
  experience?: string | null
  skills?: string[] | null
  serviceAreas?: string[] | null
  structuredServiceAreaCount?: number
  providerRateCount?: number
  portfolioUrlCount?: number
}

const PROFILE_COMPLETENESS_ITEMS = [
  { id: 'name', label: 'Name' },
  { id: 'phone', label: 'Mobile number' },
  { id: 'services', label: 'Service categories' },
  { id: 'areas', label: 'Work areas' },
  { id: 'experience', label: 'Experience' },
  { id: 'rates', label: 'Rates' },
  { id: 'trust', label: 'Bio or work examples' },
] as const

export function calculateProviderProfileCompleteness(input: ProviderProfileCompletenessInput) {
  const completed = new Set<string>()

  // These checks mirror the fields providers can update in WhatsApp/PWA today.
  if (input.name?.trim()) completed.add('name')
  if (input.phone?.trim()) completed.add('phone')
  if ((input.skills?.length ?? 0) > 0) completed.add('services')
  if ((input.serviceAreas?.length ?? 0) > 0 || (input.structuredServiceAreaCount ?? 0) > 0) completed.add('areas')
  if (input.experience?.trim()) completed.add('experience')
  if ((input.providerRateCount ?? 0) > 0) completed.add('rates')
  if (input.bio?.trim() || (input.portfolioUrlCount ?? 0) > 0) completed.add('trust')

  const missing = PROFILE_COMPLETENESS_ITEMS
    .filter((item) => !completed.has(item.id))
    .map((item) => item.label)

  return {
    completedCount: completed.size,
    totalCount: PROFILE_COMPLETENESS_ITEMS.length,
    percentage: Math.round((completed.size / PROFILE_COMPLETENESS_ITEMS.length) * 100),
    missing,
  }
}
