// Provider lead board: express-interest action. Creates/revives a BOARD-origin
// Lead, then feeds the EXISTING Qualified Shortlist pipeline (interest record,
// shortlist generation, customer notify). No deletes anywhere (data-safety).
// Spec: docs/superpowers/specs/2026-07-21-provider-lead-board-design.md §1.
import { boardEligibilityWhere, BOARD_INTEREST_CAP, OPEN_INTEREST_STATUSES } from '@/lib/board/eligibility'

// Lead.status values (prisma/schema.prisma LeadStatus) that represent an
// open/in-flight lead for a given (jobRequestId, providerId) pair. A prior
// lead in any of these states means the provider already has live standing
// on this job and must not be re-created or silently re-activated.
const OPEN_LEAD_STATUSES = [
  'SEND_PENDING', 'SEND_FAILED',
  'SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED',
  'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED',
]
// OPEN_INTEREST_STATUSES (subset of OPEN_LEAD_STATUSES that counts against
// the shortlist interest cap) is imported from lib/board/eligibility.ts —
// single source of truth shared with findBoardJobsForProvider's own
// open-interest definition (dedupe).

export type BoardInterestInput = {
  providerId: string
  jobRequestId: string
  callOutFee: number
  estimatedArrivalAt: Date
  note?: string
}

export type BoardInterestResult =
  | { ok: true; leadId: string }
  | {
      ok: false
      reason:
        | 'FLAG_OFF'
        | 'NOT_ELIGIBLE_PROVIDER'
        | 'JOB_GONE'
        | 'SHORTLIST_FULL'
        | 'ALREADY_INTERESTED'
        | 'INVALID_INPUT'
        | 'INTEREST_RECORD_FAILED'
    }

export type BoardInterestDeps = {
  now: () => Date
  db: any // TODO: narrow to the Prisma Pick actually used; kept wide for DI in unit tests
  flagEnabled: (key: string) => Promise<boolean>
  /** active + verified + job in provider's area + category in skills (reuses Task 2 logic) */
  isProviderBoardEligible: (providerId: string, jobRequestId: string) => Promise<boolean>
  /**
   * Validates fee/arrival BEFORE any write, using the same rules
   * respondToProviderOpportunity enforces (validateProviderOnboardingRates +
   * arrival-date sanity). Returns false on invalid input. Prevents a write
   * that recordInterest would only reject after the lead row already exists.
   */
  validateInput: (input: BoardInterestInput) => boolean
  /** wraps respondToProviderOpportunity: records ProviderLeadResponse + flips lead → INTERESTED */
  recordInterest: (args: {
    leadId: string
    providerId: string
    callOutFee: number
    estimatedArrivalAt: Date
    note?: string
  }) => Promise<{ ok: boolean }>
  /** generate + publish shortlist and notify customer (idempotent per generateCustomerShortlistForRequest) */
  triggerShortlist: (jobRequestId: string) => Promise<void>
}

