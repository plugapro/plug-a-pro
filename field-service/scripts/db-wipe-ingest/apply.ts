import { db } from '@/lib/db'
import { downloadAndStoreWhatsAppMedia } from '@/lib/whatsapp-media'
import type { IngestPlan, IngestResult } from './types'

type ApplyOpts = {
  dryRun?: boolean
  onProgress?: (row: IngestResult, idx: number, total: number) => void
}

export async function applyIngestPlan(plan: IngestPlan, opts: ApplyOpts = {}): Promise<IngestResult[]> {
  // Plan-staleness gate. Allow growth (concurrent inserts add to count) but
  // refuse if count dropped below snapshot — that means attachments were
  // deleted while the plan sat on disk, and our plan-row decisions are now
  // potentially based on stale FK assumptions.
  const current = await db.attachment.count()
  if (current < plan.attachmentSnapshot.totalCount) {
    throw new Error(
      `plan stale: attachment count dropped from ${plan.attachmentSnapshot.totalCount} (plan) to ${current} (live)`,
    )
  }

  const results: IngestResult[] = []
  const total = plan.rows.length
  let idx = 0

  for (const row of plan.rows) {
    idx++
    const start = Date.now()

    if (opts.dryRun) {
      const r: IngestResult = {
        mediaIdSuffix: row.mediaIdSuffix,
        mediaId: row.mediaId,
        status: 'skipped',
        attachmentId: null,
        errorCode: 'DRY_RUN',
        errorMessage: 'Dry-run: no Meta call, no Vercel Blob upload, no Attachment INSERT.',
        durationMs: Date.now() - start,
      }
      results.push(r)
      opts.onProgress?.(r, idx, total)
      continue
    }

    try {
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: row.mediaId,
        // Only high-confidence plan rows may write a ProviderApplication FK.
        // This also protects apply from older plan files that stored an
        // arbitrary parentId on MEDIUM-confidence rows.
        providerApplicationId: row.parentKind === 'providerApplication' && row.parentConfidence === 'HIGH'
          ? row.parentId
          : null,
        label: row.label,
      })
      const r: IngestResult = {
        mediaIdSuffix: row.mediaIdSuffix,
        mediaId: row.mediaId,
        status: 'success',
        attachmentId,
        errorCode: null,
        errorMessage: null,
        durationMs: Date.now() - start,
      }
      results.push(r)
      opts.onProgress?.(r, idx, total)
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown }
      const r: IngestResult = {
        mediaIdSuffix: row.mediaIdSuffix,
        mediaId: row.mediaId,
        status: 'failed',
        attachmentId: null,
        errorCode: typeof e.code === 'string' ? e.code : 'UNKNOWN_ERROR',
        errorMessage: typeof e.message === 'string' ? e.message : String(err),
        durationMs: Date.now() - start,
      }
      results.push(r)
      opts.onProgress?.(r, idx, total)
    }
  }

  return results
}
