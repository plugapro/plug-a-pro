// In-flight identity-verification re-nudge selection and send orchestration.
//
// Targets providers who started identity verification but stalled in a
// mid-flow status (CONSENTED, AWAITING_IDENTIFIER, AWAITING_DOCUMENT,
// AWAITING_SELFIE, RETRY_REQUIRED) ~24h ago. Different copy per status,
// each landing back at a signed /provider/verify/{token} URL.
//
// Politeness invariants mirror kyc-drive (lib/kyc-drive/nudge.ts):
//   - 24h MessageEvent dedup window per phone across ALL in-flight resume
//     templates AND provider_kyc_nudge — never two verification messages to
//     one phone within a day, regardless of which cron sent the first.
//   - Lifetime cap of IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION sends per
//     verification row, counted from metadata.verificationId on resume events.
//   - Attempt-first: the cadence MessageEvent is written BEFORE the send so
//     a crash or post-send write failure can never drift past the cap; a
//     confirmed send failure flips the event to FAILED so it stops counting.
//   - Batch-capped per cron run, one send per phone per run.
//
// Distinct from kyc-drive — kyc-drive targets the legacy pre-cutoff cohort
// who never STARTED verification (kycStatus != VERIFIED on the Provider row);
// this targets the engaged-but-stalled cohort mid-loop on a specific
// ProviderIdentityVerification row.
//
// Templates (Meta-approved IDs assigned 2026-06-22, status PENDING at write
// time): provider_verification_resume_consent, *_document, *_selfie.

import type { IdentityBasis, VerificationStatus } from '@prisma/client'

import { documentFriendlyName } from './document-friendly-names'
import {
  countsTowardCadence,
  IN_FLIGHT_TEMPLATE_NAMES,
  KYC_DRIVE_TEMPLATE,
  resolveBatchCap as resolveBatchCapShared,
  type InFlightTemplateName,
} from './nudge-shared'

export { IN_FLIGHT_TEMPLATE_NAMES, type InFlightTemplateName }

export const IN_FLIGHT_NUDGE_WINDOW_START_HOURS = 20
export const IN_FLIGHT_NUDGE_WINDOW_END_HOURS = 28
export const IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION = 2
// Per-PHONE lifetime cap across ALL verification rows: a provider who serially
// stalls new verification attempts must not be renudged forever — each row
// gets at most 2, the phone gets at most 6, ever.
export const IN_FLIGHT_NUDGE_MAX_PER_PHONE = 6
export const IN_FLIGHT_DEDUP_HOURS = 24

export const DEFAULT_IN_FLIGHT_BATCH_CAP = 100

export function resolveBatchCap(raw: string | undefined): number {
  return resolveBatchCapShared(raw, DEFAULT_IN_FLIGHT_BATCH_CAP)
}

const IN_FLIGHT_STATUSES: VerificationStatus[] = [
  'CONSENTED',
  'AWAITING_IDENTIFIER',
  'RETRY_REQUIRED',
  'AWAITING_DOCUMENT',
  'AWAITING_SELFIE',
]

// Map verification status → resume template. AWAITING_DOCUMENT + AWAITING_SELFIE
// each get dedicated step copy. Other in-flight statuses funnel through the
// generic "your verification is paused" consent-resume copy.
export function templateForStatus(status: VerificationStatus): InFlightTemplateName | null {
  switch (status) {
    case 'CONSENTED':
    case 'AWAITING_IDENTIFIER':
    case 'RETRY_REQUIRED':
      return 'provider_verification_resume_consent'
    case 'AWAITING_DOCUMENT':
      return 'provider_verification_resume_document'
    case 'AWAITING_SELFIE':
      return 'provider_verification_resume_selfie'
    default:
      return null
  }
}

export type InFlightRenudgeCandidate = {
  verificationId: string
  // Fix D: providerId is null for draft-anchored (PWA gate-ON) verifications.
  // Callers must use draftId / draftPhone for link issuance in that case.
  providerId: string | null
  draftId: string | null
  draftPhone: string | null
  status: VerificationStatus
  identityBasis: IdentityBasis | null
  firstName: string
  phone: string
  updatedAt: Date
  templateName: InFlightTemplateName
  priorSendsForVerification: number
  lastSentAt: Date | null
  eligibleNow: boolean
}

