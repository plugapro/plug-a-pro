// ─── Cron: Auto-match OPEN job requests + expire stale leads ─────────────────
// Runs every 30 minutes during business hours (07:00–20:00) via Vercel Cron — schedule: */30 7-20 * * *
// 1. Expires leads past their expiresAt → frees job for re-dispatch
// 2. Finds OPEN job requests with no active SENT lead → dispatches
// 3. Alerts admin if jobs remain unmatched after 1 hour
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchLeads } from '@/lib/matching-engine'
import { processPendingAssignmentWorkflows } from '@/lib/matching/service'
import { expireStaleQuotes } from '@/lib/quotes'
import { sendText } from '@/lib/whatsapp-interactive'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const results = { dispatched: 0, expired: 0, reoffered: 0, expiredQuotes: 0, noMatch: 0, errors: 0 }

  // 1. Expire stale offers and retry the next ranked technician where possible
  try {
    const workflowResult = await processPendingAssignmentWorkflows()
    results.expired = workflowResult.expiredOffers
    results.reoffered = workflowResult.reoffered
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error processing assignment workflows:`, err)
    results.errors++
  }

  // 1b. Expire stale quotes (PENDING past validUntil)
  try {
    results.expiredQuotes = await expireStaleQuotes()
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error expiring quotes:`, err)
    results.errors++
  }

  // 2. Dispatch leads for OPEN requests with no active lead
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN' },
    include: { address: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  for (const jr of openRequests) {
    const activeLead = await db.lead.findFirst({
      where: { jobRequestId: jr.id, status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] } },
    })
    if (activeLead) continue

    try {
      const result = await dispatchLeads(jr.id)
      if (result.leadsDispatched > 0) {
        results.dispatched++
      } else if (result.noMatch) {
        results.noMatch++
        console.warn(`[cron/match-leads:${reqId}] No providers for job ${jr.id}`)
      }
    } catch (err) {
      console.error(`[cron/match-leads:${reqId}] Error dispatching job ${jr.id}:`, err)
      results.errors++
    }
  }

  // 3. Alert admin if jobs unmatched for >1 hour
  if (ADMIN_PHONE) {
    const unmatched1h = await db.jobRequest.count({
      where: {
        status: 'OPEN',
        createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    })

    if (unmatched1h > 0) {
      await sendText(
        ADMIN_PHONE,
        `⚠️ *Ops Alert — Unmatched Jobs*\n\n${unmatched1h} job request(s) have been open for over 1 hour with no provider match.\n\nReview: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/bookings`
      ).catch(() => {})
    }
  }

  console.log(`[cron/match-leads:${reqId}]`, results)
  return NextResponse.json({ ok: true, ...results })
}
