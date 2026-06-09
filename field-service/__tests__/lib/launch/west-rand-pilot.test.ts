import { describe, expect, it } from 'vitest'

import {
  WEST_RAND_PILOT,
  isPilotCategorySlug,
  isPilotSuburbSlug,
  isPriorityPilotSuburb,
} from '@/lib/launch/west-rand-pilot'

describe('WEST_RAND_PILOT constant', () => {
  it('names the pilot', () => {
    expect(WEST_RAND_PILOT.key).toBe('west-rand-pilot')
    expect(WEST_RAND_PILOT.label).toBe('West Rand Pilot')
    expect(WEST_RAND_PILOT.regionKey).toBe('jhb_west')
  })

  it('lists the 8 launch suburbs by canonical slug', () => {
    expect(WEST_RAND_PILOT.activeSuburbSlugs).toEqual([
      'gauteng__johannesburg__jhb_west__honeydew',
      'gauteng__johannesburg__jhb_west__randpark_ridge',
      'gauteng__johannesburg__jhb_west__constantia_kloof',
      'gauteng__johannesburg__jhb_west__florida',
      'gauteng__johannesburg__jhb_west__bromhof',
      'gauteng__johannesburg__jhb_west__discovery',
      'gauteng__johannesburg__jhb_west__helderkruin',
      'gauteng__johannesburg__jhb_west__little_falls',
    ])
  })

  it('priority suburbs are the first 4 and are a subset of active', () => {
    expect(WEST_RAND_PILOT.prioritySuburbSlugs).toEqual([
      'gauteng__johannesburg__jhb_west__honeydew',
      'gauteng__johannesburg__jhb_west__randpark_ridge',
      'gauteng__johannesburg__jhb_west__constantia_kloof',
      'gauteng__johannesburg__jhb_west__florida',
    ])
    for (const slug of WEST_RAND_PILOT.prioritySuburbSlugs) {
      expect(WEST_RAND_PILOT.activeSuburbSlugs).toContain(slug)
    }
  })

  it('allows exactly the 6 pilot categories; electrical is intentionally absent', () => {
    expect(WEST_RAND_PILOT.allowedCategorySlugs).toEqual([
      'handyman',
      'painting',
      'plumbing',
      'tiling',
      'carpentry',
      'appliances',
    ])
    expect(WEST_RAND_PILOT.allowedCategorySlugs).not.toContain('electrical')
  })

  it('electrical-readiness threshold is 3 (configurable 3–5)', () => {
    expect(WEST_RAND_PILOT.electricalThreshold).toBe(3)
  })
})

describe('isPilotSuburbSlug', () => {
  it('returns true for every active suburb', () => {
    for (const slug of WEST_RAND_PILOT.activeSuburbSlugs) {
      expect(isPilotSuburbSlug(slug)).toBe(true)
    }
  })

  it('returns false for non-pilot suburbs and for null / undefined / empty', () => {
    expect(isPilotSuburbSlug('gauteng__johannesburg__sandton__sandhurst')).toBe(false)
    expect(isPilotSuburbSlug('honeydew')).toBe(false) // not canonical
    expect(isPilotSuburbSlug(null)).toBe(false)
    expect(isPilotSuburbSlug(undefined)).toBe(false)
    expect(isPilotSuburbSlug('')).toBe(false)
  })
})

describe('isPilotCategorySlug', () => {
  it('returns true for every allowed category', () => {
    for (const slug of WEST_RAND_PILOT.allowedCategorySlugs) {
      expect(isPilotCategorySlug(slug)).toBe(true)
    }
  })

  it('returns false for electrical, unknown categories, and falsy input', () => {
    expect(isPilotCategorySlug('electrical')).toBe(false)
    expect(isPilotCategorySlug('roofing')).toBe(false)
    expect(isPilotCategorySlug(null)).toBe(false)
    expect(isPilotCategorySlug(undefined)).toBe(false)
    expect(isPilotCategorySlug('')).toBe(false)
  })
})

describe('isPriorityPilotSuburb', () => {
  it('returns true only for the 4 priority suburbs', () => {
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__honeydew')).toBe(true)
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__florida')).toBe(true)
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__bromhof')).toBe(false)
    expect(isPriorityPilotSuburb('gauteng__johannesburg__jhb_west__discovery')).toBe(false)
    expect(isPriorityPilotSuburb(null)).toBe(false)
  })
})
