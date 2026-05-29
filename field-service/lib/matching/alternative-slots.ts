// ─── Alternative-slot finder ───────────────────────────────────────────────────
// When orchestrateMatch yields NO_MATCH due to schedule/window conflicts, this
// module probes the next N days in morning / afternoon bands to find windows where
// at least one near-miss provider CAN fit the job.
//
// Used by: orchestrator.ts (after NO_MATCH with nearMiss.length > 0)
// Produces: SlotOption[] written to DispatchDecision.alternativeSlotOptions

import { addDays, format } from 'date-fns'
import {
  buildWorkingWindow,
  evaluateScheduleFit,
  normalizeCommitments,
} from './scheduling'
import type { MatchingAddress, MatchingJobRequest, SlotOption } from './types'
import type { NearMissProvider } from './filter'

// ── SAST timezone offset ───────────────────────────────────────────────────────
// South Africa Standard Time is UTC+2 with no DST.
const SAST_UTC_OFFSET_HOURS = 2

// Band definitions in SAST wall-clock hours
const BANDS: Array<{
  name: 'morning' | 'afternoon'
  startHour: number   // SAST
  endHour: number     // SAST
  label: string
}> = [
  { name: 'morning',   startHour: 7,  endHour: 12, label: 'Morning (7–12)' },
  { name: 'afternoon', startHour: 13, endHour: 18, label: 'Afternoon (1–6)' },
]

/** Convert a SAST wall-clock hour to UTC hours for setUTCHours(). */
function sastHourToUtc(hour: number): number {
  return hour - SAST_UTC_OFFSET_HOURS
}

/**
 * Returns up to `maxSlots` future time windows (morning/afternoon bands over the
 * next `lookAheadDays` days) where at least one near-miss provider can be scheduled.
 *
 * Pure function: no DB calls - all provider data is already in `nearMissProviders`.
 */
export function findAlternativeSlots(params: {
  nearMissProviders: NearMissProvider[]
  jobRequest: MatchingJobRequest
  requestAddress: MatchingAddress
  lookAheadDays?: number  // default 3
  maxSlots?: number       // default 3
}): SlotOption[] {
  const {
    nearMissProviders,
    jobRequest,
    requestAddress,
    lookAheadDays = 3,
    maxSlots = 3,
  } = params

  if (nearMissProviders.length === 0) return []

  const slots: SlotOption[] = []
  const now = new Date()

  for (let dayOffset = 1; dayOffset <= lookAheadDays && slots.length < maxSlots; dayOffset++) {
    const probeDate = addDays(now, dayOffset)

    for (const band of BANDS) {
      if (slots.length >= maxSlots) break

      // Construct probe window in SAST (converted to UTC)
      const probeStart = new Date(probeDate)
      probeStart.setUTCHours(sastHourToUtc(band.startHour), 0, 0, 0)

      const probeEnd = new Date(probeDate)
      probeEnd.setUTCHours(sastHourToUtc(band.endHour), 0, 0, 0)

      // Skip any window that has already started
      if (probeStart <= now) continue

      // Construct a probed version of the job request with the alternative window
      const probedJob: MatchingJobRequest = {
        ...jobRequest,
        requestedWindowStart: probeStart,
        requestedWindowEnd: probeEnd,
        requestedArrivalLatest: null,
      }

      const matchingProviders: SlotOption['providers'] = []

      for (const provider of nearMissProviders) {
        // Find the provider's schedule rule for the probe day
        // probeStart is always 7am SAST (5am UTC) - unambiguously same calendar day
        const dayOfWeek = probeStart.getDay()  // 0=Sun … 6=Sat (UTC day == SAST day at 5am UTC)
        const scheduleRule =
          provider.schedule.find((rule) => rule.dayOfWeek === dayOfWeek && rule.active) ?? null

        const workingWindow = buildWorkingWindow({
          requestStartAt: probeStart,
          schedule: scheduleRule,
        })

        const commitments = normalizeCommitments({
          bookings: [],
          scheduleItems: provider.scheduleItems as Parameters<typeof normalizeCommitments>[0]['scheduleItems'],
        })

        const technicianOrigin = {
          suburb: provider.technicianServiceAreas.find((a) => a.active)?.label
            ?? provider.serviceAreas[0]
            ?? null,
          city: provider.technicianServiceAreas.find((a) => a.city != null)?.city
            ?? requestAddress.city,
          lat: provider.liveLocationLat ?? provider.lastKnownLat,
          lng: provider.liveLocationLng ?? provider.lastKnownLng,
        }

        const scheduleFit = evaluateScheduleFit({
          jobRequest: probedJob,
          requestAddress,
          workingWindow,
          technicianAvailability: provider.technicianAvailability as Parameters<typeof evaluateScheduleFit>[0]['technicianAvailability'],
          commitments,
          technicianOrigin,
          maxTravelMinutes: provider.maxTravelMinutes,
        })

        if (scheduleFit.isAvailable) {
          matchingProviders.push({
            id: provider.id,
            name: provider.name,
            phone: provider.phone,
            score: provider.scoreBase,
          })
        }
      }

      if (matchingProviders.length > 0) {
        const dayLabel = format(probeDate, 'EEE d MMM')
        const slotKey = `${format(probeDate, 'yyyy-MM-dd')}:${band.name}`

        slots.push({
          slotKey,
          slotLabel: `${dayLabel} · ${band.label}`,
          band: band.name,
          probeStartUtc: probeStart.toISOString(),
          probeEndUtc: probeEnd.toISOString(),
          providers: matchingProviders,
        })
      }
    }
  }

  return slots
}
