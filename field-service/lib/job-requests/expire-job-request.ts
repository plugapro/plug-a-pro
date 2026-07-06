// ─── Shared helper: expire a stale job request ────────────────────────────────
// Called from multiple places so expiry behaviour stays consistent:
//   1. cron/match-leads step 1h - sweeps jobs past their expiresAt (deadline-gated
//      query: `expiresAt: { not: null, lte: now }`). This is the ONLY caller that
//      passes `{ includeShortlistReady: true }`.
//   2. matching/orchestrator - guards against dispatching an already-stale job
//      (OPEN/MATCHING only, mid-dispatch)
//   3. matching/service offerNextRankedCandidate - terminates after the ranked
//      queue is exhausted (OPEN/MATCHING only)
//   4. matching/service rejectAssignmentOffer / expireAssignmentOffer, via the
//      same offerNextRankedCandidate queue-exhaustion path (OPEN/MATCHING only)
//   5. cron/match-leads via sweepStrandedJobRequests - CJ-08 mid-funnel statuses
//      (PENDING_VALIDATION / SHORTLIST_READY / PROVIDER_CONFIRMATION_PENDING),
//      passed explicitly via `allowedStatuses` once their own deadline has passed.
//
// Default transition remains status OPEN or MATCHING → EXPIRED in a single
// transaction (legacy behaviour). MATCHING must always be included because
// AUTO_ASSIGN jobs advance to MATCHING when the first offer is sent; if the
// entire ranked queue is exhausted while the job is still in MATCHING,
// failing to expire it here leaves it permanently stuck.
//
// Two independent, orthogonal opt-ins widen the default OPEN|MATCHING guard:
//
//   - `includeShortlistReady` (C2, re-review fix): widens the guard to also
//     accept SHORTLIST_READY. It is NOT true that callers 2-4 only ever reach
//     jobs that are OPEN/MATCHING "by construction": offerNextRankedCandidate's
//     queue-exhaustion terminator (caller 3, and transitively caller 4 via
//     rejectAssignmentOffer / expireAssignmentOffer calling
//     offerNextRankedCandidate) can run against a job that has already reached
//     SHORTLIST_READY - true cap-3 (I1) keeps a job board-visible through
//     SHORTLIST_READY while push-origin offers are still rotating in parallel.
//     Unconditionally widening the guard to SHORTLIST_READY for every caller
//     would let a queue-exhaustion tick expire a job while the customer is
//     actively looking at a live, PUBLISHED shortlist - dead link,
//     contradictory "could not match" copy, and lost board leads that were
//     never actually exhausted. Only the cron's step-1h sweep is
//     deadline-gated (expiresAt has genuinely passed) and is therefore safe to
//     widen; it passes `{ includeShortlistReady: true }` explicitly. Every
//     other caller keeps the old OPEN/MATCHING-only behaviour by default.
//
//   - `allowedStatuses` (CJ-08, platform audit 2026-07-06): lets a caller
//     replace the accepted-status set outright to expire the previously-
//     stranding statuses PENDING_VALIDATION, SHORTLIST_READY and
//     PROVIDER_CONFIRMATION_PENDING once THEIR OWN natural deadlines have
//     passed. Used exclusively by sweepStrandedJobRequests, which always
//     passes a single-status array scoped to the row it is currently
//     processing - it never widens the OPEN/MATCHING default for the
//     ordinary dispatch-time callers. When both options are supplied,
//     `allowedStatuses` takes precedence (it is the more specific,
//     caller-scoped override); `includeShortlistReady` only widens the
//     *default* OPEN|MATCHING set.
//
// Notification (notifyExpiredJobParties) is intentionally NOT called here
// because the cron handles the customer message after the sweep and the
// orchestrator skips dispatching rather than notifying.

import { db } from '../db'
import { sendText } from '../whatsapp-interactive'

export type ExpirableJobRequestStatus =
  | 'OPEN'
  | 'MATCHING'
  | 'PENDING_VALIDATION'
  | 'SHORTLIST_READY'
  | 'PROVIDER_CONFIRMATION_PENDING'

const DEFAULT_ALLOWED_STATUSES: readonly ExpirableJobRequestStatus[] = ['OPEN', 'MATCHING']

export interface ExpireJobRequestOptions {
  /**
   * Widen the *default* OPEN|MATCHING status guard to also accept
   * SHORTLIST_READY. Default false. ONLY the cron/match-leads step-1h
   * deadline-gated sweep should pass `true` - see the file-header comment
   * above for why every other caller must NOT opt in. Ignored when
   * `allowedStatuses` is also supplied.
   */
  includeShortlistReady?: boolean
  /**
   * Statuses eligible for the → EXPIRED transition, replacing the default
   * OPEN | MATCHING (+ optional SHORTLIST_READY) set outright. Used by the
   * stranded-request sweep (CJ-08) to scope a single call to the exact
   * mid-funnel status it already confirmed the row is in.
   */
  allowedStatuses?: readonly ExpirableJobRequestStatus[]
}

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
  options: ExpireJobRequestOptions = {},
): Promise<ExpireJobRequestResult> {
  // `allowedStatuses` is the more specific, caller-scoped override (CJ-08);
  // when absent, fall back to the default OPEN|MATCHING set optionally
  // widened by `includeShortlistReady` (C2).
  const acceptedStatuses: readonly ExpirableJobRequestStatus[] =
    options.allowedStatuses ??
    (options.includeShortlistReady === true
      ? ([...DEFAULT_ALLOWED_STATUSES, 'SHORTLIST_READY'] as const)
      : DEFAULT_ALLOWED_STATUSES)
  let transitioned = false
  let notifyTargets: { phone: string | null; suburb: string | null }[] = []

  try {
    await db.$transaction(async (tx) => {
      const jr = await tx.jobRequest.findUnique({
        where: { id: jobRequestId },
        select: { id: true, status: true, address: { select: { suburb: true } } },
      })

      // Only expire if the status is in the accepted set - guards against
      // concurrent cron ticks and racing state transitions. See the
      // file-header comment for why SHORTLIST_READY is never accepted by
      // default and why `allowedStatuses` must stay caller-scoped.
      if (!jr || !acceptedStatuses.includes(jr.status as ExpirableJobRequestStatus)) {
        return
      }

      // CAS on status so a concurrent transition between the read and the
      // write cannot expire a request that just moved forward.
      const update = await tx.jobRequest.updateMany({
        where: { id: jobRequestId, status: { in: [...acceptedStatuses] } },
        data: { status: 'EXPIRED' },
      })
      if (update.count === 0) return

      transitioned = true
      // TODO: write a DispatchDecision audit record for EXPIRED-by-max-age
      // once a suitable audit model for job-request-level events is established.
      // JobStatusEvent is for Job (not JobRequest) so is not used here.
      console.info('[expire-job-request] expired', { jobRequestId, reason, fromStatus: jr.status })

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
