import { db } from '@/lib/db'
import { classifyMetaAge } from '../whatsapp-blob-audit/age-bucket'
import { loadAttachments, loadInboundMediaCandidates, loadPhoneParentHints, normalizePhoneKey } from '../whatsapp-blob-audit/loader'
import type { AttachmentSnapshot, IngestPlan, IngestPlanRow, IngestSkippedRow } from './types'

// Read-only snapshot of the attachments table. Used at plan time as a baseline
// that apply will re-check before writing. If the live count has dropped below
// the snapshot, the plan is stale (someone deleted attachments out from under
// us) and apply must refuse.
async function loadAttachmentSnapshot(): Promise<AttachmentSnapshot> {
  const rows = await db.$queryRawUnsafe<Array<{ total: bigint; wa: bigint; max_at: Date | null }>>(
    `SELECT
       count(*)::bigint AS total,
       count(*) FILTER (WHERE "uploadedBy" LIKE 'system:whatsapp:%')::bigint AS wa,
       max("createdAt") AS max_at
     FROM attachments`,
  )
  const r = rows[0]
  return {
    totalCount: r ? Number(r.total) : 0,
    whatsappCount: r ? Number(r.wa) : 0,
    maxCreatedAt: r?.max_at ? r.max_at.toISOString() : null,
  }
}

export async function buildIngestPlan(now: Date): Promise<IngestPlan> {
  const snapshot = await loadAttachmentSnapshot()
  const [attachments, candidates] = await Promise.all([loadAttachments(), loadInboundMediaCandidates()])
  const have = new Set(attachments.map((a) => a.mediaId))
  const missing = candidates.filter((c) => !have.has(c.mediaId))
  const hints = await loadPhoneParentHints(missing.map((c) => c.phone))

  const rows: IngestPlanRow[] = []
  const skippedRows: IngestSkippedRow[] = []

  for (const c of missing) {
    const bucket = classifyMetaAge(c.firstSeenAt, now)
    if (bucket === 'gt_30d' || bucket === 'unknown') {
      skippedRows.push({
        mediaId: c.mediaId,
        mediaIdSuffix: c.mediaId.slice(-8),
        phone: c.phone,
        ageBucket: bucket,
        reason: 'beyond_meta_retention',
      })
      continue
    }
    const hint = hints.get(normalizePhoneKey(c.phone))
    const paIds = hint?.providerApplicationIds ?? []
    const parentKind = paIds.length > 0 ? 'providerApplication' as const : null
    const parentId = paIds[0] ?? null
    const parentConfidence: IngestPlanRow['parentConfidence'] =
      paIds.length === 1 ? 'HIGH' : paIds.length > 1 ? 'MEDIUM' : 'NONE'

    rows.push({
      mediaId: c.mediaId,
      mediaIdSuffix: c.mediaId.slice(-8),
      messageType: c.messageType,
      phone: c.phone,
      firstSeenAt: c.firstSeenAt.toISOString(),
      ageBucket: bucket,
      parentKind,
      parentId,
      parentConfidence,
      label: 'evidence',
    })
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    attachmentSnapshot: snapshot,
    totalCandidates: candidates.length,
    totalMissing: missing.length,
    planned: rows.length,
    skipped: skippedRows.length,
    rows,
    skippedRows,
  }
}
