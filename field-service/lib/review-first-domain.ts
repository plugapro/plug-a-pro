/**
 * review-first-domain.ts
 *
 * Pure helper functions extracted from review-first.ts.
 * No DB calls, no side effects - safe to unit-test directly.
 */

// ---------------------------------------------------------------------------
// Types (minimal parameter shapes; not re-exported to keep this lean)
// ---------------------------------------------------------------------------

type ProviderEligibilityInput = {
  active: boolean
  status: string
  availableNow: boolean
  name: string
  skills: string[]
  serviceAreas: string[]
  technicianServiceAreas: Array<{ active: boolean; label: string | null; city: string | null }>
}

type ServiceAreaLabelInput = {
  serviceAreas: string[]
  technicianServiceAreas: Array<{ active: boolean; label: string | null; city: string | null }>
}

type ProviderCoversAreaInput = {
  serviceAreas: string[]
  technicianServiceAreas: Array<{
    active: boolean
    label: string | null
    city: string | null
    regionKey: string | null
    suburbKey: string | null
    locationNodeId: string | null
  }>
}

type RequestAddressInput = {
  suburb: string
  city: string
  region: string | null
  locationNodeId: string | null
  locationNode: { regionKey: string | null } | null
} | null

type ReviewDisplayAttemptDomain = {
  providerId: string
  provider: ProviderEligibilityInput &
    ProviderCoversAreaInput & {
      skills: string[]
    }
}

type ReviewDisplayRequestDomain = {
  category: string
  leads: Array<{ providerId: string; status: string }>
  address: RequestAddressInput
}

// ---------------------------------------------------------------------------
// Exported pure functions
// ---------------------------------------------------------------------------

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

export function normalizeAreaKey(value: string | null | undefined) {
  return normalize(value).replace(/\s+/g, '_')
}

export function isProviderDisplayEligible(provider: ProviderEligibilityInput) {
  if (!provider.active) return false
  if (provider.status !== 'ACTIVE') return false
  if (!provider.name.trim()) return false
  if (!provider.availableNow) return false
  if (provider.skills.length === 0) return false
  const hasArea = provider.serviceAreas.length > 0 || provider.technicianServiceAreas.some((row) => row.active)
  if (!hasArea) return false
  return true
}

export function pickMainSkill(skills: string[], requestCategory: string) {
  const normalizedRequestCategory = requestCategory.trim().toLowerCase()
  const requestSkill = skills.find((skill) => skill.trim().toLowerCase() === normalizedRequestCategory)
  return requestSkill ?? skills[0] ?? requestCategory
}

export function buildServiceAreaLabel(provider: ServiceAreaLabelInput) {
  const structured = provider.technicianServiceAreas
    .filter((row) => row.active)
    .map((row) => row.label ?? row.city)
    .filter((row): row is string => Boolean(row))
  const zones = [...structured, ...provider.serviceAreas].filter(Boolean)
  return zones[0] ?? null
}

export function toLabourRateText(callOutFee: number | null, hourlyRate: number | null, negotiable: boolean) {
  if (hourlyRate != null) return `from R${Math.round(hourlyRate)}/hr`
  if (callOutFee != null) return `call-out from R${Math.round(callOutFee)}`
  if (negotiable) return 'rate negotiable'
  return null
}

export function filterDisplayableReviewAttempts<T extends ReviewDisplayAttemptDomain>(
  rankedAttempts: T[],
  request: ReviewDisplayRequestDomain,
): T[] {
  const normalizedRequestCategory = normalize(request.category)
  const engagedProviderIds = new Set(
    request.leads
      .filter((lead) => ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED'].includes(lead.status))
      .map((lead) => lead.providerId),
  )

  return rankedAttempts.filter((attempt) => {
    if (engagedProviderIds.has(attempt.providerId)) return false
    if (!isProviderDisplayEligible(attempt.provider)) return false
    if (!providerCoversRequestArea(attempt.provider, { address: request.address })) return false
    if (!attempt.provider.skills.map((skill) => normalize(skill)).includes(normalizedRequestCategory)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// providerCoversRequestArea - exported for use in review-first.ts (line ~791)
// It is pure and lives here so filterDisplayableReviewAttempts can reference it.
// ---------------------------------------------------------------------------

export function providerCoversRequestArea(
  provider: ProviderCoversAreaInput,
  request: { address: RequestAddressInput },
) {
  const suburb = normalize(request.address?.suburb)
  const city = normalize(request.address?.city)
  const region = normalize(request.address?.region) || normalize(request.address?.locationNode?.regionKey)
  const locationNodeId = request.address?.locationNodeId ?? null

  const legacyAreas = new Set(provider.serviceAreas.map((area) => normalize(area)).filter(Boolean))
  if (suburb && legacyAreas.has(suburb)) return true
  if (city && legacyAreas.has(city)) return true
  if (region && legacyAreas.has(region)) return true

  const activeStructuredAreas = provider.technicianServiceAreas.filter((row) => row.active)
  if (locationNodeId && activeStructuredAreas.some((row) => row.locationNodeId === locationNodeId)) return true
  if (suburb && activeStructuredAreas.some((row) => normalizeAreaKey(row.suburbKey) === normalizeAreaKey(suburb))) return true
  if (region && activeStructuredAreas.some((row) => normalize(row.regionKey) === region)) return true
  if (city && activeStructuredAreas.some((row) => normalize(row.city) === city || normalize(row.label) === city)) return true

  return false
}
