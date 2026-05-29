import { describe, expect, it } from 'vitest'
import {
  budgetPreferenceFromReply,
  buildRequestRef,
  mapAvailabilityToUrgency,
  preferenceLabel,
  providerPreferenceFromReply,
} from '../../lib/client-request-data'

describe('client request data helpers', () => {
  it('maps availability replies to urgency buckets', () => {
    expect(mapAvailabilityToUrgency('avail_asap')).toBe('urgent')
    expect(mapAvailabilityToUrgency('avail_this_week')).toBe('soon')
    expect(mapAvailabilityToUrgency('avail_next_week')).toBe('flexible')
  })

  describe('providerPreferenceFromReply', () => {
    it('maps MVP button IDs to the three internal values', () => {
      expect(providerPreferenceFromReply('pref_money')).toBe('save_money')
      expect(providerPreferenceFromReply('pref_value')).toBe('best_value')
      expect(providerPreferenceFromReply('pref_quality')).toBe('best_quality')
    })

    it('maps legacy button IDs for in-flight conversation continuity', () => {
      expect(providerPreferenceFromReply('pref_budget')).toBe('save_money')
      expect(providerPreferenceFromReply('pref_experienced')).toBe('best_quality')
      expect(providerPreferenceFromReply('pref_rated')).toBe('best_quality')
    })

    it('defaults to best_value for unknown or missing reply IDs', () => {
      expect(providerPreferenceFromReply(undefined)).toBe('best_value')
      expect(providerPreferenceFromReply(null)).toBe('best_value')
      expect(providerPreferenceFromReply('pref_fastest')).toBe('best_value')
      expect(providerPreferenceFromReply('pref_verified')).toBe('best_value')
    })
  })

  describe('preferenceLabel', () => {
    it('returns human-readable labels for MVP values', () => {
      expect(preferenceLabel('save_money')).toBe('Save money')
      expect(preferenceLabel('best_value')).toBe('Best value')
      expect(preferenceLabel('best_quality')).toBe('Best quality')
    })

    it('maps legacy providerPreference values to human-readable labels', () => {
      expect(preferenceLabel('budget_friendly')).toBe('Save money')
      expect(preferenceLabel('fastest_available')).toBe('Best value')
      expect(preferenceLabel('verified_only')).toBe('Best value')
      expect(preferenceLabel('most_experienced')).toBe('Best quality')
      expect(preferenceLabel('best_rated')).toBe('Best quality')
      expect(preferenceLabel('highest_rated')).toBe('Best quality')
    })

    it('maps legacy budgetPreference values to human-readable labels', () => {
      expect(preferenceLabel('balanced_value')).toBe('Best value')
      expect(preferenceLabel('lowest_call_out')).toBe('Save money')
      expect(preferenceLabel('quality_first')).toBe('Best quality')
      expect(preferenceLabel('quote_first')).toBe('Best value')
      expect(preferenceLabel('not_sure')).toBe('Best value')
    })

    it('defaults to Best value for null, undefined or unknown values', () => {
      expect(preferenceLabel(undefined)).toBe('Best value')
      expect(preferenceLabel(null)).toBe('Best value')
      expect(preferenceLabel('')).toBe('Best value')
      expect(preferenceLabel('unknown_value')).toBe('Best value')
    })

    it('never returns a raw snake_case internal value', () => {
      const internalValues = [
        'save_money', 'best_value', 'best_quality',
        'budget_friendly', 'fastest_available', 'verified_only',
        'balanced_value', 'lowest_call_out', 'quality_first',
        'quote_first', 'not_sure', 'most_experienced', 'best_rated',
      ]
      for (const v of internalValues) {
        const label = preferenceLabel(v)
        expect(label).not.toContain('_')
        expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase())
      }
    })
  })

  describe('budgetPreferenceFromReply (legacy)', () => {
    it('maps legacy budget button IDs', () => {
      expect(budgetPreferenceFromReply('budget_quote')).toBe('quote_first')
      expect(budgetPreferenceFromReply('budget_lowest')).toBe('lowest_call_out')
      expect(budgetPreferenceFromReply('budget_quality')).toBe('quality_first')
      expect(budgetPreferenceFromReply('budget_unsure')).toBe('not_sure')
      expect(budgetPreferenceFromReply(undefined)).toBe('balanced_value')
    })
  })

  it('builds stable customer-facing request refs', () => {
    expect(buildRequestRef('abc-123-def')).toBe('PAP-ABC123DE')
  })
})
