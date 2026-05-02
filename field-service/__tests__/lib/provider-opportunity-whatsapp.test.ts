import { describe, expect, it } from 'vitest'
import { parseProviderOpportunityArrivalText } from '../../lib/provider-opportunity-whatsapp'

describe('provider opportunity WhatsApp helpers', () => {
  it('parses common WhatsApp arrival phrases', () => {
    const now = new Date('2026-05-02T08:00:00.000Z')

    expect(parseProviderOpportunityArrivalText('today afternoon', now)?.toISOString()).toBe('2026-05-02T12:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('tomorrow morning', now)?.toISOString()).toBe('2026-05-03T07:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('tomorrow evening', now)?.toISOString()).toBe('2026-05-03T15:00:00.000Z')
  })

  it('accepts exact date input and rejects unclear text', () => {
    expect(parseProviderOpportunityArrivalText('2026-05-03T09:00:00+02:00')?.toISOString()).toBe('2026-05-03T07:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('soon please')).toBeNull()
  })
})
