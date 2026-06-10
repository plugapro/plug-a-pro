import { describe, expect, it } from 'vitest'

import { buildNudgeCsv } from '@/lib/nudges/csv'
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

  it('joins skills with a pipe in the primary_skills column', () => {
    const csv = buildNudgeCsv([{ ...baseCandidate, skills: ['plumbing', 'painting'] }])
    expect(csv).toContain('plumbing|painting')
  })
})
