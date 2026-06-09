import { describe, expect, it } from 'vitest'

import { listMissingProfileItems, type ProviderTierInput } from '@/lib/provider-tier'

const COMPLETE: ProviderTierInput = {
  verified: true,
  kycStatus: 'VERIFIED',
  status: 'ACTIVE',
  strikes: 0,
  name: 'Test Provider',
  phone: '+27821234567',
  email: 'test@example.com',
  payoutVerifiedAt: new Date('2026-01-01'),
  skills: ['plumbing'],
  equipmentTags: ['basic_tools'],
  serviceAreas: ['suburb-1'],
  identityAssurance: 'HIGH',
}

describe('listMissingProfileItems', () => {
  it('returns empty array for a complete profile', () => {
    expect(listMissingProfileItems(COMPLETE)).toEqual([])
  })

  it.each([
    ['name', { name: '' }, 'name'],
    ['name (null)', { name: null }, 'name'],
    ['phone (empty)', { phone: '   ' }, 'phone number'],
    ['email (null)', { email: null }, 'email address'],
    ['payoutVerifiedAt (null)', { payoutVerifiedAt: null }, 'bank details'],
    ['skills (empty)', { skills: [] }, 'skills list'],
    ['equipmentTags (empty)', { equipmentTags: [] }, 'equipment list'],
    ['serviceAreas (empty)', { serviceAreas: [] }, 'service areas'],
  ])('surfaces %s', (_label, override, expectedLabel) => {
    const items = listMissingProfileItems({ ...COMPLETE, ...(override as any) })
    expect(items).toContain(expectedLabel)
  })

  it('lists all missing items in the canonical order', () => {
    const items = listMissingProfileItems({
      ...COMPLETE,
      name: '',
      phone: '',
      email: '',
      payoutVerifiedAt: null,
      skills: [],
      equipmentTags: [],
      serviceAreas: [],
    })
    expect(items).toEqual([
      'name',
      'phone number',
      'email address',
      'bank details',
      'skills list',
      'equipment list',
      'service areas',
    ])
  })
})
