// ─── Cron: Lead expiry cleanup ─────────────────────────────────────────────────
// Runs every Monday at 06:00 UTC via Vercel Cron.
// Slot model removed in P2P marketplace model.
// Repurposed to expire stale OPEN JobRequests older than 7 days.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notifyExpiredJobParties } from '@/lib/matching/customer-recontact'
import { withCronHeartbeat } from '@/lib/cron-heartbeat'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Audit OBS-09: record heartbeats so a silently-dead cron is detectable.
  return withCronHeartbeat('slots', () => runCron())
}

async function runCron() {

  const cronStart = Date.now()
  const cronName = 'slots'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const staleJobs = await db.jobRequest.findMany({
      where: {
        status: 'OPEN',
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    })

    if (staleJobs.length === 0) {
      console.log('[cron/slots] Expired 0 stale job requests')
      const duration = Date.now() - cronStart
      console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
      return NextResponse.json({ expired: 0, durationMs: duration })
    }

    const result = await db.jobRequest.updateMany({
      where: { id: { in: staleJobs.map((job) => job.id) } },
      data: { status: 'EXPIRED' },
    })

    await Promise.all(
      staleJobs.map((job) =>
        notifyExpiredJobParties({ jobRequestId: job.id }).catch((err) => {
          console.error(`[cron/slots] Failed to notify parties for expired job ${job.id}:`, err)
        })
      )
    )

    console.log(`[cron/slots] Expired ${result.count} stale job requests`)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({ expired: result.count, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
