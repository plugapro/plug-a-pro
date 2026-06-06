import { describe, it, expect } from 'vitest'
import { selectMissingSections, buildDynamicSchema, SECTION_REGISTRY } from '@/lib/web-signup-sections'

describe('selectMissingSections', () => {
  it('returns all sections when data is empty', () => {
    const r = selectMissingSections({})
    expect(r.map((s) => s.key)).toEqual(SECTION_REGISTRY.map((s) => s.key))
  })

  it('omits sections whose fields are all captured', () => {
    const r = selectMissingSections({ name: 'X', idNumber: '8001015009087', skills: ['plumbing'] })
    expect(r.map((s) => s.key)).not.toContain('identity')
    expect(r.map((s) => s.key)).not.toContain('skills')
  })

  it('keeps a section when at least one of its fields is missing', () => {
    const r = selectMissingSections({ name: 'X' })
    expect(r.map((s) => s.key)).toContain('identity')
  })
})

describe('buildDynamicSchema', () => {
  it('produces a single object schema spanning all included sections', () => {
    const sections = selectMissingSections({})
    const schema = buildDynamicSchema(sections)
    const parsed = schema.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it('accepts a complete payload covering all sections', () => {
    const sections = selectMissingSections({})
    const schema = buildDynamicSchema(sections)
    const payload = {
      name: 'Jane Doe', idNumber: '8001015009087',
      skills: ['plumbing'],
      regionLabel: 'Sandton', cityLabel: 'Sandton',
      availability: ['Mon'],
      hourlyRate: 350,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'Hi I am a plumber with five years experience and a license.',
      references: 'Available on request from past clients on demand.',
      evidenceFileUrls: [],
    }
    const result = schema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})
