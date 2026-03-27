// ─── GET /api/customer/slots ──────────────────────────────────────────────────
// Returns available booking slots for a business.
// Query params: businessId (required)
// No auth required — slot availability is public.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  // In Next.js 16 App Router, searchParams on NextRequest is synchronous via .get()
  const businessId = req.nextUrl.searchParams.get('businessId')

  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Fetch slots that are not blocked and have date >= today.
  // Filter booked < capacity in-process — Prisma does not support column comparisons
  // in a where clause without $queryRaw, so we over-fetch with take: 60 then trim.
  const raw = await db.slot.findMany({
    where: {
      businessId,
      blocked: false,
      date: { gte: today },
    },
    orderBy: { date: 'asc' },
    take: 60,
  })

  const slots = raw
    .filter((s) => s.booked < s.capacity)
    .slice(0, 30)

  return NextResponse.json(
    slots.map((s) => ({
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      capacity: s.capacity,
      booked: s.booked,
    }))
  )
}
