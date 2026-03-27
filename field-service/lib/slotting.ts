// ─── Availability and slotting engine ────────────────────────────────────────
// Derives available booking windows from:
// - Business operating hours
// - Service duration + buffer time
// - Technician availability rules
// - Existing confirmed bookings
// - Service area coverage

import { db } from './db'
import { addDays, format, parseISO, startOfDay, isAfter, isBefore } from 'date-fns'

export interface AvailableSlot {
  id: string | null    // existing Slot record ID, or null if dynamic
  date: string         // ISO date string: "2026-04-01"
  windowStart: string  // "09:00"
  windowEnd: string    // "12:00"
  label: string        // "Tuesday 1 April, 09:00–12:00"
  remaining: number    // available capacity
  technicianId?: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get available booking slots for a service in a given area.
 * Returns up to `limit` slots within the next `lookAheadDays` days.
 */
export async function getAvailableSlots(params: {
  businessId: string
  serviceId: string
  suburb: string
  city: string
  startDate?: Date
  lookAheadDays?: number
  limit?: number
}): Promise<AvailableSlot[]> {
  const {
    businessId,
    serviceId,
    suburb,
    city,
    startDate = new Date(),
    lookAheadDays = 14,
    limit = 10,
  } = params

  // Verify service covers this area
  const serviceArea = await db.serviceArea.findFirst({
    where: {
      service: { id: serviceId, businessId },
      OR: [
        { suburb: { equals: suburb, mode: 'insensitive' } },
        { city: { equals: city, mode: 'insensitive' } },
      ],
    },
  })

  if (!serviceArea) return []

  const service = await db.service.findUnique({ where: { id: serviceId } })
  if (!service || !service.active) return []

  // Check existing explicit slots first
  const endDate = addDays(startDate, lookAheadDays)
  const existingSlots = await db.slot.findMany({
    where: {
      businessId,
      blocked: false,
      date: { gte: startDate, lte: endDate },
    },
    include: { technician: true },
    orderBy: [{ date: 'asc' }, { windowStart: 'asc' }],
  })

  const available: AvailableSlot[] = existingSlots
    .filter((s) => s.capacity - s.booked > 0)
    .map((s) => ({
      id: s.id,
      date: format(s.date, 'yyyy-MM-dd'),
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      label: formatSlotLabel(s.date, s.windowStart, s.windowEnd),
      remaining: s.capacity - s.booked,
      technicianId: s.technicianId ?? undefined,
    }))

  return available.slice(0, limit)
}

/**
 * Reserve a slot (optimistic hold before payment).
 * Returns a hold token — must be confirmed within TTL.
 */
export async function holdSlot(params: {
  slotId: string
  bookingId: string
}): Promise<boolean> {
  const slot = await db.slot.findUnique({ where: { id: params.slotId } })
  if (!slot || slot.booked >= slot.capacity) return false

  // Increment booked count optimistically
  await db.slot.update({
    where: { id: params.slotId },
    data: { booked: { increment: 1 } },
  })

  return true
}

/** Release a held slot (called on payment failure or booking cancellation) */
export async function releaseSlot(slotId: string): Promise<void> {
  await db.slot.update({
    where: { id: slotId },
    data: { booked: { decrement: 1 } },
  })
}

// ─── Admin slot management ────────────────────────────────────────────────────

/** Generate slots for a date range based on availability rules */
export async function generateSlots(params: {
  businessId: string
  technicianId?: string
  startDate: Date
  endDate: Date
  windowStart: string  // "09:00"
  windowEnd: string    // "17:00"
  capacity: number
}): Promise<number> {
  const { businessId, technicianId, startDate, endDate, windowStart, windowEnd, capacity } = params

  // Load technician availability once if technicianId is given
  let availByDay: Map<number, { startTime: string; endTime: string; active: boolean }> | null = null
  if (technicianId) {
    const records = await db.availability.findMany({
      where: { technicianId },
    })
    availByDay = new Map(records.map((r) => [r.dayOfWeek, r]))
  }

  let created = 0
  let current = startOfDay(startDate)

  while (isBefore(current, endDate) || current.getTime() === startOfDay(endDate).getTime()) {
    const dayOfWeek = current.getDay()

    // Determine if this day is a working day
    let workingDay = false
    let slotStart = windowStart
    let slotEnd = windowEnd

    if (availByDay) {
      const avail = availByDay.get(dayOfWeek)
      if (avail?.active) {
        workingDay = true
        slotStart = avail.startTime
        slotEnd = avail.endTime
      }
    } else {
      // Default: Mon–Fri when no technician availability configured
      workingDay = dayOfWeek !== 0 && dayOfWeek !== 6
    }

    if (workingDay) {
      const existing = await db.slot.findFirst({
        where: {
          businessId,
          technicianId: technicianId ?? null,
          date: current,
          windowStart: slotStart,
          windowEnd: slotEnd,
        },
      })

      if (!existing) {
        await db.slot.create({
          data: {
            businessId,
            technicianId,
            date: current,
            windowStart: slotStart,
            windowEnd: slotEnd,
            capacity,
            booked: 0,
          },
        })
        created++
      }
    }

    current = addDays(current, 1)
  }

  return created
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSlotLabel(date: Date, windowStart: string, windowEnd: string): string {
  const dayLabel = format(date, "EEEE d MMMM")
  return `${dayLabel}, ${windowStart}–${windowEnd}`
}
