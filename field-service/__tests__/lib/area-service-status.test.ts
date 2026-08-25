import { describe, expect, it } from 'vitest'
import { isNotYetActive, sortAreaResultsLiveFirst } from '@/lib/area-service-status'

describe('sortAreaResultsLiveFirst', () => {
  it('puts live areas before onboarding and coming_soon', () => {
    const sorted = sortAreaResultsLiveFirst([
      { label: 'A', serviceStatus: 'coming_soon' },
      { label: 'B', serviceStatus: 'live' },
      { label: 'C', serviceStatus: 'onboarding' },
    ])
    expect(sorted.map((r) => r.label)).toEqual(['B', 'C', 'A'])
  })

  it('ranks the serviceable duplicate above the unserviceable twin (the two-Northcliff case)', () => {
    const sorted = sortAreaResultsLiveFirst([
      { label: 'Northcliff', regionKey: 'jhb_north', serviceStatus: 'coming_soon' },
      { label: 'Northcliff', regionKey: 'jhb_west', serviceStatus: 'live' },
    ])
    expect(sorted[0].regionKey).toBe('jhb_west')
  })

  it('treats missing/unknown status as coming_soon (last)', () => {
    const sorted = sortAreaResultsLiveFirst([
      { label: 'A' },
      { label: 'B', serviceStatus: 'weird' },
      { label: 'C', serviceStatus: 'live' },
    ])
    expect(sorted[0].label).toBe('C')
  })

  it('is stable within a tier (preserves the API alphabetical order)', () => {
    const sorted = sortAreaResultsLiveFirst([
      { label: 'Alpha', serviceStatus: 'live' },
      { label: 'Beta', serviceStatus: 'live' },
      { label: 'Gamma', serviceStatus: 'live' },
    ])
    expect(sorted.map((r) => r.label)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { label: 'A', serviceStatus: 'coming_soon' },
      { label: 'B', serviceStatus: 'live' },
    ]
    sortAreaResultsLiveFirst(input)
    expect(input[0].label).toBe('A')
  })
})

describe('isNotYetActive', () => {
  it('is false for live and for unknown (no status field on legacy payloads)', () => {
    expect(isNotYetActive('live')).toBe(false)
    expect(isNotYetActive(undefined)).toBe(false)
  })

  it('is true for onboarding and coming_soon', () => {
    expect(isNotYetActive('onboarding')).toBe(true)
    expect(isNotYetActive('coming_soon')).toBe(true)
  })
})
