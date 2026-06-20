import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The v2 worklist already accepts a `kyc` URL filter via
// filtersFromSearchParams / applyFilters in lib/applications-queue.ts, but for
// a long time the UI had no chip for it — admins had to construct the URL
// manually. This test pins the chip into the v2 view so the UI gap stays
// closed.
//
// The chip mirrors the KycStatus prisma enum (NOT_STARTED, IN_PROGRESS,
// SUBMITTED, VERIFIED, REJECTED, EXPIRED) and collapses IN_PROGRESS +
// SUBMITTED into a single "Started" option to match how admins talk about
// these states in stand-ups.
describe('applications v2 view — KYC status filter chip', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/(admin)/admin/applications/applications-v2-view.tsx'),
    'utf8',
  )

  it('renders a KYC FilterChipGroup wired to the kyc filter key', () => {
    expect(source).toContain('label="KYC"')
    // The filterKey union in FilterChipGroup must include 'kyc' so this would
    // not even type-check before the implementation lands.
    expect(source).toMatch(/filterKey=("|')kyc("|')/)
  })

  it('offers a chip option for every Prisma KycStatus value plus "Any"', () => {
    // "Any" — clears the filter.
    expect(source).toMatch(/value:\s*null,\s*label:\s*'Any'/)
    // Terminal / explicit KYC states.
    expect(source).toContain("value: 'NOT_STARTED'")
    expect(source).toContain("value: 'VERIFIED'")
    expect(source).toContain("value: 'REJECTED'")
    expect(source).toContain("value: 'EXPIRED'")
    // The combined "started but not yet verified" option uses one of the
    // in-flight enum values so the existing applyFilters() path matches.
    expect(source).toMatch(/value:\s*'(IN_PROGRESS|SUBMITTED)'/)
  })
})
