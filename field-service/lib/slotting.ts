// ─── Provider schedule helper ─────────────────────────────────────────────────
// Replaces the old Slot-based slotting engine.
// The P2P model does not use pre-allocated Slot records.
// Availability is derived from ProviderSchedule + existing Bookings.

import { db } from './db'
import { addDays, format, startOfDay, isBefore } from 'date-fns'

export interface AvailableSlot {
  id: string | null    // null — dynamic (no Slot record in new schema)
  date: string         // ISO date string: "2026-04-01"
  windowStart: string  // "09:00"
  windowEnd: string    // "17:00"
  label: string        // "Tuesday 1 April, 09:00–17:00"
  remaining: number    // always 1 per provider slot in P2P model
  providerId?: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get available schedule windows for a provider.
 * Returns up to `limit` windows within the next `lookAheadDays` days.
 */
export async function getProviderSchedule(params: {
  providerId: string
  startDate?: Date
  lookAheadDays?: number
  limit?: number
}): Promise<AvailableSlot[]> {
  const {
    providerId,
    startDate = new Date(),
    lookAheadDays = 14,
    limit = 10,
  } = params

  const endDate = addDays(startDate, lookAheadDays)

  // Load provider availability rules
  const availabilityRules = await db.providerSchedule.findMany({
    where: { providerId },
  })

  if (availabilityRules.length === 0) return []

  // Load existing bookings to check conflicts
  const existingBookings = await db.booking.findMany({
    where: {
      match: { providerId },
      scheduledDate: { gte: startDate, lte: endDate },
      status: { notIn: ['CANCELLED'] },
    },
    select: { scheduledDate: true },
  })

  const bookedDates = new Set(
    existingBookings
      .filter((b) => b.scheduledDate != null)
      .map((b) => format(b.scheduledDate!, 'yyyy-MM-dd'))
  )

  const availByDay = new Map(
    availabilityRules.map((r) => [r.dayOfWeek, r])
  )

  const slots: AvailableSlot[] = []
  let current = startOfDay(startDate)

  while (
    (isBefore(current, endDate) || current.getTime() === startOfDay(endDate).getTime()) &&
    slots.length < limit
  ) {
    const dayOfWeek = current.getDay()
    const avail = availByDay.get(dayOfWeek)

    if (avail?.active) {
      const dateStr = format(current, 'yyyy-MM-dd')
      if (!bookedDates.has(dateStr)) {
        slots.push({
          id: null,
          date: dateStr,
          windowStart: avail.startTime,
          windowEnd: avail.endTime,
          label: formatSlotLabel(current, avail.startTime, avail.endTime),
          remaining: 1,
          providerId,
        })
      }
    }

    current = addDays(current, 1)
  }

  return slots
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSlotLabel(date: Date, windowStart: string, windowEnd: string): string {
  const dayLabel = format(date, 'EEEE d MMMM')
  return `${dayLabel}, ${windowStart}–${windowEnd}`
}
