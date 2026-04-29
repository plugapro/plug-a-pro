// ─── Cron: Auto-match OPEN job requests + expire stale leads ─────────────────
// Runs every 5 minutes during business hours (07:00–20:00) via Vercel Cron — schedule: */5 7-20 * * *
// 1. Expires leads past their expiresAt → frees job for re-dispatch
// 2. Finds OPEN job requests with no active SENT lead → dispatches via orchestrateMatch
// 3. Alerts admin if jobs remain unmatched after 1 hour
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendLeadReminders } from '@/lib/matching-engine'
import { processPendingAssignmentWorkflows, reconcileStaleAssignmentState } from '@/lib/matching/service'
import { orchestrateMatch } from '@/lib/matching/orchestrator'
import { checkJobsForNewProviderAvailability, notifyExpiredJobParties } from '@/lib/matching/customer-recontact'
import { reconcileProviderRecordsFromApplications, syncProviderRecord } from '@/lib/provider-record'
import { notifyProviderApplicationApprovedOnce } from '@/lib/provider-application-notifications'
import { awardMobileVerifiedPromoCreditsInTransaction } from '@/lib/provider-promo-awards'
import { expireStaleQuotes } from '@/lib/quotes'
import { expireOpenJobRequest } from '@/lib/job-requests/expire-job-request'
import { sendText } from '@/lib/whatsapp-interactive'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''
const PROVIDER_AUTO_APPROVAL_WINDOW_MINUTES = 30

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const results = { dispatched: 0, expired: 0, expiredRequests: 0, reoffered: 0, expiredQuotes: 0, noMatch: 0, reminders: 0, reconciledProviders: 0, autoApproved: 0, autoResumed: 0, errors: 0, reconciledCapacity: 0 }

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

  // 1d. Auto-approve provider applications older than 30 min with all required fields
  try {
    const approvalCutoff = new Date(Date.now() - PROVIDER_AUTO_APPROVAL_WINDOW_MINUTES * 60 * 1000)
    const pendingApplications = await db.providerApplication.findMany({
      where: {
        status: 'PENDING',
        submittedAt: { lte: approvalCutoff },
        name: { not: '' },
        skills: { isEmpty: false },
        serviceAreas: { isEmpty: false },
      },
      select: { id: true, phone: true, name: true, skills: true, serviceAreas: true },
      take: 50,
    })

    for (const app of pendingApplications) {
      try {
        const reviewedAt = new Date()
        let providerId: string | null = null
        let approved = false
        await db.$transaction(async (tx) => {
          providerId = await syncProviderRecord(tx as typeof db, {
            phone: app.phone,
            name: app.name,
            skills: app.skills,
            serviceAreas: app.serviceAreas,
            active: true,
            availableNow: true,
            verified: true,
          })

          const update = await tx.providerApplication.updateMany({
            where: { id: app.id, status: 'PENDING' },
            data: {
              status: 'APPROVED',
              reviewedAt,
              providerId,
            },
          })
          approved = update.count > 0
          if (approved && providerId) {
            await awardMobileVerifiedPromoCreditsInTransaction(tx, providerId, {
              referenceType: 'provider_application',
              referenceId: app.id,
              createdBy: 'system',
            })
          }
        })
        if (!approved) continue
        await notifyProviderApplicationApprovedOnce({
          applicationId: app.id,
          phone: app.phone,
          name: app.name,
        }).catch((err: unknown) => {
          console.error(`[cron/match-leads:${reqId}] Failed to notify auto-approved provider ${app.id}:`, err)
        })
        if (providerId) {
          await checkJobsForNewProviderAvailability(providerId).catch((err: unknown) => {
            console.error(`[cron/match-leads:${reqId}] new-provider job check failed for ${providerId}:`, err)
          })
        }
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

  // 1e. Retry approved provider application WhatsApp confirmations that were
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

  // 1f. Expire OPEN job requests that have passed their expiresAt deadline.
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

  // 1f. Catch-up sweep: EXPIRED jobs from the last 24h that never received a
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

  // 1g. Auto-resume providers whose temporary pause has expired (breakUntil <= now).
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

  // 2. Dispatch leads for OPEN requests with no active hold.
  // take: 20 is safe at 5-min cadence (matches the max concurrent open requests we'd expect).
  // If queue grows beyond this, add cursor-based pagination here.
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN' },
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
  return NextResponse.json({ ok: true, ...results })
}
