import type { Booking, TechnicianAvailability, TechnicianScheduleItem } from '@prisma/client'
import { addMinutes, areIntervalsOverlapping, format, max, min } from 'date-fns'
import { MATCHING_CONFIG } from './config'
import { estimateTravelMinutes } from './geography'
import type { MatchingAddress, MatchingJobRequest } from './types'

type BookingCommitment = Pick<Booking, 'id' | 'scheduledDate' | 'scheduledStartAt' | 'scheduledEndAt' | 'scheduledWindow' | 'status'>

type ScheduleCommitment = {
  id: string
  startAt: Date
  endAt: Date
  type: 'BOOKING' | 'SCHEDULE_ITEM'
  title: string
  location?: {
    suburb?: string | null
    city?: string | null
    lat?: number | null
    lng?: number | null
  }
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
}

type WorkingWindow = {
  startAt: Date
  endAt: Date
}

export type ScheduleFitResult = {
  isAvailable: boolean
  score: number
  canMeetWindow: boolean
  estimatedStartAt: Date | null
  estimatedEndAt: Date | null
  travelMinutes: number
  notes: string[]
  conflictingCommitmentIds: string[]
}

function combineDateAndTime(baseDate: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const combined = new Date(baseDate)
  combined.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return combined
}

export function deriveRequestWindow(jobRequest: MatchingJobRequest) {
  const durationMinutes =
    jobRequest.estimatedDurationMinutes ?? MATCHING_CONFIG.defaultDurationMinutes
  const startAt =
    jobRequest.requestedWindowStart ??
    jobRequest.requestedArrivalLatest ??
    new Date()
  const endAt =
    jobRequest.requestedWindowEnd ??
    addMinutes(startAt, durationMinutes + MATCHING_CONFIG.scheduleBufferMinutes)

  return { startAt, endAt, durationMinutes }
}

export function buildWorkingWindow(params: {
  requestStartAt: Date
  schedule: { startTime: string; endTime: string } | null
}) {
  if (!params.schedule) return null

  return {
    startAt: combineDateAndTime(params.requestStartAt, params.schedule.startTime),
    endAt: combineDateAndTime(params.requestStartAt, params.schedule.endTime),
  } satisfies WorkingWindow
}

