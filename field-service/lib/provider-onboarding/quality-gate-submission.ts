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

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { syncProviderRecord, upsertStructuredServiceAreas } from '@/lib/provider-record'
import { syncProviderSkills } from '@/lib/provider-skills'
import { resolveInitialApprovalStatus } from '@/lib/provider-categories'
import { resolveServiceCategoryTag } from '@/lib/service-categories'
import { getServiceComplianceRequirement } from '@/lib/service-category-policy'
import { sendButtons } from '@/lib/whatsapp-interactive'
import { issueProviderApplicationVerificationLink } from '@/lib/identity-verification/application-link'
import { ACTIVE_PROVIDER_APPLICATION_STATUSES } from '@/lib/provider-applications'
import { evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'
import { createTestCohortContext } from '@/lib/internal-test-cohort'

// ─── Local helpers (mirrors registration.ts, not exported there) ──────────────

function yearsExperienceFromLabel(label: string | undefined | null): number | null {
  if (!label) return null
  if (label.includes('Less')) return 0
  if (label.includes('1–3')) return 2
  if (label.includes('3–5')) return 4
  if (label.includes('5+')) return 5
  return null
}

function skillLevelFromExperienceLabel(label: string | undefined | null): string | null {
  if (!label) return null
  if (label.includes('Less')) return 'BEGINNER'
  if (label.includes('1–3')) return 'INTERMEDIATE'
  return 'EXPERIENCED'
}

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

// ─── Internal: create ProviderApplication inline (with completion re-check) ──

async function createApplicationInline(
  tx: Prisma.TransactionClient,
  args: {
    submitApplicationArgs: Qgv2WhatsappSubmitPayload['submitApplicationArgs']
    providerId: string
    status: 'PENDING' | 'MORE_INFO_REQUIRED'
    notesAppend: string | null
    draft?: { id: string }
  },
) {
  const a = args.submitApplicationArgs

  // Defense-in-depth: re-check for an active application that may have been
  // created during the KYC window (e.g. a concurrent WhatsApp submit or a
  // support-team manual create). If one exists, link the draft to it and skip
  // the duplicate create rather than creating a second row.
  const conflict = await tx.providerApplication.findFirst({
    where: {
      phone: a.phone,
      status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
    },
    select: { id: true, status: true },
  })
  if (conflict) {
    if (args.draft) {
      const draftId = args.draft.id
      await tx.providerApplicationDraft.update({
        where: { id: draftId },
        data: { submittedApplicationId: conflict.id },
      }).catch((err) => {
        console.error('[quality-gate-submission] createApplicationInline: failed to link draft to existing application', {
          draftId,
          conflictApplicationId: conflict.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    console.warn('[quality-gate-submission] createApplicationInline: active application already exists, skipping duplicate create', {
      existingApplicationId: conflict.id,
      existingStatus: conflict.status,
      phone: a.phone,
    })
    return { id: conflict.id, _skippedDuplicate: true as const }
  }

  // Fix B — defense-in-depth: re-evaluate the evidence and certification gates
  // at completion time. The gate was evaluated when the draft was created, but
  // the WhatsApp path bypasses submitProviderApplication (which enforces the
  // gate when the flag is ON). If an upstream path skipped the gate (flag was
  // OFF at draft-create time and turned ON before completion, or a concurrent
  // path bypassed the check), a PENDING application must not be created for an
  // under-qualified applicant. Downgrade to MORE_INFO_REQUIRED with a note so
  // ops can review rather than silently dropping the applicant.
  if (args.status === 'PENDING') {
    const evidenceResult = evaluateEvidenceGate(a.evidenceFileUrls ?? [])
    const certResult = evaluateCertificationGate(a.skills ?? [], Boolean(a.certificationRef))
    if (!evidenceResult.ok || !certResult.ok) {
      console.warn('[quality-gate-submission] createApplicationInline: evidence/cert gate failed at completion — downgrading to MORE_INFO_REQUIRED', {
        phone: a.phone,
        evidenceHave: evidenceResult.have,
        evidenceNeed: evidenceResult.need,
        certRequired: certResult.required,
        certOk: certResult.ok,
      })
      args = {
        ...args,
        status: 'MORE_INFO_REQUIRED',
        notesAppend: appendQualityGateNote(args.notesAppend ?? null, 'evidence/certification incomplete at KYC completion'),
      }
    }
  }

  const availabilityStr = Array.isArray(a.availability)
    ? (a.availability as string[]).join(', ')
    : a.availability ?? null

  const application = await tx.providerApplication.create({
    data: {
      phone: a.phone,
      name: a.name,
      email: a.email ?? null,
      idNumber: a.idNumber ?? null,
      skills: a.skills,
      serviceAreas: a.serviceAreas,
      experience: a.experience ?? null,
      availability: availabilityStr,
      callOutFee: a.callOutFee ?? null,
      hourlyRate: a.hourlyRate ?? null,
      rateNegotiable: a.rateNegotiable,
      weekendJobs: a.weekendJobs,
      sameDayJobs: a.sameDayJobs,
      evidenceNote: a.evidenceNote ?? null,
      evidenceFileUrls: a.evidenceFileUrls ?? [],
      alternateMobileE164: a.alternateMobileE164 ?? null,
      preferredLanguage: a.preferredLanguage ?? null,
      reference1Name: a.reference1Name ?? null,
      reference1Mobile: a.reference1Mobile ?? null,
      reference2Name: a.reference2Name ?? null,
      reference2Mobile: a.reference2Mobile ?? null,
      isTestUser: a.isTestUser ?? false,
      cohortName: a.cohortName ?? null,
      providerId: args.providerId,
      status: args.status,
      submittedAt: new Date(),
      // CTWA ad attribution (null-safe)
      ...(a.ctwaReferral != null
        ? {
            ctwaSourceType: (a.ctwaReferral as Record<string, unknown>).sourceType as string | undefined ?? null,
            ctwaSourceId: (a.ctwaReferral as Record<string, unknown>).sourceId as string | undefined ?? null,
            ctwaClid: (a.ctwaReferral as Record<string, unknown>).ctwaClid as string | undefined ?? null,
            ctwaHeadline: (a.ctwaReferral as Record<string, unknown>).headline as string | undefined ?? null,
            ctwaCapturedAt: (a.ctwaReferral as Record<string, unknown>).capturedAt
              ? new Date((a.ctwaReferral as Record<string, unknown>).capturedAt as string)
              : null,
          }
        : {}),
    },
  })

  if (args.notesAppend) {
    await tx.providerApplication.update({
      where: { id: application.id },
      data: { notes: args.notesAppend },
    })
  }

  return application
}

// ─── Internal: create ProviderApplication inline for PWA channels (failure path) ─
// Used when a PWA_RESUME or PWA_SELF_SERVE applicant fails KYC a 2nd+ time.
// submitProviderApplication always creates PENDING and has a conflict guard, so
// we create the row directly (mirroring createApplicationInline) with the status
// override needed for the MORE_INFO_REQUIRED failure path.

async function createPwaApplicationInline(
  tx: Prisma.TransactionClient,
  args: {
    phone: string
    name: string
    email?: string | null
    idNumber?: string | null
    skills: string[]
    serviceAreas: string[]
    experience?: string | null
    availability: string
    evidenceNote?: string | null
    evidenceFileUrls?: string[]
    callOutFee?: number | null
    reference1Name?: string | null
    reference1Mobile?: string | null
    reference2Name?: string | null
    reference2Mobile?: string | null
    ctwaReferral?: unknown | null
    providerId?: string | null
    // Fix C: test-cohort fields — caller computes createTestCohortContext(phone)
    isTestUser?: boolean
    cohortName?: string | null
    status: 'PENDING' | 'MORE_INFO_REQUIRED'
    notesAppend: string | null
    draft?: { id: string }
  },
) {
  // Defense-in-depth: re-check for an active application that may have been
  // created during the KYC window. If one exists, link the draft and skip.
  const conflict = await tx.providerApplication.findFirst({
    where: {
      phone: args.phone,
      status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
    },
    select: { id: true, status: true },
  })
  if (conflict) {
    if (args.draft) {
      const draftId = args.draft.id
      await tx.providerApplicationDraft.update({
        where: { id: draftId },
        data: { submittedApplicationId: conflict.id },
      }).catch((err) => {
        console.error('[quality-gate-submission] createPwaApplicationInline: failed to link draft to existing application', {
          draftId,
          conflictApplicationId: conflict.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    console.warn('[quality-gate-submission] createPwaApplicationInline: active application already exists, skipping duplicate create', {
      existingApplicationId: conflict.id,
      existingStatus: conflict.status,
      phone: args.phone,
    })
    return { id: conflict.id, _skippedDuplicate: true as const }
  }

  const application = await tx.providerApplication.create({
    data: {
      phone: args.phone,
      name: args.name,
      email: args.email ?? null,
      idNumber: args.idNumber ?? null,
      skills: args.skills,
      serviceAreas: args.serviceAreas,
      experience: args.experience ?? null,
      availability: args.availability,
      evidenceNote: args.evidenceNote ?? null,
      evidenceFileUrls: args.evidenceFileUrls ?? [],
      callOutFee: args.callOutFee ?? null,
      reference1Name: args.reference1Name ?? null,
      reference1Mobile: args.reference1Mobile ?? null,
      reference2Name: args.reference2Name ?? null,
      reference2Mobile: args.reference2Mobile ?? null,
      // Note: certificationRef is not a column on ProviderApplication; it lives
      // only in the draft's submitPayload for quality-gate evaluation.
      // Fix C: test-cohort fields — caller passes from createTestCohortContext
      isTestUser: args.isTestUser ?? false,
      cohortName: args.cohortName ?? null,
      providerId: args.providerId ?? null,
      status: args.status,
      submittedAt: new Date(),
      // CTWA ad attribution (null-safe)
      ...(args.ctwaReferral != null
        ? {
            ctwaSourceType: (args.ctwaReferral as Record<string, unknown>).sourceType as string | undefined ?? null,
            ctwaSourceId: (args.ctwaReferral as Record<string, unknown>).sourceId as string | undefined ?? null,
            ctwaClid: (args.ctwaReferral as Record<string, unknown>).ctwaClid as string | undefined ?? null,
            ctwaHeadline: (args.ctwaReferral as Record<string, unknown>).headline as string | undefined ?? null,
            ctwaCapturedAt: (args.ctwaReferral as Record<string, unknown>).capturedAt
              ? new Date((args.ctwaReferral as Record<string, unknown>).capturedAt as string)
              : null,
          }
        : {}),
    },
  })

  if (args.notesAppend) {
    await tx.providerApplication.update({
      where: { id: application.id },
      data: { notes: args.notesAppend },
    })
  }

  return application
}

// ─── Internal: create provider categories in tx ───────────────────────────────

async function createProviderCategoryRows(
  tx: any, // TODO: replace with Prisma.TransactionClient once the tx type is exported/threadable
  providerId: string,
  payload: Qgv2WhatsappSubmitPayload,
) {
  const providerCategoryRows = await Promise.all(
    payload.canonicalSkills.map(async (skill: string) => {
      const categorySlug = resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_')
      const approvalStatus = await resolveInitialApprovalStatus(providerId, categorySlug)
      const compliance = getServiceComplianceRequirement(skill)
      return {
        certificationRequired: Boolean(compliance.certificationRequiredForApproval),
        certificationStatus: compliance.certificationRecommended
          ? (payload.replayInputs.certificationProofAttachmentIds?.length ?? 0) > 0
            ? 'SUBMITTED'
            : 'REQUESTED'
          : 'NOT_REQUIRED',
        providerId,
        categorySlug,
        yearsExperience: yearsExperienceFromLabel(payload.replayInputs.experience),
        skillLevel: skillLevelFromExperienceLabel(payload.replayInputs.experience),
        approvalStatus,
      }
    }),
  )

  if (providerCategoryRows.length > 0) {
    // providerCategory may not exist in all env migrations; guard with optional chaining
    await tx.providerCategory?.createMany?.({ data: providerCategoryRows, skipDuplicates: true })
  }
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

    // Fix A: conflict-aware create. If a live application already exists for this
    // phone (created concurrently during the KYC window), link the draft to it and
    // return its id rather than throwing ProviderApplicationConflictError.
    const conflict = await tx.providerApplication.findFirst({
      where: {
        phone: payload.phone,
        status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      },
      select: { id: true, status: true },
    })

    if (conflict) {
      console.warn('[quality-gate-submission] completePwaResumeChannel: active application already exists, linking draft (no duplicate create)', {
        existingApplicationId: conflict.id,
        existingStatus: conflict.status,
        phone: payload.phone,
      })
      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: conflict.id },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: conflict.id },
      })
      applicationId = conflict.id
      return
    }

    // Fix B: evidence/cert defense-in-depth before creating PENDING.
    const evidenceResult = evaluateEvidenceGate(payload.evidenceFileUrls ?? [])
    const certResult = evaluateCertificationGate(payload.skills ?? [], Boolean(payload.certificationRef))
    const gatePass = evidenceResult.ok && certResult.ok
    const finalStatus: 'PENDING' | 'MORE_INFO_REQUIRED' = gatePass ? 'PENDING' : 'MORE_INFO_REQUIRED'

    if (!gatePass) {
      console.warn('[quality-gate-submission] completePwaResumeChannel: evidence/cert gate failed — creating MORE_INFO_REQUIRED', {
        phone: payload.phone,
        evidenceHave: evidenceResult.have,
        evidenceNeed: evidenceResult.need,
        certRequired: certResult.required,
        certOk: certResult.ok,
      })
    }

    const availabilityStr = Array.isArray(payload.availability)
      ? (payload.availability as string[]).join(', ')
      : payload.availability ?? null

    const application = await tx.providerApplication.create({
      data: {
        phone: payload.phone,
        name: payload.name,
        idNumber: payload.idNumber ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        availability: availabilityStr,
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
        hourlyRate: payload.hourlyRate ?? null,
        status: finalStatus,
        submittedAt: new Date(),
        ...(payload.ctwaReferral != null
          ? {
              ctwaSourceType: (payload.ctwaReferral as Record<string, unknown>).sourceType as string | undefined ?? null,
              ctwaSourceId: (payload.ctwaReferral as Record<string, unknown>).sourceId as string | undefined ?? null,
              ctwaClid: (payload.ctwaReferral as Record<string, unknown>).ctwaClid as string | undefined ?? null,
              ctwaHeadline: (payload.ctwaReferral as Record<string, unknown>).headline as string | undefined ?? null,
              ctwaCapturedAt: (payload.ctwaReferral as Record<string, unknown>).capturedAt
                ? new Date((payload.ctwaReferral as Record<string, unknown>).capturedAt as string)
                : null,
            }
          : {}),
      },
    })
    applicationId = application.id

    if (!gatePass) {
      await tx.providerApplication.update({
        where: { id: applicationId },
        data: { notes: appendQualityGateNote(null, 'evidence/certification incomplete at KYC completion') },
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

    // Fix A: conflict-aware create. If a live application already exists for this
    // phone (created concurrently during the KYC window), link the draft to it and
    // return its id rather than throwing ProviderApplicationConflictError.
    const conflict = await tx.providerApplication.findFirst({
      where: {
        phone: payload.phone,
        status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      },
      select: { id: true, status: true },
    })

    if (conflict) {
      console.warn('[quality-gate-submission] completePwaSelfServeChannel: active application already exists, linking draft (no duplicate create)', {
        existingApplicationId: conflict.id,
        existingStatus: conflict.status,
        phone: payload.phone,
      })
      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: conflict.id },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: conflict.id },
      })
      applicationId = conflict.id
      return
    }

    // Fix B: evidence/cert defense-in-depth before creating PENDING.
    const evidenceResult = evaluateEvidenceGate(payload.evidenceFileUrls ?? [])
    const certResult = evaluateCertificationGate(payload.skills ?? [], Boolean(payload.certificationRef))
    const gatePass = evidenceResult.ok && certResult.ok
    const finalStatus: 'PENDING' | 'MORE_INFO_REQUIRED' = gatePass ? 'PENDING' : 'MORE_INFO_REQUIRED'

    if (!gatePass) {
      console.warn('[quality-gate-submission] completePwaSelfServeChannel: evidence/cert gate failed — creating MORE_INFO_REQUIRED', {
        phone: payload.phone,
        evidenceHave: evidenceResult.have,
        evidenceNeed: evidenceResult.need,
        certRequired: certResult.required,
        certOk: certResult.ok,
      })
    }

    // Resume-token decision: same as PWA_RESUME — the resume token is not stored
    // in the submitPayload and retrieving it by phone/draftId would require an
    // extra lookup. The idempotency guard (draft.submittedApplicationId) makes
    // a stale token harmless, so we skip consumption here.
    const availabilityStr = Array.isArray(payload.availability)
      ? (payload.availability as string[]).join(', ')
      : payload.availability ?? null

    const application = await tx.providerApplication.create({
      data: {
        phone: payload.phone,
        name: payload.name,
        email: payload.email ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        availability: availabilityStr,
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
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
        status: finalStatus,
        submittedAt: new Date(),
      },
    })
    applicationId = application.id

    if (!gatePass) {
      await tx.providerApplication.update({
        where: { id: applicationId },
        data: { notes: appendQualityGateNote(null, 'evidence/certification incomplete at KYC completion') },
      })
    }

    // Fix C: replay providerRate rows, mirroring the gate-OFF self-serve path in
    // pwa-flow.ts. Only written when callOutFee is present (the trigger condition
    // used by the gate-OFF path). hourlyRate is replayed alongside when present.
    if (payload.callOutFee !== null && payload.callOutFee !== undefined && payload.skills.length > 0) {
      const rateRows = payload.skills.map((skill) => {
        const categorySlug = resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_')
        return {
          providerId,
          categorySlug,
          callOutFee: payload.callOutFee,
          hourlyRate: typeof payload.hourlyRate === 'number' ? payload.hourlyRate : null,
          rateNegotiable: true,
          quoteAfterInspection: false,
        }
      })
      // providerRate may not exist in all env migrations; guard with optional chaining
      // TODO: remove optional chaining once providerRate migration is confirmed in all envs
      await (tx as any) // TODO: drop the `as any` once providerRate is guaranteed present in the Prisma tx client type (post-migration)
        .providerRate?.createMany?.({ data: rateRows, skipDuplicates: true })
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
    // a. Sync provider record (creates or updates the Provider row)
    // syncProviderRecord returns the provider id (string) directly
    providerId = await syncProviderRecord(tx as unknown as typeof db, {
      ...payload.syncProviderArgs,
      skipEnrichment: true,
    })

    // b. Create application inline (bypasses quality gate re-check — the gate
    //    was already evaluated when the draft was created in registration.ts)
    const application = await createApplicationInline(tx, {
      submitApplicationArgs: { ...payload.submitApplicationArgs, providerId },
      providerId,
      status: 'PENDING',
      notesAppend: null,
      draft,
    })
    applicationId = application.id

    // c. Create provider category rows
    await createProviderCategoryRows(tx, providerId, payload)

    // Fix C: replay providerRate rows, mirroring the gate-OFF WhatsApp path in
    // registration.ts. Only written when callOutFee is present (the trigger condition
    // used by the gate-OFF path). hourlyRate and rateNegotiable are replayed alongside.
    if (
      typeof payload.replayInputs.callOutFee === 'number' &&
      payload.canonicalSkills.length > 0
    ) {
      const rateRows = payload.canonicalSkills.map((skill: string) => {
        const categorySlug = resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_')
        return {
          providerId,
          categorySlug,
          callOutFee: payload.replayInputs.callOutFee,
          hourlyRate: typeof payload.replayInputs.hourlyRate === 'number' ? payload.replayInputs.hourlyRate : null,
          rateNegotiable: payload.replayInputs.rateNegotiable !== false,
          quoteAfterInspection: false,
        }
      })
      // providerRate may not exist in all env migrations; guard with optional chaining
      // TODO: remove optional chaining once providerRate migration is confirmed in all envs
      await (tx as any) // TODO: drop the `as any` once providerRate is guaranteed present in the Prisma tx client type (post-migration)
        .providerRate?.createMany?.({ data: rateRows, skipDuplicates: true })
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

    // g. Set draft.submittedApplicationId and link verification to application
    await tx.providerApplicationDraft.update({
      where: { id: draft.id },
      data: { submittedApplicationId: applicationId },
    })
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { providerApplicationId: applicationId },
    })
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

        // Create application with MORE_INFO_REQUIRED
        const application = await createApplicationInline(tx, {
          submitApplicationArgs: { ...payload.submitApplicationArgs, providerId },
          providerId,
          status: 'MORE_INFO_REQUIRED',
          notesAppend: qualityGateNote,
        })
        applicationId = application.id

        // Link draft and verification to the new application
        await tx.providerApplicationDraft.update({
          where: { id: draft.id },
          data: { submittedApplicationId: applicationId },
        })
        await tx.providerIdentityVerification.update({
          where: { id: verificationId },
          data: { providerApplicationId: applicationId },
        })
      })
    } else if (channel === 'PWA_RESUME') {
      // PWA_RESUME: submitProviderApplication always creates PENDING and has a
      // conflict guard, so we create the row directly with the status override.
      // No WhatsApp message is sent — the in-flight re-nudge cron + applicant's
      // status polling handle the MORE_INFO_REQUIRED state on the web side.
      const payload = rawPayload as unknown as Qgv2PwaResumeSubmitPayload

      await client.$transaction(async (tx) => {
        // Fix C: compute test cohort from phone
        const resumeFailCohort = createTestCohortContext(payload.phone)
        const application = await createPwaApplicationInline(tx, {
          phone: payload.phone,
          name: payload.name,
          idNumber: payload.idNumber ?? null,
          skills: payload.skills,
          serviceAreas: payload.serviceAreas,
          availability: payload.availability,
          experience: payload.experience ?? null,
          evidenceNote: payload.evidenceNote ?? null,
          evidenceFileUrls: payload.evidenceFileUrls ?? [],
          ctwaReferral: payload.ctwaReferral ?? null,
          isTestUser: resumeFailCohort.isTestUser,
          cohortName: resumeFailCohort.cohortName,
          status: 'MORE_INFO_REQUIRED',
          notesAppend: qualityGateNote,
        })
        applicationId = application.id

        await tx.providerApplicationDraft.update({
          where: { id: draft.id },
          data: { submittedApplicationId: applicationId },
        })
        await tx.providerIdentityVerification.update({
          where: { id: verificationId },
          data: { providerApplicationId: applicationId },
        })
      })
    } else if (channel === 'PWA_SELF_SERVE') {
      // PWA_SELF_SERVE: sync the Provider row first (gate-ON deferred creation),
      // then create the application with MORE_INFO_REQUIRED directly.
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

        const application = await createPwaApplicationInline(tx, {
          phone: payload.phone,
          name: payload.name,
          email: payload.email ?? null,
          skills: payload.skills,
          serviceAreas: payload.serviceAreas,
          availability: payload.availability,
          experience: payload.experience ?? null,
          evidenceNote: payload.evidenceNote ?? null,
          evidenceFileUrls: payload.evidenceFileUrls ?? [],
          callOutFee: payload.callOutFee ?? null,
          reference1Name: payload.reference1Name ?? null,
          reference1Mobile: payload.reference1Mobile ?? null,
          reference2Name: payload.reference2Name ?? null,
          reference2Mobile: payload.reference2Mobile ?? null,
          // Fix C: forward test-cohort computed above for syncProviderRecord
          isTestUser: failCohort.isTestUser,
          cohortName: failCohort.cohortName,
          providerId,
          status: 'MORE_INFO_REQUIRED',
          notesAppend: qualityGateNote,
        })
        applicationId = application.id

        await tx.providerApplicationDraft.update({
          where: { id: draft.id },
          data: { submittedApplicationId: applicationId },
        })
        await tx.providerIdentityVerification.update({
          where: { id: verificationId },
          data: { providerApplicationId: applicationId },
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
  { verificationId, reason = 'KYC needs manual review' }: { verificationId: string; reason?: string },
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

      const application = await createApplicationInline(tx, {
        submitApplicationArgs: { ...payload.submitApplicationArgs, providerId },
        providerId,
        status: 'MORE_INFO_REQUIRED',
        notesAppend: qualityGateNote,
        draft,
      })
      applicationId = application.id

      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: applicationId },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: applicationId },
      })
    })
  } else if (channel === 'PWA_RESUME') {
    const payload = rawPayload as unknown as Qgv2PwaResumeSubmitPayload

    await client.$transaction(async (tx) => {
      const manualCohort = createTestCohortContext(payload.phone)
      const application = await createPwaApplicationInline(tx, {
        phone: payload.phone,
        name: payload.name,
        idNumber: payload.idNumber ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        availability: payload.availability,
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
        ctwaReferral: payload.ctwaReferral ?? null,
        isTestUser: manualCohort.isTestUser,
        cohortName: manualCohort.cohortName,
        status: 'MORE_INFO_REQUIRED',
        notesAppend: qualityGateNote,
        draft,
      })
      applicationId = application.id

      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: applicationId },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: applicationId },
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

      const application = await createPwaApplicationInline(tx, {
        phone: payload.phone,
        name: payload.name,
        email: payload.email ?? null,
        skills: payload.skills,
        serviceAreas: payload.serviceAreas,
        availability: payload.availability,
        experience: payload.experience ?? null,
        evidenceNote: payload.evidenceNote ?? null,
        evidenceFileUrls: payload.evidenceFileUrls ?? [],
        callOutFee: payload.callOutFee ?? null,
        reference1Name: payload.reference1Name ?? null,
        reference1Mobile: payload.reference1Mobile ?? null,
        reference2Name: payload.reference2Name ?? null,
        reference2Mobile: payload.reference2Mobile ?? null,
        isTestUser: manualCohort.isTestUser,
        cohortName: manualCohort.cohortName,
        providerId,
        status: 'MORE_INFO_REQUIRED',
        notesAppend: qualityGateNote,
        draft,
      })
      applicationId = application.id

      await tx.providerApplicationDraft.update({
        where: { id: draft.id },
        data: { submittedApplicationId: applicationId },
      })
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { providerApplicationId: applicationId },
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
