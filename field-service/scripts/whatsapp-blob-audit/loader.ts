import { db } from '@/lib/db'
import type { AttachmentRow, MediaIdIndex } from './types'

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
