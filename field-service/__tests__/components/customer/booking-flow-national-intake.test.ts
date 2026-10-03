import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// National rollout: the bookings API no longer waitlists customers for being
// outside Johannesburg, so BookingFlow has no "Not in your area yet" screen.
describe('BookingFlow national intake', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/customer/BookingFlow.tsx'),
    'utf8',
  )

  it('has no waitlisted step or copy', () => {
    expect(source).not.toContain("'waitlisted'")
    expect(source).not.toContain('waitlistedCity')
    expect(source).not.toContain('Not in your area yet')
    expect(source).not.toContain('Currently serving')
    expect(source).not.toContain('Area not covered')
  })

  it('treats a submit response without a jobRequestId as a failed submit', () => {
    expect(source).toContain("if (!data.jobRequestId) {")
    expect(source).toContain("throw new Error('We could not create your request. Please try again.')")
  })

  it('keeps the Gauteng picker default (a UI default, not a fence)', () => {
    expect(source).toContain("PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'")
  })
})
