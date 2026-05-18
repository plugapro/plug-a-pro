// ─── Cron: Expire stale PENDING_PAYMENT intents ───────────────────────────────
// Schedule: 0 * * * * (hourly)
//
// Marks PENDING_PAYMENT intents whose expiresAt has passed as EXPIRED.
// Prevents the PENDING_PAYMENT pool from growing unbounded and avoids the
// H-4 duplicate-intent guard incorrectly blocking a new top-up attempt
// against an already-lapsed Pay@ link.
//
// Only touches intents with a non-null expiresAt — MANUAL_EFT intents without
// an expiry date are left for admin reconciliation.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'expire-payment-intents'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const reqId = crypto.randomUUID().slice(0, 8)
    const now = new Date()

    const result = await db.paymentIntent.updateMany({
      where: {
        status: 'PENDING_PAYMENT',
        expiresAt: { lt: now, not: null },
      },
      data: { status: 'EXPIRED' },
    })

    console.log(`[cron/expire-payment-intents:${reqId}] expired=${result.count}`)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({ expired: result.count, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
