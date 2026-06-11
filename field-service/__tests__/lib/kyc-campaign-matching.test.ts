import { describe, expect, it } from 'vitest'
import {
  campaignAreaKey,
  legacyServiceAreaMatches,
} from '../../lib/kyc-fee/campaign-matching'

describe('campaignAreaKey', () => {
  it('maps each node level to its TechnicianServiceArea key column', () => {
    expect(campaignAreaKey({ nodeType: 'PROVINCE', slug: 'gauteng' })).toEqual({
      field: 'provinceKey',
      key: 'gauteng',
    })
    expect(
      campaignAreaKey({ nodeType: 'CITY', slug: 'gauteng__johannesburg' }),
    ).toEqual({ field: 'cityKey', key: 'johannesburg' })
    expect(
      campaignAreaKey({ nodeType: 'REGION', slug: 'gauteng__johannesburg__jhb_west' }),
    ).toEqual({ field: 'regionKey', key: 'jhb_west' })
    expect(
      campaignAreaKey({
        nodeType: 'SUBURB',
        slug: 'gauteng__johannesburg__jhb_west__honeydew',
      }),
    ).toEqual({ field: 'suburbKey', key: 'honeydew' })
  })
})

describe('legacyServiceAreaMatches', () => {
  const suburbSlug = 'gauteng__johannesburg__jhb_west__honeydew'

  it('matches an exact slug entry', () => {
    expect(legacyServiceAreaMatches([suburbSlug], suburbSlug)).toBe(true)
  })

  it('matches a region campaign against contained suburb slugs', () => {
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_west'),
    ).toBe(true)
  })

  it('does not match a different region', () => {
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_north'),
    ).toBe(false)
  })

  it('does not prefix-match partial segment names', () => {
    // 'jhb_w' must not match 'jhb_west' suburbs
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_w'),
    ).toBe(false)
  })

  it('ignores free-text non-slug entries', () => {
    expect(
      legacyServiceAreaMatches(['Honeydew'], 'gauteng__johannesburg__jhb_west'),
    ).toBe(false)
  })
})