export function normalizeCommitments(params: {
  bookings: BookingCommitment[]
  scheduleItems: Pick<
    TechnicianScheduleItem,
    | 'id'
    | 'itemType'
    | 'title'
    | 'startAt'
    | 'endAt'
    | 'bufferBeforeMinutes'
    | 'bufferAfterMinutes'
    | 'locationLabel'
    | 'lat'
    | 'lng'
    | 'status'
  >[]
  addressLookup?: Map<string, { suburb?: string | null; city?: string | null }>
}) {
  const commitments: ScheduleCommitment[] = []

  for (const booking of params.bookings) {
    const startAt = booking.scheduledStartAt ?? booking.scheduledDate
    const endAt =
      booking.scheduledEndAt ??
      addMinutes(startAt, MATCHING_CONFIG.defaultDurationMinutes)

    commitments.push({
      id: booking.id,
      startAt,
      endAt,
      type: 'BOOKING',
      title: booking.scheduledWindow ?? 'Existing booking',
      bufferBeforeMinutes: MATCHING_CONFIG.scheduleBufferMinutes,
      bufferAfterMinutes: MATCHING_CONFIG.scheduleBufferMinutes,
    })
  }

  for (const item of params.scheduleItems) {
    if (item.status !== 'ACTIVE') continue
    commitments.push({
      id: item.id,
      startAt: item.startAt,
      endAt: item.endAt,
      type: 'SCHEDULE_ITEM',
      title: item.title ?? item.itemType,
      location: {
        lat: item.lat,
        lng: item.lng,
      },
      bufferBeforeMinutes: item.bufferBeforeMinutes,
      bufferAfterMinutes: item.bufferAfterMinutes,
    })
  }

  return commitments.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export function evaluateScheduleFit(params: {
  jobRequest: MatchingJobRequest
  requestAddress: MatchingAddress
  workingWindow: WorkingWindow | null
  technicianAvailability: TechnicianAvailability | null
  commitments: ScheduleCommitment[]
  technicianOrigin: {
    suburb?: string | null
    city?: string | null
    lat?: number | null
    lng?: number | null
  }
  maxTravelMinutes: number
}) {
  const notes: string[] = []
  const conflictingCommitmentIds: string[] = []
  const { startAt: requestedStartAt, endAt: requestedEndAt, durationMinutes } =
    deriveRequestWindow(params.jobRequest)

  if (
    params.technicianAvailability?.availabilityState === 'OFFLINE' ||
    params.technicianAvailability?.availabilityState === 'PAUSED'
  ) {
    return {
      isAvailable: false,
      score: 0,
      canMeetWindow: false,
      estimatedStartAt: null,
      estimatedEndAt: null,
      travelMinutes: 0,
      notes: [
        params.technicianAvailability.availabilityState === 'PAUSED'
          ? 'Technician is paused'
          : 'Technician is offline',
      ],
      conflictingCommitmentIds,
    } satisfies ScheduleFitResult
  }

  if (
    params.technicianAvailability?.nextAvailableAt &&
    params.technicianAvailability.nextAvailableAt > requestedStartAt
  ) {
    notes.push(
      `Next available at ${format(params.technicianAvailability.nextAvailableAt, 'HH:mm')}`
    )
  }

  if (params.workingWindow) {
    if (requestedStartAt < params.workingWindow.startAt) {
      notes.push('Requested start is before technician working hours')
      return {
        isAvailable: false,
        score: 0,
        canMeetWindow: false,
        estimatedStartAt: null,
        estimatedEndAt: null,
        travelMinutes: 0,
        notes,
        conflictingCommitmentIds,
      } satisfies ScheduleFitResult
    }

    if (requestedEndAt > params.workingWindow.endAt) {
      notes.push('Requested window runs past technician working hours')
      return {
        isAvailable: false,
        score: 0,
        canMeetWindow: false,
        estimatedStartAt: null,
        estimatedEndAt: null,
        travelMinutes: 0,
        notes,
        conflictingCommitmentIds,
      } satisfies ScheduleFitResult
    }
  }

  const previousCommitment = [...params.commitments]
    .reverse()
    .find((commitment) => commitment.endAt <= requestedStartAt)
  const nextCommitment = params.commitments.find(
    (commitment) => commitment.startAt >= requestedStartAt
  )

  const travelMinutes = estimateTravelMinutes({
    from: {
      lat: previousCommitment?.location?.lat ?? params.technicianOrigin.lat ?? null,
      lng: previousCommitment?.location?.lng ?? params.technicianOrigin.lng ?? null,
    },
    to: { lat: params.requestAddress.lat, lng: params.requestAddress.lng },
    fromArea: {
      suburb: previousCommitment?.location?.suburb ?? params.technicianOrigin.suburb,
      city: previousCommitment?.location?.city ?? params.technicianOrigin.city,
    },
    toArea: {
      suburb: params.requestAddress.suburb,
      city: params.requestAddress.city,
    },
  })

  if (travelMinutes > params.maxTravelMinutes) {
    return {
      isAvailable: false,
      score: 0,
      canMeetWindow: false,
      estimatedStartAt: null,
      estimatedEndAt: null,
      travelMinutes,
      notes: [`Travel estimate ${travelMinutes} minutes exceeds technician max travel`],
      conflictingCommitmentIds,
    } satisfies ScheduleFitResult
  }

  const estimatedStartAt = max([
    requestedStartAt,
    previousCommitment
      ? addMinutes(previousCommitment.endAt, previousCommitment.bufferAfterMinutes + travelMinutes)
      : addMinutes(requestedStartAt, 0),
    params.technicianAvailability?.nextAvailableAt ?? requestedStartAt,
  ])

  const estimatedEndAt = addMinutes(
    estimatedStartAt,
    durationMinutes + MATCHING_CONFIG.scheduleBufferMinutes,
  )

  if (
    params.workingWindow &&
    (estimatedStartAt < params.workingWindow.startAt || estimatedEndAt > params.workingWindow.endAt)
  ) {
    notes.push('Job does not fit within technician working window')
    return {
      isAvailable: false,
      score: 0,
      canMeetWindow: false,
      estimatedStartAt,
      estimatedEndAt,
      travelMinutes,
      notes,
      conflictingCommitmentIds,
    } satisfies ScheduleFitResult
  }

  for (const commitment of params.commitments) {
    const blockedStart = addMinutes(
      commitment.startAt,
      -commitment.bufferBeforeMinutes,
    )
    const blockedEnd = addMinutes(
      commitment.endAt,
      commitment.bufferAfterMinutes,
    )
    const overlaps = areIntervalsOverlapping(
      { start: estimatedStartAt, end: estimatedEndAt },
      { start: blockedStart, end: blockedEnd },
      { inclusive: true },
    )

    if (overlaps) {
      conflictingCommitmentIds.push(commitment.id)
    }
  }

  if (conflictingCommitmentIds.length > 0) {
    notes.push('Existing booking or blocked time conflicts with requested window')
    return {
      isAvailable: false,
      score: 0,
      canMeetWindow: false,
      estimatedStartAt,
      estimatedEndAt,
      travelMinutes,
      notes,
      conflictingCommitmentIds,
    } satisfies ScheduleFitResult
  }

  if (nextCommitment) {
    const latestAllowedEnd = addMinutes(
      nextCommitment.startAt,
      -nextCommitment.bufferBeforeMinutes,
    )
    if (estimatedEndAt > latestAllowedEnd) {
      notes.push('Requested work would break the next scheduled commitment')
      return {
        isAvailable: false,
        score: 0,
        canMeetWindow: false,
        estimatedStartAt,
        estimatedEndAt,
        travelMinutes,
        notes,
        conflictingCommitmentIds: [nextCommitment.id],
      } satisfies ScheduleFitResult
    }
  }

  const windowSpanMinutes = Math.max(
    1,
    Math.round((requestedEndAt.getTime() - requestedStartAt.getTime()) / 60000),
  )
  const latenessMinutes = Math.max(
    0,
    Math.round((estimatedStartAt.getTime() - requestedStartAt.getTime()) / 60000),
  )
  const score = Math.max(0, 1 - latenessMinutes / windowSpanMinutes)

  if (estimatedStartAt > requestedStartAt) {
    notes.push(`Earliest feasible arrival is ${format(estimatedStartAt, 'HH:mm')}`)
  } else {
    notes.push('Fits requested arrival window')
  }

  return {
    isAvailable: true,
    score,
    canMeetWindow: estimatedStartAt <= requestedEndAt,
    estimatedStartAt,
    estimatedEndAt,
    travelMinutes,
    notes,
    conflictingCommitmentIds,
  } satisfies ScheduleFitResult
}
