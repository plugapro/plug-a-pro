// ─── Cron: Send follow-up rating requests ─────────────────────────────────────
// Runs daily at 10:00 UTC via Vercel Cron.
// Finds bookings completed ~24h ago with no rating, sends WhatsApp follow-up.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasSuccessfulMessageForBooking } from '@/lib/message-events'
import { sendFollowUp } from '@/lib/whatsapp'
import { getJobRequestAccessUrl } from '@/lib/job-request-access'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'follow-up'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  // Widened from (28h, 20h) to (48h, 12h) to capture bookings completed later in the
  // evening that were outside the original window.
  const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() - 12 * 60 * 60 * 1000)
  // TODO: add a 72-96h second reminder pass once a `follow_up_reminder` WhatsApp
  // template has been approved by Meta - the current `follow_up` template cannot be
  // reused (blocked by hasSuccessfulMessageForBooking dedup) and freeform messages
  // outside the 24h session window will fail to deliver.

  // Fetch completed bookings in window, excluding those that already have a rating
  const bookings = await db.booking.findMany({
    where: {
      status:    'COMPLETED',
      updatedAt: { gte: windowStart, lte: windowEnd },
    },
    include: {
      match: { include: { jobRequest: { include: { customer: { select: { name: true, phone: true } } } } } },
      job: { select: { id: true } },
    },
  })

  // Filter out bookings that already have a review. CJ-02: legacy
  // /review/[token] rows carry matchId only, so dedup must tolerate either
  // key or customers get asked to review a job they already reviewed.
  const jobIds = bookings.map((b) => b.job?.id).filter(Boolean) as string[]
  const matchIds = bookings.map((b) => b.matchId).filter(Boolean)
  const existingReviews = await db.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      OR: [
        { jobId: { in: jobIds } },
        { matchId: { in: matchIds } },
      ],
    },
    select: { jobId: true, matchId: true },
  })
  const reviewedJobIds = new Set(existingReviews.map((r) => r.jobId).filter(Boolean))
  const reviewedMatchIds = new Set(existingReviews.map((r) => r.matchId).filter(Boolean))

  const toNotify = bookings.filter(
    (b) => b.job && !reviewedJobIds.has(b.job.id) && !reviewedMatchIds.has(b.matchId),
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let sent = 0

  for (const booking of toNotify) {
    const customer = booking.match.jobRequest.customer
    try {
      const alreadySent = await hasSuccessfulMessageForBooking({
        bookingId: booking.id,
        templateName: 'follow_up',
        since: windowStart,
      })
      if (alreadySent) {
        console.info(`[cron/follow-up:${reqId}] Skipping duplicate follow-up for booking ${booking.id}`)
        continue
      }

      const ratingUrl = await getJobRequestAccessUrl(booking.match.jobRequest.id).catch(() => null) ?? appUrl
      await sendFollowUp({
        bookingId:     booking.id,
        customerName:  customer.name,
        customerPhone: customer.phone,
        ratingUrl,
      })

      sent++
      console.log(`[cron/follow-up:${reqId}] Sent follow-up for booking ${booking.id}`)
    } catch (err) {
      console.error(`[cron/follow-up:${reqId}] Failed for booking ${booking.id}:`, err)
    }
  }

  console.log(`[cron/follow-up:${reqId}]`, { sent })
  const duration = Date.now() - cronStart
  console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
  return NextResponse.json({ sent, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
