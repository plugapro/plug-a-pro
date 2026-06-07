import { classifyMetaAge } from './age-bucket'
import type { AttachmentRow, InboundMediaCandidate, MetaAgeBucket, PhoneParentHints } from './types'

export type MissingRowGap = {
  mediaIdSuffix: string
  messageType: 'image' | 'document' | 'video'
  phone: string
  ageBucket: MetaAgeBucket
  firstSeenAt: string | null
  replayable: boolean
  candidateParentKinds: string
  candidateParentIds: string
  reason: string
}

const COLUMNS: Array<keyof MissingRowGap> = [
  'mediaIdSuffix', 'messageType', 'phone', 'ageBucket', 'firstSeenAt', 'replayable',
  'candidateParentKinds', 'candidateParentIds', 'reason',
]

function escape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const s = String(value)
  const needsQuoting = /[",\n]/.test(s)
  const inner = s.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

function normalizePhoneKey(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

function hintFor(phone: string, hints?: PhoneParentHints): { kinds: string; ids: string } {
  const h = hints?.get(normalizePhoneKey(phone))
  if (!h) return { kinds: '', ids: '' }
  const kinds: string[] = []
  const ids: string[] = []
  if (h.providerApplicationIds.length > 0) {
    kinds.push('providerApplication')
    for (const id of h.providerApplicationIds) ids.push(`pa:${id}`)
  }
  if (h.jobRequestIds.length > 0) {
    kinds.push('jobRequest')
    for (const id of h.jobRequestIds) ids.push(`jr:${id}`)
  }
  return { kinds: kinds.join(','), ids: ids.join(',') }
}

export function findMissingRows(
  candidates: InboundMediaCandidate[],
  attachments: AttachmentRow[],
  now: Date,
  hints?: PhoneParentHints,
): MissingRowGap[] {
  const haveAttachmentFor = new Set(attachments.map((a) => a.mediaId))
  const out: MissingRowGap[] = []
  for (const c of candidates) {
    if (haveAttachmentFor.has(c.mediaId)) continue
    const bucket = classifyMetaAge(c.firstSeenAt, now)
    const replayable =
      bucket === 'lt_24h' || bucket === '1_to_3d' || bucket === '3_to_7d' || bucket === '7_to_30d'
    const { kinds, ids } = hintFor(c.phone, hints)
    out.push({
      mediaIdSuffix: c.mediaId.slice(-8),
      messageType: c.messageType,
      phone: c.phone,
      ageBucket: bucket,
      firstSeenAt: c.firstSeenAt.toISOString(),
      replayable,
      candidateParentKinds: kinds,
      candidateParentIds: ids,
      reason: replayable
        ? kinds === ''
          ? 'inbound_media_without_attachment_no_parent_hint'
          : 'inbound_media_without_attachment_with_parent_hint'
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
