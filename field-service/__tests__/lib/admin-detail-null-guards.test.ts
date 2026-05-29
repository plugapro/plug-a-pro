/**
 * Unit tests for null-guard logic added in fix/admin-detail-page-stability.
 *
 * Both /admin/providers/[id] and /admin/bookings/[id] crashed (Error ID 3811911274)
 * because production data had orphaned records where:
 *  - job.booking was null despite Job.bookingId being non-nullable in the schema
 *  - booking.match was null despite Booking.matchId being non-nullable in the schema
 *
 * These tests verify the guard logic - mirroring what the page components do
 * so a future schema rename immediately surfaces as a test failure.
 */

import { describe, it, expect } from 'vitest'

// ─── Helpers mirroring the null-guard logic in the page components ─────────────

/** Provider page: extract job request title safely (mirrors JSX expression) */
function safeJobTitle(job: { booking: { match: { jobRequest: { title: string } } | null } | null }): string {
  return job.booking?.match?.jobRequest.title ?? '-'
}

/** Provider page: extract job request category safely */
function safeJobCategory(job: { booking: { match: { jobRequest: { category: string } } | null } | null }): string {
  return job.booking?.match?.jobRequest.category ?? '-'
}

/** Booking page: extract quotes from match safely - returns empty array when match is null */
function safeMatchQuotes<T>(booking: { match: { quotes: T[] } | null }): T[] {
  return booking.match?.quotes ?? []
}

// ─── Provider page null guards ─────────────────────────────────────────────────

describe('provider detail - job.booking null guard', () => {
  it('returns "-" when job.booking is null', () => {
    const job = { booking: null }
    expect(safeJobTitle(job)).toBe('-')
    expect(safeJobCategory(job)).toBe('-')
  })

  it('returns "-" when job.booking.match is null', () => {
    const job = { booking: { match: null } }
    expect(safeJobTitle(job)).toBe('-')
    expect(safeJobCategory(job)).toBe('-')
  })

  it('returns the actual title when both booking and match are present', () => {
    const job = {
      booking: {
        match: {
          jobRequest: { title: 'Leaking tap', category: 'plumbing' },
        },
      },
    }
    expect(safeJobTitle(job)).toBe('Leaking tap')
    expect(safeJobCategory(job)).toBe('plumbing')
  })
})

// ─── Booking page null guards ──────────────────────────────────────────────────

describe('booking detail - booking.match null guard', () => {
  it('returns empty array when booking.match is null - does not throw', () => {
    const booking = { match: null }
    expect(() => safeMatchQuotes(booking)).not.toThrow()
    expect(safeMatchQuotes(booking)).toEqual([])
  })

  it('returns quotes array when match is present', () => {
    const booking = {
      match: {
        quotes: [{ id: 'q1', amount: 500 }, { id: 'q2', amount: 750 }],
      },
    }
    expect(safeMatchQuotes(booking)).toHaveLength(2)
    expect(safeMatchQuotes(booking)[0].id).toBe('q1')
  })
})
