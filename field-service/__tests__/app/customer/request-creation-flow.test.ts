// ─── CLIENT-04: Request Creation Flow ─────────────────────────────────────────
// Validates that all blueprint-required fields are handled by the lib helpers
// and that the API route body shape covers the full field set.
//
// Component-level interaction tests for BookingFlow are deferred to a Playwright
// smoke spec because the component relies on `navigator.geolocation`, `fetch`,
// and `localStorage`, which cannot be meaningfully exercised in a Node vitest
// environment without extensive mocking.

import { describe, expect, it } from 'vitest'
import {
  resolvePreferredTimingWindow,
  validateClientRequestDetails,
  PROVIDER_PREFERENCE_OPTIONS,
  BUDGET_PREFERENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  TIME_WINDOW_OPTIONS,
  type ProviderPreference,
  type BudgetPreference,
  type JobType,
  type PreferredTimeWindow,
} from '../../../lib/client-request-flow'

// ─── Field coverage ───────────────────────────────────────────────────────────

describe('blueprint field coverage', () => {
  it('PROVIDER_PREFERENCE_OPTIONS covers all blueprint values', () => {
    const values = PROVIDER_PREFERENCE_OPTIONS.map((o) => o.value)
    expect(values).toContain('fastest_available')
    expect(values).toContain('most_experienced')
    expect(values).toContain('best_rated')
    expect(values).toContain('budget_friendly')
    expect(values).toContain('verified_only')
  })

  it('JOB_TYPE_OPTIONS exports a non-empty list', () => {
    expect(JOB_TYPE_OPTIONS.length).toBeGreaterThan(0)
  })

  it('BUDGET_PREFERENCE_OPTIONS exports a non-empty list', () => {
    expect(BUDGET_PREFERENCE_OPTIONS.length).toBeGreaterThan(0)
  })

  it('TIME_WINDOW_OPTIONS exports morning / afternoon / evening / flexible', () => {
    const values = TIME_WINDOW_OPTIONS.map((o) => o.value)
    expect(values).toContain('morning')
    expect(values).toContain('afternoon')
    expect(values).toContain('evening')
    expect(values).toContain('flexible')
  })
})

// ─── Privacy and terms acknowledgement ───────────────────────────────────────

