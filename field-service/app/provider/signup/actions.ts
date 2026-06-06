'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken, consumeProviderResumeToken } from '@/lib/provider-resume-tokens'
import { submitProviderApplication, type SubmitInput } from '@/lib/provider-applications-submit'
import { buildDynamicSchema, selectMissingSections } from '@/lib/web-signup-sections'

// ─── submitProviderApplicationFromWebAction ───────────────────────────────────

const SubmitSchema = z.object({
  rawToken: z.string().min(32),
  payload: z.record(z.string(), z.unknown()),
})

export async function submitProviderApplicationFromWebAction(
  input: z.infer<typeof SubmitSchema>,
): Promise<{ ok: true; applicationId: string }> {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    throw new Error('feature_disabled')
  }

  const { rawToken, payload } = SubmitSchema.parse(input)

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
    const sections = selectMissingSections(capturedData)
    const schema = buildDynamicSchema(sections)
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
  'hourlyRate', 'profilePhotoUrl', 'bio', 'references', 'evidenceFileUrls',
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
