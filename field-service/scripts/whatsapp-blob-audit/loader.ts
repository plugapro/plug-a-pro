import { db } from '@/lib/db'
import type { AttachmentRow, MediaIdIndex, InboundMediaCandidate } from './types'

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
