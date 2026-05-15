// ─── Shared helper: expire an OPEN or MATCHING job request ───────────────────
// Called from multiple places so expiry behaviour stays consistent:
//   1. cron/match-leads — sweeps jobs past their expiresAt
//   2. matching/orchestrator — guards against dispatching an already-stale job
//   3. matching/service (offerNextRankedCandidate) — terminates after queue exhaustion
//
// Transitions status OPEN or MATCHING → EXPIRED in a single transaction.
// MATCHING must be included because AUTO_ASSIGN jobs advance to MATCHING when
// the first offer is sent; if the entire ranked queue is exhausted while the job
// is still in MATCHING, failing to expire it here leaves it permanently stuck.
//
// Notification (notifyExpiredJobParties) is intentionally NOT called here
// because the cron handles the customer message after the sweep, and the
// orchestrator skips dispatching rather than notifying.

import { db } from '../db'

export interface ExpireJobRequestResult {
  /** true if the job was transitioned; false if it was already EXPIRED/CANCELLED */
  transitioned: boolean
}

export async function expireOpenJobRequest(
  jobRequestId: string,
  reason = 'max_age_exceeded',
): Promise<ExpireJobRequestResult> {
  let transitioned = false

  try {
    await db.$transaction(async (tx) => {
      const jr = await tx.jobRequest.findUnique({
        where: { id: jobRequestId },
        select: { id: true, status: true },
      })

      // Only expire if OPEN or MATCHING — guard against concurrent cron ticks.
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
    })
  } catch (err) {
    // Log but don't throw — the cron/orchestrator should continue with other jobs.
    console.error('[expire-job-request] failed to expire job request', { jobRequestId, err })
    return { transitioned: false }
  }

  return { transitioned }
}
