// ─── WhatsApp media-upload batch debounce ───────────────────────────────────
// WhatsApp Cloud API delivers each media file as a separate webhook event,
// even when the customer uploads several at once. Vercel's serverless model
// means each event may land on a different function instance, so the existing
// in-memory batch map (lib/whatsapp-bot.ts) does not cover the cross-instance
// case. Result before this module: provider/customer sees "2 files received"
// followed immediately by "3 files received" for one multi-file upload.
//
// This module fixes that by introducing a per-phone, per-scope sequence
// counter persisted in Conversation.data. Each media event:
//   1. atomically claims the next seq number,
//   2. sleeps WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS (default 2500),
//   3. re-reads the current seq.
// If the current seq is still the caller's, the caller is the latest event
// in the burst and sends the consolidated progress response. If the seq has
// moved on, a newer event has superseded the caller and the caller exits
// silently. The newest event always wins, regardless of which Vercel
// instance handles it.
//
// The seq lives in Conversation.data.mediaBatchSeq_<scope> so no schema
// migration is required.

import { Prisma } from '@prisma/client'
import { db } from './db'

export type MediaBatchScope = 'provider_evidence' | 'customer_photo'

const DEFAULT_DEBOUNCE_MS = 2500
export const WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS = (() => {
  const raw = process.env.WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS
  if (!raw) return DEFAULT_DEBOUNCE_MS
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEBOUNCE_MS
})()

function seqKey(scope: MediaBatchScope): string {
  return `mediaBatchSeq_${scope}`
}

/**
 * Atomically increment and return the next sequence number for this
 * (phone, scope) pair. Stored inside Conversation.data so no schema change.
 *
 * Idempotency: callers should call this ONCE per media event after WAMID
 * dedup has already filtered out duplicate webhook deliveries (existing
 * dedup lives at InboundWhatsAppMessage.externalId @unique).
 */
export async function claimMediaBatchSeq(
  phone: string,
  scope: MediaBatchScope,
  client: typeof db = db,
): Promise<number> {
  const key = seqKey(scope)
  // Serializable isolation forces concurrent claims on the same conversation
  // row to serialize at the Postgres level, so the increment is atomic even
  // when multiple Vercel function instances handle media events for the same
  // phone at the same time.
  return await client.$transaction(
    async (tx) => {
      const row = await tx.conversation.findUnique({
        where: { phone },
        select: { data: true },
      })
      const data = ((row?.data as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
      const current = typeof data[key] === 'number' ? (data[key] as number) : 0
      const next = current + 1
      if (row) {
        // The merged payload widens to `Record<string, unknown>`; assert as
        // `Prisma.InputJsonValue` so Prisma accepts it on the JSON column.
        const nextData = { ...data, [key]: next } as Prisma.InputJsonValue
        await tx.conversation.update({
          where: { phone },
          data: { data: nextData },
        })
      }
      return next
    },
    { isolationLevel: 'Serializable' },
  )
}

export async function readMediaBatchSeq(
  phone: string,
  scope: MediaBatchScope,
  client: typeof db = db,
): Promise<number> {
  const key = seqKey(scope)
  const row = await client.conversation.findUnique({
    where: { phone },
    select: { data: true },
  })
  const data = ((row?.data as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
  return typeof data[key] === 'number' ? (data[key] as number) : 0
}

/**
 * Wait `debounceMs` then re-check whether the caller's claimed seq is still
 * the latest one for this phone+scope. Returns true iff the caller may now
 * proceed to send the consolidated response. False means a newer event has
 * superseded — the caller MUST exit without sending anything.
 */
export async function awaitAndCheckLatest(
  phone: string,
  scope: MediaBatchScope,
  mySeq: number,
  debounceMs: number = WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS,
  client: typeof db = db,
): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, debounceMs))
  const current = await readMediaBatchSeq(phone, scope, client)
  return current === mySeq
}

/**
 * Convenience wrapper: claim → debounce → check. Returns the consolidated
 * batch state if the caller is the latest event, or null if superseded.
 */
export async function debounceMediaBatch(params: {
  phone: string
  scope: MediaBatchScope
  debounceMs?: number
  client?: typeof db
}): Promise<{ mySeq: number; isLatest: boolean }> {
  const client = params.client ?? db
  const mySeq = await claimMediaBatchSeq(params.phone, params.scope, client)
  const isLatest = await awaitAndCheckLatest(
    params.phone,
    params.scope,
    mySeq,
    params.debounceMs ?? WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS,
    client,
  )
  return { mySeq, isLatest }
}
