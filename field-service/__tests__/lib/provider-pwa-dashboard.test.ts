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

  it('returns 0% for a brand-new provider with no fields', () => {
    expect(calculateProviderProfileCompleteness({})).toEqual({
      completedCount: 0,
      totalCount: 7,
      percentage: 0,
      missing: ['Name', 'Mobile number', 'Service categories', 'Work areas', 'Experience', 'Rates', 'Bio or work examples'],
    })
  })

  it('counts structuredServiceAreaCount when legacy serviceAreas is absent', () => {
    const result = calculateProviderProfileCompleteness({
      name: 'Sipho',
      phone: '+27820000001',
      skills: ['Electrical'],
      structuredServiceAreaCount: 1,
      experience: '2 years',
      providerRateCount: 2,
      bio: 'Qualified electrician',
    })
    expect(result.percentage).toBe(100)
    expect(result.missing).toEqual([])
  })

  it('treats empty string name as missing', () => {
    const result = calculateProviderProfileCompleteness({
      name: '   ',
      phone: '+27820000001',
      skills: ['Plumbing'],
      structuredServiceAreaCount: 1,
      experience: '1 year',
      providerRateCount: 1,
      bio: 'Plumber',
    })
    expect(result.missing).toContain('Name')
  })

  it('counts portfolioUrlCount as satisfying the trust field when bio is absent', () => {
    const result = calculateProviderProfileCompleteness({
      name: 'Bongani',
      phone: '+27820000002',
      skills: ['Tiling'],
      structuredServiceAreaCount: 1,
      experience: '5 years',
      providerRateCount: 1,
      portfolioUrlCount: 1,
    })
    expect(result.missing).not.toContain('Bio or work examples')
    expect(result.percentage).toBe(100)
  })
})
