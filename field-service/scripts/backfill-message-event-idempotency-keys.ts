/**
 * backfill-message-event-idempotency-keys.ts
 *
 * Generates idempotencyKey values for MessageEvent rows that were created
 * before the idempotency column was added. Without a key these rows are
 * invisible to the hasSent* guards, meaning the same template could be
 * re-sent if the notification path is triggered again.
 *
 * Key format (deterministic, stable across retries):
 *   backfill:<id>
 *
 * Safe to run multiple times — rows with an existing key are skipped.
 *
 * Usage:
 *   cd field-service && npx tsx scripts/backfill-message-event-idempotency-keys.ts
 *
 * Requires: DATABASE_URL
 */

import 'dotenv/config'
import { db } from '../lib/db'

const BATCH_SIZE = 500

async function main() {
  let updated = 0
  let cursor: string | undefined

  console.log('[backfill] scanning MessageEvent rows with null idempotencyKey...')

  for (;;) {
    const rows = await db.messageEvent.findMany({
      where: { idempotencyKey: null },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })

    if (rows.length === 0) break

    await Promise.all(
      rows.map((row) =>
        db.messageEvent.update({
          where: { id: row.id },
          data: { idempotencyKey: `backfill:${row.id}` },
        })
      )
    )

    updated += rows.length
    cursor = rows[rows.length - 1]!.id
    console.log(`[backfill] updated ${updated} rows...`)
  }

  console.log(`[backfill] done — ${updated} rows backfilled`)
  await db.$disconnect()
}

main().catch((err) => {
  console.error('[backfill] fatal error:', err)
  process.exit(1)
})
