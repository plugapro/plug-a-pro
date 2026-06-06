import { classifyAge } from './age-bucket'
import type { AttachmentRow, GapRow, HeadResult, MediaIdIndex } from './types'

const COLUMNS: Array<keyof GapRow> = [
  'attachmentId', 'mediaIdSuffix', 'ageBucket', 'parentKind', 'parentId',
  'label', 'httpStatus', 'firstSeenAt', 'replayable', 'reason',
]

function escape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const s = String(value)
  const needsQuoting = /[",\n]/.test(s)
  const inner = s.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

export function buildGapRows(
  attachments: AttachmentRow[],
  headResults: HeadResult[],
  mediaIndex: MediaIdIndex,
  now: Date,
): GapRow[] {
  const attachmentById = new Map(attachments.map((a) => [a.id, a]))
  const out: GapRow[] = []
  for (const head of headResults) {
    if (head.status === 'alive') continue
    const att = attachmentById.get(head.attachmentId)
    if (!att) continue
    const firstSeen = mediaIndex.get(att.mediaId) ?? null
    const bucket = classifyAge(firstSeen, now)
    const replayable = bucket === 'lt_24h' || bucket === '1_to_3d' || bucket === '3_to_7d'
    out.push({
      attachmentId: att.id,
      mediaIdSuffix: att.mediaId.slice(-8),
      ageBucket: bucket,
      parentKind: att.parentKind,
      parentId: att.parentId,
      label: att.label,
      httpStatus: head.httpStatus,
      firstSeenAt: firstSeen ? firstSeen.toISOString() : null,
      replayable,
      reason: replayable ? 'dead_blob_within_meta_window' : bucket === 'unknown' ? 'no_inbound_record_found' : 'dead_blob_beyond_meta_window',
    })
  }
  return out
}

export function gapRowsToCsv(rows: GapRow[]): string {
  const header = COLUMNS.join(',')
  const body = rows
    .map((row) => COLUMNS.map((c) => escape((row[c] ?? null) as string | number | boolean | null)).join(','))
    .join('\n')
  return body ? `${header}\n${body}` : header
}
