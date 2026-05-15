// ─── Cron: Auto-match OPEN job requests + expire stale leads + ops alerts ─────
// Runs 24/7 via two Vercel Cron schedules (all times SAST = UTC+2):
//   */5 5-16 * * *       — every 5 min during standard hours (07:00–18:59 SAST)
//   */30 17-23,0-4 * * * — every 30 min during off-hours (19:00–06:59 SAST)
// 1. Expires leads past their expiresAt → frees job for re-dispatch
// 2. Finds OPEN job requests with no active SENT lead → dispatches via orchestrateMatch
// 3. Alerts admin if jobs remain unmatched after 1 hour
// 4. Detects queue breaches and sends WhatsApp ops alerts (merged from ops-alerts cron)
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendLeadReminders } from '@/lib/matching-engine'
import { processPendingAssignmentWorkflows, reconcileStaleAssignmentState, sendQuickMatchProgressUpdates } from '@/lib/matching/service'
import { orchestrateMatch } from '@/lib/matching/orchestrator'
import { checkJobsForNewProviderAvailability, notifyExpiredJobParties } from '@/lib/matching/customer-recontact'
import { expireRfpInvitations } from '@/lib/review-first'
import { reconcileProviderRecordsFromApplications } from '@/lib/provider-record'
import { notifyProviderApplicationApprovedOnce } from '@/lib/provider-application-notifications'
import { routeProviderApplicationsForOpsReview } from '@/lib/provider-application-review-support'
import { expireStaleQuotes } from '@/lib/quotes'
import { expireOpenJobRequest } from '@/lib/job-requests/expire-job-request'
import { sendText } from '@/lib/whatsapp-interactive'
import { recordAuditLog } from '@/lib/audit'
import { detectQueueBreaches, getQueueHref } from '@/lib/ops-dashboard/alerts'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''
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
  const results = { dispatched: 0, expired: 0, expiredRequests: 0, reoffered: 0, expiredQuotes: 0, noMatch: 0, reminders: 0, progressUpdates: 0, reconciledProviders: 0, reviewRoutedApplications: 0, flaggedApplications: 0, autoResumed: 0, errors: 0, reconciledCapacity: 0, rfpExpired: 0 }

  // 0. Reconcile stale capacity counters (safety net — corrects counter drift)
  try {
    const reconcile = await reconcileStaleAssignmentState()
    results.reconciledCapacity = reconcile.corrected
    if (reconcile.corrected > 0) {
      console.warn(`[cron/match-leads:${reqId}] Capacity reconciliation corrected ${reconcile.corrected} provider(s)`)
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Capacity reconciliation error:`, err)
    results.errors++
  }

  // 1. Expire stale offers and retry the next ranked technician where possible
  try {
    const workflowResult = await processPendingAssignmentWorkflows()
    results.expired = workflowResult.expiredOffers
    results.reoffered = workflowResult.reoffered
    const rfpResult = await expireRfpInvitations()
    results.rfpExpired = rfpResult.expiredCount
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

  // 1d. Route pending provider applications for Ops review and queue them for
  // the ops dashboard. Auto-approval runs on the dedicated
  // /api/cron/provider-auto-approve schedule — not here.
  try {
    const routed = await routeProviderApplicationsForOpsReview(db, { actorId: 'cron:match-leads' })
    results.reviewRoutedApplications = routed.routed
    results.flaggedApplications = routed.flagged
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error routing provider applications for review:`, err)
    results.errors++
  }

  // 1g. Retry approved provider application WhatsApp confirmations that were
  // missed because Meta, network, or a prior deploy failed after DB approval.
  try {
    const approvedMissingNotifications = await db.providerApplication.findMany({
      where: {
        status: 'APPROVED',
        approvalWhatsappSentAt: null,
        OR: [
          { approvalWhatsappSendStartedAt: null },
          { approvalWhatsappSendStartedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      select: { id: true, phone: true, name: true },
      take: 25,
    })

    for (const app of approvedMissingNotifications) {
      await notifyProviderApplicationApprovedOnce({
        applicationId: app.id,
        phone: app.phone,
        name: app.name,
      }).catch((err: unknown) => {
        console.error(`[cron/match-leads:${reqId}] Failed to retry approval notification ${app.id}:`, err)
        results.errors++
      })
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error retrying approval notifications:`, err)
    results.errors++
  }

  // 1h. Expire OPEN job requests that have passed their expiresAt deadline.
  // Only processes jobs where expiresAt was explicitly set (legacy jobs without
  // the field are ignored). Notify customer after each transition.
  try {
    const staleRequests = await db.jobRequest.findMany({
      where: {
        status: 'OPEN',
        expiresAt: { not: null, lte: new Date() },
      },
      select: { id: true },
      take: 20, // match the dispatch batch size
    })

    for (const jr of staleRequests) {
      try {
        const { transitioned } = await expireOpenJobRequest(jr.id, 'max_age_exceeded')
        if (transitioned) {
          results.expiredRequests++
          // Notify customer (fire-and-forget — failure should not block the sweep)
          notifyExpiredJobParties({ jobRequestId: jr.id }).catch((err: unknown) => {
            console.error(`[cron/match-leads:${reqId}] Failed to notify expired job parties ${jr.id}:`, err)
          })
        }
      } catch (err) {
        console.error(`[cron/match-leads:${reqId}] Error expiring job request ${jr.id}:`, err)
        results.errors++
      }
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error sweeping expired job requests:`, err)
    results.errors++
  }

  // 1i. Catch-up sweep: EXPIRED jobs from the last 24h that never received a
  // no-match notification (e.g. if 1e fired but the notify call failed).
  // notifyExpiredJobParties() is idempotent — it guards on customerNoMatchNotifiedAt.
  try {
    const recentlyExpired = await db.jobRequest.findMany({
      where: {
        status: 'EXPIRED',
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        customerNoMatchNotifiedAt: null,
      },
      select: { id: true },
      take: 20,
    })
    for (const jr of recentlyExpired) {
      notifyExpiredJobParties({ jobRequestId: jr.id }).catch((err: unknown) => {
        console.error(`[cron/match-leads:${reqId}] Catch-up notify failed for ${jr.id}:`, err)
      })
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error in catch-up expired notification sweep:`, err)
    results.errors++
  }

  // 1j. Auto-resume providers whose temporary pause has expired (breakUntil <= now).
  // Hard-paused providers (breakUntil=null) are excluded — they must re-enable manually via WhatsApp.
  try {
    const expiredPauses = await db.technicianAvailability.findMany({
      where: {
        availabilityState: 'PAUSED',
        breakUntil: { not: null, lte: new Date() },
      },
      select: { providerId: true },
      take: 50,
    })
    for (const { providerId } of expiredPauses) {
      try {
        await db.$transaction([
          db.provider.update({ where: { id: providerId }, data: { availableNow: true } }),
          db.technicianAvailability.update({
            where: { providerId },
            data: { availabilityState: 'AVAILABLE', breakUntil: null, notes: null },
          }),
        ])
        checkJobsForNewProviderAvailability(providerId).catch((err: unknown) => {
          console.error(`[cron/match-leads:${reqId}] auto-resume job check failed for ${providerId}:`, err)
        })
        results.autoResumed++
      } catch (err) {
        console.error(`[cron/match-leads:${reqId}] auto-resume failed for provider ${providerId}:`, err)
        results.errors++
      }
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error in auto-resume sweep:`, err)
    results.errors++
  }

  // 1k. Recover MATCHING jobs with no active hold — these are stuck because the
  // ranked queue was exhausted but expireOpenJobRequest previously only handled
  // OPEN status. With that fix in place this sweep terminates lingering cases.
  // A job is considered stuck if it has been in MATCHING for >30 min with no
  // active hold: either expire it (if expiresAt has passed) or reset to OPEN.
  try {
    const stuckMatchingJobs = await db.jobRequest.findMany({
      where: {
        status: 'MATCHING',
        assignmentMode: 'AUTO_ASSIGN',
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        assignmentHolds: { none: { status: 'ACTIVE' } },
      },
      select: { id: true, expiresAt: true },
      take: 20,
    })

    for (const jr of stuckMatchingJobs) {
      try {
        const isExpired = !jr.expiresAt || jr.expiresAt <= new Date()
        if (isExpired) {
          const { transitioned } = await expireOpenJobRequest(jr.id, 'stuck_matching_recovery')
          if (transitioned) {
            results.expiredRequests++
            notifyExpiredJobParties({ jobRequestId: jr.id }).catch((err: unknown) => {
              console.error(`[cron/match-leads:${reqId}] Failed to notify stuck-MATCHING expired job ${jr.id}:`, err)
            })
          }
        } else {
          await db.jobRequest.update({ where: { id: jr.id }, data: { status: 'OPEN' } })
          console.info(`[cron/match-leads:${reqId}] Reset stuck MATCHING job to OPEN`, { jobRequestId: jr.id })
        }
      } catch (err) {
        console.error(`[cron/match-leads:${reqId}] Error recovering stuck MATCHING job ${jr.id}:`, err)
        results.errors++
      }
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error sweeping stuck MATCHING jobs:`, err)
    results.errors++
  }

  // 2. Dispatch leads for OPEN requests with no active hold.
  // take: 20 is safe at 5-min cadence (matches the max concurrent open requests we'd expect).
  // If queue grows beyond this, add cursor-based pagination here.
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN', assignmentMode: 'AUTO_ASSIGN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  for (const jr of openRequests) {
    // orchestrateMatch() guards against already-active holds internally;
    // it returns SKIP for MATCHING/MATCHED/EXPIRED/CANCELLED status too.
    try {
      const result = await orchestrateMatch(jr.id, { triggeredBy: 'cron' })
      if (result.status === 'DISPATCHED') {
        results.dispatched++
      } else if (result.status === 'NO_MATCH') {
        results.noMatch++
        console.warn(`[cron/match-leads:${reqId}] No providers for job ${jr.id}`)
      }
      // SKIP is expected for jobs with active holds or non-OPEN status — not an error
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

  // 3b. Send customer-facing Quick Match progress updates at most every 30 min.
  try {
    const progress = await sendQuickMatchProgressUpdates()
    results.progressUpdates = progress.sent
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error sending Quick Match progress updates:`, err)
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

      const link = `${getPublicAppUrl()}${getQueueHref(breach.queueKey)}`
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
