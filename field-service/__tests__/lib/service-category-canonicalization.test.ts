import { describe, expect, it } from 'vitest'

import {
  canonicalizeServiceCategoryValue,
  canonicalizeServiceCategoryValues,
} from '@/lib/service-category-canonicalization'

describe('service category canonicalization', () => {
  it('maps known display labels to canonical tags', () => {
    expect(canonicalizeServiceCategoryValue('Plumbing')).toEqual({
      raw: 'Plumbing',
      canonical: 'plumbing',
      source: 'label',
    })
    expect(canonicalizeServiceCategoryValue('Garden and Landscaping')).toEqual({
      raw: 'Garden and Landscaping',
      canonical: 'garden',
      source: 'label',
    })
  })

  it('keeps known canonical tags unchanged', () => {
    expect(canonicalizeServiceCategoryValue('plumbing')).toEqual({
      raw: 'plumbing',
      canonical: 'plumbing',
      source: 'tag',
    })
  })

  it('passes unknown values through with warning metadata', () => {
    expect(canonicalizeServiceCategoryValue('Solar Repairs')).toEqual({
      raw: 'Solar Repairs',
      canonical: 'Solar Repairs',
      source: 'pass-through',
      warning: 'unmapped_service_category',
    })
  })

  it('deduplicates canonicalized arrays while preserving first-seen order', () => {
    expect(canonicalizeServiceCategoryValues(['Plumbing', 'plumbing', 'DIY & Assembly'])).toEqual([
      'plumbing',
      'diy',
    ])
  })
})
