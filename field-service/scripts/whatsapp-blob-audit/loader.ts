import { db } from '@/lib/db'
import type { AttachmentRow, MediaIdIndex, InboundMediaCandidate, PhoneParentHints } from './types'

type RawRow = {
  id: string
  uploadedBy: string
  url: string
  label: string | null
  providerApplicationId: string | null
  jobRequestId: string | null
  jobId: string | null
  inspectionSlotId: string | null
}

function parentFromRow(r: RawRow): { parentKind: AttachmentRow['parentKind']; parentId: string | null } {
  if (r.providerApplicationId) return { parentKind: 'providerApplication', parentId: r.providerApplicationId }
  if (r.jobRequestId) return { parentKind: 'jobRequest', parentId: r.jobRequestId }
  if (r.jobId) return { parentKind: 'job', parentId: r.jobId }
  if (r.inspectionSlotId) return { parentKind: 'inspectionSlot', parentId: r.inspectionSlotId }
  return { parentKind: null, parentId: null }
}

export async function loadAttachments(): Promise<AttachmentRow[]> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT id, "uploadedBy", url, label,
            "providerApplicationId", "jobRequestId", "jobId", "inspectionSlotId"
     FROM attachments
     WHERE "uploadedBy" LIKE 'system:whatsapp:%'`,
  )
  return rows.map((r) => {
    const { parentKind, parentId } = parentFromRow(r)
    return {
      id: r.id,
      mediaId: r.uploadedBy.slice('system:whatsapp:'.length),
      url: r.url,
      label: r.label,
      parentKind,
      parentId,
    }
  })
}

export async function loadMediaIdIndex(): Promise<MediaIdIndex> {
  const rows = await db.$queryRawUnsafe<Array<{ media_id: string; firstSeenAt: Date }>>(
    `SELECT
       payload -> "messageType" ->> 'id' AS media_id,
       "firstSeenAt"
     FROM inbound_whatsapp_messages
     WHERE "messageType" IN ('image','document','video')`,
  )
  const index: MediaIdIndex = new Map()
  for (const r of rows) {
    if (r.media_id) index.set(r.media_id, r.firstSeenAt)
  }
  return index
}

export async function loadInboundMediaCandidates(): Promise<InboundMediaCandidate[]> {
  const rows = await db.$queryRawUnsafe<Array<{ media_id: string | null; phone: string; messageType: string; firstSeenAt: Date }>>(
    `SELECT
       payload -> "messageType" ->> 'id' AS media_id,
       phone,
       "messageType",
       "firstSeenAt"
     FROM inbound_whatsapp_messages
     WHERE "messageType" IN ('image','document','video')`,
  )
  const out: InboundMediaCandidate[] = []
  for (const r of rows) {
    if (!r.media_id) continue
    if (r.messageType !== 'image' && r.messageType !== 'document' && r.messageType !== 'video') continue
    out.push({
      mediaId: r.media_id,
      phone: r.phone,
      messageType: r.messageType,
      firstSeenAt: r.firstSeenAt,
    })
  }
  return out
}

// Phone key normalization: inbound_whatsapp_messages.phone stores the raw
// Meta-supplied digits (e.g., '27768196963') while provider_applications.phone
// and customers.phone store the E.164 form with leading '+'. Strip the '+' on
// both sides so map keys match regardless of which side is the canonical store.
export function normalizePhoneKey(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

// FK-resolution hint loader. Given the unique set of phones from inbound
// candidates, returns the ProviderApplication and JobRequest IDs each phone
// has in live prod. The recovery script can pin the right parent via
// closest-time matching; this audit just enumerates the candidates so the
// operator can review which media maps to which entity.
//
// Read-only: SELECTs against provider_applications + job_requests/customers.
// Uses parameterised array binding so the phone list cannot break out of the
// query string. The WHERE clauses normalise the stored phone by stripping a
// leading '+' so they match the normalised array bind argument.
export async function loadPhoneParentHints(phones: string[]): Promise<PhoneParentHints> {
  const hints: PhoneParentHints = new Map()
  if (phones.length === 0) return hints
  const normalizedUnique = Array.from(new Set(phones.map(normalizePhoneKey)))

  const apps = await db.$queryRawUnsafe<Array<{ id: string; phone: string }>>(
    `SELECT id, phone
     FROM provider_applications
     WHERE regexp_replace(phone, '^\\+', '') = ANY($1::text[])`,
    normalizedUnique,
  )
  for (const a of apps) {
    const key = normalizePhoneKey(a.phone)
    const entry = hints.get(key) ?? { providerApplicationIds: [], jobRequestIds: [] }
    entry.providerApplicationIds.push(a.id)
    hints.set(key, entry)
  }

  const jrs = await db.$queryRawUnsafe<Array<{ id: string; phone: string }>>(
    `SELECT jr.id, c.phone
     FROM job_requests jr
     JOIN customers c ON c.id = jr."customerId"
     WHERE regexp_replace(c.phone, '^\\+', '') = ANY($1::text[])`,
    normalizedUnique,
  )
  for (const j of jrs) {
    const key = normalizePhoneKey(j.phone)
    const entry = hints.get(key) ?? { providerApplicationIds: [], jobRequestIds: [] }
    entry.jobRequestIds.push(j.id)
    hints.set(key, entry)
  }

  return hints
}
