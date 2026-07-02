import type { Prisma, ProviderApplication } from '@prisma/client'
import { db } from './db'
import { ACTIVE_PROVIDER_APPLICATION_STATUSES } from './provider-applications'
import { emitServerConversion } from './marketing/server-events'
import { recordWorkflowEvent } from './workflow-events'
import type { CtwaReferralAttribution } from './whatsapp-referral'

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
  /** Formatted label, e.g. "Mon, Tue" or "Any day". The caller must format before passing. */
  availability: string | string[]
  experience?: string | null
  evidenceNote?: string | null
  evidenceFileUrls?: string[]

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
}

export interface SubmitResult {
  application: ProviderApplication
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
  const doInTx = async (tx: Tx): Promise<ProviderApplication> => {
    // Guard: reject if a live (non-terminal) application already exists.
    const conflict = await tx.providerApplication.findFirst({
      where: {
        phone: input.phone,
        status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      },
      select: { id: true, status: true },
    })
    if (conflict) {
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
        status: 'PENDING',
        submittedAt: new Date(),
        // CTWA ad attribution (null-safe: most applications have none)
        ctwaSourceType: input.ctwaReferral?.sourceType ?? null,
        ctwaSourceId: input.ctwaReferral?.sourceId ?? null,
        ctwaClid: input.ctwaReferral?.ctwaClid ?? null,
        ctwaHeadline: input.ctwaReferral?.headline ?? null,
        ctwaCapturedAt: input.ctwaReferral?.capturedAt ? new Date(input.ctwaReferral.capturedAt) : null,
      },
    })

    // Advance the conversation to reg_pending.
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

    return application
  }

  // If the caller already holds a transaction (Prisma.TransactionClient),
  // $transaction is NOT present on it. Run directly. Otherwise open a new tx.
  const application =
    '$transaction' in client
      ? await (client as typeof db).$transaction((tx) => doInTx(tx))
      : await doInTx(client)

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
