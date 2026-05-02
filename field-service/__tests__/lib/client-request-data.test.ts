import { describe, expect, it } from 'vitest'
import {
  budgetPreferenceFromReply,
  buildRequestRef,
  mapAvailabilityToUrgency,
  providerPreferenceFromReply,
} from '../../lib/client-request-data'

describe('client request data helpers', () => {
  it('maps availability replies to urgency buckets', () => {
    expect(mapAvailabilityToUrgency('avail_asap')).toBe('urgent')
    expect(mapAvailabilityToUrgency('avail_this_week')).toBe('soon')
    expect(mapAvailabilityToUrgency('avail_next_week')).toBe('flexible')
  })

  it('maps provider and budget preferences from WhatsApp replies', () => {
    expect(providerPreferenceFromReply('pref_verified')).toBe('verified_only')
    expect(providerPreferenceFromReply('pref_budget')).toBe('budget_friendly')
    expect(providerPreferenceFromReply(undefined)).toBe('fastest_available')
    expect(budgetPreferenceFromReply('budget_quote')).toBe('quote_first')
    expect(budgetPreferenceFromReply(undefined)).toBe('balanced_value')
  })

  it('builds stable customer-facing request refs', () => {
    expect(buildRequestRef('abc-123-def')).toBe('PAP-ABC123DE')
  })
})
