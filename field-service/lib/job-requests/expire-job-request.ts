// ─── Shared helper: expire an OPEN job request ────────────────────────────────
// Called from two places so expiry behaviour stays consistent:
//   1. cron/match-leads — sweeps jobs past their expiresAt
//   2. matching/orchestrator — guards against dispatching an already-stale job
//
// Transitions status OPEN → EXPIRED in a single transaction.
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

      // Only expire if truly OPEN — guard against concurrent cron ticks.
      if (!jr || jr.status !== 'OPEN') return

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
