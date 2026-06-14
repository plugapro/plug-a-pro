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
  // CSV formula injection: a cell starting with = + - @ (or tab/CR) is treated as
  // a formula by Excel/Sheets/LibreOffice. Provider-controlled fields (name,
  // skills, message) flow into this export, so prefix a single quote to force
  // text interpretation. Always quote such cells so the prefix can't be split.
  if (/^[=+\-@\t\r]/.test(s)) {
    return `"'${s.replace(/"/g, '""')}"`
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// Slugs are hierarchical (province__city__region__suburb); ops only need the suburb.
export function humanizeSuburbSlug(slug: string | null | undefined): string {
  if (!slug) return ''
  const segment = slug.split('__').pop() ?? slug
  return segment
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function rowFor(c: NudgeCandidate): string[] {
  return [
    c.providerId,
    c.name ?? '',
    c.phone ?? '',
    c.tier,
    c.skills.join('|'),
    c.missingItems.join('|'),
    humanizeSuburbSlug(c.serviceAreas[0]),
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
