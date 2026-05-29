import { describe, expect, it } from 'vitest'
import {
  deriveDefaultArrivalWindow,
  getCustomerAvailabilitySummary,
  validateArrivalWindowAgainstCustomerAvailability,
} from '@/lib/arrival-availability'

const NOW = new Date('2026-04-29T08:00:00+02:00') // Tuesday 08:00 SAST

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
  // ── Afternoons ────────────────────────────────────────────────────────────

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

  // ── Mornings ──────────────────────────────────────────────────────────────

  it('allows mornings only between 06:00 and 12:00', () => {
    expect(validate(
      'Preferred availability: Mornings only',
      '2026-04-29T08:00:00+02:00',
      '2026-04-29T10:00:00+02:00',
    )).toMatchObject({ isValid: true })
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

  // ── Evenings ──────────────────────────────────────────────────────────────

  it('allows evenings only between 17:00 and 20:00', () => {
    expect(validate(
      'Preferred availability: Evenings',
      '2026-04-29T17:00:00+02:00',
      '2026-04-29T19:00:00+02:00',
    )).toMatchObject({ isValid: true })
  })

  it('blocks morning selections for evenings only', () => {
    expect(validate(
      'Preferred availability: Evenings',
      '2026-04-29T09:00:00+02:00',
      '2026-04-29T11:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  // ── Weekends ──────────────────────────────────────────────────────────────

  it('allows weekend selections when customer requested weekends only', () => {
    // 2026-05-02 is a Saturday
    expect(validate(
      'Preferred availability: This weekend',
      '2026-05-02T09:00:00+02:00',
      '2026-05-02T11:00:00+02:00',
    )).toMatchObject({ isValid: true })
  })

  it('blocks weekdays when customer requested weekends only', () => {
    // 2026-04-30 is a Thursday
    expect(validate(
      'Preferred availability: This weekend',
      '2026-04-30T09:00:00+02:00',
      '2026-04-30T11:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  // ── Weekdays ──────────────────────────────────────────────────────────────

  it('allows weekday selections when customer requested weekdays', () => {
    // 2026-04-30 is a Thursday
    expect(validate(
      'Preferred availability: Monday to Friday',
      '2026-04-30T09:00:00+02:00',
      '2026-04-30T11:00:00+02:00',
    )).toMatchObject({ isValid: true })
  })

  it('blocks weekend selections when customer requested weekdays only', () => {
    // 2026-05-02 is a Saturday
    expect(validate(
      'Preferred availability: Monday to Friday',
      '2026-05-02T09:00:00+02:00',
      '2026-05-02T11:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  // ── Specific window ───────────────────────────────────────────────────────

  it('allows arrival inside a specific requested window', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedWindowStart: new Date('2026-04-30T13:00:00+02:00'),
      requestedWindowEnd: new Date('2026-04-30T17:00:00+02:00'),
    })
    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('2026-04-30T14:00:00+02:00'),
      proposedEnd: new Date('2026-04-30T16:00:00+02:00'),
      now: NOW,
    })).toMatchObject({ isValid: true })
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

  // ── ARRIVAL_LATEST ────────────────────────────────────────────────────────

  it('allows an arrival window ending before the deadline', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedArrivalLatest: new Date('2026-04-30T12:00:00+02:00'),
    })
    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('2026-04-30T09:00:00+02:00'),
      proposedEnd: new Date('2026-04-30T11:00:00+02:00'),
      now: NOW,
    })).toMatchObject({ isValid: true })
  })

  it('blocks an arrival window that ends after the deadline', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedArrivalLatest: new Date('2026-04-30T12:00:00+02:00'),
    })
    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('2026-04-30T11:00:00+02:00'),
      proposedEnd: new Date('2026-04-30T13:00:00+02:00'),
      now: NOW,
    })).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    })
  })

  // ── Pre-condition guards ──────────────────────────────────────────────────

  it('rejects a date in the past', () => {
    expect(validate(
      'Preferred availability: Afternoons only',
      '2026-04-28T13:00:00+02:00', // one day before NOW
      '2026-04-28T15:00:00+02:00',
    )).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_DATE_IN_PAST',
    })
  })

  it('rejects an arrival with end time before start time', () => {
    const availability = getCustomerAvailabilitySummary({ description: null })
    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('2026-04-30T15:00:00+02:00'),
      proposedEnd: new Date('2026-04-30T13:00:00+02:00'),
      now: NOW,
    })).toMatchObject({
      isValid: false,
      errorCode: 'ARRIVAL_END_BEFORE_START',
    })
  })

  it('rejects an invalid (NaN) arrival date', () => {
    const availability = getCustomerAvailabilitySummary({ description: null })
    expect(validateArrivalWindowAgainstCustomerAvailability({
      availability,
      proposedStart: new Date('not-a-date'),
      proposedEnd: new Date('2026-04-30T15:00:00+02:00'),
      now: NOW,
    })).toMatchObject({
      isValid: false,
      errorCode: 'INVALID_ARRIVAL_TIME',
    })
  })
})

