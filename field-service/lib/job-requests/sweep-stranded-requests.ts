// ─── Stranded job-request expiry sweep (CJ-08) ────────────────────────────────
// Platform audit 2026-07-06: expireOpenJobRequest only covered OPEN|MATCHING,
// so requests parked in PENDING_VALIDATION (customer never picked a matching
// mode), SHORTLIST_READY (customer never selected a provider) and
// PROVIDER_CONFIRMATION_PENDING (selected provider never responded and the
// request-level deadline passed) stranded silently forever — the mid-funnel
// 100%-drop pattern observed in prod.
//
// This sweep expires those requests once their natural deadline passes and
// sends the EXISTING expiry notification (notifyExpiredJobParties →
// notifyCustomerNoMatch, idempotent via customerNoMatchNotifiedAt). No new
// message type is introduced, so no feature flag is required.
//
// Deadlines:
//   - PENDING_VALIDATION: the request's own expiresAt (already set at intake).
//   - SHORTLIST_READY / PROVIDER_CONFIRMATION_PENDING: the request's expiresAt
//     when set; otherwise the 24h selection window
//     (PROVIDER_CONFIRMATION_WINDOW_MS, shared with lib/customer-shortlists.ts)
//     measured from the last status change (updatedAt).
//
// Ordering note: the existing sweepStaleProviderConfirmationRequests (which
// resets PCP → SHORTLIST_READY when only the selected LEAD expired) should run
// BEFORE this sweep in the cron so a request whose overall deadline has NOT
// passed gets returned to the customer's shortlist rather than expired.

import { db } from '../db'
import { PROVIDER_CONFIRMATION_WINDOW_MS } from '../customer-shortlists'
import { expireOpenJobRequest, type ExpirableJobRequestStatus } from './expire-job-request'

export const SHORTLIST_SELECTION_WINDOW_MS = PROVIDER_CONFIRMATION_WINDOW_MS

const STRANDED_STATUSES = [
  'PENDING_VALIDATION',
  'SHORTLIST_READY',
  'PROVIDER_CONFIRMATION_PENDING',
] as const

type StrandedStatus = (typeof STRANDED_STATUSES)[number]

const EXPIRY_REASON_BY_STATUS: Record<StrandedStatus, string> = {
  PENDING_VALIDATION: 'validation_window_exceeded',
  SHORTLIST_READY: 'shortlist_selection_window_exceeded',
  PROVIDER_CONFIRMATION_PENDING: 'provider_confirmation_window_exceeded',
}

export type SweepStrandedJobRequestsResult = {
  scanned: number
  expired: number
  notified: number
  errors: number
  byStatus: Record<StrandedStatus, number>
}

export async function sweepStrandedJobRequests(options?: {
  batchSize?: number
  now?: Date
}): Promise<SweepStrandedJobRequestsResult> {
  const now = options?.now ?? new Date()
  const take = options?.batchSize ?? 20
  const selectionWindowCutoff = new Date(now.getTime() - SHORTLIST_SELECTION_WINDOW_MS)

  const result: SweepStrandedJobRequestsResult = {
    scanned: 0,
    expired: 0,
    notified: 0,
    errors: 0,
    byStatus: {
      PENDING_VALIDATION: 0,
      SHORTLIST_READY: 0,
      PROVIDER_CONFIRMATION_PENDING: 0,
    },
  }

  let stranded: Array<{ id: string; status: string }>
  try {
    stranded = await db.jobRequest.findMany({
      where: {
        OR: [
          // PENDING_VALIDATION: only the explicit intake deadline applies —
          // requests without expiresAt predate the field and are left alone.
          { status: 'PENDING_VALIDATION', expiresAt: { not: null, lte: now } },
          // SHORTLIST_READY / PROVIDER_CONFIRMATION_PENDING: request-level
          // deadline, or the 24h selection window from the last status change
          // when no explicit deadline exists.
          {
            status: { in: ['SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'] },
            OR: [
              { expiresAt: { not: null, lte: now } },
              { expiresAt: null, updatedAt: { lte: selectionWindowCutoff } },
            ],
          },
        ],
      },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'asc' },
      take,
    })
  } catch (err) {
    console.error('[sweep-stranded-requests] query failed', { err })
    result.errors += 1
    return result
  }

  result.scanned = stranded.length

  for (const jr of stranded) {
    const status = jr.status as StrandedStatus
    if (!STRANDED_STATUSES.includes(status)) continue
    try {
      const { transitioned } = await expireOpenJobRequest(
        jr.id,
        EXPIRY_REASON_BY_STATUS[status],
        { allowedStatuses: [status as ExpirableJobRequestStatus] },
      )
      if (!transitioned) continue

      result.expired += 1
      result.byStatus[status] += 1

      // Existing expiry notification — customer gets the honest "we could not
      // match your request" message. Idempotent (customerNoMatchNotifiedAt),
      // and the cron's catch-up sweep re-drives missed sends.
      const { notifyExpiredJobParties } = await import('../matching/customer-recontact')
      const notifyOutcome = await notifyExpiredJobParties({ jobRequestId: jr.id }).catch((err: unknown) => {
        console.error('[sweep-stranded-requests] expiry notification failed', { jobRequestId: jr.id, err })
        return { customerNotified: false, providerNotified: false }
      })
      if (notifyOutcome.customerNotified) result.notified += 1
    } catch (err) {
      console.error('[sweep-stranded-requests] failed to expire stranded request', {
        jobRequestId: jr.id,
        status,
        err,
      })
      result.errors += 1
    }
  }

  if (result.expired > 0) {
    console.info('[sweep-stranded-requests] swept stranded job requests', result)
  }

  return result
}
