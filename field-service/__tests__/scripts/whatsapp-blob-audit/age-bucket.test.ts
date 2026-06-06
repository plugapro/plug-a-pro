import { describe, it, expect } from 'vitest'
import { classifyAge } from '@/scripts/whatsapp-blob-audit/age-bucket'

const now = new Date('2026-06-06T12:00:00Z')

describe('classifyAge', () => {
  it('lt_24h for < 24h old', () => {
    expect(classifyAge(new Date('2026-06-06T08:00:00Z'), now)).toBe('lt_24h')
  })

  it('1_to_3d for >= 24h and < 72h', () => {
    expect(classifyAge(new Date('2026-06-04T13:00:00Z'), now)).toBe('1_to_3d')
  })

  it('3_to_7d for >= 72h and < 168h', () => {
    expect(classifyAge(new Date('2026-06-01T13:00:00Z'), now)).toBe('3_to_7d')
  })

  it('gt_7d for >= 168h', () => {
    expect(classifyAge(new Date('2026-05-29T11:00:00Z'), now)).toBe('gt_7d')
  })

  it('unknown when firstSeenAt is null', () => {
    expect(classifyAge(null, now)).toBe('unknown')
  })
})
