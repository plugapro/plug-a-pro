import { classifyAge } from './age-bucket'
import type { AgeBucket, AttachmentRow, InboundMediaCandidate } from './types'

export type MissingRowGap = {
  mediaIdSuffix: string
  messageType: 'image' | 'document' | 'video'
  phone: string
  ageBucket: AgeBucket
  firstSeenAt: string | null
  replayable: boolean
  reason: string
}

const COLUMNS: Array<keyof MissingRowGap> = [
  'mediaIdSuffix', 'messageType', 'phone', 'ageBucket', 'firstSeenAt', 'replayable', 'reason',
]

function escape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const s = String(value)
  const needsQuoting = /[",\n]/.test(s)
  const inner = s.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

export function findMissingRows(
  candidates: InboundMediaCandidate[],
  attachments: AttachmentRow[],
  now: Date,
): MissingRowGap[] {
  const haveAttachmentFor = new Set(attachments.map((a) => a.mediaId))
  const out: MissingRowGap[] = []
  for (const c of candidates) {
    if (haveAttachmentFor.has(c.mediaId)) continue
    const bucket = classifyAge(c.firstSeenAt, now)
    const replayable = bucket === 'lt_24h' || bucket === '1_to_3d' || bucket === '3_to_7d'
    out.push({
      mediaIdSuffix: c.mediaId.slice(-8),
      messageType: c.messageType,
      phone: c.phone,
      ageBucket: bucket,
      firstSeenAt: c.firstSeenAt.toISOString(),
      replayable,
      reason: replayable
        ? 'inbound_media_without_attachment_within_meta_window'
        : bucket === 'unknown'
          ? 'inbound_media_without_attachment_unknown_age'
          : 'inbound_media_without_attachment_beyond_meta_window',
    })
  }
  return out
}

export function missingRowsToCsv(rows: MissingRowGap[]): string {
  const header = COLUMNS.join(',')
  const body = rows
    .map((row) => COLUMNS.map((c) => escape((row[c] ?? null) as string | number | boolean | null)).join(','))
    .join('\n')
  return body ? `${header}\n${body}` : header
}
