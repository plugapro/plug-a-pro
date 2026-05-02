import { describe, expect, it } from 'vitest'
import { calculateProviderProfileCompleteness } from '../../lib/provider-pwa-dashboard'

describe('provider PWA dashboard helpers', () => {
  it('calculates complete provider profile progress from existing backend fields', () => {
    expect(calculateProviderProfileCompleteness({
      name: 'Thabo',
      phone: '+27821234567',
      skills: ['Plumbing'],
      structuredServiceAreaCount: 2,
      experience: '3-5 years',
      providerRateCount: 1,
      portfolioUrlCount: 1,
    })).toEqual({
      completedCount: 7,
      totalCount: 7,
      percentage: 100,
      missing: [],
    })
  })

  it('reports missing optional rich-profile fields without blocking WhatsApp operations', () => {
    expect(calculateProviderProfileCompleteness({
      name: 'Thabo',
      phone: '+27821234567',
      skills: ['Plumbing'],
      serviceAreas: ['Gauteng'],
    })).toEqual({
      completedCount: 4,
      totalCount: 7,
      percentage: 57,
      missing: ['Experience', 'Rates', 'Bio or work examples'],
    })
  })
})
