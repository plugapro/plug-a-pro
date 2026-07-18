/**
 * quality-gate-submission.ts
 *
 * Called by the verification completion webhook (Task 2.6) after Didit returns
 * PASSED or FAILED for a draft-anchored ProviderIdentityVerification.
 *
 * PASSED  → replays the submit bundle from ProviderApplicationDraft.submitPayload
 *           and creates the ProviderApplication with status PENDING.
 * FAILED  → on 2nd+ failure, creates the application with MORE_INFO_REQUIRED and
 *           appends a [quality-gate] ops note. On 1st failure, re-issues the
 *           verification link so the applicant can retry.
 */

import type { Prisma, KycStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { syncProviderRecord, upsertStructuredServiceAreas } from '@/lib/provider-record'
import { syncProviderSkills } from '@/lib/provider-skills'
import { submitProviderApplication, type SubmitInput } from '@/lib/provider-applications-submit'
import {
  finalizeWhatsappProviderSubmission,
  categorySlugForSkill,
  yearsExperienceFromLabel,
  skillLevelFromExperienceLabel,
  type FinalizeWhatsappInput,
  type FinalizeWhatsappOpts,
} from '@/lib/provider-onboarding/finalize-whatsapp-submission'
import { sendButtons } from '@/lib/whatsapp-interactive'
import { issueProviderApplicationVerificationLink } from '@/lib/identity-verification/application-link'
import { evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'
import { createTestCohortContext } from '@/lib/internal-test-cohort'

// ─── Local helpers ────────────────────────────────────────────────────────────

/**
 * Appends a [quality-gate] marker line to the ops notes field.
 * Idempotent: existing marker lines are replaced rather than duplicated.
 */
function appendQualityGateNote(existing: string | null, message = 'KYC failed at application'): string {
  const marker = '[quality-gate]'
  const line = `${marker} ${message}`
  if (!existing) return line
  const preservedLines = existing.split('\n').filter((l) => !l.startsWith(`${marker} `))
  const cleaned = preservedLines.join('\n').trimEnd()
  return cleaned ? `${cleaned}\n${line}` : line
}

/**
 * Defense-in-depth evidence/certification re-evaluation at completion time.
 *
 * The gate was evaluated when the draft was created, but if an upstream path
 * skipped it (flag OFF at draft-create, ON at completion; or a concurrent
 * bypass), a PENDING application must not be created for an under-qualified
 * applicant. When under-bar, downgrade to MORE_INFO_REQUIRED with a note so ops
 * can review rather than silently dropping the applicant.
 *
 * Returns the completion opts to pass to submitProviderApplication / the
 * finalizer: statusOverride + initialNotes. On a pass, both are undefined (→
 * default PENDING create, no note).
 */
function evaluateCompletionGate(
  skills: string[],
  evidenceFileUrls: string[],
  certificationRef: string | null,
  context: string,
): { statusOverride?: 'MORE_INFO_REQUIRED'; initialNotes?: string } {
  const evidenceResult = evaluateEvidenceGate(evidenceFileUrls ?? [])
  const certResult = evaluateCertificationGate(skills ?? [], Boolean(certificationRef))
  if (evidenceResult.ok && certResult.ok) return {}
  console.warn(`[quality-gate-submission] ${context}: evidence/cert gate failed at completion — creating MORE_INFO_REQUIRED`, {
    evidenceHave: evidenceResult.have,
    evidenceNeed: evidenceResult.need,
    certRequired: certResult.required,
    certOk: certResult.ok,
  })
  return {
    statusOverride: 'MORE_INFO_REQUIRED',
    initialNotes: appendQualityGateNote(null, 'evidence/certification incomplete at KYC completion'),
  }
}

// ─── Shared mappers: WHATSAPP / PWA payload → canonical creator input ──────────

/** Availability may arrive as string or string[]; the DB stores a joined label. */
function joinAvailability(availability: string | string[] | null | undefined): string | null {
  return Array.isArray(availability) ? availability.join(', ') : availability ?? null
}

/**
 * Maps a stored WHATSAPP submit bundle to the shared finalizer input, injecting
 * the completion-time cohort/experience context. providerId is resolved by the
 * finalizer's syncProviderRecord and injected onto the submit input there.
 */
/** Maps a stored WHATSAPP submit bundle's application args to a canonical SubmitInput. */
function toWhatsappSubmitInput(
  a: Qgv2WhatsappSubmitPayload['submitApplicationArgs'],
  providerId: string,
  locationNodeIds: string[] = [],
): SubmitInput {
  return {
    phone: a.phone,
    name: a.name,
    idNumber: a.idNumber ?? null,
    skills: a.skills,
    serviceAreas: a.serviceAreas,
    locationNodeIds,
    availability: joinAvailability(a.availability),
    experience: a.experience ?? null,
    evidenceNote: a.evidenceNote ?? null,
    evidenceFileUrls: a.evidenceFileUrls ?? [],
    certificationRef: a.certificationRef ?? null,
    providerId,
    email: a.email ?? null,
    alternateMobileE164: a.alternateMobileE164 ?? null,
    preferredLanguage: a.preferredLanguage ?? null,
    reference1Name: a.reference1Name ?? null,
    reference1Mobile: a.reference1Mobile ?? null,
    reference2Name: a.reference2Name ?? null,
    reference2Mobile: a.reference2Mobile ?? null,
    callOutFee: a.callOutFee ?? null,
    hourlyRate: a.hourlyRate ?? null,
    rateNegotiable: a.rateNegotiable,
    weekendJobs: a.weekendJobs,
    sameDayJobs: a.sameDayJobs,
    isTestUser: a.isTestUser ?? false,
    cohortName: a.cohortName ?? null,
    ctwaReferral: (a.ctwaReferral ?? null) as SubmitInput['ctwaReferral'],
  }
}

function toWhatsappFinalizeInput(payload: Qgv2WhatsappSubmitPayload): FinalizeWhatsappInput {
  const submitInput = toWhatsappSubmitInput(payload.submitApplicationArgs, '', payload.replayInputs.locationNodeIds ?? [])
  return {
    syncProviderArgs: payload.syncProviderArgs,
    submitInput,
    canonicalSkills: payload.canonicalSkills,
    experienceLabel: payload.replayInputs.experience,
    certificationProofCount: payload.replayInputs.certificationProofAttachmentIds?.length ?? 0,
    rate:
      typeof payload.replayInputs.callOutFee === 'number'
        ? {
            callOutFee: payload.replayInputs.callOutFee,
            hourlyRate:
              typeof payload.replayInputs.hourlyRate === 'number' ? payload.replayInputs.hourlyRate : null,
            rateNegotiable: payload.replayInputs.rateNegotiable !== false,
          }
        : null,
  }
}

type TestCohort = { isTestUser: boolean; cohortName: string | null }

/**
 * Maps a stored PWA_RESUME submit bundle to a canonical SubmitInput.
 *
 * KNOWN GAP (Task 4, PJ-01): Qgv2PwaResumeSubmitPayload carries no
 * locationNodeIds field, so this path cannot populate it — submitInput omits
 * the key and submitProviderApplication defaults it to [] (same as today's
 * pre-Task-4 behavior; no regression). Backfilling PWA_RESUME's payload shape
 * with resolved location ids is a separate, follow-up change.
 */
function toPwaResumeSubmitInput(payload: Qgv2PwaResumeSubmitPayload, cohort: TestCohort): SubmitInput {
  return {
    phone: payload.phone,
    name: payload.name,
    idNumber: payload.idNumber ?? null,
    skills: payload.skills,
    serviceAreas: payload.serviceAreas,
    availability: joinAvailability(payload.availability),
    experience: payload.experience ?? null,
    evidenceNote: payload.evidenceNote ?? null,
    evidenceFileUrls: payload.evidenceFileUrls ?? [],
    certificationRef: payload.certificationRef ?? null,
    hourlyRate: payload.hourlyRate ?? null,
    isTestUser: cohort.isTestUser,
    cohortName: cohort.cohortName,
    ctwaReferral: (payload.ctwaReferral ?? null) as SubmitInput['ctwaReferral'],
  }
}

/** Maps a stored PWA_SELF_SERVE submit bundle to a canonical SubmitInput. */
function toPwaSelfServeSubmitInput(
  payload: Qgv2PwaSelfServeSubmitPayload,
  cohort: TestCohort,
  providerId: string,
): SubmitInput {
  return {
    phone: payload.phone,
    name: payload.name,
    email: payload.email ?? null,
    skills: payload.skills,
    serviceAreas: payload.serviceAreas,
    locationNodeIds: payload.locationNodeIds ?? [],
    availability: joinAvailability(payload.availability),
    experience: payload.experience ?? null,
    evidenceNote: payload.evidenceNote ?? null,
    evidenceFileUrls: payload.evidenceFileUrls ?? [],
    certificationRef: payload.certificationRef ?? null,
    callOutFee: payload.callOutFee ?? null,
    hourlyRate: payload.hourlyRate ?? null,
    reference1Name: payload.reference1Name ?? null,
    reference1Mobile: payload.reference1Mobile ?? null,
    reference2Name: payload.reference2Name ?? null,
    reference2Mobile: payload.reference2Mobile ?? null,
    isTestUser: cohort.isTestUser,
    cohortName: cohort.cohortName,
    providerId,
  }
}

/**
 * Draft-anchored kycStatus mapping, mirroring the orchestrator's
 * kycStatusForTransition (lib/identity-verification/orchestrator.ts). The
 * orchestrator only writes kycStatus when the verification already has a
 * providerId at transition time; for draft-anchored flows the Provider row does
 * not exist yet, so the mapping is (re)applied here once the provider is created
 * at completion.
 *
 *   PASSED (+ PASS)         → VERIFIED
 *   FAILED                  → REJECTED
 *   NEEDS_MANUAL_REVIEW     → (no mapping — kycStatus left untouched)
 *   EXPIRED                 → EXPIRED
 *
 * Returns null when no mapping exists (kycStatus must not be touched).
 */
function draftKycStatusFor(
  verdict: 'PASSED' | 'FAILED' | 'NEEDS_MANUAL_REVIEW' | 'EXPIRED' | 'CANCELLED',
): KycStatus | null {
  if (verdict === 'PASSED') return 'VERIFIED'
  if (verdict === 'FAILED') return 'REJECTED'
  if (verdict === 'EXPIRED') return 'EXPIRED'
  return null
}

/**
 * Links a newly created/obtained Provider to the verification and applies the
 * draft-anchored kycStatus mapping, inside the caller's transaction.
 *
 * - Always sets verification.providerId = providerId (alongside the
 *   providerApplicationId link written elsewhere).
 * - Sets provider.kycStatus when draftKycStatusFor(verdict) yields a mapping.
 */
async function linkProviderAndKyc(
  tx: Prisma.TransactionClient,
  args: {
    verificationId: string
    providerId: string
    verdict: 'PASSED' | 'FAILED' | 'NEEDS_MANUAL_REVIEW' | 'EXPIRED' | 'CANCELLED'
  },
): Promise<void> {
  await tx.providerIdentityVerification.update({
    where: { id: args.verificationId },
    data: { providerId: args.providerId },
  })
  const kycStatus = draftKycStatusFor(args.verdict)
  if (kycStatus) {
    await tx.provider.update({
      where: { id: args.providerId },
      data: { kycStatus },
    })
  }
}

/**
 * Shared MORE_INFO_REQUIRED creator for the FAILED×2 / manual-review paths.
 *
 * Creates the application row via the canonical submitProviderApplication with
 * statusOverride:'MORE_INFO_REQUIRED' + initialNotes (the [quality-gate] note,
 * written atomically) + onConflict:'link' (a KYC-window race links rather than
 * throwing), then links the draft and verification. No provider category or rate
 * rows are written on these paths — matching the original inline creators, which
 * only wrote the application row + note. Returns the application id (existing id
 * on a linked conflict).
 */
async function createMoreInfoApplicationAndLink(
  tx: Prisma.TransactionClient,
  args: {
    submitInput: SubmitInput
    note: string
    draftId: string
    verificationId: string
    /**
     * When present, the created/obtained provider is linked to the verification
     * (verification.providerId) and its kycStatus is set per the draft-anchored
     * mapping for `verdict`. Omit for paths that create no provider.
     */
    providerId?: string
    verdict?: 'FAILED' | 'NEEDS_MANUAL_REVIEW' | 'EXPIRED' | 'CANCELLED'
  },
): Promise<string> {
  const { application } = await submitProviderApplication(tx, args.submitInput, {
    source: 'web',
    statusOverride: 'MORE_INFO_REQUIRED',
    onConflict: 'link',
    initialNotes: args.note,
  })
  const applicationId = application.id

  await tx.providerApplicationDraft.update({
    where: { id: args.draftId },
    data: { submittedApplicationId: applicationId },
  })
  await tx.providerIdentityVerification.update({
    where: { id: args.verificationId },
    data: { providerApplicationId: applicationId },
  })
  // Fix 1: link the newly created provider to the verification + apply kycStatus
  // (verification.providerId is null at draft time, so the orchestrator never set it).
  if (args.providerId && args.verdict) {
    await linkProviderAndKyc(tx, {
      verificationId: args.verificationId,
      providerId: args.providerId,
      verdict: args.verdict,
    })
  }
  return applicationId
}

// ─── Type for the WHATSAPP channel submit bundle ──────────────────────────────

interface Qgv2WhatsappSubmitPayload {
  version: 1
  channel: 'WHATSAPP'
  submittedAt: string
  normalizedPhone: string
  isTestUser: boolean
  cohortName: string | null
  canonicalSkills: string[]
  categorySlugs: string[]
  syncProviderArgs: {
    phone: string
    name: string
    email: string | null
    skills: string[]
    serviceAreas: string[]
    active: boolean
    availableNow: boolean
    verified: boolean
    isTestUser: boolean
    cohortName: string | null
    locationNodeIds: string[]
  }
  submitApplicationArgs: {
    phone: string
    name: string
    idNumber: string | null
    skills: string[]
    serviceAreas: string[]
    availability: string | null
    experience: string | null
    evidenceNote: string | null
    evidenceFileUrls: string[]
    certificationRef: string | null
    providerId: string | null
    email: string | null
    alternateMobileE164: string | null
    preferredLanguage: string | null
    reference1Name: string | null
    reference1Mobile: string | null
    reference2Name: string | null
    reference2Mobile: string | null
    callOutFee: number | null
    hourlyRate: number | null
    rateNegotiable: boolean
    weekendJobs: boolean
    sameDayJobs: boolean
    isTestUser: boolean
    cohortName: string | null
    ctwaReferral: unknown | null
  }
  replayInputs: {
    experience: string | null
    callOutFee: number | null
    hourlyRate: number | null
    rateNegotiable: boolean
    certificationProofAttachmentIds: string[]
    // Fix 3: the uploaded certification document attachment id (set by
    // handleCollectCertification when a cert doc is uploaded). Linked to the
    // application in the WHATSAPP completion attachment-linking step.
    certificationDocAttachmentId: string | null
    evidenceAttachmentIds: string[]
    profilePhotoAttachmentId: string | null
    providerBio: string | null
    verificationDocAttachmentId: string | null
    verificationSelfieAttachmentId: string | null
    locationNodeIds: string[]
    selectedRegionStatus: string | null
  }
}

// ─── Type for the PWA_RESUME channel submit bundle ───────────────────────────

interface Qgv2PwaResumeSubmitPayload {
  version: 1
  channel: 'PWA_RESUME'
  submittedAt: string
  phone: string
  name: string
  idNumber: string | null
  skills: string[]
  serviceAreas: string[]
  availability: string
  experience: string | null
  evidenceNote: string | null
  evidenceFileUrls: string[]
  certificationRef: string | null
  ctwaReferral: unknown | null
  hourlyRate?: number | null
}

// ─── Type for the PWA_SELF_SERVE channel submit bundle ────────────────────────

interface Qgv2PwaSelfServeSubmitPayload {
  version: 1
  channel: 'PWA_SELF_SERVE'
  submittedAt: string
  name: string
  phone: string
  email: string | null
  skills: string[]
  categorySlugs: string[]
  serviceAreas: string[]
  locationNodeIds: string[]
  experience: string | null
  availability: string
  availabilityDays: string[]
  emergencyAvailable: boolean
  callOutFee: number | null
  hourlyRate?: number | null
  travelRadiusKm: number | null
  evidenceNote: string | null
  evidenceFileUrls: string[]
  certificationRef: string | null
  reference1Name: string | null
  reference1Mobile: string | null
  reference2Name: string | null
  reference2Mobile: string | null
  bio: string | null
  profilePhotoUrl: string | null
}

// ─── Internal: link attachments non-fatally ───────────────────────────────────

async function linkAttachmentToApplication(
  tx: any, // TODO: replace with Prisma.TransactionClient once the tx type is exported/threadable
  attachmentId: string | null | undefined,
  providerApplicationId: string,
  tag: string,
) {
  if (!attachmentId) return
  try {
    await tx.attachment.updateMany({
      where: { id: attachmentId, providerApplicationId: null },
      data: { providerApplicationId },
    })
  } catch (err) {
    console.warn('[quality-gate-submission] attachment link failed (non-fatal)', {
      tag,
      attachmentId,
      providerApplicationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Internal: PWA_RESUME channel — conflict-aware inline create on PASS ─────
//
// Fix A: previously called submitProviderApplication which throws
// ProviderApplicationConflictError when an active application exists for the
// phone. That throw (during the KYC completion webhook) had no processedAt
// set → the webhook treated it as retryable → the completion retried forever.
//
// Fix: do the conflict check ourselves inside the transaction. If an active
// application already exists, link the draft and verification to it and return
// the existing id — no throw, no duplicate.

async function completePwaResumeChannel(
  client: typeof db,
  payload: Qgv2PwaResumeSubmitPayload,
  draft: { id: string },
  verificationId: string,
): Promise<{ applicationId: string }> {
  let applicationId: string

  await client.$transaction(async (tx) => {
    // Resume-token decision: the draft's resume token was left unconsumed by Task 2.5
    // intentionally. We do NOT consume it here — the draft.submittedApplicationId link
    // + the idempotency guard already prevent a double-submit, making a stale token
    // harmless. Consuming it would require loading the ProviderResumeToken by some
    // key not present in this payload, so we skip it to avoid a partial-data lookup.

    // Delegate row creation to the canonical creator. onConflict:'link' handles the
    // KYC-window race (link, no throw, no duplicate); the evidence/cert defense-in-
    // depth re-check downgrades an under-bar applicant to MORE_INFO_REQUIRED with a
    // [quality-gate] note (statusOverride + initialNotes), else a PENDING create.
    const { application, conflicted } = await submitProviderApplication(
      tx,
      {
        phone: payload.phone,
        name: payload.name,
        idNumber: payload.idNumber ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        availability: joinAvailability(payload.availability),
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
        certificationRef: payload.certificationRef ?? null,
        hourlyRate: payload.hourlyRate ?? null,
        ctwaReferral: (payload.ctwaReferral ?? null) as SubmitInput['ctwaReferral'],
      },
      {
        source: 'web',
        onConflict: 'link',
        ...evaluateCompletionGate(
          payload.skills ?? [],
          payload.evidenceFileUrls ?? [],
          payload.certificationRef ?? null,
          'completePwaResumeChannel',
        ),
      },
    )
    applicationId = application.id

    if (conflicted) {
      console.warn('[quality-gate-submission] completePwaResumeChannel: active application already exists, linking draft (no duplicate create)', {
        existingApplicationId: application.id,
        existingStatus: application.status,
        phone: payload.phone,
      })
    }

    await tx.providerApplicationDraft.update({
      where: { id: draft.id },
      data: { submittedApplicationId: applicationId },
    })
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { providerApplicationId: applicationId },
    })
  })

  // Confirmation: best-effort WhatsApp message if phone is available
  if (payload.phone) {
    try {
      const ref = applicationId!.slice(-8).toUpperCase()
      await sendButtons(
        payload.phone,
        `✅ Your identity verification passed!\n\nYour application is now submitted.\n\nRef: *${ref}*\n\nApproval is not automatic. We'll update you after the review is complete.`,
        [
          { id: 'provider_application_status', title: 'Check Status' },
          { id: 'back_home', title: 'Main Menu' },
        ],
      )
    } catch (err) {
      // Non-fatal: confirmation failure must never fail the application creation
      console.warn('[quality-gate-submission] PWA_RESUME WhatsApp confirmation failed (non-fatal)', {
        verificationId,
        applicationId: applicationId!,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Note: for PWA_RESUME a dedicated web confirmation UI exists at /provider/signup/confirmation;
  // the webhook event should trigger a redirect there. WhatsApp send is best-effort only.

  return { applicationId: applicationId! }
}

// ─── Internal: PWA_SELF_SERVE channel — sync provider, conflict-aware inline create ─
//
// Fix A: previously called submitProviderApplication which throws
// ProviderApplicationConflictError when an active application exists for the
// phone. That throw (during the KYC completion webhook) had no processedAt
// set → the webhook treated it as retryable → the completion retried forever.
//
// Fix: do the conflict check ourselves. If an active application already exists,
// link the draft and verification to it and return the existing id — no throw.
//
// Fix C: replay providerRate rows using callOutFee / hourlyRate from the payload
// (mirrors the gate-OFF self-serve path in pwa-flow.ts).

async function completePwaSelfServeChannel(
  client: typeof db,
  payload: Qgv2PwaSelfServeSubmitPayload,
  draft: { id: string },
  verificationId: string,
): Promise<{ applicationId: string }> {
  let providerId: string
  let applicationId: string

  await client.$transaction(async (tx) => {
    // PWA_SELF_SERVE: the Provider row does not exist yet (gate-ON deferred creation).
    // Sync it first, mirroring the gate-OFF create path in pwa-flow.ts.
    // Fix C: compute test cohort from phone (deterministic — matches gate-OFF path).
    const cohort = createTestCohortContext(payload.phone)
    providerId = await syncProviderRecord(tx as unknown as typeof db, {
      phone: payload.phone,
      name: payload.name,
      email: payload.email ?? null,
      skills: payload.skills,
      serviceAreas: payload.serviceAreas,
      active: true,
      availableNow: false,
      verified: false,
      isTestUser: cohort.isTestUser,
      cohortName: cohort.cohortName,
      locationNodeIds: payload.locationNodeIds ?? [],
      skipEnrichment: true,
    })

    // Resume-token decision: same as PWA_RESUME — the resume token is not stored
    // in the submitPayload and retrieving it by phone/draftId would require an
    // extra lookup. The idempotency guard (draft.submittedApplicationId) makes
    // a stale token harmless, so we skip consumption here.
    //
    // Delegate row creation to the canonical creator. onConflict:'link' handles the
    // KYC-window race; the evidence/cert re-check downgrades an under-bar applicant
    // to MORE_INFO_REQUIRED with a [quality-gate] note (statusOverride+initialNotes).
    const { application, conflicted } = await submitProviderApplication(
      tx,
      {
        phone: payload.phone,
        name: payload.name,
        email: payload.email ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        locationNodeIds: payload.locationNodeIds ?? [],
        availability: joinAvailability(payload.availability),
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
        certificationRef: payload.certificationRef ?? null,
        callOutFee: payload.callOutFee ?? null,
        hourlyRate: payload.hourlyRate ?? null,
        reference1Name: payload.reference1Name ?? null,
        reference1Mobile: payload.reference1Mobile ?? null,
        reference2Name: payload.reference2Name ?? null,
        reference2Mobile: payload.reference2Mobile ?? null,
        // Fix C: preserve test-cohort classification at completion time
        isTestUser: cohort.isTestUser,
        cohortName: cohort.cohortName,
        providerId,
      },
      {
        source: 'web',
        onConflict: 'link',
        ...evaluateCompletionGate(
          payload.skills ?? [],
          payload.evidenceFileUrls ?? [],
          payload.certificationRef ?? null,
          'completePwaSelfServeChannel',
        ),
      },
    )
    applicationId = application.id

    if (conflicted) {
      console.warn('[quality-gate-submission] completePwaSelfServeChannel: active application already exists, linking draft (no duplicate create)', {
        existingApplicationId: application.id,
        existingStatus: application.status,
        phone: payload.phone,
      })
      // Linked to a pre-existing application: its rate rows already exist; skip the
      // replay and just link the draft + verification below.
      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: applicationId },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: applicationId },
      })
      // Fix 1: link provider + set kycStatus VERIFIED (provider was synced above).
      await linkProviderAndKyc(tx, { verificationId, providerId, verdict: 'PASSED' })
      return
    }

    // Fix 4: replay providerCategory rows, mirroring the gate-OFF self-serve path
    // in pwa-flow.ts (which creates one category row per skill before rates). The
    // completion previously replayed only rates, leaving the provider with no
    // category rows. Skipped on the conflict-link path above (rows already exist),
    // same as rates. categorySlugForSkill is used so the slug matches the rate rows.
    if (payload.skills.length > 0) {
      const categoryRows = payload.skills.map((skill) => ({
        providerId,
        categorySlug: categorySlugForSkill(skill),
        yearsExperience: yearsExperienceFromLabel(payload.experience),
        skillLevel: skillLevelFromExperienceLabel(payload.experience),
        approvalStatus: 'PENDING_REVIEW',
        certificationRequired: false,
        certificationStatus: 'NOT_REQUIRED',
      }))
      // providerCategory may not exist in all env migrations; guard with optional chaining.
      // TODO: drop the `as any` once providerCategory is guaranteed present in the Prisma tx client type (post-migration)
      const pc = (tx as any).providerCategory
      if (pc?.createMany) {
        await pc.createMany({ data: categoryRows, skipDuplicates: true })
      } else {
        console.warn('[quality-gate] providerCategory model absent — category rows NOT written (migration missing?)', {
          draftId: draft.id,
          providerId,
          categoryCount: categoryRows.length,
        })
      }
    }

    // Fix C: replay providerRate rows, mirroring the gate-OFF self-serve path in
    // pwa-flow.ts. Only written when callOutFee is present (the trigger condition
    // used by the gate-OFF path). hourlyRate is replayed alongside when present.
    if (payload.callOutFee !== null && payload.callOutFee !== undefined && payload.skills.length > 0) {
      const rateRows = payload.skills.map((skill) => ({
        providerId,
        categorySlug: categorySlugForSkill(skill),
        callOutFee: payload.callOutFee,
        hourlyRate: typeof payload.hourlyRate === 'number' ? payload.hourlyRate : null,
        rateNegotiable: true,
        quoteAfterInspection: false,
      }))
      // providerRate may not exist in all env migrations; guard with optional chaining
      // TODO: remove optional chaining once providerRate migration is confirmed in all envs
      const pr = (tx as any) // TODO: drop the `as any` once providerRate is guaranteed present in the Prisma tx client type (post-migration)
        .providerRate
      if (pr?.createMany) {
        await pr.createMany({ data: rateRows, skipDuplicates: true })
      } else {
        console.warn('[quality-gate] providerRate model absent — rate rows NOT written (migration missing?)', {
          draftId: draft.id,
          providerId,
          rateCount: rateRows.length,
        })
      }
    }

    await tx.providerApplicationDraft.update({
      where: { id: draft.id },
      data: { submittedApplicationId: applicationId },
    })
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { providerApplicationId: applicationId },
    })
    // Fix 1: link the synced provider to the verification + set kycStatus VERIFIED.
    await linkProviderAndKyc(tx, { verificationId, providerId, verdict: 'PASSED' })
  })

  // Post-commit enrichment (non-blocking)
  if (payload.locationNodeIds?.length > 0) {
    upsertStructuredServiceAreas(client, providerId!, payload.locationNodeIds).catch((err) =>
      console.error('[quality-gate-submission] PWA_SELF_SERVE upsertStructuredServiceAreas failed (non-fatal)', {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  // Confirmation: no WhatsApp channel for PWA_SELF_SERVE applicants.
  // The web confirmation page (/provider/signup/confirmation) is the primary
  // post-submit destination; no server-side message is sent here.

  return { applicationId: applicationId! }
}

// ─── Public: complete draft on PASSED verification ────────────────────────────

export type CompleteApplicationResult =
  | { applicationId: string }
  | { skipped: 'no_draft' | 'already_submitted' }

export async function completeApplicationForPassedVerification(
  client: typeof db,
  { verificationId }: { verificationId: string },
): Promise<CompleteApplicationResult> {
  // 1. Load verification
  const verification = await client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: { id: true, providerApplicationDraftId: true },
  })

  if (!verification.providerApplicationDraftId) {
    return { skipped: 'no_draft' }
  }

  // 2. Load draft
  const draft = await client.providerApplicationDraft.findUniqueOrThrow({
    where: { id: verification.providerApplicationDraftId },
    select: { id: true, submittedApplicationId: true, submitPayload: true, phone: true, name: true },
  })

  // Idempotency guard
  if (draft.submittedApplicationId) {
    return { skipped: 'already_submitted' }
  }

  // 3. Parse submit payload and dispatch by channel
  const rawPayload = draft.submitPayload as Record<string, unknown>
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('ProviderApplicationDraft.submitPayload is missing or not an object')
  }

  const channel = rawPayload.channel as string

  if (channel === 'PWA_RESUME') {
    return completePwaResumeChannel(client, rawPayload as unknown as Qgv2PwaResumeSubmitPayload, draft, verificationId)
  }

  if (channel === 'PWA_SELF_SERVE') {
    return completePwaSelfServeChannel(client, rawPayload as unknown as Qgv2PwaSelfServeSubmitPayload, draft, verificationId)
  }

  if (channel !== 'WHATSAPP') {
    throw new Error(`Unknown submit payload channel: ${channel}`)
  }

  const payload = rawPayload as unknown as Qgv2WhatsappSubmitPayload

  // 4. Execute in a transaction
  let providerId: string
  let applicationId: string

  await client.$transaction(async (tx) => {
    // a–c. Delegate to the canonical WhatsApp finalizer: syncProviderRecord →
    //      submitProviderApplication → providerCategory.createMany →
    //      providerRate.createMany. This is the SAME code the gate-OFF handlePending
    //      path runs, so the two can never diverge again.
    //
    //   - onConflict:'link' — a live application created during the KYC window is
    //     linked (below) rather than throwing (a throw here has no processedAt →
    //     the completion webhook retries forever). No duplicate row is created.
    //   - statusOverride/initialNotes — defense-in-depth evidence/cert re-check:
    //     an under-bar applicant is created as MORE_INFO_REQUIRED with a
    //     [quality-gate] note instead of PENDING. On a pass these are undefined
    //     (→ PENDING create, no note), matching the gate-OFF path exactly.
    const gateOpts: FinalizeWhatsappOpts = {
      onConflict: 'link',
      ...evaluateCompletionGate(
        payload.submitApplicationArgs.skills ?? [],
        payload.submitApplicationArgs.evidenceFileUrls ?? [],
        payload.submitApplicationArgs.certificationRef ?? null,
        'completeApplicationForPassedVerification (WHATSAPP)',
      ),
    }
    const finalize = await finalizeWhatsappProviderSubmission(
      tx,
      toWhatsappFinalizeInput(payload),
      gateOpts,
    )
    providerId = finalize.providerId
    applicationId = finalize.application.id

    // On a linked conflict the category/rate rows already exist and attachments
    // belong to the pre-existing application; link the draft + verification below
    // and skip the replay-attachment linking (mirrors the old skip-duplicate path).
    if (finalize.conflicted) {
      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: applicationId },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: applicationId },
      })
      // Fix 1: link provider + set kycStatus VERIFIED even on the conflict path
      // (the provider exists; only the application row was pre-existing).
      await linkProviderAndKyc(tx, { verificationId, providerId, verdict: 'PASSED' })
      return
    }

    // d. Link evidence attachments (non-fatal for each)
    for (const attId of payload.replayInputs.evidenceAttachmentIds ?? []) {
      await linkAttachmentToApplication(tx, attId, applicationId, 'evidence')
    }

    // e. Link profile photo (non-fatal)
    if (payload.replayInputs.profilePhotoAttachmentId) {
      try {
        await tx.attachment.updateMany({
          where: { id: payload.replayInputs.profilePhotoAttachmentId, providerApplicationId: null },
          data: { providerApplicationId: applicationId },
        })
        const photoRow = await tx.attachment.findUnique({
          where: { id: payload.replayInputs.profilePhotoAttachmentId },
          select: { url: true },
        })
        if (photoRow?.url) {
          await tx.provider.updateMany({
            where: { id: providerId },
            data: { avatarUrl: photoRow.url },
          })
        }
      } catch (err) {
        console.warn('[quality-gate-submission] profile photo link failed (non-fatal)', {
          verificationId,
          applicationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // f. Link verification doc and selfie attachments (non-fatal)
    await linkAttachmentToApplication(
      tx,
      payload.replayInputs.verificationDocAttachmentId,
      applicationId,
      'verification_doc',
    )
    await linkAttachmentToApplication(
      tx,
      payload.replayInputs.verificationSelfieAttachmentId,
      applicationId,
      'verification_selfie',
    )

    // Fix 3: link the uploaded certification document (non-fatal). Older drafts
    // predating this field carry undefined → linkAttachmentToApplication no-ops.
    await linkAttachmentToApplication(
      tx,
      payload.replayInputs.certificationDocAttachmentId,
      applicationId,
      'certification_doc',
    )

    // g. Set draft.submittedApplicationId and link verification to application
    await tx.providerApplicationDraft.update({
      where: { id: draft.id },
      data: { submittedApplicationId: applicationId },
    })
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { providerApplicationId: applicationId },
    })
    // Fix 1: link the created provider to the verification + set kycStatus VERIFIED.
    await linkProviderAndKyc(tx, { verificationId, providerId, verdict: 'PASSED' })
  })

  // 5. Post-commit enrichment (non-blocking)
  if (payload.canonicalSkills?.length > 0) {
    syncProviderSkills(client, providerId!, payload.canonicalSkills).catch((err) =>
      console.error('[quality-gate-submission] syncProviderSkills failed (non-fatal)', {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  if (payload.replayInputs.locationNodeIds?.length > 0) {
    upsertStructuredServiceAreas(client, providerId!, payload.replayInputs.locationNodeIds).catch((err) =>
      console.error('[quality-gate-submission] upsertStructuredServiceAreas failed (non-fatal)', {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  // 6. Send WhatsApp confirmation (non-blocking)
  try {
    const ref = applicationId!.slice(-8).toUpperCase()
    await sendButtons(
      payload.normalizedPhone,
      `✅ Your identity verification passed!\n\nYour application is now submitted.\n\nRef: *${ref}*\n\nApproval is not automatic. We'll update you after the review is complete.`,
      [
        { id: 'provider_application_status', title: 'Check Status' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
  } catch (err) {
    console.warn('[quality-gate-submission] WhatsApp confirmation send failed (non-fatal)', {
      verificationId,
      applicationId: applicationId!,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { applicationId: applicationId! }
}

// ─── Public: record failed verification for draft-anchored flow ───────────────

export async function recordFailedVerificationForApplication(
  client: typeof db,
  { verificationId }: { verificationId: string },
): Promise<void> {
  // 1. Load verification
  const verification = await client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: { id: true, providerApplicationDraftId: true },
  })

  if (!verification.providerApplicationDraftId) {
    // Not a draft-anchored verification — nothing to do
    return
  }

  // 2. Load draft
  const draft = await client.providerApplicationDraft.findUniqueOrThrow({
    where: { id: verification.providerApplicationDraftId },
    select: { id: true, submittedApplicationId: true, submitPayload: true, phone: true },
  })

  // Guard: if draft already has a submitted application, skip both paths
  if (draft.submittedApplicationId) {
    // Already submitted from a prior PASS or prior failure path — skip
    return
  }

  // 3. Count all FAILED verifications for this draft (includes the current one
  //    since applyVendorVerdict was already called before this function)
  const failCount = await client.providerIdentityVerification.count({
    where: {
      providerApplicationDraftId: verification.providerApplicationDraftId,
      status: 'FAILED',
    },
  })

  const rawPayload = draft.submitPayload as Record<string, unknown>
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('ProviderApplicationDraft.submitPayload is missing or not an object')
  }

  const channel = rawPayload.channel as string

  if (failCount >= 2) {
    // 4. 2nd+ failure: create MORE_INFO_REQUIRED application
    let applicationId: string
    const qualityGateNote = appendQualityGateNote(null)

    if (channel === 'WHATSAPP') {
      const payload = rawPayload as unknown as Qgv2WhatsappSubmitPayload

      await client.$transaction(async (tx) => {
        // Sync provider record (returns id string)
        const providerId = await syncProviderRecord(tx as unknown as typeof db, {
          ...payload.syncProviderArgs,
          skipEnrichment: true,
        })

        // Create MORE_INFO_REQUIRED via the canonical creator. No category/rate
        // rows on the failure path (matching the original createApplicationInline,
        // which only wrote the application row + note). onConflict:'link' avoids the
        // retry-forever throw on a KYC-window race.
        applicationId = await createMoreInfoApplicationAndLink(tx, {
          submitInput: toWhatsappSubmitInput(payload.submitApplicationArgs, providerId, payload.replayInputs.locationNodeIds ?? []),
          note: qualityGateNote,
          draftId: draft.id,
          verificationId,
          // Fix 1: FAILED verdict → kycStatus REJECTED + link provider.
          providerId,
          verdict: 'FAILED',
        })
      })
    } else if (channel === 'PWA_RESUME') {
      // PWA_RESUME: create the MORE_INFO_REQUIRED row via the canonical creator.
      // No WhatsApp message is sent — the in-flight re-nudge cron + applicant's
      // status polling handle the MORE_INFO_REQUIRED state on the web side.
      const payload = rawPayload as unknown as Qgv2PwaResumeSubmitPayload

      await client.$transaction(async (tx) => {
        // Fix C: compute test cohort from phone
        const resumeFailCohort = createTestCohortContext(payload.phone)
        applicationId = await createMoreInfoApplicationAndLink(tx, {
          submitInput: toPwaResumeSubmitInput(payload, resumeFailCohort),
          note: qualityGateNote,
          draftId: draft.id,
          verificationId,
        })
      })
    } else if (channel === 'PWA_SELF_SERVE') {
      // PWA_SELF_SERVE: sync the Provider row first (gate-ON deferred creation),
      // then create the MORE_INFO_REQUIRED row via the canonical creator.
      // No WhatsApp message is sent — the web flow handles the MORE_INFO state.
      const payload = rawPayload as unknown as Qgv2PwaSelfServeSubmitPayload

      await client.$transaction(async (tx) => {
        // Fix C: compute test cohort from phone (deterministic — matches gate-OFF path)
        const failCohort = createTestCohortContext(payload.phone)
        const providerId = await syncProviderRecord(tx as unknown as typeof db, {
          phone: payload.phone,
          name: payload.name,
          email: payload.email ?? null,
          skills: payload.skills,
          serviceAreas: payload.serviceAreas,
          active: true,
          availableNow: false,
          verified: false,
          isTestUser: failCohort.isTestUser,
          cohortName: failCohort.cohortName,
          locationNodeIds: payload.locationNodeIds ?? [],
          skipEnrichment: true,
        })

        applicationId = await createMoreInfoApplicationAndLink(tx, {
          submitInput: toPwaSelfServeSubmitInput(payload, failCohort, providerId),
          note: qualityGateNote,
          draftId: draft.id,
          verificationId,
          // Fix 1: FAILED verdict → kycStatus REJECTED + link provider.
          providerId,
          verdict: 'FAILED',
        })
      })
    } else {
      throw new Error(`Unknown submit payload channel: ${channel}`)
    }

    console.info('[quality-gate-submission] 2nd+ KYC failure — created MORE_INFO_REQUIRED application', {
      verificationId,
      applicationId: applicationId!,
      draftId: draft.id,
      failCount,
      channel,
    })
  } else {
    // 5. 1st failure: re-issue the verification link so the applicant can retry.
    // Channel mapping: WHATSAPP → 'WHATSAPP'; PWA_RESUME/PWA_SELF_SERVE → 'PWA'.
    // For PWA channels, no WhatsApp nudge is sent — the in-flight re-nudge cron
    // and the applicant's status polling handle retry. Re-issuing the link is
    // idempotent (issueProviderApplicationVerificationLink is idempotent by design).
    const verificationChannel: 'WHATSAPP' | 'PWA' =
      channel === 'WHATSAPP' ? 'WHATSAPP' : 'PWA'

    try {
      await issueProviderApplicationVerificationLink({
        providerApplicationDraftId: draft.id,
        channel: verificationChannel,
      })

      // Only send a WhatsApp nudge for WHATSAPP-channel applicants.
      // PWA applicants have no WhatsApp contact on the verification flow.
      if (channel === 'WHATSAPP') {
        const phone = (draft.phone as string | null) ?? (
          (draft.submitPayload as Record<string, unknown>)?.normalizedPhone as string | null
        )

        if (phone) {
          await sendButtons(
            phone,
            `❌ Your identity verification was unsuccessful.\n\nYou can try again — tap the button below to re-verify.`,
            [
              { id: 'provider_verify_retry', title: 'Try Again' },
              { id: 'back_home', title: 'Main Menu' },
            ],
          )
        }
      }
    } catch (err) {
      console.warn('[quality-gate-submission] 1st failure retry link/message failed (non-fatal)', {
        verificationId,
        draftId: draft.id,
        channel,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ─── Public: handle manual-review verdict for draft-anchored flow (Fix A) ──────
//
// Didit "Declined" / "In Review" verdicts map to NEEDS_MANUAL_REVIEW (not FAILED).
// For draft-anchored verifications this status was previously unhandled → the
// webhook marked processed, no application was created, and the applicant was
// silently stranded. This function creates a MORE_INFO_REQUIRED application with
// a [quality-gate] ops note so the ops team can see and action the applicant.
// EXPIRED and CANCELLED terminal statuses are handled identically — they represent
// sessions that cannot be recovered and ops must decide next steps.

export async function recordManualReviewForApplication(
  client: typeof db,
  {
    verificationId,
    reason = 'KYC needs manual review',
    verdict = 'NEEDS_MANUAL_REVIEW',
  }: {
    verificationId: string
    reason?: string
    /**
     * The terminal-but-not-PASS verdict that routed here. Drives the
     * draft-anchored kycStatus mapping (Fix 1): NEEDS_MANUAL_REVIEW/CANCELLED →
     * untouched, EXPIRED → EXPIRED. Defaults to NEEDS_MANUAL_REVIEW for callers
     * that predate this param.
     */
    verdict?: 'NEEDS_MANUAL_REVIEW' | 'EXPIRED' | 'CANCELLED'
  },
): Promise<void> {
  // 1. Load verification
  const verification = await client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: { id: true, providerApplicationDraftId: true },
  })

  if (!verification.providerApplicationDraftId) {
    // Not draft-anchored — nothing to do here
    return
  }

  // 2. Load draft
  const draft = await client.providerApplicationDraft.findUniqueOrThrow({
    where: { id: verification.providerApplicationDraftId },
    select: { id: true, submittedApplicationId: true, submitPayload: true, phone: true },
  })

  // Guard: if draft already has a submitted application, skip (idempotent)
  if (draft.submittedApplicationId) {
    return
  }

  const rawPayload = draft.submitPayload as Record<string, unknown>
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('ProviderApplicationDraft.submitPayload is missing or not an object')
  }

  const channel = rawPayload.channel as string
  const qualityGateNote = appendQualityGateNote(null, reason)
  let applicationId: string

  if (channel === 'WHATSAPP') {
    const payload = rawPayload as unknown as Qgv2WhatsappSubmitPayload

    await client.$transaction(async (tx) => {
      const providerId = await syncProviderRecord(tx as unknown as typeof db, {
        ...payload.syncProviderArgs,
        skipEnrichment: true,
      })

      // WHATSAPP: isTestUser/cohortName already carried in payload.submitApplicationArgs.
      applicationId = await createMoreInfoApplicationAndLink(tx, {
        submitInput: toWhatsappSubmitInput(payload.submitApplicationArgs, providerId, payload.replayInputs.locationNodeIds ?? []),
        note: qualityGateNote,
        draftId: draft.id,
        verificationId,
        // Fix 1: link provider + apply the verdict's kycStatus mapping (if any).
        providerId,
        verdict,
      })
    })
  } else if (channel === 'PWA_RESUME') {
    const payload = rawPayload as unknown as Qgv2PwaResumeSubmitPayload

    await client.$transaction(async (tx) => {
      const manualCohort = createTestCohortContext(payload.phone)
      applicationId = await createMoreInfoApplicationAndLink(tx, {
        submitInput: toPwaResumeSubmitInput(payload, manualCohort),
        note: qualityGateNote,
        draftId: draft.id,
        verificationId,
      })
    })
  } else if (channel === 'PWA_SELF_SERVE') {
    const payload = rawPayload as unknown as Qgv2PwaSelfServeSubmitPayload

    await client.$transaction(async (tx) => {
      const manualCohort = createTestCohortContext(payload.phone)
      const providerId = await syncProviderRecord(tx as unknown as typeof db, {
        phone: payload.phone,
        name: payload.name,
        email: payload.email ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        active: true,
        availableNow: false,
        verified: false,
        isTestUser: manualCohort.isTestUser,
        cohortName: manualCohort.cohortName,
        locationNodeIds: payload.locationNodeIds ?? [],
        skipEnrichment: true,
      })

      applicationId = await createMoreInfoApplicationAndLink(tx, {
        submitInput: toPwaSelfServeSubmitInput(payload, manualCohort, providerId),
        note: qualityGateNote,
        draftId: draft.id,
        verificationId,
        // Fix 1: link provider + apply the verdict's kycStatus mapping (if any).
        providerId,
        verdict,
      })
    })
  } else {
    throw new Error(`Unknown submit payload channel: ${channel}`)
  }

  console.info('[quality-gate-submission] manual-review verdict — created MORE_INFO_REQUIRED application', {
    verificationId,
    applicationId: applicationId!,
    draftId: draft.id,
    channel,
    reason,
  })
}
