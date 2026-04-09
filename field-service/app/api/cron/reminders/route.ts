// ─── Cron: Send booking reminders ─────────────────────────────────────────────
// Runs daily at 08:00 UTC via Vercel Cron.
// Finds bookings scheduled tomorrow and sends a WhatsApp reminder.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasSuccessfulMessageForBooking } from '@/lib/message-events'
import { sendBookingReminder } from '@/lib/whatsapp'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()
  // "Tomorrow" window: 20h from now → 28h from now
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() + 28 * 60 * 60 * 1000)

  const bookings = await db.booking.findMany({
    where: {
      scheduledDate: { gte: windowStart, lte: windowEnd },
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
    },
    include: {
      match: { include: { jobRequest: { include: { customer: { select: { name: true, phone: true } } } } } },
    },
  })

  let sent = 0

  for (const booking of bookings) {
    const customer = booking.match.jobRequest.customer
    try {
      const alreadySent = await hasSuccessfulMessageForBooking({
        bookingId: booking.id,
        templateName: 'booking_reminder',
        since: windowStart,
      })
      if (alreadySent) {
        console.info(`[cron/reminders] Skipping duplicate reminder for booking ${booking.id}`)
        continue
      }

      const scheduledWindow = booking.scheduledWindow ?? 'Time to be confirmed'

      await sendBookingReminder({
        bookingId:       booking.id,
        customerName:    customer.name,
        customerPhone:   customer.phone,
        serviceName:     booking.match.jobRequest.category,
        scheduledWindow,
      })

      sent++
      console.log(`[cron/reminders] Sent reminder for booking ${booking.id}`)
    } catch (err) {
      console.error(`[cron/reminders] Failed for booking ${booking.id}:`, err)
    }
  }

  return NextResponse.json({ sent })
}
