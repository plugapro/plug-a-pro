import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/messaging-templates'

describe('provider_kyc_nudge template registration', () => {
  it('is registered as a UTILITY template with a matching name', () => {
    const t = TEMPLATES.provider_kyc_nudge
    expect(t.name).toBe('provider_kyc_nudge')
    expect(t.category).toBe('UTILITY')
    expect(t.language).toBe('en_ZA')
  })

  it('keeps the deadline and name as the only body parameters', () => {
    const params = t => [...t.example.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
    expect(params(TEMPLATES.provider_kyc_nudge)).toEqual([1, 2])
  })
})
