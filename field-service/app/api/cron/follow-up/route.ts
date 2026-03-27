// ─── Cron: Send follow-up rating requests ─────────────────────────────────────
// Runs daily at 10:00 UTC via Vercel Cron.
// Finds bookings completed ~24h ago with no rating, sends WhatsApp follow-up.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendFollowUp } from '@/lib/whatsapp'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

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
      customer: { select: { name: true, phone: true } },
    },
  })

  // Filter out bookings that already have a rating
  const bookingIds = bookings.map((b) => b.id)
  const existingRatings = await db.rating.findMany({
    where:  { bookingId: { in: bookingIds } },
    select: { bookingId: true },
  })
  const ratedSet = new Set(existingRatings.map((r) => r.bookingId))

  const toNotify = bookings.filter((b) => !ratedSet.has(b.id))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let sent = 0

  for (const booking of toNotify) {
    try {
      await sendFollowUp({
        businessId:    booking.businessId,
        bookingId:     booking.id,
        customerName:  booking.customer.name,
        customerPhone: booking.customer.phone,
        ratingUrl:     `${appUrl}/bookings/${booking.id}/rate`,
      })

      sent++
      console.log(`[cron/follow-up] Sent follow-up for booking ${booking.id}`)
    } catch (err) {
      console.error(`[cron/follow-up] Failed for booking ${booking.id}:`, err)
    }
  }

  return NextResponse.json({ sent })
}
