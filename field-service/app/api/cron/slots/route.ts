// ─── Cron: Lead expiry cleanup ─────────────────────────────────────────────────
// Runs every Monday at 06:00 UTC via Vercel Cron.
// Slot model removed in P2P marketplace model.
// Repurposed to expire stale OPEN JobRequests older than 7 days.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const result = await db.jobRequest.updateMany({
    where: {
      status: 'OPEN',
      createdAt: { lt: cutoff },
    },
    data: { status: 'EXPIRED' },
  })

  console.log(`[cron/slots] Expired ${result.count} stale job requests`)

  return NextResponse.json({ expired: result.count })
}
