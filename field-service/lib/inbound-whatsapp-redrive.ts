// ─── Inbound WhatsApp dead-letter re-drive (SRE-03) ───────────────────────────
//
// The webhook records inbound messages in inbound_whatsapp_messages before
// processing. When processInboundMessage throws, only failureReason is
// recorded — and the WAMID dedup row actively blocks Meta redelivery, so the
// customer's message would otherwise vanish permanently. This sweep reprocesses
// recent dead-lettered rows through the same bot entry point the webhook uses.
//
// Guard rails:
//   - Flag-gated by `whatsapp.inbound.redrive` (default OFF): when disabled
//     the sweep no-ops with a log line.
//   - 60-minute window: replaying stale customer messages hours later would
//     confuse customers (they've moved on / re-sent), so anything older is
//     left dead-lettered for manual review.
//   - Max 3 reprocess attempts per message (reprocessAttempts column), claimed
//     with a CAS update so overlapping runs never double-process a row.

import { db } from './db'
import { isEnabled } from './flags'

export const INBOUND_REDRIVE_FLAG = 'whatsapp.inbound.redrive' as const
export const REDRIVE_WINDOW_MINUTES = 60
export const MAX_REPROCESS_ATTEMPTS = 3
export const REDRIVE_BATCH_SIZE = 25

export type RedriveSummary = {
  skipped: boolean
  reason?: 'flag_disabled'
  considered: number
  reprocessed: number
  failed: number
  skippedClaim: number
}

/**
 * Selection criteria for dead-lettered inbound messages eligible for re-drive:
 * never processed, failed at least once, received within the re-drive window,
 * and under the attempt cap.
 */
export function buildRedriveWhere(now: Date) {
  return {
    processedAt: null,
    failureReason: { not: null },
    firstSeenAt: { gte: new Date(now.getTime() - REDRIVE_WINDOW_MINUTES * 60 * 1000) },
    reprocessAttempts: { lt: MAX_REPROCESS_ATTEMPTS },
  }
}

export async function runInboundWhatsappRedrive(): Promise<RedriveSummary> {
  const enabled = await isEnabled(INBOUND_REDRIVE_FLAG)
  if (!enabled) {
    console.log(JSON.stringify({
      event: 'inbound_redrive_skipped',
      reason: 'flag_disabled',
      flag: INBOUND_REDRIVE_FLAG,
    }))
    return { skipped: true, reason: 'flag_disabled', considered: 0, reprocessed: 0, failed: 0, skippedClaim: 0 }
  }

  const { processInboundMessage } = await import('./whatsapp-bot')
  type InboundMessagePayload = Parameters<typeof processInboundMessage>[0]

  const rows = await db.inboundWhatsAppMessage.findMany({
    where: buildRedriveWhere(new Date()),
    orderBy: { firstSeenAt: 'asc' },
    take: REDRIVE_BATCH_SIZE,
    select: {
      id: true,
      externalId: true,
      phone: true,
      payload: true,
      reprocessAttempts: true,
      failureReason: true,
    },
  })

  let reprocessed = 0
  let failed = 0
  let skippedClaim = 0

  for (const row of rows) {
    // CAS claim: bump reprocessAttempts only if the row is still unprocessed
    // and nobody else bumped it since we read it. Prevents overlapping runs
    // from double-processing the same customer message.
    const claim = await db.inboundWhatsAppMessage.updateMany({
      where: {
        id: row.id,
        processedAt: null,
        reprocessAttempts: row.reprocessAttempts,
      },
      data: { reprocessAttempts: { increment: 1 } },
    })
    if (claim.count === 0) {
      skippedClaim++
      continue
    }

    try {
      await processInboundMessage(row.payload as unknown as InboundMessagePayload)
      await db.inboundWhatsAppMessage.update({
        where: { id: row.id },
        data: { processedAt: new Date(), failureReason: null },
      })
      reprocessed++
      console.log(`[inbound-redrive] reprocessed ${row.externalId} (attempt ${row.reprocessAttempts + 1})`)
    } catch (err) {
      failed++
      const failureReason = err instanceof Error ? err.message : String(err)
      await db.inboundWhatsAppMessage
        .update({
          where: { id: row.id },
          data: { failureReason: failureReason.slice(0, 1000), lastSeenAt: new Date() },
        })
        .catch(() => {})
      console.error(`[inbound-redrive] reprocess failed for ${row.externalId} (attempt ${row.reprocessAttempts + 1}):`, failureReason)
    }
  }

  return { skipped: false, considered: rows.length, reprocessed, failed, skippedClaim }
}
