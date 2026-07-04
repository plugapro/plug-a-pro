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
