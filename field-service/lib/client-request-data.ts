export type ProviderPreference =
  | 'fastest_available'
  | 'most_experienced'
  | 'best_rated'
  | 'budget_friendly'
  | 'verified_only'

export type BudgetPreference =
  | 'lowest_call_out'
  | 'balanced_value'
  | 'quality_first'
  | 'quote_first'
  | 'not_sure'

export function mapAvailabilityToUrgency(availabilityId?: string | null) {
  if (availabilityId === 'avail_asap') return 'urgent'
  if (availabilityId === 'avail_this_week' || availabilityId === 'avail_weekend') return 'soon'
  return 'flexible'
}

export function providerPreferenceFromReply(replyId?: string | null): ProviderPreference {
  if (replyId === 'pref_experienced') return 'most_experienced'
  if (replyId === 'pref_rated') return 'best_rated'
  if (replyId === 'pref_budget') return 'budget_friendly'
  if (replyId === 'pref_verified') return 'verified_only'
  return 'fastest_available'
}

export function budgetPreferenceFromReply(replyId?: string | null): BudgetPreference {
  if (replyId === 'budget_lowest') return 'lowest_call_out'
  if (replyId === 'budget_quality') return 'quality_first'
  if (replyId === 'budget_quote') return 'quote_first'
  if (replyId === 'budget_unsure') return 'not_sure'
  return 'balanced_value'
}

export function buildRequestRef(seed = crypto.randomUUID()) {
  return `PAP-${seed.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`
}
