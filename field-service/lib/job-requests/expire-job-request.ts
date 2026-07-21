// ─── Shared helper: expire an OPEN or MATCHING job request ───────────────────
// Called from multiple places so expiry behaviour stays consistent:
//   1. cron/match-leads - sweeps jobs past their expiresAt
//   2. matching/orchestrator - guards against dispatching an already-stale job
//   3. matching/service (offerNextRankedCandidate) - terminates after queue exhaustion
//
// Transitions status OPEN or MATCHING → EXPIRED in a single transaction.
// MATCHING must be included because AUTO_ASSIGN jobs advance to MATCHING when
// the first offer is sent; if the entire ranked queue is exhausted while the job
// is still in MATCHING, failing to expire it here leaves it permanently stuck.
//
// Notification (notifyExpiredJobParties) is intentionally NOT called here
// because the cron handles the customer message after the sweep and the
// orchestrator skips dispatching rather than notifying.

import { db } from '../db'
import { sendText } from '../whatsapp-interactive'

export interface ExpireJobRequestResult {
  /** true if the job was transitioned; false if it was already EXPIRED/CANCELLED */
  transitioned: boolean
}

// Board leads that are still "open" from the provider's perspective when the
// job expires. PUSH-origin leads are handled by their own dedicated expiry
// paths (see expireAssignmentOffer in lib/matching/service.ts) and are
// intentionally out of scope here.
const OPEN_BOARD_LEAD_STATUSES = ['VIEWED', 'INTERESTED', 'SHORTLISTED'] as const

export async function expireOpenJobRequest(
  jobRequestId: string,
  reason = 'max_age_exceeded',
): Promise<ExpireJobRequestResult> {
  let transitioned = false
  let notifyTargets: { phone: string | null; suburb: string | null }[] = []

  try {
    await db.$transaction(async (tx) => {
      const jr = await tx.jobRequest.findUnique({
        where: { id: jobRequestId },
        select: { id: true, status: true, address: { select: { suburb: true } } },
      })

      // Only expire if OPEN or MATCHING - guard against concurrent cron ticks.
      // MATCHING must be included: AUTO_ASSIGN jobs advance to MATCHING on first
      // offer; if the full ranked queue is exhausted, the job can be stuck in
      // MATCHING indefinitely without this guard.
      if (!jr || (jr.status !== 'OPEN' && jr.status !== 'MATCHING')) return

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'EXPIRED' },
      })

      transitioned = true
      // TODO: write a DispatchDecision audit record for EXPIRED-by-max-age
      // once a suitable audit model for job-request-level events is established.
      // JobStatusEvent is for Job (not JobRequest) so is not used here.
      console.info('[expire-job-request] expired', { jobRequestId, reason })

      // ── Additive close-out: open BOARD-origin leads ──────────────────────
      // Provider self-serve board leads (origin: 'BOARD') don't have their own
      // expiry timer tied to an AssignmentHold, so a job going stale must
      // explicitly close out any board leads still sitting open (VIEWED /
      // INTERESTED / SHORTLISTED) for it. Read-before-update so we know which
      // providers to courteously notify after the transaction commits;
      // updateMany alone would not return affected rows.
      const openBoardLeads = await tx.lead.findMany({
        where: {
          jobRequestId,
          origin: 'BOARD',
          status: { in: [...OPEN_BOARD_LEAD_STATUSES] },
        },
        select: { provider: { select: { phone: true } } },
      })

      if (openBoardLeads.length > 0) {
        await tx.lead.updateMany({
          where: {
            jobRequestId,
            origin: 'BOARD',
            status: { in: [...OPEN_BOARD_LEAD_STATUSES] },
          },
          data: { status: 'EXPIRED', expiredAt: new Date() },
        })

        notifyTargets = openBoardLeads.map((lead) => ({
          phone: lead.provider?.phone ?? null,
          suburb: jr.address?.suburb ?? null,
        }))
      }
    })
  } catch (err) {
    // Log but don't throw - the cron/orchestrator should continue with other jobs.
    console.error('[expire-job-request] failed to expire job request', { jobRequestId, err })
    return { transitioned: false }
  }

  // Best-effort notify, strictly after the transaction has committed. Never
  // block or fail expiry on a WhatsApp send error.
  for (const target of notifyTargets) {
    if (!target.phone) continue
    const suburbLabel = target.suburb ?? 'your area'
    sendText(
      target.phone,
      `That job in ${suburbLabel} is no longer available — more jobs are on your board.`,
      { templateName: 'interactive:board_lead_closed_out', metadata: { jobRequestId, reason } },
    ).catch(() => {})
  }

  return { transitioned }
}
