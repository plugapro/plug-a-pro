import { describe, it, expect } from 'vitest'
import { buildDynamicSchema, selectMissingSections, SECTION_REGISTRY } from '@/lib/web-signup-sections'

// Pure logic tests — no jsdom, no mocks required. gateEnabled is passed as data.

const evidenceSectionDef = SECTION_REGISTRY.find((s) => s.key === 'evidence')!

describe('buildDynamicSchema — evidence gate', () => {
  it('requires ≥3 URLs when gateEnabled: true', () => {
    const schema = buildDynamicSchema([evidenceSectionDef], { gateEnabled: true })

    const oneUrl = schema.safeParse({ evidenceFileUrls: ['https://abc.vercel-storage.com/a.jpg'] })
    expect(oneUrl.success).toBe(false)

    const threeUrls = schema.safeParse({
      evidenceFileUrls: [
        'https://abc.vercel-storage.com/a.jpg',
        'https://abc.vercel-storage.com/b.jpg',
        'https://abc.vercel-storage.com/c.jpg',
      ],
    })
    expect(threeUrls.success).toBe(true)
  })

  it('accepts 0 URLs when gateEnabled: false (optional field)', () => {
    const schema = buildDynamicSchema([evidenceSectionDef], { gateEnabled: false })

    const zeroUrls = schema.safeParse({ evidenceFileUrls: [] })
    expect(zeroUrls.success).toBe(true)

    const noField = schema.safeParse({})
    expect(noField.success).toBe(true)
  })

  it('accepts 0 URLs when opts omitted (backward compat)', () => {
    const schema = buildDynamicSchema([evidenceSectionDef])
    expect(schema.safeParse({}).success).toBe(true)
  })
})

describe('selectMissingSections — certification gate', () => {
  it('includes certification for high-risk skill (plumbing) when gateEnabled: true', () => {
    const sections = selectMissingSections({ skills: ['plumbing'] }, { gateEnabled: true })
    expect(sections.map((s) => s.key)).toContain('certification')
  })

  it('includes certification for regulated skill (electrical) when gateEnabled: true', () => {
    const sections = selectMissingSections({ skills: ['electrical'] }, { gateEnabled: true })
    expect(sections.map((s) => s.key)).toContain('certification')
  })

  it('does not include certification for standard-only skill (painting) when gateEnabled: true', () => {
    const sections = selectMissingSections({ skills: ['painting'] }, { gateEnabled: true })
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })

  it('does not include certification when gateEnabled: false', () => {
    const sections = selectMissingSections({ skills: ['plumbing'] }, { gateEnabled: false })
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })

  it('does not include certification when opts omitted (default false)', () => {
    const sections = selectMissingSections({ skills: ['electrical'] })
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })

  it('does not include certification when certificationRef already captured', () => {
    const sections = selectMissingSections(
      { skills: ['plumbing'], certificationRef: 'WL-2024-001' },
      { gateEnabled: true },
    )
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })
})

