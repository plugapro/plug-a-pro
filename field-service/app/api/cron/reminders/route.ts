// ─── Cron: Send booking reminders ─────────────────────────────────────────────
// Runs daily at 08:00 UTC via Vercel Cron.
// Finds bookings scheduled tomorrow and sends a WhatsApp reminder.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
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
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      service:  { select: { name: true } },
      slot:     { select: { windowStart: true, windowEnd: true } },
    },
  })

  let sent = 0

  for (const booking of bookings) {
    try {
      const scheduledWindow =
        booking.scheduledWindow ??
        (booking.slot
          ? `${booking.slot.windowStart}–${booking.slot.windowEnd}`
          : 'Time to be confirmed')

      await sendBookingReminder({
        businessId:      booking.businessId,
        bookingId:       booking.id,
        customerName:    booking.customer.name,
        customerPhone:   booking.customer.phone,
        serviceName:     booking.service.name,
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
