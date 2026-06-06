import { describe, it, expect } from 'vitest'
import { selectMissingSections, buildDynamicSchema, SECTION_REGISTRY } from '@/lib/web-signup-sections'

describe('selectMissingSections', () => {
  it('returns all sections when data is empty', () => {
    const r = selectMissingSections({})
    expect(r.map((s) => s.key)).toEqual(SECTION_REGISTRY.map((s) => s.key))
  })

  it('omits name and identity sections when both are captured', () => {
    const r = selectMissingSections({ name: 'X', idNumber: '8001015009087', skills: ['plumbing'] })
    expect(r.map((s) => s.key)).not.toContain('name')
    expect(r.map((s) => s.key)).not.toContain('identity')
    expect(r.map((s) => s.key)).not.toContain('skills')
  })

  it('omits identity section when provider deferred verification on WhatsApp', () => {
    const r = selectMissingSections({ name: 'Thabo Nkosi', verificationMethod: 'skipped' })
    expect(r.map((s) => s.key)).not.toContain('identity')
    expect(r.map((s) => s.key)).not.toContain('name')
  })

  it('omits identity section when verification document attachment present', () => {
    const r = selectMissingSections({ name: 'Thabo', verificationDocAttachmentId: 'att-123' })
    expect(r.map((s) => s.key)).not.toContain('identity')
  })

  it('omits identity section when selfie attachment present', () => {
    const r = selectMissingSections({ name: 'Thabo', verificationSelfieAttachmentId: 'att-456' })
    expect(r.map((s) => s.key)).not.toContain('identity')
  })

  it('still includes identity when no deferral and no idNumber captured', () => {
    const r = selectMissingSections({ name: 'Thabo' })
    expect(r.map((s) => s.key)).toContain('identity')
  })

  it('keeps name section when idNumber is captured but name is missing', () => {
    const r = selectMissingSections({ idNumber: '8001015009087' })
    expect(r.map((s) => s.key)).toContain('name')
    expect(r.map((s) => s.key)).not.toContain('identity')
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
      availability: ['Mon'], hourlyRate: 350,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'Hi I am a plumber with five years experience and a license.',
      references: 'Available on request from past clients on demand.',
      evidenceFileUrls: [],
    }
    expect(schema.safeParse(payload).success).toBe(true)
  })

  it('produces a schema without idNumber required when provider deferred verification', () => {
    const sections = selectMissingSections({ verificationMethod: 'skipped' })
    const schema = buildDynamicSchema(sections)
    // Note: name is still required since 'name' is its own section
    const payload = {
      name: 'Jane Doe',
      skills: ['plumbing'],
      regionLabel: 'Sandton', cityLabel: 'Sandton',
      availability: ['Mon'], hourlyRate: 350,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'Hi I am a plumber with five years experience and a license.',
      references: 'Available on request from past clients on demand.',
      evidenceFileUrls: [],
    }
    expect(schema.safeParse(payload).success).toBe(true)
  })
})