export async function expressBoardInterest(
  deps: BoardInterestDeps,
  input: BoardInterestInput,
): Promise<BoardInterestResult> {
  if (!(await deps.flagEnabled('provider.board.v1'))) {
    return { ok: false, reason: 'FLAG_OFF' }
  }
  if (!(await deps.isProviderBoardEligible(input.providerId, input.jobRequestId))) {
    return { ok: false, reason: 'NOT_ELIGIBLE_PROVIDER' }
  }
  if (!deps.validateInput(input)) {
    return { ok: false, reason: 'INVALID_INPUT' }
  }
  const now = deps.now()

  const outcome: BoardInterestResult = await deps.db.$transaction(async (tx: any) => {
    // Lock the job row FIRST so the count-then-write below is serialized per
    // job across concurrent express-interest calls (READ COMMITTED otherwise
    // lets two providers both read count=2 and both write, breaching the cap).
    // Matches lib/matching/reservation.ts's SELECT ... FOR UPDATE precedent.
    // Table name verified against JobRequest's @@map("job_requests").
    await tx.$queryRaw`SELECT id FROM "job_requests" WHERE id = ${input.jobRequestId} FOR UPDATE`

    const job = await tx.jobRequest.findFirst({
      where: { id: input.jobRequestId, ...boardEligibilityWhere(now) },
      select: { id: true, category: true, expiresAt: true },
    })
    if (!job) return { ok: false, reason: 'JOB_GONE' } as const

    const openInterests = await tx.lead.count({
      where: { jobRequestId: input.jobRequestId, status: { in: OPEN_INTEREST_STATUSES } },
    })
    if (openInterests >= BOARD_INTEREST_CAP) return { ok: false, reason: 'SHORTLIST_FULL' } as const

    // C1 fix: board leads must carry a real (non-null) expiresAt or they are
    // silently invisible to generateCustomerShortlistForRequest /
    // maybeAutoTriggerShortlist, which both require leadInvite.expiresAt >
    // now. Derive it from the job request's own expiresAt when set, else
    // default to now + 7 days (matches lib/matching/config.ts's
    // jobRequestMaxAgeDays default for jobs with no explicit deadline).
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const leadExpiresAt = job.expiresAt ?? new Date(now.getTime() + SEVEN_DAYS_MS)

    const prior = await tx.lead.findUnique({
      where: { jobRequestId_providerId: { jobRequestId: input.jobRequestId, providerId: input.providerId } },
      select: { id: true, status: true },
    })

    let leadId: string
    if (prior) {
      if (OPEN_LEAD_STATUSES.includes(String(prior.status))) {
        return { ok: false, reason: 'ALREADY_INTERESTED' } as const
      }
      // Terminal prior lead (EXPIRED/DECLINED/CANCELLED/SUPERSEDED): revive it —
      // the unique (jobRequestId, providerId) constraint forbids a second row.
      // Never delete/replace; always UPDATE the existing row.
      // I2: also clear every selection-cycle field a prior lifecycle (push
      // offer, customer selection, decline, cancellation, expiry) may have
      // left set — a revived board lead must start clean, not carry stale
      // state from whatever terminal path it came from.
      await tx.lead.update({
        where: { id: prior.id },
        data: {
          origin: 'BOARD',
          status: 'VIEWED',
          viewedAt: now,
          respondedAt: null,
          expiresAt: leadExpiresAt,
          notifiedAt: null,
          notificationAttemptedAt: null,
          customerSelectedAt: null,
          declinedAt: null,
          cancelledAt: null,
          expiredAt: null,
        },
      })
      leadId = prior.id
    } else {
      const created = await tx.lead.create({
        data: {
          jobRequestId: input.jobRequestId,
          providerId: input.providerId,
          origin: 'BOARD',
          status: 'VIEWED',
          sentAt: now,
          viewedAt: now,
          expiresAt: leadExpiresAt,
        },
        select: { id: true },
      })
      leadId = created.id
    }

    await tx.auditLog
      .create({
        data: {
          actorId: input.providerId,
          actorRole: 'provider',
          action: 'lead.board_interest_created',
          entityType: 'Lead',
          entityId: leadId,
          after: { jobRequestId: input.jobRequestId, callOutFee: input.callOutFee },
        },
      })
      .catch(() => undefined)

    return { ok: true, leadId } as const
  })

  if (!outcome.ok) return outcome

  // Outside the row transaction (matches existing respondToProviderOpportunity usage).
  // MUST be guarded: an unguarded throw here would (a) surface as an unhandled
  // rejection instead of a typed result, and (b) leave the lead committed in
  // VIEWED — every retry would then see it as an open prior lead and return
  // ALREADY_INTERESTED forever, with the rate/arrival never recorded. On
  // failure we compensate by flipping the lead to the terminal EXPIRED state;
  // the revive path above already treats EXPIRED as reviveable, so the
  // provider's next attempt works naturally instead of being stuck.
  try {
    await deps.recordInterest({
      leadId: outcome.leadId,
      providerId: input.providerId,
      callOutFee: input.callOutFee,
      estimatedArrivalAt: input.estimatedArrivalAt,
      note: input.note,
    })
  } catch {
    // Status-guarded: only flips a lead that is still VIEWED. If recordInterest
    // partially succeeded before throwing (e.g. it already flipped the lead to
    // INTERESTED) this WHERE matches zero rows and the flip is a no-op instead
    // of clobbering an INTERESTED lead back to EXPIRED. Also wrapped in its own
    // .catch: a failure here (e.g. DB unavailable) must not throw and mask the
    // real INTEREST_RECORD_FAILED result with an unhandled rejection.
    await deps.db.lead
      .updateMany({
        where: { id: outcome.leadId, status: 'VIEWED' },
        data: { status: 'EXPIRED', expiredAt: deps.now() },
      })
      .catch(() => undefined)
    return { ok: false, reason: 'INTEREST_RECORD_FAILED' }
  }
  await deps.triggerShortlist(input.jobRequestId)
  return outcome
}

// ─── Production wiring ─────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { findBoardJobsForProvider } from '@/lib/board/eligibility'
import { respondToProviderOpportunity } from '@/lib/provider-opportunity-responses'
import { generateCustomerShortlistForRequest } from '@/lib/customer-shortlists'
import {
  validateProviderOnboardingRates,
  ProviderOnboardingValidationError,
} from '@/lib/provider-onboarding-data'

/**
 * Checks whether a specific job request is currently in the board result set
 * for this provider (active + verified + in-area + skill match), reusing
 * Task 2's findBoardJobsForProvider rather than duplicating its area/skill
 * logic. Cost is acceptable: board listings are small (take: 100) and this
 * runs once per express-interest call, not per render.
 */
