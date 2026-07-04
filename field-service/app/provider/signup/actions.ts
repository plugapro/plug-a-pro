'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken, consumeProviderResumeToken } from '@/lib/provider-resume-tokens'
import { submitProviderApplication, type SubmitInput } from '@/lib/provider-applications-submit'
import { findLatestActiveProviderApplicationByPhone } from '@/lib/provider-applications'
import { buildDynamicSchema, selectMissingSections } from '@/lib/web-signup-sections'
import { isQualityGateV2Enabled, evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'
import { issueProviderApplicationVerificationLink } from '@/lib/identity-verification/application-link'

// ─── submitProviderApplicationFromWebAction ───────────────────────────────────

const SubmitSchema = z.object({
  rawToken: z.string().min(32),
  payload: z.record(z.string(), z.unknown()),
})

export async function submitProviderApplicationFromWebAction(
  input: z.infer<typeof SubmitSchema>,
): Promise<
  | { ok: true; applicationId: string }
  | { ok: true; awaitingVerification: true; verificationUrl: string | null }
> {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    throw new Error('feature_disabled')
  }

  const { rawToken, payload } = SubmitSchema.parse(input)

  // Resolve the gate flag once, outside the DB transaction, so the schema and
  // section selection both see the same value.
  const gateEnabled = await isQualityGateV2Enabled()
  const gateOpts = { gateEnabled }

  if (gateEnabled) {
    // Gate ON: validate token (without consuming it), run P1 guards (customer-phone,
    // existing-app), persist submitPayload onto the draft, issue a verification link,
    // and return awaitingVerification. Guards mirror the gate-OFF submit path so both
    // paths reject customer-owned phones and duplicate applicants identically.
    type GateOnTxResult =
      | { kind: 'ok'; draftId: string }
      | { kind: 'existing'; outcome: 'existing_pending' | 'existing_approved'; applicationId: string }

    const txResult = await db.$transaction(async (tx): Promise<GateOnTxResult> => {
      // 1. Validate the token (does not consume it).
      const v = await validateProviderResumeToken(tx, rawToken)
      if (!v.ok) throw new Error(`token_${v.reason}`)

      // 2. Load captured conversation data.
      const conv = await tx.conversation.findUniqueOrThrow({ where: { id: v.conversationId } })
      const capturedData = (conv.data as Record<string, unknown>) ?? {}
      if (!capturedData.idNumber && typeof capturedData.providerIdNumber === 'string') {
        capturedData.idNumber = capturedData.providerIdNumber
      }

      // 3. Build a dynamic Zod schema for any fields still missing from captured data.
      const sections = selectMissingSections(capturedData, gateOpts)
      const schema = buildDynamicSchema(sections, gateOpts)
      const parsed = schema.safeParse(payload)
      if (!parsed.success) {
        throw new Error('validation: ' + parsed.error.issues.map((i) => i.message).join('; '))
      }

      // 4. Merge captured + submitted data.
      const merged: Record<string, unknown> = { ...capturedData, ...parsed.data }

      // P1 guard: customer-phone rejection and existing-application short-circuit.
      // Token validation above gates these so enumeration risk is unchanged.
      // Uses conv.phone (the verified phone) identical to the gate-OFF submit path.
      const phone = conv.phone
      const phoneDigits = phone.replace(/\D/g, '')
      const phoneVariants = Array.from(new Set([
        phone,
        phoneDigits ? `+${phoneDigits}` : null,
        phoneDigits || null,
        phoneDigits.startsWith('27') ? `0${phoneDigits.slice(2)}` : null,
      ].filter(Boolean) as string[]))

      const existingCustomer = await tx.customer.findFirst({
        where: { phone: { in: phoneVariants } },
        select: { id: true },
      })
      if (existingCustomer) {
        throw new Error('PHONE_REGISTERED_AS_CUSTOMER')
      }

      // Existing active applications: return discriminated value so the tx commits
      // cleanly and the caller can surface the right error to the web client.
      const existingApp = await findLatestActiveProviderApplicationByPhone(tx as unknown as typeof import('@/lib/db').db, phone)
      if (existingApp?.status === 'APPROVED') {
        return { kind: 'existing', outcome: 'existing_approved', applicationId: existingApp.id }
      }
      if (existingApp?.status === 'PENDING' || existingApp?.status === 'MORE_INFO_REQUIRED') {
        return { kind: 'existing', outcome: 'existing_pending', applicationId: existingApp.id }
      }

      // Fix B: enforce evidence/cert gates before issuing a paid KYC session.
      const mergedEvidenceUrls = Array.isArray(merged.evidenceFileUrls) ? (merged.evidenceFileUrls as string[]) : []
      const mergedSkills = Array.isArray(merged.skills) ? (merged.skills as string[]) : []
      const mergedCertRef = typeof merged.certificationRef === 'string' ? merged.certificationRef : null
      const evidenceResult = evaluateEvidenceGate(mergedEvidenceUrls)
      if (!evidenceResult.ok) {
        throw new Error('QUALITY_GATE_EVIDENCE')
      }
      const certResult = evaluateCertificationGate(mergedSkills, Boolean(mergedCertRef))
      if (!certResult.ok) {
        throw new Error('QUALITY_GATE_CERTIFICATION')
      }

      // 4a. Persist merged form data back to Conversation.data.
      await tx.conversation.update({
        where: { id: conv.id },
        data: { data: merged as never },
      })

      // 5. Build the replayable submitPayload for the draft.
      const draftColumns = {
        phone: conv.phone,
        submitPayload: {
          version: 1 as const,
          channel: 'PWA_RESUME' as const,
          submittedAt: new Date().toISOString(),
          phone: conv.phone,
          name: String(merged.name ?? ''),
          idNumber: typeof merged.idNumber === 'string' ? merged.idNumber : null,
          skills: Array.isArray(merged.skills) ? (merged.skills as string[]) : [],
          serviceAreas: [String(merged.regionLabel ?? '')].filter(Boolean),
          availability: Array.isArray(merged.availability)
            ? (merged.availability as string[]).join(', ')
            : typeof merged.availability === 'string'
              ? merged.availability
              : '',
          experience: typeof merged.experience === 'string' ? merged.experience : null,
          evidenceNote: typeof merged.evidenceNote === 'string' ? merged.evidenceNote : null,
          evidenceFileUrls: Array.isArray(merged.evidenceFileUrls) ? (merged.evidenceFileUrls as string[]) : [],
          certificationRef: typeof merged.certificationRef === 'string' ? merged.certificationRef : null,
          hourlyRate: typeof merged.hourlyRate === 'number' ? merged.hourlyRate : null,
          ctwaReferral:
            capturedData.ctwaReferral && typeof capturedData.ctwaReferral === 'object'
              ? capturedData.ctwaReferral
              : null,
          // TODO: Prisma infers Json fields as `InputJsonValue` but the object
          // literal doesn't satisfy that structural type directly. Cast via
          // `unknown` until Prisma generates a stricter helper or we upgrade.
        } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      }

      // Upsert the draft (no unique on phone, so findFirst + update/create).
      const existingDraft = await tx.providerApplicationDraft.findFirst({
        where: { phone: conv.phone, submittedApplicationId: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })

      let resolvedDraftId: string
      if (existingDraft) {
        await tx.providerApplicationDraft.update({ where: { id: existingDraft.id }, data: draftColumns })
        resolvedDraftId = existingDraft.id
      } else {
        const created = await tx.providerApplicationDraft.create({ data: draftColumns, select: { id: true } })
        resolvedDraftId = created.id
      }

      // 6. Do NOT consume the token — verification must happen first.
      return { kind: 'ok' as const, draftId: resolvedDraftId }
    })

    // If an existing active application was found, throw so the web client sees an error.
    // The gate-OFF path's submitProviderApplication throws ProviderApplicationConflictError
    // for this case; here we use a named error string for the web action caller.
    if (txResult.kind === 'existing') {
      throw new Error(`APPLICATION_CONFLICT:${txResult.outcome}:${txResult.applicationId}`)
    }

    const draftId = txResult.draftId

    // Issue verification link outside the transaction (idempotent, uses db internally).
    let link: { verificationUrl: string | null }
    try {
      link = await issueProviderApplicationVerificationLink({
        providerApplicationDraftId: draftId,
        channel: 'PWA',
      })
    } catch (err) {
      console.error('[web-action] verification link issue failed (Didit unavailable, draft retained)', {
        draft_id: draftId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { ok: true as const, awaitingVerification: true as const, verificationUrl: null }
    }

    return { ok: true as const, awaitingVerification: true as const, verificationUrl: link.verificationUrl }
  }

  return db.$transaction(async (tx) => {
    // 1. Validate the token (does not consume it yet).
    const v = await validateProviderResumeToken(tx, rawToken)
    if (!v.ok) throw new Error(`token_${v.reason}`)

    // 2. Load captured conversation data.
    const conv = await tx.conversation.findUniqueOrThrow({ where: { id: v.conversationId } })
    const capturedData = (conv.data as Record<string, unknown>) ?? {}
    // Backfill canonical key from WhatsApp's variant before computing sections (I1)
    if (!capturedData.idNumber && typeof capturedData.providerIdNumber === 'string') {
      capturedData.idNumber = capturedData.providerIdNumber
    }

    // 3. Build a dynamic Zod schema for any fields still missing from captured data.
    const sections = selectMissingSections(capturedData, gateOpts)
    const schema = buildDynamicSchema(sections, gateOpts)
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      throw new Error('validation: ' + parsed.error.issues.map((i) => i.message).join('; '))
    }

    // 4. Merge captured + submitted data.
    const merged: Record<string, unknown> = { ...capturedData, ...parsed.data }

    // 4a. Persist merged form data back to Conversation.data so the approval
    // flow (syncProviderRecord) picks up all fields, including those the
    // helper doesn't accept (e.g. bio, references, profilePhotoUrl).
    await tx.conversation.update({
      where: { id: conv.id },
      data: { data: merged as never },
    })

    // 5. Build SubmitInput — only pass fields the web flow knows about.
    const submitInput: SubmitInput = {
      phone: conv.phone,
      name: String(merged.name ?? ''),
      idNumber: typeof merged.idNumber === 'string' ? merged.idNumber : undefined,
      skills: Array.isArray(merged.skills) ? (merged.skills as string[]) : [],
      serviceAreas: [String(merged.regionLabel ?? '')].filter(Boolean),
      availability: Array.isArray(merged.availability)
        ? (merged.availability as string[])
        : typeof merged.availability === 'string'
          ? merged.availability
          : [],
      experience: typeof merged.experience === 'string' ? merged.experience : undefined,
      evidenceNote: typeof merged.evidenceNote === 'string' ? merged.evidenceNote : undefined,
      hourlyRate: typeof merged.hourlyRate === 'number' ? merged.hourlyRate : undefined,
      evidenceFileUrls: Array.isArray(merged.evidenceFileUrls)
        ? (merged.evidenceFileUrls as string[])
        : [],
      certificationRef: typeof merged.certificationRef === 'string' ? merged.certificationRef : undefined,
      // CTWA ad attribution — written by the bot on the first inbound message
      // (ConversationData.ctwaReferral); not user-editable, so read from
      // capturedData rather than merged payload.
      ctwaReferral:
        capturedData.ctwaReferral && typeof capturedData.ctwaReferral === 'object'
          ? (capturedData.ctwaReferral as SubmitInput['ctwaReferral'])
          : null,
    }

    // 6. Atomically consume the token.
    const consumed = await consumeProviderResumeToken(tx, v.tokenId)
    if (!consumed) throw new Error('token_used')

    // 7. Create the ProviderApplication and advance the conversation step.
    const { application } = await submitProviderApplication(tx, submitInput, {
      source: 'web',
      conversationId: conv.id,
    })

    revalidatePath('/admin/applications')
    return { ok: true as const, applicationId: application.id }
  })
}

// ─── updateCapturedFieldAction ────────────────────────────────────────────────

const UpdateSchema = z.object({
  rawToken: z.string().min(32),
  field: z.string().min(1),
  value: z.unknown(),
})

// I3: Allowlist — token holders may only write these fields to Conversation.data.
const ALLOWED_FIELDS = new Set([
  'name', 'idNumber', 'skills', 'regionLabel', 'cityLabel', 'availability',
  'hourlyRate', 'profilePhotoUrl', 'bio', 'references', 'evidenceFileUrls', 'certificationRef',
])

export async function updateCapturedFieldAction(
  input: z.infer<typeof UpdateSchema>,
): Promise<{ ok: true }> {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    throw new Error('feature_disabled')
  }

  const { rawToken, field, value } = UpdateSchema.parse(input)

  // I3: Reject writes to fields not on the allowlist.
  if (!ALLOWED_FIELDS.has(field)) throw new Error('field_not_allowed')

  // I2: Wrap in a transaction to eliminate the TOCTOU race between
  // read-existing-data and write-merged-data.
  return db.$transaction(async (tx) => {
    // Validate the token without consuming it — the edit affordance must not burn
    // the token; submission will do that.
    const v = await validateProviderResumeToken(tx, rawToken)
    if (!v.ok) throw new Error(`token_${v.reason}`)

    const conv = await tx.conversation.findUniqueOrThrow({ where: { id: v.conversationId } })
    const existing = (conv.data as Record<string, unknown>) ?? {}

    await tx.conversation.update({
      where: { id: v.conversationId },
      data: { data: { ...existing, [field]: value } as never },
    })

    return { ok: true as const }
  })
}
