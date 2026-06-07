import { db } from '@/lib/db'
import { maskPhone } from '@/lib/support-diagnostics'
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
    const phoneMasked = maskPhone(c.phone) ?? 'masked'
    const phoneTail = normalizePhoneKey(c.phone).replace(/\D/g, '').slice(-4)
    const bucket = classifyMetaAge(c.firstSeenAt, now)
    if (bucket === 'gt_30d' || bucket === 'unknown') {
      skippedRows.push({
        mediaId: c.mediaId,
        mediaIdSuffix: c.mediaId.slice(-8),
        phoneMasked,
        phoneTail,
        ageBucket: bucket,
        reason: 'beyond_meta_retention',
      })
      continue
    }
    const hint = hints.get(normalizePhoneKey(c.phone))
    const paIds = hint?.providerApplicationIds ?? []
    const jrIds = hint?.jobRequestIds ?? []
    const hasProviderConflict = paIds.length > 1 || (paIds.length === 1 && jrIds.length > 0)
    const canAutoLinkProviderApplication = paIds.length === 1 && jrIds.length === 0
    // Only a single ProviderApplication match is safe to auto-link. Multiple
    // provider matches, or a competing JobRequest match for the same phone, mean
    // the operator needs a manual review pass rather than us attaching evidence
    // to whichever row the database happened to return first.
    const parentKind = canAutoLinkProviderApplication ? 'providerApplication' as const : null
    const parentId = canAutoLinkProviderApplication ? paIds[0] : null
    const parentConfidence: IngestPlanRow['parentConfidence'] =
      canAutoLinkProviderApplication ? 'HIGH' : hasProviderConflict ? 'MEDIUM' : 'NONE'

    rows.push({
      mediaId: c.mediaId,
      mediaIdSuffix: c.mediaId.slice(-8),
      messageType: c.messageType,
      phoneMasked,
      phoneTail,
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
