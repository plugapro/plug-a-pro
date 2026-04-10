// ─── Cron: Send follow-up rating requests ─────────────────────────────────────
// Runs daily at 10:00 UTC via Vercel Cron.
// Finds bookings completed ~24h ago with no rating, sends WhatsApp follow-up.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasSuccessfulMessageForBooking } from '@/lib/message-events'
import { sendFollowUp } from '@/lib/whatsapp'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  // "~24h ago" window: 28h ago → 20h ago
  const windowStart = new Date(now.getTime() - 28 * 60 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() - 20 * 60 * 60 * 1000)

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

  // Filter out bookings that already have a review
  const jobIds = bookings.map((b) => b.job?.id).filter(Boolean) as string[]
  const existingReviews = await db.review.findMany({
    where:  { jobId: { in: jobIds }, reviewerType: 'CUSTOMER' },
    select: { jobId: true },
  })
  const reviewedJobIds = new Set(existingReviews.map((r) => r.jobId))

  const toNotify = bookings.filter((b) => b.job && !reviewedJobIds.has(b.job.id))

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

      await sendFollowUp({
        bookingId:     booking.id,
        customerName:  customer.name,
        customerPhone: customer.phone,
        ratingUrl:     `${appUrl}/bookings/${booking.id}/rate`,
      })

      sent++
      console.log(`[cron/follow-up:${reqId}] Sent follow-up for booking ${booking.id}`)
    } catch (err) {
      console.error(`[cron/follow-up:${reqId}] Failed for booking ${booking.id}:`, err)
    }
  }

  console.log(`[cron/follow-up:${reqId}]`, { sent })
  return NextResponse.json({ sent })
}
