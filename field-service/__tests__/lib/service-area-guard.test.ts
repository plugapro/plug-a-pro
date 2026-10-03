import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    serviceAreaWaitlist: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { db } from '@/lib/db'
import {
  normalizeLocationKey,
  getRegionKeyFromSlug,
  addToServiceAreaWaitlist,
} from '@/lib/service-area-guard'

const waitlist = db.serviceAreaWaitlist as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

describe('normalizeLocationKey', () => {
  it('lower-cases, trims and joins whitespace/hyphens with underscores', () => {
    expect(normalizeLocationKey('  JHB West ')).toBe('jhb_west')
    expect(normalizeLocationKey('Cape-Town  CBD')).toBe('cape_town_cbd')
  })

  it('returns an empty string for null, undefined and blank input', () => {
    expect(normalizeLocationKey(null)).toBe('')
    expect(normalizeLocationKey(undefined)).toBe('')
    expect(normalizeLocationKey('   ')).toBe('')
  })
})

describe('getRegionKeyFromSlug', () => {
  it('returns the last double-underscore segment of a node slug, normalised', () => {
    expect(getRegionKeyFromSlug('gauteng__johannesburg__jhb_west')).toBe('jhb_west')
    expect(getRegionKeyFromSlug('western_cape__cape_town__Cape_Town_CBD')).toBe('cape_town_cbd')
  })

  it('returns an empty string for null/undefined', () => {
    expect(getRegionKeyFromSlug(null)).toBe('')
    expect(getRegionKeyFromSlug(undefined)).toBe('')
  })
})

describe('addToServiceAreaWaitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    waitlist.findFirst.mockResolvedValue(null)
  })

  it('creates a normalised row when the phone+city pair is new', async () => {
    await addToServiceAreaWaitlist({
      phone: '+27820000001',
      name: 'Thandi',
      category: 'painting',
      suburb: 'sea point',
      city: 'cape town',
      province: 'western cape',
      source: 'whatsapp',
    })

    expect(waitlist.findFirst).toHaveBeenCalledWith({
      where: { phone: '+27820000001', city: { equals: 'Cape Town', mode: 'insensitive' } },
      select: { id: true },
    })
    expect(waitlist.update).not.toHaveBeenCalled()
    expect(waitlist.create).toHaveBeenCalledWith({
      data: {
        phone: '+27820000001',
        name: 'Thandi',
        category: 'painting',
        suburb: 'Sea Point',
        city: 'Cape Town',
        province: 'Western Cape',
        source: 'whatsapp',
      },
    })
  })

  it('updates the existing row (idempotent on phone+city; lookup is case-insensitive)', async () => {
    waitlist.findFirst.mockResolvedValue({ id: 'wl_1' })

    await addToServiceAreaWaitlist({
      phone: '+27820000001',
      category: 'garden',
      city: 'cape town',
      source: 'pwa',
    })

    expect(waitlist.create).not.toHaveBeenCalled()
    expect(waitlist.update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: { city: 'Cape Town', category: 'garden' },
    })
  })

  it('stores null for optional fields that are omitted', async () => {
    await addToServiceAreaWaitlist({ phone: '+27820000002', city: 'Kimberley', source: 'vodapay' })

    expect(waitlist.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: null, category: null, suburb: null, province: null, source: 'vodapay' }),
    })
  })
})
