import { describe, it, expect } from 'vitest'
import { areaInPilot, computeInPilotArea } from '@/lib/ops-agents/pilot-area'

describe('areaInPilot', () => {
  it('matches the canonical pilot suburb slug', () => {
    expect(areaInPilot('gauteng__johannesburg__jhb_west__honeydew')).toBe(true)
  })

  it('matches a jhb_west / west-rand region marker', () => {
    expect(areaInPilot('jhb_west')).toBe(true)
    expect(areaInPilot('gauteng-west_rand-something')).toBe(true)
  })

  it('matches human-readable pilot suburb NAMES (the format applications store)', () => {
    expect(areaInPilot('Honeydew')).toBe(true)
    expect(areaInPilot('Constantia Kloof')).toBe(true)
    expect(areaInPilot('Little Falls')).toBe(true)
    expect(areaInPilot('florida')).toBe(true)
    expect(areaInPilot('Randpark Ridge')).toBe(true)
  })

  it('does NOT match a non-pilot suburb name', () => {
    expect(areaInPilot('Benoni')).toBe(false)
    expect(areaInPilot('Centurion')).toBe(false)
    expect(areaInPilot('Midrand')).toBe(false)
  })

  it('returns false for empty/nullish input', () => {
    expect(areaInPilot('')).toBe(false)
    expect(areaInPilot(null)).toBe(false)
    expect(areaInPilot(undefined)).toBe(false)
  })
})

describe('computeInPilotArea', () => {
  it('is true when any area is a pilot suburb name', () => {
    expect(computeInPilotArea(['Benoni', 'Honeydew'])).toBe(true)
  })

  it('is false when areas are given but none are in the footprint', () => {
    expect(computeInPilotArea(['Benoni', 'Centurion', 'Midrand'])).toBe(false)
  })

  it('is null when no areas are given (unknown, not "out of area")', () => {
    expect(computeInPilotArea([])).toBeNull()
    expect(computeInPilotArea([null, undefined, '  '])).toBeNull()
  })
})
