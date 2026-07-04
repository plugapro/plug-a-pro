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
function appendQualityGateNote(existing: string | null): string {
  const marker = '[quality-gate]'
  const line = `${marker} KYC failed at application`
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

// ─── Internal: create ProviderApplication inline (bypasses quality gate re-check) ─

async function createApplicationInline(
  tx: Prisma.TransactionClient,
  args: {
    submitApplicationArgs: Qgv2WhatsappSubmitPayload['submitApplicationArgs']
    providerId: string
    status: 'PENDING' | 'MORE_INFO_REQUIRED'
    notesAppend: string | null
  },
) {
  const a = args.submitApplicationArgs
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

// ─── Internal: create provider categories in tx ───────────────────────────────

async function createProviderCategoryRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type not exported
  tx: any,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type not exported
  tx: any,
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

  if (channel === 'PWA_SELF_SERVE' || channel === 'PWA_RESUME') {
    // TODO(Task 2.6): PWA channel replay not yet implemented
    throw new Error('PWA channel replay not yet implemented (Task 2.6 concern)')
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
    })
    applicationId = application.id

    // c. Create provider category rows
    await createProviderCategoryRows(tx, providerId, payload)

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

  // 2. Count all FAILED verifications for this draft (includes the current one
  //    since applyVendorVerdict was already called before this function)
  const failCount = await client.providerIdentityVerification.count({
    where: {
      providerApplicationDraftId: verification.providerApplicationDraftId,
      status: 'FAILED',
    },
  })

  const draft = await client.providerApplicationDraft.findUniqueOrThrow({
    where: { id: verification.providerApplicationDraftId },
    select: { id: true, submittedApplicationId: true, submitPayload: true, phone: true },
  })

  if (failCount >= 2) {
    // 3. 2nd+ failure: create MORE_INFO_REQUIRED application
    if (draft.submittedApplicationId) {
      // Already submitted from a prior PASS or prior failure path — skip
      return
    }

    const rawPayload = draft.submitPayload as Record<string, unknown>
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('ProviderApplicationDraft.submitPayload is missing or not an object')
    }
    if ((rawPayload.channel as string) !== 'WHATSAPP') {
      throw new Error('Non-WHATSAPP channel not yet implemented for failure path (Task 2.6 concern)')
    }

    const payload = rawPayload as unknown as Qgv2WhatsappSubmitPayload
    let applicationId: string

    await client.$transaction(async (tx) => {
      // Sync provider record (returns id string)
      const providerId = await syncProviderRecord(tx as unknown as typeof db, {
        ...payload.syncProviderArgs,
        skipEnrichment: true,
      })

      // Create application with MORE_INFO_REQUIRED
      const qualityGateNote = appendQualityGateNote(null)
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

    console.info('[quality-gate-submission] 2nd+ KYC failure — created MORE_INFO_REQUIRED application', {
      verificationId,
      applicationId: applicationId!,
      draftId: draft.id,
      failCount,
    })
  } else {
    // 4. 1st failure: re-issue the verification link so the applicant can retry
    try {
      await issueProviderApplicationVerificationLink({
        providerApplicationDraftId: draft.id,
        channel: 'WHATSAPP',
      })

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
    } catch (err) {
      console.warn('[quality-gate-submission] 1st failure retry link/message failed (non-fatal)', {
        verificationId,
        draftId: draft.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
