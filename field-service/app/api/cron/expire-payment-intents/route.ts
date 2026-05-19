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
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'

const PAYAT_ITN_RECOVERY_BATCH = 25

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

    const itnIntents = await db.paymentIntent.findMany({
      where: {
        paymentMethod: 'PAYAT',
        status: 'ITN_RECEIVED',
        creditedAt: null,
        itnPaymentStatus: { in: ['PAID', 'COMPLETED'] },
        itnReceivedAt: { not: null },
      },
      select: { id: true },
      orderBy: { itnReceivedAt: 'asc' },
      take: PAYAT_ITN_RECOVERY_BATCH,
    })

    let recovered = 0
    let skipped = 0
    let failed = 0

    for (const it of itnIntents) {
      try {
        const recoveryResult = await creditProviderWalletFromPayatWebhook(it.id)
        if (recoveryResult.credited) {
          recovered += 1
          continue
        }

        skipped += 1
        console.warn('[cron/expire-payment-intents] payat itn recovery skipped', {
          reqId,
          intentId: it.id,
          reason: recoveryResult.reason,
        })
      } catch (error) {
        failed += 1
        console.error('[cron/expire-payment-intents] payat itn recovery failed', {
          reqId,
          intentId: it.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    console.log(`[cron/expire-payment-intents:${reqId}] payat-itn-recovered=${recovered}, skipped=${skipped}, failed=${failed}`)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({
      expired: result.count,
      payatItnRecovered: recovered,
      payatItnSkipped: skipped,
      payatItnFailed: failed,
      durationMs: duration,
    })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
