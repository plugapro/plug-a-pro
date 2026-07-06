// ─── Shared helper: expire a stale job request ────────────────────────────────
// Called from multiple places so expiry behaviour stays consistent:
//   1. cron/match-leads - sweeps jobs past their expiresAt
//   2. matching/orchestrator - guards against dispatching an already-stale job
//   3. matching/service (offerNextRankedCandidate) - terminates after queue exhaustion
//   4. cron/match-leads via sweepStrandedJobRequests - CJ-08 mid-funnel statuses
//
// Default transition remains status OPEN or MATCHING → EXPIRED in a single
// transaction (legacy behaviour). MATCHING must be included because
// AUTO_ASSIGN jobs advance to MATCHING when the first offer is sent; if the
// entire ranked queue is exhausted while the job is still in MATCHING,
// failing to expire it here leaves it permanently stuck.
//
// CJ-08 (platform audit 2026-07-06): callers may pass allowedStatuses to also
// expire the previously-stranding statuses PENDING_VALIDATION,
// SHORTLIST_READY and PROVIDER_CONFIRMATION_PENDING once their natural
// deadlines have passed. The default is unchanged so existing call sites keep
// their exact semantics.
//
// Notification (notifyExpiredJobParties) is intentionally NOT called here
// because the cron handles the customer message after the sweep and the
// orchestrator skips dispatching rather than notifying.

import { db } from '../db'

export type ExpirableJobRequestStatus =
  | 'OPEN'
  | 'MATCHING'
  | 'PENDING_VALIDATION'
  | 'SHORTLIST_READY'
  | 'PROVIDER_CONFIRMATION_PENDING'

const DEFAULT_ALLOWED_STATUSES: readonly ExpirableJobRequestStatus[] = ['OPEN', 'MATCHING']

export interface ExpireJobRequestOptions {
  /**
   * Statuses eligible for the → EXPIRED transition. Defaults to the legacy
   * OPEN | MATCHING pair; the stranded-request sweep passes the mid-funnel
   * statuses explicitly.
   */
  allowedStatuses?: readonly ExpirableJobRequestStatus[]
}

export interface ExpireJobRequestResult {
  /** true if the job was transitioned; false if it was already EXPIRED/CANCELLED */
  transitioned: boolean
}

export async function expireOpenJobRequest(
  jobRequestId: string,
  reason = 'max_age_exceeded',
  options: ExpireJobRequestOptions = {},
): Promise<ExpireJobRequestResult> {
  const allowedStatuses = options.allowedStatuses ?? DEFAULT_ALLOWED_STATUSES
  let transitioned = false

  try {
    await db.$transaction(async (tx) => {
      const jr = await tx.jobRequest.findUnique({
        where: { id: jobRequestId },
        select: { id: true, status: true },
      })

      // Only expire if the status is in the allowed set - guards against
      // concurrent cron ticks and racing state transitions.
      if (!jr || !allowedStatuses.includes(jr.status as ExpirableJobRequestStatus)) return

      // CAS on status so a concurrent transition between the read and the
      // write cannot expire a request that just moved forward.
      const update = await tx.jobRequest.updateMany({
        where: { id: jobRequestId, status: { in: [...allowedStatuses] } },
        data: { status: 'EXPIRED' },
      })
      if (update.count === 0) return

      transitioned = true
      // TODO: write a DispatchDecision audit record for EXPIRED-by-max-age
      // once a suitable audit model for job-request-level events is established.
      // JobStatusEvent is for Job (not JobRequest) so is not used here.
      console.info('[expire-job-request] expired', { jobRequestId, reason, fromStatus: jr.status })
    })
  } catch (err) {
    // Log but don't throw - the cron/orchestrator should continue with other jobs.
    console.error('[expire-job-request] failed to expire job request', { jobRequestId, err })
    return { transitioned: false }
  }

  return { transitioned }
}
