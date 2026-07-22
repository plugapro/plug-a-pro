// ─── Cron: Auto-match OPEN job requests + expire stale leads + ops alerts ─────
// Runs 24/7 via two Vercel Cron schedules (all times SAST = UTC+2):
//   */5 5-16 * * *       - every 5 min during standard hours (07:00–18:59 SAST)
//   */30 17-23,0-4 * * * - every 30 min during off-hours (19:00–06:59 SAST)
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
import { sweepStaleProviderConfirmationRequests } from '@/lib/customer-shortlists'
import { expireRfpInvitations } from '@/lib/review-first'
import { reconcileProviderRecordsFromApplications } from '@/lib/provider-record'
import { notifyProviderApplicationApprovedOnce } from '@/lib/provider-application-notifications'
import { routeProviderApplicationsForOpsReview } from '@/lib/provider-application-review-support'
import { expireStaleQuotes } from '@/lib/quotes'
import { expireOpenJobRequest } from '@/lib/job-requests/expire-job-request'
import { sendCtaUrl } from '@/lib/whatsapp-interactive'
import { recordAuditLog } from '@/lib/audit'
import {
  buildQueueBreachAlertMessage,
  buildUnmatchedJobsAlertMessage,
  detectQueueBreaches,
  getQueueHref,
} from '@/lib/ops-dashboard/alerts'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''
const ALERT_COOLDOWN_MINUTES = 90

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const results = { dispatched: 0, expired: 0, expiredRequests: 0, reoffered: 0, expiredQuotes: 0, noMatch: 0, reminders: 0, progressUpdates: 0, reconciledProviders: 0, reviewRoutedApplications: 0, flaggedApplications: 0, autoResumed: 0, errors: 0, reconciledCapacity: 0, rfpExpired: 0 }

  // 0. Reconcile stale capacity counters (safety net - corrects counter drift)
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

  // 1a. Sweep stale PROVIDER_CONFIRMATION_PENDING requests where provider never responded
  try {
    const sweptCount = await sweepStaleProviderConfirmationRequests()
    if (sweptCount > 0) {
      console.info(`[cron/match-leads:${reqId}] swept ${sweptCount} stale provider confirmation requests`)
    }
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error sweeping stale provider confirmations:`, err)
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
  // /api/cron/provider-auto-approve schedule - not here.
  try {
    const routed = await routeProviderApplicationsForOpsReview(db, { actorId: 'cron:match-leads' })
    results.reviewRoutedApplications = routed.routed
    results.flaggedApplications = routed.flagged
  } catch (err) {
    console.error(`[cron/match-leads:${reqId}] Error routing provider applications for review:`, err)
    results.errors++
  }

  // 1g. Retry approved provider application WhatsApp confirmations that were
  // missed because Meta, network or a prior deploy failed after DB approval.
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

  // 1h. Expire OPEN/MATCHING/SHORTLIST_READY job requests that have passed
  // their expiresAt deadline. Only processes jobs where expiresAt was
  // explicitly set (legacy jobs without the field are ignored). Notify
  // customer after each transition.
  // SHORTLIST_READY is included additively (I1, true cap-3): the provider
  // board keeps a job visible through SHORTLIST_READY until 3 open interests
  // or customer selection, so a SHORTLIST_READY job can now idle past its
  // expiresAt with open board leads still attached — nothing else in this
  // cron (or elsewhere) swept that state before. expireOpenJobRequest itself
  // already accepts SHORTLIST_READY (see lib/job-requests/expire-job-request.ts)
  // and closes out any open board leads in the same transaction; this query
  // just needs to find those jobs and hand them to it.
  try {
    const staleRequests = await db.jobRequest.findMany({
      where: {
        status: { in: ['OPEN', 'SHORTLIST_READY'] },
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
          // Notify customer (fire-and-forget - failure should not block the sweep)
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
  // notifyExpiredJobParties() is idempotent - it guards on customerNoMatchNotifiedAt.
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
  // Hard-paused providers (breakUntil=null) are excluded - they must re-enable manually via WhatsApp.
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

  // 1k. Recover MATCHING jobs with no active hold - these are stuck because the
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
  // take: 50 increased from 20 to handle 30-min cron cadence; during off-hours,
  // a job at position 21+ could wait up to 30 min for first dispatch otherwise.
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN', assignmentMode: 'AUTO_ASSIGN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })

  // Alert if queue is at max capacity: indicates jobs may be backed up
  if (openRequests.length === 50) {
    console.warn(`[cron/match-leads:${reqId}] job queue may be backed up: fetched max batch of 50 jobs`)
  }

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
      // SKIP is expected for jobs with active holds or non-OPEN status - not an error
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
      // URL must travel in the CTA button payload: a raw URL in the text body
      // is rejected by the central WhatsApp send guard. getPublicAppUrl() can
      // resolve to '' (missing/relative env) and Meta rejects relative CTA
      // URLs, so fail loudly instead of sending a message Meta will drop.
      const baseUrl = getPublicAppUrl()
      if (!baseUrl) {
        console.error(`[cron/match-leads:${reqId}] Skipping unmatched-jobs alert: no public app URL configured`)
      } else {
        const alert = buildUnmatchedJobsAlertMessage(unmatched1h)
        await sendCtaUrl(
          ADMIN_PHONE,
          alert.body,
          alert.buttonText,
          `${baseUrl}/admin/bookings`
        ).catch((error) => {
          console.error(`[cron/match-leads:${reqId}] Failed to send unmatched-jobs alert`, { error })
        })
      }
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

      const baseUrl = getPublicAppUrl()
      const link = `${baseUrl}${getQueueHref(breach.queueKey)}`
      const alert = buildQueueBreachAlertMessage(breach)

      if (!baseUrl) {
        console.error(`[cron/match-leads:${reqId}] Skipping ops breach alert: no public app URL configured`, { queueKey: breach.queueKey })
      }
      const sent = ADMIN_PHONE && baseUrl
        ? await sendCtaUrl(ADMIN_PHONE, alert.body, alert.buttonText, link).catch((error) => {
            console.error(`[cron/match-leads:${reqId}] Failed to send ops WhatsApp alert`, { queueKey: breach.queueKey, error })
            return null
          })
        : null

      if (sent) opsNotified++

      // Only a DELIVERED alert arms the 90-min cooldown: the cooldown query
      // above matches action 'ops_alert.sent' only, so recording failures under
      // a separate action keeps the audit trail without suppressing retries of
      // alerts that never reached ops.
      await recordAuditLog({
        actorId: 'system',
        actorRole: 'system',
        action: sent ? 'ops_alert.sent' : 'ops_alert.failed',
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
