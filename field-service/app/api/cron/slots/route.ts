// ─── Cron: Generate availability slots ────────────────────────────────────────
// Runs every Monday at 06:00 UTC via Vercel Cron.
// Generates 2 weeks of weekday slots for all active businesses.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateSlots } from '@/lib/slotting'
import { addDays, startOfDay } from 'date-fns'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const businesses = await db.business.findMany({
    where: { active: true },
    select: { id: true },
  })

  const startDate = startOfDay(new Date())
  const endDate   = addDays(startDate, 14)

  let created = 0

  for (const business of businesses) {
    try {
      const count = await generateSlots({
        businessId:  business.id,
        startDate,
        endDate,
        windowStart: '09:00',
        windowEnd:   '17:00',
        capacity:    2,
      })
      created += count
      console.log(`[cron/slots] Created ${count} slots for business ${business.id}`)
    } catch (err) {
      console.error(`[cron/slots] Failed for business ${business.id}:`, err)
    }
  }

  return NextResponse.json({ created })
}
