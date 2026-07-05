import type { Prisma, ProviderApplication } from '@prisma/client'
import { db } from './db'
import { ACTIVE_PROVIDER_APPLICATION_STATUSES } from './provider-applications'
import { emitServerConversion } from './marketing/server-events'
import { recordWorkflowEvent } from './workflow-events'
import type { CtwaReferralAttribution } from './whatsapp-referral'
import { isQualityGateV2Enabled, evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ProviderApplicationConflictError extends Error {
  readonly code = 'APPLICATION_CONFLICT'
  constructor(public readonly existingStatus: string) {
    super(`Phone already has an active application (status: ${existingStatus}).`)
    this.name = 'ProviderApplicationConflictError'
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Fields collected from the applicant before submission. Mirrors the data
 * written by both WhatsApp registration call sites (registration.ts:2420)
 * and the web finish page. Optional fields default to null.
 *
 * Extended beyond the spec's 10-column baseline to cover every column written
 * by the existing WhatsApp PENDING create call site at registration.ts:2420:
 *   - email, callOutFee, hourlyRate, rateNegotiable, weekendJobs, sameDayJobs
 *   - alternateMobileE164, preferredLanguage
 *   - reference1Name/Mobile, reference2Name/Mobile
 *   - isTestUser, cohortName, providerId
 */
export interface SubmitInput {
  phone: string
  name: string
  idNumber?: string | null
  skills: string[]
  serviceAreas: string[]
  /**
   * Formatted label, e.g. "Mon, Tue" or "Any day". The caller must format before
   * passing. Accepts null (stored as null) for completion replays where the draft
   * carried no availability.
   */
  availability: string | string[] | null
  experience?: string | null
  evidenceNote?: string | null
  evidenceFileUrls?: string[]
  /** cert doc URL or registration number; high-risk gate (quality gate v2) */
  certificationRef?: string | null

  // Optional fields present in the WhatsApp flow create call
  email?: string | null
  callOutFee?: number | null
  hourlyRate?: number | null
  rateNegotiable?: boolean
  weekendJobs?: boolean
  sameDayJobs?: boolean
  alternateMobileE164?: string | null
  preferredLanguage?: string | null
  reference1Name?: string | null
  reference1Mobile?: string | null
  reference2Name?: string | null
  reference2Mobile?: string | null
  isTestUser?: boolean
  cohortName?: string | null
  providerId?: string | null
  /**
   * CTWA ad attribution captured on the conversation's first inbound message
   * (Conversation.data.ctwaReferral, see lib/whatsapp-referral.ts). Persisted
   * on the application so registrations can be reported per ad, and used as
   * the CAPI join key for the server-side Lead event.
   */
  ctwaReferral?: CtwaReferralAttribution | null
}

export interface SubmitOptions {
  source: 'whatsapp' | 'web'
  /**
   * When provided, update that specific Conversation to step `reg_pending`.
   * When omitted, updateMany is called for (phone, flow=registration) to
   * advance any active registration conversation for this phone.
   */
  conversationId?: string
  /**
   * Status the created row is written with. Defaults to `'PENDING'` (today's
   * behavior). When `'MORE_INFO_REQUIRED'`, the quality-gate v2 check is
   * skipped (an under-bar MORE_INFO application is the intended ops-review
   * outcome, not an error) and the row is created with that status.
   *
   * This is the completion-safe extension used by the KYC create-on-PASS
   * completion flow (lib/provider-onboarding/quality-gate-submission.ts).
   */
  statusOverride?: 'PENDING' | 'MORE_INFO_REQUIRED'
  /**
   * How to react when an active (non-terminal) application already exists for
   * the phone. Defaults to `'throw'` (today's ProviderApplicationConflictError).
   * With `'link'`, the existing row is selected and returned as
   * `{ application: existing, conflicted: true }` — no new row is created and no
   * error is thrown. Used by the completion flow so a KYC-window race links the
   * draft to the existing application instead of failing the webhook forever.
   */
  onConflict?: 'throw' | 'link'
  /**
   * Optional ops notes written atomically in the `create` data. Used by the
   * completion flow for the `[quality-gate]` note so the note lands in a single
   * write rather than a follow-up update. Defaults to undefined (no note).
   */
  initialNotes?: string | null
}

export interface SubmitResult {
  application: ProviderApplication
  /**
   * True when `onConflict: 'link'` was set and an active application already
   * existed — `application` is that existing row and no new row was created.
   * Undefined/false on the normal create path.
   */
  conflicted?: boolean
}

type Tx = Prisma.TransactionClient | typeof db

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Create a ProviderApplication with status PENDING and advance the linked
 * Conversation to step `reg_pending`. Idempotency-safe: throws if a
 * non-CANCELLED / non-REJECTED application already exists for this phone.
 *
 * Accepts an outer transaction client (Prisma.TransactionClient) so it can be
 * called from inside `crudAction`'s tx callback without nesting. When called
 * with the top-level `db` client it opens its own transaction.
 */
export async function submitProviderApplication(
  client: Tx,
  input: SubmitInput,
  options: SubmitOptions,
): Promise<SubmitResult> {
  const status = options.statusOverride ?? 'PENDING'
  const onConflict = options.onConflict ?? 'throw'

  type TxResult = { application: ProviderApplication; conflicted: boolean }

  const doInTx = async (tx: Tx): Promise<TxResult> => {
    // Quality gate v2: enforce minimum evidence + high-risk certification bar
    // when the flag is ON. Checked before the conflict guard so a bad submission
    // is never persisted even temporarily.
    //
    // Skipped entirely when the caller sets statusOverride: 'MORE_INFO_REQUIRED'.
    // An under-bar MORE_INFO application is the intended ops-review outcome (the
    // KYC completion flow deliberately creates one for below-bar applicants);
    // throwing the gate error there would strand the applicant.
    if (status === 'PENDING' && (await isQualityGateV2Enabled())) {
      const evidence = evaluateEvidenceGate(input.evidenceFileUrls ?? [])
      if (!evidence.ok) throw new Error('QUALITY_GATE_EVIDENCE')
      // A high-risk applicant must carry a certification. At submit the certification
      // is represented by a non-empty certificationRef on SubmitInput (see Task 1.6);
      // treat any provided cert doc URL or registration number as satisfying.
      const cert = evaluateCertificationGate(input.skills ?? [], Boolean(input.certificationRef))
      if (!cert.ok) throw new Error('QUALITY_GATE_CERTIFICATION')
    }

    // Guard: an active (non-terminal) application already exists for this phone.
    // Default onConflict='throw' preserves today's ProviderApplicationConflictError.
    // onConflict='link' (completion flow) selects the existing row and returns it
    // without creating a duplicate — used so a KYC-window race links the draft to
    // the existing application instead of failing the completion webhook forever.
    const conflict = await tx.providerApplication.findFirst({
      where: {
        phone: input.phone,
        status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      },
      select: { id: true, status: true },
    })
    if (conflict) {
      if (onConflict === 'link') {
        const existing = await tx.providerApplication.findUniqueOrThrow({
          where: { id: conflict.id },
        })
        return { application: existing, conflicted: true }
      }
      throw new ProviderApplicationConflictError(conflict.status)
    }

    // Normalise availability: the WhatsApp flow passes a pre-formatted string,
    // the web flow may pass a string[] which we join here.
    const availabilityStr = Array.isArray(input.availability)
      ? input.availability.join(', ')
      : input.availability ?? null

    const application = await tx.providerApplication.create({
      data: {
        phone: input.phone,
        name: input.name,
        email: input.email ?? null,
        idNumber: input.idNumber ?? null,
        skills: input.skills,
        serviceAreas: input.serviceAreas,
        experience: input.experience ?? null,
        availability: availabilityStr,
        callOutFee: input.callOutFee ?? null,
        hourlyRate: input.hourlyRate ?? null,
        ...(input.rateNegotiable !== undefined && { rateNegotiable: input.rateNegotiable }),
        ...(input.weekendJobs !== undefined && { weekendJobs: input.weekendJobs }),
        ...(input.sameDayJobs !== undefined && { sameDayJobs: input.sameDayJobs }),
        evidenceNote: input.evidenceNote ?? null,
        evidenceFileUrls: input.evidenceFileUrls ?? [],
        alternateMobileE164: input.alternateMobileE164 ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        reference1Name: input.reference1Name ?? null,
        reference1Mobile: input.reference1Mobile ?? null,
        reference2Name: input.reference2Name ?? null,
        reference2Mobile: input.reference2Mobile ?? null,
        isTestUser: input.isTestUser ?? false,
        cohortName: input.cohortName ?? null,
        providerId: input.providerId ?? null,
        status,
        // initialNotes: written atomically in the create (completion flow's
        // [quality-gate] note). Omitted entirely when not provided so the
        // default create is byte-identical to today's.
        ...(options.initialNotes != null ? { notes: options.initialNotes } : {}),
        submittedAt: new Date(),
        // CTWA ad attribution (null-safe: most applications have none)
        ctwaSourceType: input.ctwaReferral?.sourceType ?? null,
        ctwaSourceId: input.ctwaReferral?.sourceId ?? null,
        ctwaClid: input.ctwaReferral?.ctwaClid ?? null,
        ctwaHeadline: input.ctwaReferral?.headline ?? null,
        ctwaCapturedAt: input.ctwaReferral?.capturedAt ? new Date(input.ctwaReferral.capturedAt) : null,
      },
    })

    // Advance the conversation to reg_pending. Only the WhatsApp/web registration
    // flows have an active conversation to advance; the completion flow does not
    // pass a conversationId and has no live registration conversation, so the
    // updateMany matches nothing there (harmless).
    if (options.conversationId) {
      await tx.conversation.update({
        where: { id: options.conversationId },
        data: { step: 'reg_pending' },
      })
    } else {
      await tx.conversation.updateMany({
        where: { phone: input.phone, flow: 'registration' },
        data: { step: 'reg_pending' },
      })
    }

    return { application, conflicted: false }
  }

  // If the caller already holds a transaction (Prisma.TransactionClient),
  // $transaction is NOT present on it. Run directly. Otherwise open a new tx.
  const { application, conflicted } =
    '$transaction' in client
      ? await (client as typeof db).$transaction((tx) => doInTx(tx))
      : await doInTx(client)

  // Conflict-link path: no new row was created and no submission occurred, so
  // skip the funnel/CAPI telemetry (they must only fire on a real create).
  if (conflicted) {
    return { application, conflicted: true }
  }

  // Funnel telemetry — post-tx, best-effort, mirroring the Tier-1
  // REQUEST_SUBMITTED pattern in lib/job-requests/create-job-request.ts.
  // A telemetry outage must never fail (or roll back) a submit. Metadata
  // carries only ids/booleans — recordWorkflowEvent's PII guard rejects
  // applicant fields like name/phone.
  try {
    await recordWorkflowEvent({
      eventType: 'PROVIDER_APPLICATION_SUBMITTED',
      actorType: 'anonymous',
      entityType: 'PROVIDER_APPLICATION',
      entityId: application.id,
      source: options.source,
      metadata: {
        isTestUser: input.isTestUser ?? false,
        hasCtwaAttribution: Boolean(input.ctwaReferral),
        ...(input.ctwaReferral?.sourceId ? { ctwaSourceId: input.ctwaReferral.sourceId } : {}),
      },
    })
  } catch (err) {
    console.warn('[provider-applications-submit] workflow event emit failed', {
      applicationId: application.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Server-side Lead conversion (Meta CAPI + GA4). Fire-and-forget — a tracker
  // outage must never break a submit. Skipped for test users so seeded/e2e
  // applications don't pollute the ad account. Note: when called with an outer
  // tx this fires before the outer commit; the eventId dedupe makes the rare
  // rollback case harmless.
  if (!(input.isTestUser ?? false)) {
    void emitServerConversion({
      name: 'provider_application_submitted',
      entityId: application.id,
      ctwaClid: input.ctwaReferral?.ctwaClid ?? null,
      customParams: {
        source: options.source,
        ...(input.ctwaReferral?.sourceId ? { ctwa_source_id: input.ctwaReferral.sourceId } : {}),
      },
    })
  }

  return { application }
}
