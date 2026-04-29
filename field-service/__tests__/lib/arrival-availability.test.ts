import { describe, expect, it } from 'vitest'
import {
  getCustomerAvailabilitySummary,
  validateArrivalWindowAgainstCustomerAvailability,
} from '@/lib/arrival-availability'

const NOW = new Date('2026-04-29T08:00:00+02:00')

function validate(description: string, start: string, end: string) {
  const availability = getCustomerAvailabilitySummary({ description })
  return validateArrivalWindowAgainstCustomerAvailability({
    availability,
    proposedStart: new Date(start),
    proposedEnd: new Date(end),
    now: NOW,
  })
}

describe('arrival availability validation', () => {
  it('allows afternoons only between 12:00 and 17:00', () => {
    expect(validate(
      'Preferred availability: Afternoons only',
      '2026-04-29T13:00:00+02:00',
      '2026-04-29T15:00:00+02:00',
    )).toMatchObject({ isValid: true })
  })

  it('blocks morning selections for afternoons only', () => {
    expect(validate(
      'Preferred availability: Afternoons only',
      '2026-04-29T09:00:00+02:00',
      '2026-04-29T11:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  it('blocks afternoon selections for mornings only', () => {
    expect(validate(
      'Preferred availability: Mornings only',
      '2026-04-29T13:00:00+02:00',
      '2026-04-29T15:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  it('blocks weekdays when customer requested weekends only', () => {
    expect(validate(
      'Preferred availability: This weekend',
      '2026-04-30T09:00:00+02:00',
      '2026-04-30T11:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  it('blocks other dates for a specific requested window', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedWindowStart: new Date('2026-04-30T13:00:00+02:00'),
      requestedWindowEnd: new Date('2026-04-30T17:00:00+02:00'),
    })

    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('2026-05-01T13:00:00+02:00'),
      proposedEnd: new Date('2026-05-01T15:00:00+02:00'),
      now: NOW,
    })).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })
})
