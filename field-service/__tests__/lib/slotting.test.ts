import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProviderSchedule, mockProvider, mockBooking } = vi.hoisted(() => ({
  mockProviderSchedule: { findMany: vi.fn(), upsert: vi.fn() },
  mockProvider: { findMany: vi.fn() },
  mockBooking: { findMany: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  db: {
    providerSchedule: mockProviderSchedule,
    provider: mockProvider,
    booking: mockBooking,
  },
}))

import {
  getProviderSchedule,
  getProvidersAvailableOn,
  upsertSchedule,
} from '@/lib/slotting'

describe('ProviderSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getProviderSchedule returns schedule rows for a provider', async () => {
    mockProviderSchedule.findMany.mockResolvedValue([
      { dayOfWeek: 1, startTime: '08:00', endTime: '17:00', active: true }, // Monday
      { dayOfWeek: 3, startTime: '09:00', endTime: '16:00', active: true }, // Wednesday
    ])
    mockBooking.findMany.mockResolvedValue([])

    const monday = new Date('2026-05-11') // Monday
    const slots = await getProviderSchedule({
      providerId: 'prov-1',
      startDate: monday,
      lookAheadDays: 7,
      limit: 5,
    })

    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      const day = new Date(slot.date + 'T00:00:00').getDay()
      expect([1, 3]).toContain(day)
    }
    expect(slots[0]).toMatchObject({
      id: null,
      remaining: 1,
      providerId: 'prov-1',
    })
  })

  it('getProvidersAvailableOn filters by dayOfWeek and serviceArea', async () => {
    mockProviderSchedule.findMany.mockResolvedValue([
      { providerId: 'prov-1' },
      { providerId: 'prov-2' },
      { providerId: 'prov-3' },
    ])
    mockProvider.findMany.mockResolvedValue([
      { id: 'prov-1' },
      { id: 'prov-3' },
    ])

    const result = await getProvidersAvailableOn({
      dayOfWeek: 1,
      serviceAreaSlug: 'johannesburg',
    })

    expect(result).toEqual(['prov-1', 'prov-3'])
    expect(mockProviderSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dayOfWeek: 1, active: true } }),
    )
    expect(mockProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ serviceAreas: { has: 'johannesburg' } }),
      }),
    )
  })

  it('upsertSchedule creates new schedule rows', async () => {
    mockProviderSchedule.upsert.mockResolvedValue({})

    await upsertSchedule('prov-1', [
      { dayOfWeek: 1, startTime: '08:00', endTime: '17:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '16:00' },
    ])

    expect(mockProviderSchedule.upsert).toHaveBeenCalledTimes(2)
    expect(mockProviderSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ providerId: 'prov-1', dayOfWeek: 1, startTime: '08:00' }),
      }),
    )
  })

  it('upsertSchedule updates existing schedule rows', async () => {
    mockProviderSchedule.upsert.mockResolvedValue({})

    await upsertSchedule('prov-1', [
      { dayOfWeek: 1, startTime: '10:00', endTime: '18:00', active: false },
    ])

    expect(mockProviderSchedule.upsert).toHaveBeenCalledOnce()
    expect(mockProviderSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_dayOfWeek: { providerId: 'prov-1', dayOfWeek: 1 } },
        update: { startTime: '10:00', endTime: '18:00', active: false },
      }),
    )
  })
})
