// ─── Slotting engine tests ────────────────────────────────────────────────────
// Tests getAvailableSlots, holdSlot, releaseSlot, and generateSlots logic.
// All DB calls are mocked — no real database connection required.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addDays, startOfDay } from 'date-fns'

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockSlot = {
  id: 'slot_1',
  businessId: 'biz_1',
  technicianId: 'tech_1',
  date: new Date('2026-04-07T00:00:00.000Z'),
  windowStart: '09:00',
  windowEnd: '12:00',
  capacity: 3,
  booked: 1,
  blocked: false,
  technician: null,
}

const mockService = {
  id: 'svc_1',
  businessId: 'biz_1',
  active: true,
  name: 'Electrical Inspection',
}

const mockServiceArea = {
  id: 'area_1',
  serviceId: 'svc_1',
  suburb: 'Sandton',
  city: 'Johannesburg',
}

vi.mock('@/lib/db', () => ({
  db: {
    serviceArea: { findFirst: vi.fn() },
    service: { findUnique: vi.fn() },
    slot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    availability: { findMany: vi.fn() },
  },
}))

import { getAvailableSlots, holdSlot, releaseSlot, generateSlots } from '@/lib/slotting'
import { db } from '@/lib/db'

// ─── getAvailableSlots ────────────────────────────────────────────────────────

describe('getAvailableSlots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when service area not found', async () => {
    ;(db.serviceArea.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await getAvailableSlots({
      businessId: 'biz_1',
      serviceId: 'svc_1',
      suburb: 'Unknown',
      city: 'Unknown',
    })

    expect(result).toEqual([])
  })

  it('returns empty array when service is inactive', async () => {
    ;(db.serviceArea.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockServiceArea)
    ;(db.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...mockService, active: false })

    const result = await getAvailableSlots({
      businessId: 'biz_1',
      serviceId: 'svc_1',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })

    expect(result).toEqual([])
  })

  it('returns available slots with remaining capacity', async () => {
    ;(db.serviceArea.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockServiceArea)
    ;(db.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockService)
    ;(db.slot.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockSlot])

    const result = await getAvailableSlots({
      businessId: 'biz_1',
      serviceId: 'svc_1',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'slot_1',
      windowStart: '09:00',
      windowEnd: '12:00',
      remaining: 2, // capacity 3 - booked 1
    })
  })

  it('excludes fully booked slots', async () => {
    const fullSlot = { ...mockSlot, capacity: 2, booked: 2 }
    ;(db.serviceArea.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockServiceArea)
    ;(db.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockService)
    ;(db.slot.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fullSlot])

    const result = await getAvailableSlots({
      businessId: 'biz_1',
      serviceId: 'svc_1',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })

    expect(result).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({
      ...mockSlot,
      id: `slot_${i}`,
      booked: 0,
    }))
    ;(db.serviceArea.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockServiceArea)
    ;(db.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockService)
    ;(db.slot.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(slots)

    const result = await getAvailableSlots({
      businessId: 'biz_1',
      serviceId: 'svc_1',
      suburb: 'Sandton',
      city: 'Johannesburg',
      limit: 5,
    })

    expect(result).toHaveLength(5)
  })
})

// ─── holdSlot ─────────────────────────────────────────────────────────────────

describe('holdSlot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('increments booked count and returns true', async () => {
    ;(db.slot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockSlot)
    ;(db.slot.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...mockSlot, booked: 2 })

    const result = await holdSlot({ slotId: 'slot_1', bookingId: 'booking_1' })

    expect(result).toBe(true)
    expect(db.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { booked: { increment: 1 } },
    })
  })

  it('returns false when slot is at capacity', async () => {
    const fullSlot = { ...mockSlot, capacity: 2, booked: 2 }
    ;(db.slot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fullSlot)

    const result = await holdSlot({ slotId: 'slot_1', bookingId: 'booking_1' })

    expect(result).toBe(false)
    expect(db.slot.update).not.toHaveBeenCalled()
  })

  it('returns false when slot not found', async () => {
    ;(db.slot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await holdSlot({ slotId: 'missing', bookingId: 'booking_1' })

    expect(result).toBe(false)
  })
})

// ─── releaseSlot ──────────────────────────────────────────────────────────────

describe('releaseSlot', () => {
  it('decrements booked count', async () => {
    ;(db.slot.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...mockSlot, booked: 0 })

    await releaseSlot('slot_1')

    expect(db.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { booked: { decrement: 1 } },
    })
  })
})

// ─── generateSlots ────────────────────────────────────────────────────────────

describe('generateSlots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips weekends when no technician availability is configured', async () => {
    ;(db.availability.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(db.slot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.slot.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    // Monday to Sunday (7 days starting on Monday 2026-03-30)
    const startDate = new Date('2026-03-30T00:00:00.000Z') // Monday
    const endDate = addDays(startDate, 6) // Sunday

    const count = await generateSlots({
      businessId: 'biz_1',
      technicianId: 'tech_1',
      startDate,
      endDate,
      windowStart: '09:00',
      windowEnd: '17:00',
      capacity: 2,
    })

    // With technician availability = [] (all inactive), count should be 0
    // because no days are active
    expect(count).toBe(0)
  })

  it('uses technician availability to determine working days', async () => {
    // Tech works Mon (1), Wed (3), Fri (5) only
    const availability = [
      { dayOfWeek: 1, startTime: '08:00', endTime: '16:00', active: true },
      { dayOfWeek: 2, startTime: '08:00', endTime: '16:00', active: false },
      { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', active: true },
      { dayOfWeek: 4, startTime: '08:00', endTime: '16:00', active: false },
      { dayOfWeek: 5, startTime: '10:00', endTime: '15:00', active: true },
    ]
    ;(db.availability.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(availability)
    ;(db.slot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.slot.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    // Week of 2026-03-30 (Mon) to 2026-04-05 (Sun)
    const startDate = new Date('2026-03-30T00:00:00.000Z')
    const endDate = addDays(startDate, 6)

    const count = await generateSlots({
      businessId: 'biz_1',
      technicianId: 'tech_1',
      startDate,
      endDate,
      windowStart: '09:00',
      windowEnd: '17:00',
      capacity: 2,
    })

    expect(count).toBe(3) // Mon, Wed, Fri only
  })

  it('skips days where slot already exists', async () => {
    const availability = [
      { dayOfWeek: 1, startTime: '08:00', endTime: '16:00', active: true },
    ]
    ;(db.availability.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(availability)
    // Slot already exists for this day
    ;(db.slot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockSlot)

    const startDate = new Date('2026-03-30T00:00:00.000Z') // Monday
    const endDate = startDate

    const count = await generateSlots({
      businessId: 'biz_1',
      technicianId: 'tech_1',
      startDate,
      endDate,
      windowStart: '08:00',
      windowEnd: '16:00',
      capacity: 2,
    })

    expect(count).toBe(0)
    expect(db.slot.create).not.toHaveBeenCalled()
  })

  it('falls back to Mon-Fri when no technicianId given', async () => {
    ;(db.slot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.slot.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    // Mon to Sun
    const startDate = new Date('2026-03-30T00:00:00.000Z')
    const endDate = addDays(startDate, 6)

    const count = await generateSlots({
      businessId: 'biz_1',
      startDate,
      endDate,
      windowStart: '09:00',
      windowEnd: '17:00',
      capacity: 2,
    })

    expect(count).toBe(5) // Mon-Fri only
    expect(db.availability.findMany).not.toHaveBeenCalled()
  })
})
