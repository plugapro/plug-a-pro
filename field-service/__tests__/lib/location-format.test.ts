import { describe, expect, it } from 'vitest'
import {
  normaliseLocationDisplayName,
  normaliseLocationDisplayNames,
  normaliseLocationKey,
} from '@/lib/location-format'

describe('location display-name normalisation', () => {
  it('formats lowercase single-word place names for display', () => {
    expect(normaliseLocationDisplayName('ruimsig')).toBe('Ruimsig')
    expect(normaliseLocationDisplayName('johannesburg')).toBe('Johannesburg')
    expect(normaliseLocationDisplayName('sandton')).toBe('Sandton')
  })

  it('formats multi-word and hyphenated place names', () => {
    expect(normaliseLocationDisplayName('greenstone hill')).toBe('Greenstone Hill')
    expect(normaliseLocationDisplayName('north riding')).toBe('North Riding')
    expect(normaliseLocationDisplayName('bryanston-east')).toBe('Bryanston-East')
  })

  it('preserves configured South African special cases and acronyms', () => {
    expect(normaliseLocationDisplayName('emalahleni')).toBe('eMalahleni')
    expect(normaliseLocationDisplayName('umhlanga')).toBe('uMhlanga')
    expect(normaliseLocationDisplayName('kwazulu natal')).toBe('KwaZulu-Natal')
    expect(normaliseLocationDisplayName('jhb cbd')).toBe('JHB CBD')
  })

  it('normalises comma-separated service-area labels without changing matching keys', () => {
    expect(normaliseLocationDisplayNames(['ruimsig, johannesburg', 'greenstone hill'])).toEqual([
      'Ruimsig, Johannesburg',
      'Greenstone Hill',
    ])
    expect(normaliseLocationKey('Ruimsig')).toBe('ruimsig')
    expect(normaliseLocationKey('Greenstone Hill')).toBe('greenstone_hill')
  })
})
