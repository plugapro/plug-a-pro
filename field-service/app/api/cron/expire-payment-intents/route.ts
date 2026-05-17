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
  return NextResponse.json({ expired: result.count })
}