// Fix 5: when skills are chosen IN THE FORM (skills not captured), the cert
// section must be available so a high-risk in-form selection has a field to fill.
describe('selectMissingSections / schema — certification available when skills section shown (Fix 5)', () => {
  it('gate ON + skills NOT captured → includes both skills and certification sections', () => {
    const sections = selectMissingSections({}, { gateEnabled: true })
    const keys = sections.map((s) => s.key)
    expect(keys).toContain('skills')
    expect(keys).toContain('certification')
  })

  it('gate OFF + skills NOT captured → does NOT include certification section', () => {
    const sections = selectMissingSections({}, { gateEnabled: false })
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })

  it('gate ON + skills captured non-high-risk (painting) → no certification (captured path unchanged)', () => {
    const sections = selectMissingSections({ skills: ['painting'] }, { gateEnabled: true })
    expect(sections.map((s) => s.key)).not.toContain('certification')
  })

  it('schema: certificationRef is OPTIONAL when the skills section is in-form (non-high-risk selection must not be blocked)', () => {
    // verificationMethod:'skipped' drops the identity section so this test isolates
    // the certification-optionality behaviour.
    const data = { verificationMethod: 'skipped' }
    const sections = selectMissingSections(data, { gateEnabled: true })
    expect(sections.map((s) => s.key)).toContain('certification')
    const schema = buildDynamicSchema(sections, { gateEnabled: true })

    // A non-high-risk selection with no cert must validate (cert optional).
    const nonHighRisk = schema.safeParse({
      name: 'Test Provider',
      skills: ['painting'],
      regionLabel: 'Gauteng',
      cityLabel: 'Johannesburg',
      availability: ['Mon'],
      hourlyRate: 200,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'A sufficiently long bio for validation.',
      references: 'Reference details here',
      evidenceFileUrls: [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ],
      // no certificationRef
    })
    expect(nonHighRisk.success).toBe(true)
  })

  it('schema: certificationRef stays REQUIRED when skills already captured as high-risk (not in-form)', () => {
    // skills captured high-risk + identity skipped → the ONLY remaining required
    // field of interest is certificationRef, so an empty parse must fail on it.
    const sections = selectMissingSections(
      { skills: ['plumbing'], verificationMethod: 'skipped' },
      { gateEnabled: true },
    )
    expect(sections.map((s) => s.key)).toContain('certification')
    const schema = buildDynamicSchema(sections, { gateEnabled: true })
    const withoutCert = schema.safeParse({
      regionLabel: 'Gauteng',
      cityLabel: 'Johannesburg',
      availability: ['Mon'],
      hourlyRate: 200,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'A sufficiently long bio for validation.',
      references: 'Reference details here',
      evidenceFileUrls: [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ],
      // no certificationRef → must fail (cert required when skills captured high-risk)
    })
    expect(withoutCert.success).toBe(false)
  })
})

describe('selectMissingSections — evidence gate (Fix B)', () => {
  it('gate ON + 1 captured URL → includes evidence section (below minimum)', () => {
    const sections = selectMissingSections(
      { evidenceFileUrls: ['https://example.vercel-storage.com/a.jpg'] },
      { gateEnabled: true },
    )
    expect(sections.map((s) => s.key)).toContain('evidence')
  })

  it('gate ON + 2 captured URLs → includes evidence section (still below minimum)', () => {
    const sections = selectMissingSections(
      {
        evidenceFileUrls: [
          'https://example.vercel-storage.com/a.jpg',
          'https://example.vercel-storage.com/b.jpg',
        ],
      },
      { gateEnabled: true },
    )
    expect(sections.map((s) => s.key)).toContain('evidence')
  })

  it('gate ON + 3 captured URLs → does NOT include evidence section (meets minimum)', () => {
    const sections = selectMissingSections(
      {
        evidenceFileUrls: [
          'https://example.vercel-storage.com/a.jpg',
          'https://example.vercel-storage.com/b.jpg',
          'https://example.vercel-storage.com/c.jpg',
        ],
      },
      { gateEnabled: true },
    )
    expect(sections.map((s) => s.key)).not.toContain('evidence')
  })

  it('gate OFF + 1 captured URL → does NOT include evidence section (current behaviour unchanged)', () => {
    const sections = selectMissingSections(
      { evidenceFileUrls: ['https://example.vercel-storage.com/a.jpg'] },
      { gateEnabled: false },
    )
    expect(sections.map((s) => s.key)).not.toContain('evidence')
  })

  it('gate OFF + 0 URLs → includes evidence section (field empty, gate-OFF behaviour)', () => {
    const sections = selectMissingSections({ evidenceFileUrls: [] }, { gateEnabled: false })
    expect(sections.map((s) => s.key)).toContain('evidence')
  })

  it('gate OFF + opts omitted + 1 URL → does NOT include evidence (backward compat)', () => {
    const sections = selectMissingSections({ evidenceFileUrls: ['https://example.vercel-storage.com/a.jpg'] })
    expect(sections.map((s) => s.key)).not.toContain('evidence')
  })
})
