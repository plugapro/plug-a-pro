import { describe, expect, it } from 'vitest'
import {
  formatLocationSlugLabel,
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
    expect(normaliseLocationDisplayName('kwazulu-natal')).toBe('KwaZulu-Natal')
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

describe('formatLocationSlugLabel (customer-facing slug → label)', () => {
  it('formats single-segment province slugs into clean names', () => {
    expect(formatLocationSlugLabel('kwazulu_natal')).toBe('KwaZulu-Natal')
    expect(formatLocationSlugLabel('western_cape')).toBe('Western Cape')
    expect(formatLocationSlugLabel('eastern_cape')).toBe('Eastern Cape')
    expect(formatLocationSlugLabel('northern_cape')).toBe('Northern Cape')
    expect(formatLocationSlugLabel('north_west')).toBe('North West')
    expect(formatLocationSlugLabel('free_state')).toBe('Free State')
    expect(formatLocationSlugLabel('mpumalanga')).toBe('Mpumalanga')
    expect(formatLocationSlugLabel('limpopo')).toBe('Limpopo')
    expect(formatLocationSlugLabel('gauteng')).toBe('Gauteng')
  })

  it('shows the most-specific segment of a combined hierarchy key (never the raw key)', () => {
    expect(formatLocationSlugLabel('kwazulu_natal__durban')).toBe('Durban')
    expect(formatLocationSlugLabel('gauteng__johannesburg__jhb_west__roodepoort')).toBe('Roodepoort')
    expect(formatLocationSlugLabel('kwazulu_natal__durban__umhlanga__ballito')).toBe('Ballito')
  })

  it('applies acronym/special-case overrides to region segments', () => {
    expect(formatLocationSlugLabel('gauteng__johannesburg__jhb_north')).toBe('JHB North')
    expect(formatLocationSlugLabel('kwazulu_natal__durban__umhlanga')).toBe('uMhlanga')
  })

  it('is idempotent on already-clean labels so it is safe to wrap any display string', () => {
    expect(formatLocationSlugLabel('Durban')).toBe('Durban')
    expect(formatLocationSlugLabel('KwaZulu-Natal')).toBe('KwaZulu-Natal')
    expect(formatLocationSlugLabel('Cape Town')).toBe('Cape Town')
  })

  it('returns an empty string for empty/nullish input', () => {
    expect(formatLocationSlugLabel('')).toBe('')
    expect(formatLocationSlugLabel(null)).toBe('')
    expect(formatLocationSlugLabel(undefined)).toBe('')
  })
})