async function isProviderBoardEligibleProduction(providerId: string, jobRequestId: string): Promise<boolean> {
  const jobs = await findBoardJobsForProvider(db, providerId, {}, new Date())
  return jobs.some((job) => job.id === jobRequestId)
}

/**
 * Pre-validates fee/arrival BEFORE any DB write, reusing the SAME exported
 * validator respondToProviderOpportunity uses internally
 * (validateProviderOnboardingRates), so the rules never drift between the two
 * call sites. Without this, an invalid callOutFee/estimatedArrivalAt would
 * only be caught after the Lead row was already created/revived inside the
 * transaction, and the post-transaction recordInterest failure would then
 * require the compensating EXPIRED flip for a case that was avoidable up
 * front.
 */
function validateInputProduction(input: BoardInterestInput): boolean {
  try {
    const rates = validateProviderOnboardingRates({ callOutFeeText: String(input.callOutFee) })
    if (rates.callOutFee == null) return false
  } catch (error) {
    if (error instanceof ProviderOnboardingValidationError) return false
    throw error
  }
  if (!(input.estimatedArrivalAt instanceof Date) || Number.isNaN(input.estimatedArrivalAt.getTime())) {
    return false
  }
  return true
}

/**
 * Wraps respondToProviderOpportunity to record the free "interested" response
 * (rate + arrival) against the newly created/revived board lead. This is the
 * same path push-origin leads use once a provider taps "I'm interested" —
 * board leads are created directly in VIEWED status, which
 * respondToProviderOpportunity already accepts (status SENT or VIEWED), so no
 * guard change was required in provider-opportunity-responses.ts.
 */
async function recordInterestProduction(args: {
  leadId: string
  providerId: string
  callOutFee: number
  estimatedArrivalAt: Date
  note?: string
}): Promise<{ ok: boolean }> {
  await respondToProviderOpportunity({
    leadId: args.leadId,
    providerId: args.providerId,
    response: 'INTERESTED',
    callOutFeeText: String(args.callOutFee),
    estimatedArrivalAt: args.estimatedArrivalAt,
    providerNote: args.note ?? null,
    source: 'board',
  })
  return { ok: true }
}

/**
 * respondToProviderOpportunity already triggers shortlist generation via its
 * internal maybeAutoTriggerShortlist (gated by qualified_shortlist.auto_trigger,
 * which also calls notifyCustomerShortlistReady internally once published).
 * This wrapper is an additive safety net for the case where auto-trigger is
 * off or the interest threshold was already met by a different path.
 *
 * IMPORTANT: generateCustomerShortlistForRequest has NO status guard and
 * always publishes + re-notifies when called — it does not self-guard on
 * OPEN/MATCHING/SHORTLIST_READY. THIS wrapper's status pre-check below is the
 * only thing preventing shortlist regeneration/notify on a job that has
 * already left the board (PROVIDER_CONFIRMATION_PENDING via customer
 * selection, MATCHED, EXPIRED, etc).
 *
 * True cap-3 (I1): the job stays board-visible through SHORTLIST_READY until
 * 3 open interests or customer selection, so SHORTLIST_READY is now an
 * ALLOWED status here, not a blocked one. Each new interest on a
 * SHORTLIST_READY job calling generateCustomerShortlistForRequest again is
 * the intended regeneration path — it supersedes the prior PUBLISHED
 * shortlist (see generateCustomerShortlistForRequest's
 * `providerShortlist.updateMany({ status: 'PUBLISHED' } → 'SUPERSEDED')`)
 * and re-notifies the customer. THAT re-notify IS the per-interest notify the
 * spec demands — it is not a duplicate-notify bug to guard against.
 * (maybeAutoTriggerShortlist, the other caller, carries its own equivalent
 * OPEN/MATCHING/SHORTLIST_READY guard independently — the two guards are not
 * the same code, they just happen to enforce the same invariant.)
 */
export async function triggerShortlistProduction(jobRequestId: string): Promise<void> {
  const request = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { id: true, status: true },
  })
  if (!request) return
  if (request.status !== 'OPEN' && request.status !== 'MATCHING' && request.status !== 'SHORTLIST_READY') return

  await generateCustomerShortlistForRequest(jobRequestId).catch((error) => {
    console.warn('[board/interest] triggerShortlist failed', {
      jobRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function expressBoardInterestProduction(
  input: BoardInterestInput,
): Promise<BoardInterestResult> {
  return expressBoardInterest(
    {
      now: () => new Date(),
      db,
      flagEnabled: (key) => isEnabled(key as Parameters<typeof isEnabled>[0]),
      isProviderBoardEligible: isProviderBoardEligibleProduction,
      validateInput: validateInputProduction,
      recordInterest: recordInterestProduction,
      triggerShortlist: triggerShortlistProduction,
    },
    input,
  )
}
