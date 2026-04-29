import { describe, expect, it } from 'vitest'
import { addHours } from 'date-fns'
import { buildWorkingWindow, evaluateScheduleFit } from '../../lib/matching/scheduling'

const baseRequest = {
  id: 'jr-1',
  category: 'plumbing',
  title: 'Leaking tap',
  description: 'Kitchen leak',
  requestedWindowStart: new Date('2026-04-14T08:00:00.000Z'),
  requestedWindowEnd: new Date('2026-04-14T10:00:00.000Z'),
  requestedArrivalLatest: new Date('2026-04-14T09:00:00.000Z'),
  estimatedDurationMinutes: 90,
  requiredSkillTags: ['plumbing'],
  requiredCertificationCodes: [],
  requiredEquipmentTags: [],
  requiredVehicleTypes: [],
  customerAcceptedAmount: null,
  customerAcceptedScope: null,
  autoCreateBookingOnAssignment: false,
  preferredProviderId: null,
  assignmentMode: 'AUTO_ASSIGN' as const,
  status: 'OPEN' as const,
  expiresAt: null,
}

const requestAddress = {
  street: '1 Main St',
  suburb: 'Sandton',
  city: 'Johannesburg',
  province: 'Gauteng',
  lat: -26.1076,
  lng: 28.0567,
  locationNodeId: null,
  regionKey: null,
  provinceKey: null,
}

describe('evaluateScheduleFit', () => {
  it('rejects a technician whose existing booking overlaps the requested work window', () => {
    const result = evaluateScheduleFit({
      jobRequest: baseRequest,
      requestAddress,
      workingWindow: buildWorkingWindow({
        requestStartAt: baseRequest.requestedWindowStart!,
        schedule: { startTime: '07:00', endTime: '17:00' },
      }),
      technicianAvailability: null,
      commitments: [
        {
          id: 'booking-1',
          type: 'BOOKING',
          title: 'Existing booking',
          startAt: new Date('2026-04-14T08:30:00.000Z'),
          endAt: new Date('2026-04-14T10:00:00.000Z'),
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
        },
      ],
      technicianOrigin: { suburb: 'Sandton', city: 'Johannesburg', lat: -26.1076, lng: 28.0567 },
      maxTravelMinutes: 90,
    })

    expect(result.isAvailable).toBe(false)
    expect(result.conflictingCommitmentIds).toContain('booking-1')
  })

  it('rejects a technician when the job would break the next commitment', () => {
    const result = evaluateScheduleFit({
      jobRequest: {
        ...baseRequest,
        requestedWindowStart: new Date('2026-04-14T09:00:00.000Z'),
        requestedWindowEnd: new Date('2026-04-14T10:00:00.000Z'),
        estimatedDurationMinutes: 120,
      },
      requestAddress,
      workingWindow: buildWorkingWindow({
        requestStartAt: baseRequest.requestedWindowStart!,
        schedule: { startTime: '07:00', endTime: '17:00' },
      }),
      technicianAvailability: null,
      commitments: [
        {
          id: 'booking-next',
          type: 'BOOKING',
          title: 'Next booking',
          startAt: new Date('2026-04-14T11:00:00.000Z'),
          endAt: new Date('2026-04-14T12:00:00.000Z'),
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
        },
      ],
      technicianOrigin: { suburb: 'Sandton', city: 'Johannesburg', lat: -26.1076, lng: 28.0567 },
      maxTravelMinutes: 90,
    })

    expect(result.isAvailable).toBe(false)
    expect(result.conflictingCommitmentIds.length).toBeGreaterThan(0)
  })

  it('accepts a feasible back-to-back job when travel and buffers still fit', () => {
    const result = evaluateScheduleFit({
      jobRequest: {
        ...baseRequest,
        requestedWindowStart: new Date('2026-04-14T11:30:00.000Z'),
        requestedWindowEnd: new Date('2026-04-14T13:30:00.000Z'),
      },
      requestAddress,
      workingWindow: buildWorkingWindow({
        requestStartAt: baseRequest.requestedWindowStart!,
        schedule: { startTime: '07:00', endTime: '17:00' },
      }),
      technicianAvailability: { availabilityState: 'AVAILABLE', nextAvailableAt: null, breakUntil: null } as any,
      commitments: [
        {
          id: 'booking-previous',
          type: 'BOOKING',
          title: 'Previous booking',
          startAt: new Date('2026-04-14T09:00:00.000Z'),
          endAt: new Date('2026-04-14T11:00:00.000Z'),
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
          location: { suburb: 'Sandton', city: 'Johannesburg', lat: -26.1076, lng: 28.0567 },
        },
        {
          id: 'booking-next',
          type: 'BOOKING',
          title: 'Next booking',
          startAt: new Date('2026-04-14T15:30:00.000Z'),
          endAt: addHours(new Date('2026-04-14T15:30:00.000Z'), 1),
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
        },
      ],
      technicianOrigin: { suburb: 'Sandton', city: 'Johannesburg', lat: -26.1076, lng: 28.0567 },
      maxTravelMinutes: 90,
    })

    expect(result.isAvailable).toBe(true)
    expect(result.canMeetWindow).toBe(true)
    expect(result.travelMinutes).toBeGreaterThan(0)
  })
})
