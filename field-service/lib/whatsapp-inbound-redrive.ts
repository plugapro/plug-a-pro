// Re-drive for inbound WhatsApp messages that failed processing.
//
// The webhook (app/api/webhooks/whatsapp/route.ts) processes inbound messages in
// after(), non-transactionally. On a processing error it records `failureReason`
// and leaves `processedAt` NULL, but nothing re-invokes processing — and because
// the WAMID is already stored, Meta's own redelivery hits the duplicate guard and
// is dropped. So a customer reply that trips a transient bug is silently lost.
//
// This module finds those failed-but-unprocessed rows and re-runs processing.
// It is dependency-injected so the orchestration (flag gate, success/failure
// bookkeeping) is unit-testable without a live DB.
//
// RETRY CAP WITHOUT A SCHEMA CHANGE: candidates are bounded by `firstSeenAt`
// (the immutable original receipt time), so a permanently-failing "poison"
// message ages out of the window after REDRIVE_WINDOW_HOURS instead of being
// retried forever. No new column / migration required.

import type { Prisma, PrismaClient } from '@prisma/client'
import type { InboundMessage } from './whatsapp-interactive'

export const REDRIVE_WINDOW_HOURS = 3
export const REDRIVE_BATCH = 25

/**
 * Prisma `where` selecting failed-but-unprocessed inbound messages still inside
 * the retry window. Exported for direct unit testing of the selection criteria.
 */
export function buildRedriveCandidateWhere(now: Date): Prisma.InboundWhatsAppMessageWhereInput {
  const cutoff = new Date(now.getTime() - REDRIVE_WINDOW_HOURS * 60 * 60 * 1000)
  return {
    processedAt: null,
    failureReason: { not: null },
    firstSeenAt: { gte: cutoff },
  }
}

export type RedriveSummary = {
  mode: 'report_only' | 'active'
  candidates: number
  reprocessed: number
  stillFailing: number
}

type RedriveDeps = {
  db: Pick<PrismaClient, 'inboundWhatsAppMessage'>
  processMessage: (message: InboundMessage) => Promise<void>
  now: Date
  flagEnabled: boolean
  batch?: number
}

/**
 * Core re-drive routine. When `flagEnabled` is false, only counts candidates
 * (report-only) and performs no sends. When true, re-runs processing for each
 * candidate: on success stamps `processedAt` and clears `failureReason`; on
 * failure updates `failureReason`/`lastSeenAt` and leaves the row for the next
 * pass (until it ages out of the window).
 */
export async function redriveInboundWhatsApp(deps: RedriveDeps): Promise<RedriveSummary> {
  const { db, processMessage, now, flagEnabled, batch = REDRIVE_BATCH } = deps

  const candidates = await db.inboundWhatsAppMessage.findMany({
    where: buildRedriveCandidateWhere(now),
    orderBy: { firstSeenAt: 'asc' },
    take: batch,
  })

  if (!flagEnabled) {
    return { mode: 'report_only', candidates: candidates.length, reprocessed: 0, stillFailing: 0 }
  }

  let reprocessed = 0
  let stillFailing = 0

  for (const row of candidates) {
    try {
      await processMessage(row.payload as unknown as InboundMessage)
      await db.inboundWhatsAppMessage.update({
        where: { externalId: row.externalId },
        data: { processedAt: now, failureReason: null },
      })
      reprocessed++
    } catch (err) {
      stillFailing++
      await db.inboundWhatsAppMessage
        .update({
          where: { externalId: row.externalId },
          data: {
            failureReason: err instanceof Error ? err.message : String(err),
            lastSeenAt: now,
          },
        })
        .catch(() => {})
    }
  }

  return { mode: 'active', candidates: candidates.length, reprocessed, stillFailing }
}
