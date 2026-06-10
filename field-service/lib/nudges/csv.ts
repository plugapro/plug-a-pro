// ─── West Rand pilot — nudge CSV builder ────────────────────────────────────
// Builds the export consumed by ops who send the nudges externally
// (WhatsApp Business app, manual paste, future Meta-template send).
// Spec column order is fixed; reorder by editing CSV_COLUMNS.

import type { NudgeCandidate } from './queue'

export const CSV_COLUMNS = [
  'provider_id',
  'name',
  'phone',
  'tier',
  'primary_skills',
  'missing_items',
  'suburb_label',
  'application_status',
  'rendered_message',
] as const

function escapeCell(value: string | null | undefined): string {
  const s = value ?? ''
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowFor(c: NudgeCandidate): string[] {
  return [
    c.providerId,
    c.name ?? '',
    c.phone ?? '',
    c.tier,
    c.skills.join('|'),
    c.missingItems.join('|'),
    c.serviceAreas[0] ?? '',
    c.applicationStatus ?? '',
    c.renderedMessage,
  ]
}

export function buildNudgeCsv(candidates: NudgeCandidate[]): string {
  const lines: string[] = []
  lines.push(CSV_COLUMNS.join(','))
  for (const c of candidates) {
    lines.push(rowFor(c).map(escapeCell).join(','))
  }
  return lines.join('\n') + '\n'
}
