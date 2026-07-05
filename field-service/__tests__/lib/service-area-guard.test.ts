import { describe, it, expect } from 'vitest'
import {
  isOnboardingActiveRegion,
  isMatchingActiveRegion,
  isActiveRegion,
  getRegionServiceStatus,
  describeRegionServiceStatus,
  ONBOARDING_ACTIVE_REGION_KEYS,
  MATCHING_ACTIVE_REGION_KEYS,
} from '@/lib/service-area-guard'

const COJ_REGIONS = ['jhb_north', 'jhb_east', 'jhb_south', 'jhb_cbd', 'jhb_west']

describe('service-area-guard gate split', () => {
  it('onboarding set contains all five CoJ regions', () => {
    for (const key of COJ_REGIONS) expect(isOnboardingActiveRegion(key)).toBe(true)
    expect(ONBOARDING_ACTIVE_REGION_KEYS.size).toBe(5)
  })

  it('matching set contains only jhb_west', () => {
    expect(isMatchingActiveRegion('jhb_west')).toBe(true)
    for (const key of ['jhb_north', 'jhb_east', 'jhb_south', 'jhb_cbd']) {
      expect(isMatchingActiveRegion(key)).toBe(false)
    }
    expect(MATCHING_ACTIVE_REGION_KEYS.size).toBe(1)
  })

  it('isActiveRegion keeps legacy (matching) behaviour', () => {
    expect(isActiveRegion('jhb_west')).toBe(true)
    expect(isActiveRegion('jhb_north')).toBe(false)
  })

  it('getRegionServiceStatus defaults to the matching gate', () => {
    expect(getRegionServiceStatus({ regionKey: 'jhb_north' })).toBe('coming_soon')
    expect(getRegionServiceStatus({ regionKey: 'jhb_west' })).toBe('active')
  })

  it('getRegionServiceStatus honours the onboarding gate', () => {
    expect(getRegionServiceStatus({ regionKey: 'jhb_north' }, 'onboarding')).toBe('active')
    expect(getRegionServiceStatus({ regionKey: 'jhb_south' }, 'onboarding')).toBe('active')
  })

  it('describeRegionServiceStatus copy differs by gate', () => {
    expect(describeRegionServiceStatus({ regionKey: 'jhb_north' }, 'onboarding')).toContain('Open for registration')
    expect(describeRegionServiceStatus({ regionKey: 'jhb_west' }, 'matching')).toContain('Active pilot')
    expect(describeRegionServiceStatus({ regionKey: 'jhb_north' }, 'matching')).toContain('Coming soon')
  })

  it('slug-input path resolves correctly for matching and onboarding gates', () => {
    // Production calls pass both regionKey and slug; slug alone must also resolve.
    // Region slugs end with the regionKey segment: gauteng__johannesburg__<regionKey>
    expect(getRegionServiceStatus({ slug: 'gauteng__johannesburg__jhb_west' }, 'matching')).toBe('active')
    expect(getRegionServiceStatus({ slug: 'gauteng__johannesburg__jhb_north' }, 'onboarding')).toBe('active')
  })

  it('isOnboardingActiveRegion returns false for out-of-scope regions', () => {
    expect(isOnboardingActiveRegion('western_cape')).toBe(false)
  })
})
