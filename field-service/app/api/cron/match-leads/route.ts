// ─── Cron: Auto-match OPEN job requests + expire stale leads + ops alerts ─────
// Runs every 30 minutes during business hours (07:00–20:00) via Vercel Cron — schedule: */30 7-20 * * *
// 1. Expires leads past their expiresAt → frees job for re-dispatch
// 2. Finds OPEN job requests with no active SENT lead → dispatches
// 3. Alerts admin if jobs remain unmatched after 1 hour
// 4. Detects queue breaches and sends WhatsApp ops alerts (merged from ops-alerts cron)
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchLeads, sendLeadReminders } from '@/lib/matching-engine'
import { processPendingAssignmentWorkflows } from '@/lib/matching/service'
import { reconcileProviderRecordsFromApplications } from '@/lib/provider-record'
import { expireStaleQuotes } from '@/lib/quotes'
import { sendText } from '@/lib/whatsapp-interactive'
import { recordAuditLog } from '@/lib/audit'
import { detectQueueBreaches, getQueueHref } from '@/lib/ops-dashboard/alerts'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
const ALERT_COOLDOWN_MINUTES = 90

function formatAge(ageMinutes: number) {
  if (ageMinutes < 60) return `${ageMinutes}m`
  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60
  if (hours < 24) return `${hours}h ${minutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const results = { dispatched: 0, expired: 0, reoffered: 0, expiredQuotes: 0, noMatch: 0, reminders: 0, reconciledProviders: 0, autoApproved: 0, errors: 0 }

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

  // 1c. Ensure pending and approved applications have live provider rows so
  // automatch can handle normal intake without operator intervention.
  try {
    const reconciliation = await reconcileProviderRecordsFromApplications(db)
    results.reconciledProviders = reconciliation.reconciled
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error reconciling provider applications:`, err)
    results.errors++
  }

  // 1d. Auto-approve provider applications older than 60 min with all required fields
  try {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000)
    const pendingApplications = await db.providerApplication.findMany({
      where: {
        status: 'PENDING',
        submittedAt: { lte: sixtyMinAgo },
        name: { not: '' },
        skills: { isEmpty: false },
        serviceAreas: { isEmpty: false },
      },
      select: { id: true, phone: true, name: true },
      take: 50,
    })

    for (const app of pendingApplications) {
      try {
        await db.providerApplication.update({
          where: { id: app.id },
          data: { status: 'APPROVED', reviewedAt: new Date() },
        })
        await sendText(
          app.phone,
          `✅ *Application Approved!*\n\nHi *${app.name}*, your Plug a Pro application has been approved!\n\nYou'll start receiving job leads on this number. Reply *menu* to check your status anytime.`
        ).catch((err: unknown) => {
          console.error(`[cron/match-leads:${reqId}] Failed to notify auto-approved provider ${app.id}:`, err)
        })
        results.autoApproved++
      } catch (err) {
        console.error(`[cron/match-leads:${reqId}] Failed to auto-approve application ${app.id}:`, err)
        results.errors++
      }
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error running auto-approve:`, err)
    results.errors++
  }

  // 2. Dispatch leads for OPEN requests with no active lead
  // take: 100 handles ~50 concurrent open requests safely at 30-min cadence.
  // If queue grows beyond this, add cursor-based pagination here.
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  for (const jr of openRequests) {
    const activeLead = await db.lead.findFirst({
      where: { jobRequestId: jr.id, status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] } },
      select: { id: true },
    })
    if (activeLead) continue

    // Skip re-dispatch: if any leads already expired or were declined, this job has
    // already been offered to providers. Re-broadcasting every 30 min creates spam.
    // The job stays OPEN for admin review; manual re-dispatch is available in the
    // dispatch console (/admin/dispatch).
    const priorLead = await db.lead.findFirst({
      where: { jobRequestId: jr.id, status: { in: ['EXPIRED', 'DECLINED'] } },
      select: { id: true },
    })
    if (priorLead) continue

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

  // 3. Send 1-hour reminders for SENT/VIEWED leads with no response
  try {
    results.reminders = await sendLeadReminders()
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error sending lead reminders:`, err)
    results.errors++
  }

  // 4. Alert admin if jobs unmatched for >1 hour
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

  // 5. Ops queue breach alerts (merged from ops-alerts cron)
  let opsBreaches = 0
  let opsNotified = 0
  try {
    const breaches = await detectQueueBreaches(db)
    opsBreaches = breaches.length

    const recentAlertCutoff = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60000)
    const recentAlerts = breaches.length
      ? await db.auditLog.findMany({
          where: {
            action: 'ops_alert.sent',
            entityType: 'ops_queue',
            entityId: { in: breaches.map((breach) => breach.queueKey) },
            timestamp: { gte: recentAlertCutoff },
          },
          select: { entityId: true, timestamp: true },
        }).catch((error) => {
          console.error(`[cron/match-leads:${reqId}] Failed to load recent alert cooldowns`, error)
          return []
        })
      : []
    const recentlyAlertedQueues = new Set(recentAlerts.map((entry) => entry.entityId))

    for (const breach of breaches) {
      if (recentlyAlertedQueues.has(breach.queueKey)) {
        console.log(`[cron/match-leads:${reqId}] Skipping cooldown-suppressed alert`, { queueKey: breach.queueKey })
        continue
      }

      const link = `${APP_URL}${getQueueHref(breach.queueKey)}`
      const message =
        `⚠️ *Ops Alert — ${breach.label}*\n\n` +
        `${breach.overdueCount} item${breach.overdueCount === 1 ? '' : 's'} overdue.\n` +
        `Oldest age: ${formatAge(breach.oldestAgeMinutes)}.\n\n` +
        `Review: ${link}`

      const sent = ADMIN_PHONE
        ? await sendText(ADMIN_PHONE, message).catch((error) => {
            console.error(`[cron/match-leads:${reqId}] Failed to send ops WhatsApp alert`, { queueKey: breach.queueKey, error })
            return null
          })
        : null

      if (sent) opsNotified++

      await recordAuditLog({
        actorId: 'system',
        actorRole: 'system',
        action: 'ops_alert.sent',
        entityType: 'ops_queue',
        entityId: breach.queueKey,
        after: {
          label: breach.label,
          overdueCount: breach.overdueCount,
          oldestAgeMinutes: breach.oldestAgeMinutes,
          severity: breach.severity,
          delivered: Boolean(sent),
        },
      }).catch((error) => {
        console.error(`[cron/match-leads:${reqId}] Failed to record alert audit log`, { queueKey: breach.queueKey, error })
      })
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error running ops breach alerts:`, err)
    results.errors++
  }

  return NextResponse.json({ ok: true, ...results, opsBreaches, opsNotified })
}
