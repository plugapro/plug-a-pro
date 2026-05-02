export const PROVIDER_PREFERENCE_OPTIONS = [
  { value: 'fastest_available', label: 'Fastest available' },
  { value: 'most_experienced', label: 'Most experienced' },
  { value: 'best_rated', label: 'Best rated' },
  { value: 'budget_friendly', label: 'Budget friendly' },
  { value: 'verified_only', label: 'Verified only' },
] as const

export const BUDGET_PREFERENCE_OPTIONS = [
  { value: 'balanced_value', label: 'Balanced value' },
  { value: 'lowest_call_out', label: 'Lowest call-out' },
  { value: 'fixed_budget', label: 'Stay within my budget' },
  { value: 'premium_ok', label: 'Premium provider is okay' },
] as const

export const JOB_TYPE_OPTIONS = [
  { value: 'repair', label: 'Repair' },
  { value: 'installation', label: 'Installation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inspection', label: 'Inspection / quote' },
  { value: 'other', label: 'Other' },
] as const

export const TIME_WINDOW_OPTIONS = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'flexible', label: 'Any time' },
] as const

export type ProviderPreference = (typeof PROVIDER_PREFERENCE_OPTIONS)[number]['value']
export type BudgetPreference = (typeof BUDGET_PREFERENCE_OPTIONS)[number]['value']
export type JobType = (typeof JOB_TYPE_OPTIONS)[number]['value']
export type PreferredTimeWindow = (typeof TIME_WINDOW_OPTIONS)[number]['value']

export type ClientRequestValidationInput = {
  title: string
  description: string
  privacyAcknowledged: boolean
  termsAcknowledged: boolean
}

export type PreferredTimingInput = {
  urgency: 'asap' | 'this_week' | 'flexible'
  preferredDate?: string | null
  preferredTimeWindow: PreferredTimeWindow
  now?: Date
}

// Keep request detail validation in a pure helper so PWA and future WhatsApp draft handlers share the same rules.
export function validateClientRequestDetails(input: ClientRequestValidationInput) {
  const normalizedTitle = input.title.trim().replace(/\s+/g, ' ')

  if (normalizedTitle.length < 6) {
    return 'Please enter a short job title so the provider can identify the work clearly.'
  }

  if (normalizedTitle.length > 120) {
    return 'Job title is too long. Please keep it under 120 characters.'
  }

  if (input.description.trim().length > 1200) {
    return 'Job details are too long. Please keep them under 1200 characters.'
  }

  if (!input.privacyAcknowledged) {
    return 'Please confirm you understand when your contact and exact address are shared.'
  }

  if (!input.termsAcknowledged) {
    return 'Please accept the request terms before submitting.'
  }

  return null
}

// Convert simple customer timing choices into the request window fields already used by matching.
export function resolvePreferredTimingWindow(input: PreferredTimingInput) {
  const now = input.now ?? new Date()

  if (input.preferredDate) {
    const [year, month, day] = input.preferredDate.split('-').map(Number)
    const startHour = input.preferredTimeWindow === 'afternoon' ? 12 : input.preferredTimeWindow === 'evening' ? 16 : 8
    const endHour = input.preferredTimeWindow === 'morning' ? 12 : input.preferredTimeWindow === 'afternoon' ? 17 : 20
    const requestedWindowStart = new Date(year, month - 1, day, startHour, 0, 0, 0)
    const requestedWindowEnd = new Date(year, month - 1, day, endHour, 0, 0, 0)

    return {
      requestedWindowStart,
      requestedWindowEnd,
      requestedArrivalLatest: requestedWindowEnd,
    }
  }

  if (input.urgency === 'asap') {
    return {
      requestedWindowStart: null,
      requestedWindowEnd: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      requestedArrivalLatest: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    }
  }

  if (input.urgency === 'this_week') {
    const withinWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return {
      requestedWindowStart: null,
      requestedWindowEnd: withinWeek,
      requestedArrivalLatest: withinWeek,
    }
  }

  return {
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
  }
}