type VerificationRow = {
  id: string
  providerId: string | null
  // Fix D: draft-anchored verifications (gate-ON PWA path) have no providerId
  providerApplicationDraftId: string | null
  status: VerificationStatus
  identityBasis: IdentityBasis | null
  updatedAt: Date
  expiresAt: Date | null
  provider: {
    id: string
    firstName: string | null
    name: string | null
    phone: string | null
    active: boolean
  } | null
  providerApplicationDraft: {
    id: string
    phone: string | null
    name: string | null
  } | null
}

export type InFlightRenudgeClient = {
  providerIdentityVerification: {
    findMany(args: unknown): Promise<unknown>
  }
  messageEvent: {
    findMany(args: unknown): Promise<unknown>
  }
}

function firstNameFrom(firstName: string | null, name: string | null): string {
  const candidate = firstName?.trim() || name?.trim().split(/\s+/)[0] || ''
  return candidate || 'there'
}

export async function listInFlightRenudgeCandidates(
  client: InFlightRenudgeClient,
  opts: { now?: Date; windowStartHours?: number; windowEndHours?: number } = {},
): Promise<InFlightRenudgeCandidate[]> {
  const now = opts.now ?? new Date()
  const windowStart = opts.windowStartHours ?? IN_FLIGHT_NUDGE_WINDOW_START_HOURS
  const windowEnd = opts.windowEndHours ?? IN_FLIGHT_NUDGE_WINDOW_END_HOURS
  const HOUR_MS = 60 * 60 * 1000
  const updatedAtFrom = new Date(now.getTime() - windowEnd * HOUR_MS)
  const updatedAtTo = new Date(now.getTime() - windowStart * HOUR_MS)

  // Fix D: include draft-anchored (PWA gate-ON) verifications that have no
  // Provider row yet. These applicants also need re-nudging if they stall mid-flow.
  // The OR allows rows where either providerId OR providerApplicationDraftId is set.
  const rows = (await client.providerIdentityVerification.findMany({
    where: {
      status: { in: IN_FLIGHT_STATUSES },
      updatedAt: { gte: updatedAtFrom, lte: updatedAtTo },
      OR: [
        {
          providerId: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          provider: { active: true },
        },
        {
          providerApplicationDraftId: { not: null },
          providerId: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      ],
    },
    include: {
      provider: { select: { id: true, firstName: true, name: true, phone: true, active: true } },
      providerApplicationDraft: { select: { id: true, phone: true, name: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })) as VerificationRow[]

  if (rows.length === 0) return []

  // One batched MessageEvent query: every in-flight resume event (plus
  // kyc-drive nudges, for the cross-cron 24h politeness window) for the
  // candidate phone set. We compute dedup (24h per phone) and the lifetime cap
  // (per verification) from the same result so the cron only round-trips
  // Postgres twice. Bounded to 90 days: verification rows expire well before,
  // so older events can never belong to a live candidate.
  // Deliberately UNBOUNDED in time and status:
  //   - lifetime caps must see all history (expiresAt:null rows can re-enter
  //     the window months later, past any scan cutoff), and
  //   - FAILED attempts must still enforce the 24h retry floor — excluding
  //     them at the query freed budget for an hourly re-send storm.
  // Fix D: phone comes from provider for provider-anchored rows, from draft for draft-anchored rows
  const phones = rows
    .map(r => (r.provider?.phone ?? r.providerApplicationDraft?.phone)?.trim())
    .filter((p): p is string => Boolean(p))
  const dedupCutoff = new Date(now.getTime() - IN_FLIGHT_DEDUP_HOURS * HOUR_MS)

  const events = (await client.messageEvent.findMany({
    where: {
      templateName: { in: [...IN_FLIGHT_TEMPLATE_NAMES, KYC_DRIVE_TEMPLATE] },
      direction: 'OUTBOUND',
      to: { in: phones },
    },
    select: { to: true, createdAt: true, templateName: true, metadata: true, status: true },
  })) as Array<{ to: string; createdAt: Date; templateName: string; metadata?: unknown; status?: string | null }>

  const resumeTemplates = new Set<string>(IN_FLIGHT_TEMPLATE_NAMES)
  const recentByPhone = new Map<string, number>()
  const sendsByVerification = new Map<string, number>()
  const sendsByPhone = new Map<string, number>()
  const lastSentByPhoneTemplate = new Map<string, Date>()
  for (const e of events) {
    // 24h retry floor is per phone across resume templates AND kyc-drive
    // nudges and counts EVERY attempt including FAILED — never two
    // verification messages (or retries) to one phone within a day.
    if (e.createdAt >= dedupCutoff) {
      recentByPhone.set(e.to, (recentByPhone.get(e.to) ?? 0) + 1)
    }
    // Lifetime caps count resume templates only (kyc-drive has its own
    // budget) and only attempts that plausibly reached the recipient — a
    // provider who received nothing keeps their budget.
    if (!resumeTemplates.has(e.templateName)) continue
    if (!countsTowardCadence(e.status)) continue
    sendsByPhone.set(e.to, (sendsByPhone.get(e.to) ?? 0) + 1)
    const verificationId =
      e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
        ? (e.metadata as Record<string, unknown>).verificationId
        : undefined
    if (typeof verificationId === 'string') {
      sendsByVerification.set(verificationId, (sendsByVerification.get(verificationId) ?? 0) + 1)
    }
    const key = `${e.to}\u0000${e.templateName}`
    const prev = lastSentByPhoneTemplate.get(key)
    if (!prev || e.createdAt > prev) lastSentByPhoneTemplate.set(key, e.createdAt)
  }

  const candidates: InFlightRenudgeCandidate[] = []
  for (const row of rows) {
    // Fix D: resolve phone and name from provider (provider-anchored) or draft (draft-anchored).
    // A row with neither providerId nor providerApplicationDraftId is invalid — skip.
    const isDraftAnchored = !row.providerId && Boolean(row.providerApplicationDraftId)
    if (!row.providerId && !isDraftAnchored) continue
    // trim(): a whitespace-only phone must not become a zero-history candidate.
    const phone = isDraftAnchored
      ? row.providerApplicationDraft?.phone?.trim()
      : row.provider?.phone?.trim()
    if (!phone) continue
    if (!isDraftAnchored && !row.provider) continue
    const templateName = templateForStatus(row.status)
    if (!templateName) continue
    const priorSendsForVerification = sendsByVerification.get(row.id) ?? 0
    const recentCount = recentByPhone.get(phone) ?? 0
    const totalSendsForPhone = sendsByPhone.get(phone) ?? 0
    const eligibleNow =
      recentCount === 0 &&
      priorSendsForVerification < IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION &&
      totalSendsForPhone < IN_FLIGHT_NUDGE_MAX_PER_PHONE
    const firstName = isDraftAnchored
      ? firstNameFrom(null, row.providerApplicationDraft?.name ?? null)
      : firstNameFrom(row.provider!.firstName, row.provider!.name)
    candidates.push({
      verificationId: row.id,
      providerId: row.providerId,
      draftId: row.providerApplicationDraftId,
      draftPhone: isDraftAnchored ? (row.providerApplicationDraft?.phone ?? null) : null,
      status: row.status,
      identityBasis: row.identityBasis,
      firstName,
      phone,
      updatedAt: row.updatedAt,
      templateName,
      priorSendsForVerification,
      lastSentAt: lastSentByPhoneTemplate.get(`${phone}\u0000${templateName}`) ?? null,
      eligibleNow,
    })
  }
  return candidates
}

export function summarizeInFlightRenudgeRows(rows: InFlightRenudgeCandidate[]) {
  return {
    candidates: rows.length,
    eligibleNow: rows.filter(r => r.eligibleNow).length,
    exhausted: rows.filter(r => r.priorSendsForVerification >= IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION).length,
  }
}

export type SendInFlightRenudgesDeps = {
  // Fix D: accept providerId (provider-anchored) OR draftId (draft-anchored) — callers must
  // implement both branches; for draft-anchored verifications providerId will be null.
  issueLink(input: { providerId: string | null; draftId: string | null; verificationId: string }): Promise<{ verificationUrl: string | null }>
  // Writes the cadence MessageEvent BEFORE send so the spacing + cap can never
  // drift past a crash or post-send write failure. Mirrors kyc-drive politeness.
  // Returns the event id so a failed send can flip the event to FAILED.
  recordAttempt(params: {
    to: string
    templateName: InFlightTemplateName
    metadata: Record<string, unknown>
  }): Promise<{ id: string } | null>
  markAttemptFailed(params: { eventId: string; failureReason: string }): Promise<unknown>
  sendConsentResume(params: {
    providerPhone: string
    providerFirstName: string
    verificationUrl: string
    metadata?: Record<string, unknown>
  }): Promise<string>
  sendDocumentResume(params: {
    providerPhone: string
    providerFirstName: string
    documentFriendlyName: string
    verificationUrl: string
    metadata?: Record<string, unknown>
  }): Promise<string>
  sendSelfieResume(params: {
    providerPhone: string
    providerFirstName: string
    verificationUrl: string
    metadata?: Record<string, unknown>
  }): Promise<string>
}

export async function sendInFlightRenudges(
  client: InFlightRenudgeClient,
  opts: {
    batchCap: number
    deps: SendInFlightRenudgesDeps
    now?: Date
    windowStartHours?: number
    windowEndHours?: number
  },
): Promise<{ rows: InFlightRenudgeCandidate[]; sent: number; skipped: number; errors: number; aborted: boolean }> {
  const rows = await listInFlightRenudgeCandidates(client, {
    now: opts.now,
    windowStartHours: opts.windowStartHours,
    windowEndHours: opts.windowEndHours,
  })
  const eligible = rows.filter(r => r.eligibleNow)
  const batch = eligible.slice(0, Math.max(0, opts.batchCap))

  let sent = 0
  let errors = 0
  let skipped = eligible.length - batch.length
  let aborted = false
  // In-run same-phone guard: two stalled verification rows can share a phone;
  // the DB dedup window only sees events from BEFORE this run started.
  const sentPhones = new Set<string>()
  let processed = 0
  for (const candidate of batch) {
    processed += 1
    if (sentPhones.has(candidate.phone)) {
      skipped += 1
      continue
    }
    let attemptEventId: string | null = null
    try {
      const { verificationUrl } = await opts.deps.issueLink({
        providerId: candidate.providerId,
        draftId: candidate.draftId,
        verificationId: candidate.verificationId,
      })
      if (!verificationUrl) {
        errors += 1
        console.error('[identity-verification-in-flight-renudge] no verification URL issued', {
          providerId: candidate.providerId,
          draftId: candidate.draftId,
          verificationId: candidate.verificationId,
        })
        continue
      }
      const metadata: Record<string, unknown> = {
        identityInFlightRenudge: true,
        verificationId: candidate.verificationId,
        providerId: candidate.providerId,
        draftId: candidate.draftId,
        status: candidate.status,
      }
      // Attempt-first: consume the cadence slot before any message can leave.
      const attempt = await opts.deps.recordAttempt({
        to: candidate.phone,
        templateName: candidate.templateName,
        metadata,
      })
      attemptEventId = attempt?.id ?? null
      // Slot consumed — this phone is done for the run even if the send fails.
      sentPhones.add(candidate.phone)
      if (candidate.templateName === 'provider_verification_resume_consent') {
        await opts.deps.sendConsentResume({
          providerPhone: candidate.phone,
          providerFirstName: candidate.firstName,
          verificationUrl,
          metadata,
        })
      } else if (candidate.templateName === 'provider_verification_resume_selfie') {
        await opts.deps.sendSelfieResume({
          providerPhone: candidate.phone,
          providerFirstName: candidate.firstName,
          verificationUrl,
          metadata,
        })
      } else {
        const friendlyName = candidate.identityBasis
          ? documentFriendlyName(candidate.identityBasis)
          : 'document'
        await opts.deps.sendDocumentResume({
          providerPhone: candidate.phone,
          providerFirstName: candidate.firstName,
          documentFriendlyName: friendlyName,
          verificationUrl,
          metadata,
        })
      }
      sent += 1
    } catch (error) {
      errors += 1
      const failureReason = error instanceof Error ? error.message : String(error)
      console.error('[identity-verification-in-flight-renudge] send failed', {
        providerId: candidate.providerId,
        verificationId: candidate.verificationId,
        error: failureReason,
      })
      if (attemptEventId) {
        try {
          await opts.deps.markAttemptFailed({ eventId: attemptEventId, failureReason })
        } catch (markError) {
          // Event stays SENT and keeps consuming cap budget — polite bias:
          // better to under-send than double-send.
          console.error('[identity-verification-in-flight-renudge] mark-failed write failed', {
            eventId: attemptEventId,
            verificationId: candidate.verificationId,
            error: markError instanceof Error ? markError.message : String(markError),
          })
        }
      }
      // Systemic failure: every remaining send would fail identically, each
      // burning a cadence slot. Stop the run instead.
      if (failureReason.includes('TEMPLATE_NOT_APPROVED') || failureReason.includes('132001')) {
        aborted = true
        console.error('[identity-verification-in-flight-renudge] template rejected by Meta — aborting run', {
          templateName: candidate.templateName,
          error: failureReason,
        })
        break
      }
    }
  }

  // On abort the unprocessed remainder must stay accounted for:
  // sent + skipped + errors always covers the whole eligible set.
  if (aborted) skipped += batch.length - processed

  return { rows, sent, skipped, errors, aborted }
}