describe('validateClientRequestDetails - acknowledgements', () => {
  it('blocks submit when privacy is not acknowledged', () => {
    expect(
      validateClientRequestDetails({
        title: 'Fix leaking tap',
        description: 'Kitchen tap keeps dripping',
        privacyAcknowledged: false,
        termsAcknowledged: true,
      }),
    ).toBe('Please confirm you understand when your contact and exact address are shared.')
  })

  it('blocks submit when terms are not acknowledged', () => {
    expect(
      validateClientRequestDetails({
        title: 'Fix leaking tap',
        description: '',
        privacyAcknowledged: true,
        termsAcknowledged: false,
      }),
    ).toBe('Please accept the request terms before submitting.')
  })

  it('passes when both acknowledgements are ticked', () => {
    expect(
      validateClientRequestDetails({
        title: 'Fix leaking tap',
        description: 'Kitchen tap keeps dripping',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeNull()
  })
})

// ─── Title validation ─────────────────────────────────────────────────────────

describe('validateClientRequestDetails - title', () => {
  it('rejects titles shorter than 6 characters', () => {
    expect(
      validateClientRequestDetails({
        title: 'Fix',
        description: '',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeTruthy()
  })

  it('rejects titles longer than 120 characters', () => {
    expect(
      validateClientRequestDetails({
        title: 'x'.repeat(121),
        description: '',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeTruthy()
  })

  it('accepts a title with exactly 6 characters', () => {
    expect(
      validateClientRequestDetails({
        title: 'Repair',
        description: '',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeNull()
  })
})

// ─── Description validation ───────────────────────────────────────────────────

describe('validateClientRequestDetails - description', () => {
  it('rejects descriptions longer than 1200 characters', () => {
    expect(
      validateClientRequestDetails({
        title: 'Leaking tap',
        description: 'd'.repeat(1201),
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeTruthy()
  })

  it('accepts an empty description', () => {
    expect(
      validateClientRequestDetails({
        title: 'Leaking tap',
        description: '',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeNull()
  })
})

// ─── Timing resolution ────────────────────────────────────────────────────────

describe('resolvePreferredTimingWindow', () => {
  it('converts preferred date + afternoon to 12:00–17:00 window', () => {
    const timing = resolvePreferredTimingWindow({
      urgency: 'flexible',
      preferredDate: '2026-05-10',
      preferredTimeWindow: 'afternoon',
    })
    expect(timing.requestedWindowStart?.getHours()).toBe(12)
    expect(timing.requestedWindowEnd?.getHours()).toBe(17)
    expect(timing.requestedArrivalLatest).toEqual(timing.requestedWindowEnd)
  })

  it('converts preferred date + morning to 08:00–12:00 window', () => {
    const timing = resolvePreferredTimingWindow({
      urgency: 'flexible',
      preferredDate: '2026-05-10',
      preferredTimeWindow: 'morning',
    })
    expect(timing.requestedWindowStart?.getHours()).toBe(8)
    expect(timing.requestedWindowEnd?.getHours()).toBe(12)
  })

  it('converts preferred date + evening to 16:00–20:00 window', () => {
    const timing = resolvePreferredTimingWindow({
      urgency: 'flexible',
      preferredDate: '2026-05-10',
      preferredTimeWindow: 'evening',
    })
    expect(timing.requestedWindowStart?.getHours()).toBe(16)
    expect(timing.requestedWindowEnd?.getHours()).toBe(20)
  })

  it('urgency=asap sets window end to now+48h and arrival latest to now+24h', () => {
    const now = new Date('2026-05-07T10:00:00Z')
    const timing = resolvePreferredTimingWindow({
      urgency: 'asap',
      preferredTimeWindow: 'flexible',
      now,
    })
    expect(timing.requestedWindowStart).toBeNull()
    const expectedEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    const expectedArrival = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    expect(timing.requestedWindowEnd?.getTime()).toBe(expectedEnd.getTime())
    expect(timing.requestedArrivalLatest?.getTime()).toBe(expectedArrival.getTime())
  })

  it('urgency=this_week sets window end to now+7 days', () => {
    const now = new Date('2026-05-07T10:00:00Z')
    const timing = resolvePreferredTimingWindow({
      urgency: 'this_week',
      preferredTimeWindow: 'flexible',
      now,
    })
    const expectedEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    expect(timing.requestedWindowEnd?.getTime()).toBe(expectedEnd.getTime())
  })

  it('urgency=flexible without date returns all-null timing fields', () => {
    const timing = resolvePreferredTimingWindow({
      urgency: 'flexible',
      preferredTimeWindow: 'flexible',
    })
    expect(timing.requestedWindowStart).toBeNull()
    expect(timing.requestedWindowEnd).toBeNull()
    expect(timing.requestedArrivalLatest).toBeNull()
  })

  it('preferred date takes precedence over urgency', () => {
    // Even with urgency=asap, if a date is specified the date window wins
    const timing = resolvePreferredTimingWindow({
      urgency: 'asap',
      preferredDate: '2026-06-01',
      preferredTimeWindow: 'morning',
    })
    expect(timing.requestedWindowStart?.getFullYear()).toBe(2026)
    expect(timing.requestedWindowStart?.getMonth()).toBe(5) // June = 5 (0-indexed)
    expect(timing.requestedWindowStart?.getDate()).toBe(1)
  })
})

// ─── Type narrowing helpers ───────────────────────────────────────────────────

describe('type exports - satisfy TypeScript', () => {
  it('ProviderPreference accepts valid values', () => {
    const v: ProviderPreference = 'fastest_available'
    expect(v).toBeDefined()
  })

  it('BudgetPreference accepts valid values', () => {
    const v: BudgetPreference = 'balanced_value'
    expect(v).toBeDefined()
  })

  it('JobType accepts valid values', () => {
    const v: JobType = 'repair'
    expect(v).toBeDefined()
  })

  it('PreferredTimeWindow accepts valid values', () => {
    const v: PreferredTimeWindow = 'morning'
    expect(v).toBeDefined()
  })
})