// ── deriveDefaultArrivalWindow ────────────────────────────────────────────────

describe('deriveDefaultArrivalWindow', () => {
  it('returns the exact requested window for SPECIFIC_WINDOW', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedWindowStart: new Date('2026-04-30T13:00:00+02:00'),
      requestedWindowEnd: new Date('2026-04-30T17:00:00+02:00'),
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    expect(result.date).toBe('2026-04-30')
    expect(result.start).toBe('13:00')
    expect(result.end).toBe('17:00')
  })

  it('returns a 2-hour window ending at the deadline for ARRIVAL_LATEST', () => {
    const availability = getCustomerAvailabilitySummary({
      requestedArrivalLatest: new Date('2026-04-30T12:00:00+02:00'),
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    expect(result.start).toBe('10:00')
    expect(result.end).toBe('12:00')
  })

  it('defaults to 13:00–15:00 for AFTERNOON rule', () => {
    const availability = getCustomerAvailabilitySummary({
      description: 'Preferred availability: Afternoons only',
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    expect(result.start).toBe('13:00')
    expect(result.end).toBe('15:00')
  })

  it('defaults to 08:00–10:00 for MORNING rule', () => {
    const availability = getCustomerAvailabilitySummary({
      description: 'Preferred availability: Mornings only',
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    expect(result.start).toBe('08:00')
    expect(result.end).toBe('10:00')
  })

  it('defaults to 17:00–19:00 for EVENING rule', () => {
    const availability = getCustomerAvailabilitySummary({
      description: 'Preferred availability: Evenings',
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    expect(result.start).toBe('17:00')
    expect(result.end).toBe('19:00')
  })

  it('finds the next Saturday/Sunday for WEEKEND rule', () => {
    // NOW is Tuesday 2026-04-29 - next weekend is 2026-05-02 (Saturday)
    const availability = getCustomerAvailabilitySummary({
      description: 'Preferred availability: This weekend',
    })
    const result = deriveDefaultArrivalWindow(availability, NOW)
    // Date must be a Saturday (day=6) or Sunday (day=0)
    const date = new Date(result.date + 'T00:00:00+02:00')
    expect(date.getDay() === 0 || date.getDay() === 6).toBe(true)
  })

  it('finds the next weekday for WEEKDAY rule when now is on a weekend', () => {
    const saturday = new Date('2026-05-02T08:00:00+02:00') // Saturday
    const availability = getCustomerAvailabilitySummary({
      description: 'Preferred availability: Monday to Friday',
    })
    const result = deriveDefaultArrivalWindow(availability, saturday)
    const date = new Date(result.date + 'T00:00:00+02:00')
    expect(date.getDay() >= 1 && date.getDay() <= 5).toBe(true)
  })
})
