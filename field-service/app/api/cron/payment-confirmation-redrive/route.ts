// ─── Cron: payment confirmation re-drive (SRE-02) ────────────────────────────
// Sweeps PAID payments (< 7 days old) whose booking confirmation was never
// delivered (Payment.bookingConfirmationSentAt IS NULL) and re-attempts the
// send via sendPaidBookingConfirmation. Attempts are capped per payment
// (MAX_BOOKING_CONFIRMATION_ATTEMPTS) so a permanently failing recipient
// falls out of the sweep instead of looping forever.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  MAX_BOOKING_CONFIRMATION_ATTEMPTS,
  sendPaidBookingConfirmation,
} from '@/lib/payment-confirmation'

const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const BATCH_CAP = 25

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'payment-confirmation-redrive'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const cutoff = new Date(Date.now() - SWEEP_WINDOW_MS)
    const candidates = await db.payment.findMany({
      where: {
        status: 'PAID',
        bookingConfirmationSentAt: null,
        bookingConfirmationAttempts: { lt: MAX_BOOKING_CONFIRMATION_ATTEMPTS },
        paidAt: { gte: cutoff },
      },
      select: { bookingId: true },
      orderBy: { paidAt: 'asc' },
      take: BATCH_CAP,
    })

    let sent = 0
    let failed = 0
    let skipped = 0
    for (const candidate of candidates) {
      // Non-throwing by contract; one bad row must not stall the sweep.
      const result = await sendPaidBookingConfirmation(candidate.bookingId)
      if (result.sent) {
        sent += 1
      } else if (result.outcome === 'send_failed') {
        failed += 1
      } else {
        skipped += 1
      }
    }

    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      durationMs,
      candidates: candidates.length,
      sent,
      failed,
      skipped,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({ ok: true, candidates: candidates.length, sent, failed, skipped, durationMs })
  } catch (err) {
    const durationMs = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
