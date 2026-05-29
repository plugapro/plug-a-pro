// MVP provider-matching preference: three options exposed to customers.
// Internal values are stored verbatim in JobRequest.providerPreference.
export type ProviderPreference = 'save_money' | 'best_value' | 'best_quality'

// Legacy BudgetPreference - kept only for backward-compatible reads of old DB records.
// The budget preference step was removed from the active flow in the MVP simplification.
// New requests no longer populate this field.
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

// Maps WhatsApp button IDs to the MVP ProviderPreference internal value.
// Handles both new MVP button IDs and legacy IDs from in-flight conversations.
export function providerPreferenceFromReply(replyId?: string | null): ProviderPreference {
  // New MVP button IDs
  if (replyId === 'pref_money') return 'save_money'
  if (replyId === 'pref_quality') return 'best_quality'
  if (replyId === 'pref_value') return 'best_value'
  // Legacy IDs - map to closest MVP equivalent for in-flight session continuity
  if (replyId === 'pref_budget') return 'save_money'
  if (replyId === 'pref_experienced' || replyId === 'pref_rated') return 'best_quality'
  // Default: best_value (balanced)
  return 'best_value'
}

// Legacy: maps WhatsApp budget button IDs to internal BudgetPreference values.
// Only used when reading existing in-flight conversations; the budget step is removed from new flows.
export function budgetPreferenceFromReply(replyId?: string | null): BudgetPreference {
  if (replyId === 'budget_lowest') return 'lowest_call_out'
  if (replyId === 'budget_quality') return 'quality_first'
  if (replyId === 'budget_quote') return 'quote_first'
  if (replyId === 'budget_unsure') return 'not_sure'
  return 'balanced_value'
}

// Returns the customer-facing display label for a stored preference value.
// Handles current MVP values and all legacy values so old DB records always render cleanly.
export function preferenceLabel(value?: string | null): string {
  switch (value) {
    // MVP values
    case 'save_money':    return 'Save money'
    case 'best_value':    return 'Best value'
    case 'best_quality':  return 'Best quality'
    // Legacy providerPreference values
    case 'budget_friendly':  return 'Save money'
    case 'most_experienced':
    case 'best_rated':
    case 'highest_rated':
    case 'quality_first':    return 'Best quality'
    case 'fastest_available':
    case 'verified_only':    return 'Best value'
    // Legacy budgetPreference values
    case 'balanced_value':  return 'Best value'
    case 'lowest_call_out': return 'Save money'
    case 'quote_first':
    case 'not_sure':        return 'Best value'
    default:                return 'Best value'
  }
}

export function buildRequestRef(seed = crypto.randomUUID()) {
  return `PAP-${seed.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`
}
