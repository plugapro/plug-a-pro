// ─── Service provider registration flow via WhatsApp ──────────────────────────
// Journey: trigger → name → skills (multi-select) → area → experience → availability → submit → pending review
// No direct connection given to customer — all mediated through Plug A Pro

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { WHATSAPP_COPY, ctaLabelFor } from '../whatsapp-copy'
import { downloadAndStoreWhatsAppMedia } from '../whatsapp-media'
import { sendWhatsAppJourneyRecovery } from '../journey-recovery'
import { db } from '../db'
import { syncProviderRecord, upsertStructuredServiceAreas } from '../provider-record'
import { syncProviderSkills } from '../provider-skills'
import { checkJobsForNewProviderAvailability } from '../matching/customer-recontact'
import { normalizePhone } from '../utils'
import { phoneLookupVariants } from '../whatsapp-identity'
import { findLatestActiveProviderApplicationByPhone } from '../provider-applications'
import { createTestCohortContext } from '../internal-test-cohort'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from '../location-format'
import {
  formatRandAmountForProviderOnboarding,
  validateProviderOnboardingRates,
  ProviderOnboardingValidationError,
} from '../provider-onboarding-data'
import {
  PROVIDER_APPLY_BUTTON_TITLE,
  PROVIDER_NOT_NOW_BUTTON_TITLE,
  buildProviderApplicationSubmittedMessage,
  buildProviderOnboardingIntroMessage,
  getProviderTermsUrl,
} from '../provider-credit-copy'
import {
  SERVICE_CATEGORY_OPTIONS,
  resolveServiceCategoryTag,
} from '../service-categories'
import {
  ACTIVE_PILOT_CITY_LABEL,
  ACTIVE_PILOT_REGION_LABEL,
  describeCityServiceStatus,
  describeRegionServiceStatus,
  getRegionServiceStatus,
  type ServiceAreaStatus,
} from '../service-area-guard'
import type { FlowContext, FlowResult } from './types'

// ─── Trigger keywords that start the registration flow ────────────────────────
export const REGISTRATION_TRIGGERS = [
  'register', 'join', 'technician', 'provider', 'apply', 'signup', 'sign up',
  'i want to work', 'want to work', 'looking for work', 'find work',
  'i want work', 'need work', 'find a job', 'get work',
  'ek wil werk',        // Afrikaans: "I want to work"
  'ngifuna ukusebenza', // Zulu: "I want to work"
]

// ─── Provider skill options (all categories except 'other', which is client-side) ─
// 'other' lets clients describe unusual jobs, but providers select real skill tags.
const PROVIDER_SKILL_OPTIONS = SERVICE_CATEGORY_OPTIONS.filter(o => o.tag !== 'other')
const MAX_EVIDENCE_FILES = 5

type ProviderApplicationSubmitErrorCode =
  | 'PROVIDER_APPLICATION_VALIDATION_FAILED'
  | 'PROVIDER_APPLICATION_ALREADY_EXISTS'
  | 'PROVIDER_APPLICATION_FILES_MISSING'
  | 'PROVIDER_APPLICATION_ATTACHMENTS_NOT_READY'
  | 'PROVIDER_APPLICATION_FILE_LINK_FAILED'
  | 'PROVIDER_APPLICATION_SKILLS_INVALID'
  | 'PROVIDER_APPLICATION_AREAS_INVALID'
  | 'PROVIDER_APPLICATION_AVAILABILITY_INVALID'
  | 'PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED'
  | 'PROVIDER_APPLICATION_SUBMIT_FAILED'
  | 'PROVIDER_APPLICATION_UNKNOWN_ERROR'

class ProviderApplicationSubmitError extends Error {
  constructor(
    public readonly code: ProviderApplicationSubmitErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ProviderApplicationSubmitError'
  }
}

type ProviderApplicationSubmitResult =
  | { outcome: 'created'; applicationId: string; providerId: string; ref: string }
  | { outcome: 'existing_pending'; applicationId: string; ref: string }
  | { outcome: 'existing_approved'; applicationId: string; ref: string }

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function createSubmitTraceId() {
  return `provider_app_submit_${crypto.randomUUID().slice(0, 12)}`
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function errorCodeFromUnknown(error: unknown): ProviderApplicationSubmitErrorCode {
  if (error instanceof ProviderApplicationSubmitError) return error.code
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('P')
  ) {
    return 'PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED'
  }
  return 'PROVIDER_APPLICATION_UNKNOWN_ERROR'
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function validateSubmitData(ctx: FlowContext) {
  const name = ctx.data.name?.trim()
  const skills = uniqueStrings(ctx.data.skills ?? [])
  const invalidSkills = skills.filter((skill) => !resolveServiceCategoryTag(skill))
  const locationNodeIds = uniqueStrings(ctx.data.locationNodeIds ?? [])
  const serviceAreas = uniqueStrings(ctx.data.serviceAreas ?? [])
  const selectedSuburbLabels = uniqueStrings(ctx.data.selectedSuburbLabels ?? [])
  const selectedRegionLabels = uniqueStrings(ctx.data.selectedRegionLabels ?? [])
  const availability = uniqueStrings(ctx.data.availability ?? [])
  const evidenceAttachmentIds = uniqueStrings(ctx.data.evidenceFileUrls ?? []).slice(0, MAX_EVIDENCE_FILES)
  const idNumber = ctx.data.providerIdNumber?.trim()

  if (!name || name.length < 2) {
    throw new ProviderApplicationSubmitError(
      'PROVIDER_APPLICATION_VALIDATION_FAILED',
      'Provider application requires a valid name.',
      { missingField: 'name' },
    )
  }

  if (skills.length === 0) {
    throw new ProviderApplicationSubmitError(
      'PROVIDER_APPLICATION_SKILLS_INVALID',
      'Provider application requires at least one valid skill.',
      { selectedSkillsCount: 0 },
    )
  }

  if (invalidSkills.length > 0) {
    throw new ProviderApplicationSubmitError(
      'PROVIDER_APPLICATION_SKILLS_INVALID',
      'Provider application contains unsupported skills.',
      { invalidSkills },
    )
  }

  if (
    locationNodeIds.length === 0 &&
    serviceAreas.length === 0 &&
    selectedSuburbLabels.length === 0 &&
    selectedRegionLabels.length === 0
  ) {
    throw new ProviderApplicationSubmitError(
      'PROVIDER_APPLICATION_AREAS_INVALID',
      'Provider application requires at least one service area.',
      { selectedAreasCount: 0 },
    )
  }

  if (availability.length === 0) {
    throw new ProviderApplicationSubmitError(
      'PROVIDER_APPLICATION_AVAILABILITY_INVALID',
      'Provider application requires availability.',
      { selectedAvailabilityCount: 0 },
    )
  }

  return {
    name,
    skills,
    availability,
    evidenceAttachmentIds,
    idNumber: idNumber || undefined,
    resolvedAreaLabels: normaliseLocationDisplayNames(locationNodeIds.length > 0
      ? (selectedSuburbLabels.length ? selectedSuburbLabels : selectedRegionLabels.length ? selectedRegionLabels : serviceAreas)
      : serviceAreas),
    locationNodeIds,
  }
}

function verificationStatusLabel(data: Partial<{ providerIdNumber?: string; verificationMethod?: string; verificationDocAttachmentId?: string }>): string {
  if (data.providerIdNumber) return 'ID/passport provided'
  if (data.verificationDocAttachmentId) return 'Document uploaded'
  if (data.verificationMethod === 'skipped') return 'Skipped (optional)'
  return 'Not provided (optional)'
}

function formatAvailabilityLabel(availability: string[] | undefined) {
  return (availability?.length ?? 0) >= 7 ? 'Any day'
    : (availability?.length ?? 0) >= 6 ? 'Mon–Sat'
    : 'Weekdays only'
}

function yearsExperienceFromLabel(label: string | undefined) {
  if (!label) return null
  if (label.includes('Less')) return 0
  if (label.includes('1–3')) return 2
  if (label.includes('3–5')) return 4
  if (label.includes('5+')) return 5
  return null
}

function skillLevelFromExperienceLabel(label: string | undefined) {
  if (!label) return null
  if (label.includes('Less')) return 'BEGINNER'
  if (label.includes('1–3')) return 'INTERMEDIATE'
  return 'EXPERIENCED'
}

async function sendEvidenceFileProgress(phone: string, count: number) {
  // Debounce across Vercel function instances. Each media event claims a seq
  // and waits; if a newer event arrives during the wait, this caller exits
  // silently and the newer one sends the consolidated message. Default
  // window is 2.5s, override via WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS.
  const { debounceMediaBatch, readMediaBatchSeq } = await import('../whatsapp-media-batch')
  const { isLatest, mySeq } = await debounceMediaBatch({
    phone,
    scope: 'provider_evidence',
  })
  if (!isLatest) {
    const currentSeq = await readMediaBatchSeq(phone, 'provider_evidence')
    console.info('[registration:sendEvidenceFileProgress] superseded — newer media event in batch', {
      phone,
      mySeq,
      currentSeq,
      countObservedAtClaim: count,
    })
    return
  }

  // Re-read the freshest count from the conversation record so the message
  // reflects the settled total (not just what this invocation observed at
  // claim time).
  const fresh = await db.conversation.findUnique({
    where: { phone },
    select: { data: true },
  })
  const freshUrls = ((fresh?.data as { evidenceFileUrls?: unknown[] } | null)?.evidenceFileUrls ?? []) as unknown[]
  const settledCount = Math.max(count, Math.min(freshUrls.length, MAX_EVIDENCE_FILES))
  const remaining = MAX_EVIDENCE_FILES - settledCount

  if (remaining <= 0) {
    await sendButtons(
      phone,
      `✅ *${MAX_EVIDENCE_FILES} files received.* Maximum reached.\n\nContinue to the next step?`,
      [{ id: 'evidence_done', title: '✅ Continue' }]
    )
    return
  }

  await sendButtons(
    phone,
    `✅ *${settledCount} file${settledCount === 1 ? '' : 's'} received.* You can add up to ${remaining} more, or continue.`,
    [
      { id: 'evidence_done', title: '✅ Continue' },
      { id: 'evidence_add_more', title: '📎 Add another file' },
    ]
  )
}

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleRegistrationFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'reg_start':
      return startRegistration(ctx)
    case 'reg_collect_name':
      return handleCollectName(ctx)
    case 'reg_collect_email':
      return handleMigratedEmailStep(ctx)
    case 'reg_collect_id':
      return handleCollectId(ctx)
    case 'reg_verify_enter_id':
      return handleVerifyEnterId(ctx)
    case 'reg_verify_upload_doc':
      return handleVerifyUploadDoc(ctx)
    case 'reg_verify_upload_selfie':
      return handleVerifyUploadSelfie(ctx)
    case 'reg_collect_skills':
      return handleCollectSkills(ctx)
    case 'reg_collect_skills_more':
      return handleCollectSkillsMore(ctx)
    case 'reg_collect_area':
      return handleCollectArea(ctx)
    case 'reg_collect_experience':
      return handleCollectExperience(ctx)
    case 'reg_collect_city':
      return handleCollectCity(ctx)
    case 'reg_collect_region':
      return handleCollectRegion(ctx)
    case 'reg_collect_region_more':
      return handleCollectRegionMore(ctx)
    case 'reg_collect_hourly_rate':
      return handleCollectHourlyRate(ctx)
    case 'reg_collect_profile_photo':
      return handleCollectProfilePhoto(ctx)
    case 'reg_collect_bio':
      return handleCollectBio(ctx)
    case 'reg_collect_suburb_select':
      return handleCollectSuburbSelect(ctx)
    case 'reg_collect_suburb_text':
      return handleCollectSuburbText(ctx)
    case 'reg_collect_availability':
      return handleCollectAvailability(ctx)
    case 'reg_collect_rates':
      return handleCollectRates(ctx)
    case 'reg_collect_evidence':
      return handleCollectEvidence(ctx)
    case 'reg_confirm':
      return handleConfirm(ctx)
    case 'reg_pending':
      return handlePending(ctx)
    case 'reg_edit_field':
      return handleEditField(ctx)
    default:
      return startRegistration(ctx)
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function startRegistration(ctx: FlowContext): Promise<FlowResult> {
  // A known provider should never be sent through duplicate registration.
  const phoneVariants = phoneLookupVariants(ctx.phone)

  const existingProvider = await (db as any).provider?.findFirst?.({
    where: { phone: { in: phoneVariants } },
    select: { id: true, name: true, status: true, active: true, availableNow: true },
  }) ?? null

  if (existingProvider) {
    const inactive =
      !existingProvider.active ||
      ['SUSPENDED', 'ARCHIVED', 'BANNED'].includes(existingProvider.status)
    await sendButtons(
      ctx.phone,
      inactive
        ? `👷 Hi ${existingProvider.name}, your provider profile is currently inactive.\n\nYou won't receive new job leads until this is resolved.`
        : `✅ Hi ${existingProvider.name}, you're already registered as a Plug A Pro provider.\n\nWhat would you like to manage?`,
      inactive
        ? [
            { id: 'provider_status', title: 'Provider Status' },
            { id: 'provider_support', title: 'Support' },
          ]
        : [
            { id: 'provider_my_jobs', title: 'My Jobs' },
            { id: 'provider_availability', title: 'Availability' },
            { id: 'back_home', title: 'Main Menu' },
          ],
    )
    return { nextStep: inactive ? 'pj_provider_status' : 'pj_toggle_available' }
  }

  const existingCustomer = await db.customer.findFirst({
    where: { phone: { in: phoneVariants } },
    select: { id: true },
  })
  if (existingCustomer) {
    await sendText(
      ctx.phone,
      `⚠️ *Provider registration unavailable*\n\nThis number is already registered as a customer on Plug A Pro.\n\nTo join as a service provider, please use a *different phone number* and restart with *join*.`
    )
    return { nextStep: 'done' }
  }

  // Existing active applications own the provider identity for this phone number.
  const existing = await findLatestActiveProviderApplicationByPhone(db, ctx.phone)

  if (existing?.status === 'APPROVED') {
    await sendButtons(
      ctx.phone,
      "✅ You're already registered as a Plug A Pro worker! You'll receive job leads through this number.\n\nWhat would you like to do?",
      [
        { id: 'pj_view_jobs', title: '📋 My Jobs' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  if (existing?.status === 'PENDING') {
    await sendText(
      ctx.phone,
      `⏳ Your provider profile is already on file.\n\nRef: *${existing.id.slice(-8).toUpperCase()}*\n\nReply *jobs* to check leads or *menu* to return to the main menu.`
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    buildProviderOnboardingIntroMessage(),
    [
      { id: 'reg_start', title: PROVIDER_APPLY_BUTTON_TITLE },
      { id: 'reg_cancel', title: PROVIDER_NOT_NOW_BUTTON_TITLE },
    ]
  )
  // Follow-up CTA so the terms URL is exposed via a labelled button rather than
  // raw text in the body. The intro message body intentionally has no URL.
  try {
    await sendCtaUrl(
      ctx.phone,
      'Provider terms and credit rules.',
      ctaLabelFor('credit_policy'),
      getProviderTermsUrl(),
      undefined,
      { templateName: 'interactive:provider_onboarding_terms_cta' },
    )
  } catch (error) {
    console.warn('[registration-flow] terms CTA follow-up failed (intro)', { error })
  }
  return { nextStep: 'reg_collect_name' }
}

async function handleCollectName(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'reg_cancel') {
    console.info('[registration-flow] provider application cancelled at intro', {
      normalized_phone: normalizePhone(ctx.phone),
    })
    await sendText(ctx.phone, "No problem! Reply *join* anytime when you're ready to apply.")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'reg_start' || ctx.step === 'reg_collect_name') {
    await sendText(ctx.phone, '👤 What is your *full name*?\n\n_(Type and send your name)_')
    return { nextStep: 'reg_collect_skills' }
  }

  return { nextStep: 'reg_collect_name' }
}

async function handleCollectSkills(ctx: FlowContext): Promise<FlowResult> {
  const name = ctx.reply.text
  if (!name || name.length < 2) {
    await sendText(ctx.phone, 'Please type your full name (at least 2 characters).')
    return { nextStep: 'reg_collect_skills' }
  }

  // If provider already answered the verification step (name edit path), skip re-prompting.
  if (ctx.data.verificationMethod || ctx.data.providerIdNumber || ctx.data.verificationDocAttachmentId) {
    await sendText(ctx.phone, buildSkillPromptText(`👤 Name updated to *${name}*.\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { name } }
  }

  await sendVerificationChoicePrompt(ctx.phone)
  return { nextStep: 'reg_collect_id', nextData: { name } }
}

// Handles providers whose conversation is still on 'reg_collect_email' from before
// the email step was removed from the onboarding flow. Whatever they reply, we
// accept it and advance to the optional verification prompt. A well-formed email
// is saved as optional profile enrichment; any other reply continues without it.
async function handleMigratedEmailStep(ctx: FlowContext): Promise<FlowResult> {
  const raw = ctx.reply.text?.trim() ?? ''
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
  await sendVerificationChoicePrompt(ctx.phone)
  return {
    nextStep: 'reg_collect_id',
    nextData: isValidEmail ? { providerEmail: raw.toLowerCase() } : {},
  }
}

async function sendVerificationChoicePrompt(phone: string) {
  await sendButtons(
    phone,
    [
      '🪪 *Verify your identity (optional)*',
      '',
      'Providing ID helps us review your application faster. Your details are never shared with customers.',
      '',
      'Choose how to verify, or skip and apply without it:',
    ].join('\n'),
    [
      { id: 'verify_enter_id', title: 'Enter ID/passport' },
      { id: 'verify_upload_doc', title: 'Upload document' },
      { id: 'verify_skip', title: 'Skip for now' },
    ],
  )
}

// Standard Luhn check (rightmost digit = position 1, not doubled).
function luhnCheck(num: string): boolean {
  let sum = 0
  let doubleDigit = false
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = parseInt(num[i], 10)
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

function validateSaId(raw: string): string | null {
  const digits = raw.replace(/\s+/g, '')
  if (!/^\d{13}$/.test(digits)) return null
  const mm = parseInt(digits.slice(2, 4), 10)
  const dd = parseInt(digits.slice(4, 6), 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  if (!luhnCheck(digits)) return null
  return digits
}

function validatePassportNumber(raw: string): string | null {
  const trimmed = raw.trim()
  // Reject if the input contains spaces — passport numbers never have spaces
  if (/\s/.test(trimmed)) return null
  // Passport: 6–30 alphanumeric, must contain at least one letter (not all digits)
  if (trimmed.length >= 6 && trimmed.length <= 30 && /^[a-z0-9]+$/i.test(trimmed) && /[a-z]/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  return null
}

// Migration handler for in-progress users still on the old mandatory ID step.
// Accepts a typed ID/passport number for backward compatibility; shows the
// optional verification prompt for any other reply.
async function handleCollectId(ctx: FlowContext): Promise<FlowResult> {
  // Handle button replies from the optional verification prompt or from error re-prompts.
  if (ctx.reply.id === 'verify_enter_id') {
    await sendText(ctx.phone, '🪪 Please send your *SA ID number* (13 digits) or *passport number*.\n\nType *skip* at any time to continue without verifying.')
    return { nextStep: 'reg_verify_enter_id' }
  }

  if (ctx.reply.id === 'verify_upload_doc') {
    await sendText(ctx.phone, '📄 Please send a *photo of your ID document* (SA ID card or passport).')
    return { nextStep: 'reg_verify_upload_doc' }
  }

  if (ctx.reply.id === 'verify_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    await sendText(ctx.phone, 'No problem. You can verify your identity later from the Worker Portal.')
    await sendText(ctx.phone, buildSkillPromptText(`Now let's set up your profile, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { verificationMethod: 'skipped', skills: [] } }
  }

  // Backward compat: a user who types a plausible ID number goes through directly.
  const raw = ctx.reply.text?.trim() ?? ''
  const saId = validateSaId(raw)
  if (saId) {
    await sendText(ctx.phone, buildSkillPromptText(`Thanks, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { providerIdNumber: saId, verificationMethod: 'id_number', skills: [] } }
  }
  const passport = validatePassportNumber(raw)
  if (passport) {
    await sendText(ctx.phone, buildSkillPromptText(`Thanks, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { providerIdNumber: passport, verificationMethod: 'id_number', skills: [] } }
  }

  // Any other input (including old 6-char alphanumeric IDs in flight) — re-show the choice.
  await sendVerificationChoicePrompt(ctx.phone)
  return { nextStep: 'reg_collect_id' }
}

async function handleVerifyEnterId(ctx: FlowContext): Promise<FlowResult> {
  // Button or text "skip" — escape hatch so users with unusual IDs are never trapped.
  if (ctx.reply.id === 'verify_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    await sendText(ctx.phone, 'No problem. You can verify your identity later from the Worker Portal.')
    await sendText(ctx.phone, buildSkillPromptText(`🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { verificationMethod: 'skipped', skills: [] } }
  }

  const raw = ctx.reply.text?.trim() ?? ''

  // Try 13-digit SA ID with Luhn validation first.
  const noSpace = raw.replace(/\s+/g, '')
  if (/^\d{13}$/.test(noSpace)) {
    const saId = validateSaId(noSpace)
    if (!saId) {
      await sendButtons(
        ctx.phone,
        "❌ That SA ID number didn't pass the checksum check. Please check and try again, or send your passport number instead.",
        [{ id: 'verify_skip', title: 'Skip verification' }],
      )
      return { nextStep: 'reg_verify_enter_id' }
    }
    await sendText(ctx.phone, buildSkillPromptText(`✅ ID verified.\n\nThanks, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { providerIdNumber: saId, verificationMethod: 'id_number', skills: [] } }
  }

  // Passport number: 6–30 alphanumeric, must not be all digits.
  const passport = validatePassportNumber(raw)
  if (passport) {
    await sendText(ctx.phone, buildSkillPromptText(`✅ Passport number saved.\n\nThanks, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { providerIdNumber: passport, verificationMethod: 'id_number', skills: [] } }
  }

  await sendButtons(
    ctx.phone,
    '❌ Please send a valid *SA ID number* (13 digits) or *passport number* (6–30 alphanumeric characters). Or tap below to skip.',
    [{ id: 'verify_skip', title: 'Skip verification' }],
  )
  return { nextStep: 'reg_verify_enter_id' }
}

async function handleVerifyUploadDoc(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'verify_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    await sendText(ctx.phone, 'Skipping document upload. You can verify your identity later from the Worker Portal.')
    await sendText(ctx.phone, buildSkillPromptText(`🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { verificationMethod: 'skipped', skills: [] } }
  }

  if (ctx.reply.type === 'image' || ctx.reply.type === 'document') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, "⚠️ Couldn't read that file. Please try again.")
      return { nextStep: 'reg_verify_upload_doc' }
    }
    try {
      const { PROVIDER_ID_DOCUMENT_LABEL } = await import('../provider-attachment-labels')
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        label: PROVIDER_ID_DOCUMENT_LABEL,
      })
      console.info('[registration:handleVerifyUploadDoc] ID document saved', {
        phone: ctx.phone,
        mediaIdSuffix: ctx.reply.mediaId.slice(-8),
        attachmentId,
      })
      await sendText(ctx.phone, '✅ Document received.\n\n🤳 Now please send a *selfie holding your ID document* so we can match your face to it.')
      return {
        nextStep: 'reg_verify_upload_selfie',
        nextData: { verificationDocAttachmentId: attachmentId, verificationDocMediaId: ctx.reply.mediaId },
      }
    } catch (err) {
      console.error('[registration:handleVerifyUploadDoc] media upload failed', { phone: ctx.phone, err })
      await sendWhatsAppJourneyRecovery(ctx.phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: ctx.flow,
        currentStep: ctx.step,
        failureType: 'storage_failure',
        recoveryClass: 'retry_same_step',
        error: err,
      })
      return { nextStep: 'reg_verify_upload_doc' }
    }
  }

  await sendButtons(
    ctx.phone,
    '📄 Please send a *photo of your ID document* (SA ID card or passport).',
    [{ id: 'verify_skip', title: 'Skip for now' }],
  )
  return { nextStep: 'reg_verify_upload_doc' }
}

async function handleVerifyUploadSelfie(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'verify_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    await sendText(ctx.phone, 'Skipping selfie. You can complete verification later from the Worker Portal.')
    await sendText(ctx.phone, buildSkillPromptText(`🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { verificationMethod: 'documents', skills: [] } }
  }

  if (ctx.reply.type === 'image') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, "⚠️ Couldn't read that photo. Please try again.")
      return { nextStep: 'reg_verify_upload_selfie' }
    }
    try {
      const { PROVIDER_ID_SELFIE_LABEL } = await import('../provider-attachment-labels')
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        label: PROVIDER_ID_SELFIE_LABEL,
      })
      console.info('[registration:handleVerifyUploadSelfie] ID selfie saved', {
        phone: ctx.phone,
        mediaIdSuffix: ctx.reply.mediaId.slice(-8),
        attachmentId,
      })
      await sendText(ctx.phone, buildSkillPromptText(`✅ Selfie received. Identity documents uploaded.\n\nThanks, *${ctx.data.name ?? 'there'}*. 👋\n\n🔧 *What type of work do you do?*`))
      return {
        nextStep: 'reg_collect_skills_more',
        nextData: {
          verificationSelfieAttachmentId: attachmentId,
          verificationSelfieMediaId: ctx.reply.mediaId,
          verificationMethod: 'documents',
          skills: [],
        },
      }
    } catch (err) {
      console.error('[registration:handleVerifyUploadSelfie] media upload failed', { phone: ctx.phone, err })
      await sendWhatsAppJourneyRecovery(ctx.phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: ctx.flow,
        currentStep: ctx.step,
        failureType: 'storage_failure',
        recoveryClass: 'retry_same_step',
        error: err,
      })
      return { nextStep: 'reg_verify_upload_selfie' }
    }
  }

  await sendButtons(
    ctx.phone,
    '🤳 Please send a *selfie holding your ID document*.',
    [{ id: 'verify_skip', title: 'Skip selfie' }],
  )
  return { nextStep: 'reg_verify_upload_selfie' }
}

async function handleCollectSkillsMore(ctx: FlowContext): Promise<FlowResult> {
  const existingSkills: string[] = ctx.data.skills ?? []

  // ── Button replies (from confirmation screen) ──────────────────────────────

  if (ctx.reply.id === 'skills_confirm') {
    if (existingSkills.length === 0) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please choose at least one skill first.*'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
    }
    return promptArea(ctx)
  }

  if (ctx.reply.id === 'skills_change' || ctx.reply.id === 'edit_skills') {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  // ── Text reply ─────────────────────────────────────────────────────────────

  const raw = ctx.reply.text?.trim() ?? ''

  if (/^done$/i.test(raw)) {
    if (existingSkills.length === 0) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please choose at least one skill first.*'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
    }
    return promptArea(ctx)
  }

  if (/^change(\s+skills?)?$/i.test(raw)) {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  // ── Parse number input ─────────────────────────────────────────────────────

  const indices = parseNumberedInput(raw)

  // No numbers found — try label matching as fallback.
  // 1. Try the full raw phrase first (handles "pest control", "air conditioning", etc.)
  // 2. If no full-phrase match, split into tokens (handles "plumbing electrical")
  let labelMatched: string[] = []
  if (indices.length === 0 && raw.length > 0) {
    const fullTag = resolveServiceCategoryTag(raw)
    if (fullTag && fullTag !== 'other') {
      const opt = PROVIDER_SKILL_OPTIONS.find(o => o.tag === fullTag)
      if (opt && !existingSkills.includes(opt.label)) labelMatched.push(opt.label)
    } else {
      const parts = raw.split(/[,;&\s]+/).filter(s => s.length > 1)
      for (const part of parts) {
        const tag = resolveServiceCategoryTag(part)
        if (!tag || tag === 'other') continue
        const opt = PROVIDER_SKILL_OPTIONS.find(o => o.tag === tag)
        if (opt && !existingSkills.includes(opt.label)) labelMatched.push(opt.label)
      }
    }
  }

  if (indices.length === 0 && labelMatched.length === 0) {
    if (!raw) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *What type of work do you do?*', existingSkills))
    } else {
      // Unrecognised text — ask for numbers
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please reply with the numbers from the list below.*', existingSkills))
    }
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: existingSkills } }
  }

  // Validate indices (1-based) against PROVIDER_SKILL_OPTIONS
  const validSkills: string[] = []
  const invalidNums: number[] = []
  for (const n of indices) {
    const option = PROVIDER_SKILL_OPTIONS[n - 1]
    if (option) {
      validSkills.push(option.label)
    } else {
      invalidNums.push(n)
    }
  }

  // All numbers were invalid (no label matches either)
  if (validSkills.length === 0 && labelMatched.length === 0) {
    await sendText(
      ctx.phone,
      buildSkillPromptText(`❌ None of those numbers are on the list (${invalidNums.join(', ')}).\n\n🔧 *Choose your skills:*`, existingSkills)
    )
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: existingSkills } }
  }

  // Merge new selections into existing (deduplicated)
  const merged = [...new Set([...existingSkills, ...validSkills, ...labelMatched])]

  let confirmBody = `✅ *Skills selected:* ${merged.join(', ')}`
  if (invalidNums.length > 0) {
    confirmBody += `\n\n_(We ignored numbers not on the list: ${invalidNums.join(', ')})_`
  }
  confirmBody += `\n\n${WHATSAPP_COPY.confirmContinue}`

  await sendButtons(ctx.phone, confirmBody, [
    { id: 'skills_confirm', title: WHATSAPP_COPY.continueButton },
    { id: 'skills_change', title: WHATSAPP_COPY.changeSkillsButton },
  ])

  return { nextStep: 'reg_collect_skills_more', nextData: { skills: merged } }
}

async function promptArea(ctx: FlowContext): Promise<FlowResult> {
  const rows = [
    { id: 'area_gauteng', title: 'Gauteng', description: `🟢 Active pilot — ${ACTIVE_PILOT_REGION_LABEL}` },
    { id: 'area_western_cape', title: 'Western Cape', description: '🔜 Coming soon — register now' },
    { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: '🔜 Coming soon — register now' },
    { id: 'area_eastern_cape', title: 'Eastern Cape', description: '🔜 Coming soon — register now' },
    { id: 'area_other', title: 'Other province', description: '🔜 Coming soon — register now' },
  ]

  await sendList(
    ctx.phone,
    '📍 Which area do you mainly work in?',
    [{ title: 'Areas', rows }],
    { buttonLabel: 'Choose Area' }
  )
  return { nextStep: 'reg_collect_experience' }
}

async function handleCollectArea(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'edit_skills' || ctx.reply.id === 'skills_change') {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  return promptArea(ctx)
}

// ─── Province key map ─────────────────────────────────────────────────────────

const PROVINCE_KEY_MAP: Record<string, string> = {
  'area_gauteng':       'gauteng',
  'area_western_cape':  'western_cape',
  'area_kwazulu_natal': 'kwazulu_natal',
  'area_eastern_cape':  'eastern_cape',
  'area_other':         'gauteng', // fallback to largest province
}

// ─── Experience and availability ──────────────────────────────────────────────

async function handleCollectExperience(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('area_')) {
    await sendList(
      ctx.phone,
      '📍 Please choose your area from the list.',
      [{
        title: 'Areas',
        rows: [
          { id: 'area_gauteng', title: 'Gauteng', description: `🟢 Active pilot — ${ACTIVE_PILOT_REGION_LABEL}` },
          { id: 'area_western_cape', title: 'Western Cape', description: '🔜 Coming soon — register now' },
          { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: '🔜 Coming soon — register now' },
          { id: 'area_eastern_cape', title: 'Eastern Cape', description: '🔜 Coming soon — register now' },
          { id: 'area_other', title: 'Other province', description: '🔜 Coming soon — register now' },
        ],
      }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_experience' }
  }

  const areaLabel = ctx.reply.title ?? ''
  const provinceKey = PROVINCE_KEY_MAP[ctx.reply.id ?? ''] ?? 'gauteng'

  // Soft pilot notice for providers outside Gauteng — still allow full registration
  if (ctx.reply.id !== 'area_gauteng') {
    await sendText(
      ctx.phone,
      `🌍 *Heads up — Pilot Phase*\n\nPlug A Pro is currently operating in Gauteng only. We are expanding soon!\n\nYou can still complete your profile now — we will WhatsApp you the moment we go live in your area. No need to re-register later.`
    )
  }

  try {
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(provinceKey)

    if (cities.length === 0) {
      // No cities seeded yet — ask provider to type their suburb for finer granularity
      await sendText(
        ctx.phone,
        `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
      )
      return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey, selectedRegionStatus: 'coming_soon' } }
    }

    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: c.label,
      description: describeCityServiceStatus({ cityKey: c.cityKey }),
    }))

    await sendList(
      ctx.phone,
      '🏙 Which city do you mainly work in?',
      [{ title: 'Cities', rows }],
      { buttonLabel: 'Choose City' }
    )
    return {
      nextStep: 'reg_collect_city',
      nextData: {
        serviceAreas: [areaLabel],
        province: areaLabel,
        provinceKey,
        selectedRegionStatus: ctx.reply.id === 'area_gauteng' ? undefined : 'coming_soon',
      },
    }
  } catch {
    // DB unavailable — ask provider to type their suburb
    await sendText(
      ctx.phone,
      `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
    )
    return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey, selectedRegionStatus: 'coming_soon' } }
  }
}

// ─── Experience prompt helper ─────────────────────────────────────────────────

async function sendExperiencePrompt(phone: string): Promise<void> {
  await sendList(
    phone,
    '💼 How many years of experience do you have in your trade?',
    [{
      title: 'Experience',
      rows: [
        { id: 'exp_lt1', title: 'Less than 1 year', description: 'Just starting out' },
        { id: 'exp_1_3', title: '1–3 years', description: 'Some experience' },
        { id: 'exp_3_5', title: '3–5 years', description: 'Experienced' },
        { id: 'exp_5plus', title: '5+ years', description: 'Highly experienced' },
      ],
    }],
    { buttonLabel: 'Choose Experience' }
  )
}

// ─── City and region selection (structured location) ─────────────────────────

async function handleCollectCity(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('city_')) {
    // Re-show city list using stored provinceKey
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(ctx.data.provinceKey ?? 'gauteng')
    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: c.label,
      description: describeCityServiceStatus({ cityKey: c.cityKey }),
    }))
    await sendList(ctx.phone, '🏙 Please choose your city:', [{ title: 'Cities', rows }], { buttonLabel: 'Choose City' })
    return { nextStep: 'reg_collect_city' }
  }

  const cityId = ctx.reply.id.replace('city_', '')
  const cityLabel = ctx.reply.title ?? ''
  const cityIsActive = ctx.reply.title === ACTIVE_PILOT_CITY_LABEL

  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(cityId)

    if (regions.length === 0) {
      // No regions for this city — ask provider to type their suburb
      await sendText(
        ctx.phone,
        `📍 Which suburb or area of *${cityLabel}* do you mainly work in?\n\nType the suburb name (e.g. *Allen's Nek*, *Fourways*, *Rondebosch*):`,
      )
      return {
        nextStep: 'reg_collect_suburb_text',
        nextData: { city: cityLabel, cityId, selectedRegionStatus: 'coming_soon' },
      }
    }

    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
      description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }),
    }))

    await sendList(
      ctx.phone,
      cityIsActive
        ? `🗺 Which area of *${cityLabel}* do you mainly work in?\n\nOnly *${ACTIVE_PILOT_REGION_LABEL}* is live for leads right now. Other areas are still welcome to register.`
        : `🗺 Which area of *${cityLabel}* do you mainly work in?\n\nThis city is coming soon. You can still register now and we will notify you when leads open there.`,
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return {
      nextStep: 'reg_collect_region',
      nextData: { city: cityLabel, cityId },
    }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability', nextData: { city: cityLabel } }
  }
}

async function showRegionList(ctx: FlowContext): Promise<FlowResult> {
  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(ctx.data.cityId ?? '')
    if (regions.length === 0) {
      await sendExperiencePrompt(ctx.phone)
      return { nextStep: 'reg_collect_availability' }
    }
    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
      description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }),
    }))
    await sendList(
      ctx.phone,
      '🗺 Please choose an area:',
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_region' }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability' }
  }
}

async function handleCollectRegion(ctx: FlowContext): Promise<FlowResult> {
  // Fallback "Done" — used if the user somehow re-enters this step
  if (ctx.reply.id === 'region_done') {
    const nodeIds = ctx.data.locationNodeIds ?? []
    if (nodeIds.length === 0) {
      return showRegionList(ctx)
    }
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability' }
  }

  if (ctx.reply.id === 'region_more') {
    return showRegionList(ctx)
  }

  if (!ctx.reply.id?.startsWith('region_')) {
    return showRegionList(ctx)
  }

  const regionId = ctx.reply.id.replace('region_', '')
  const regionLabel = ctx.reply.title ?? ''
  let regionStatus: ServiceAreaStatus = 'coming_soon'

  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(ctx.data.cityId ?? '')
    const selectedRegion = regions.find((region) => region.id === regionId)
    regionStatus = getRegionServiceStatus({
      regionKey: selectedRegion?.regionKey,
      slug: selectedRegion?.slug,
    })
  } catch {
    regionStatus = 'coming_soon'
  }

  if (regionStatus !== 'active') {
    await sendText(
      ctx.phone,
      `🔜 *Coming soon area*\n\nThanks. *${regionLabel}* is not live for leads yet, but your profile will still be saved. We'll notify you when Plug A Pro opens leads in this region.`
    )
  }

  // Drill down to suburb selection within this region (numbered text list)
  return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, regionStatus)
}

async function handleCollectRegionMore(ctx: FlowContext): Promise<FlowResult> {
  return showRegionList(ctx) // re-show the region list
}

// ─── Suburb multi-select within a region (numbered text list) ─────────────────
// Providers reply once with multiple numbers (e.g. "1,3,5") to select suburbs.
// Uses global 1-based numbering across all pages so "8" always means the 8th suburb.

const SUBURB_TEXT_PAGE_SIZE = 15

async function showSuburbNumberedPrompt(
  phone: string,
  regionId: string,
  regionLabel: string,
  selectedLabels: string[],
  selectedIds: string[],
  pageOffset: number,
  regionStatus: ServiceAreaStatus = 'coming_soon',
): Promise<FlowResult> {
  try {
    const { getSuburbs } = await import('@/lib/location-nodes')
    const suburbs = await getSuburbs(regionId)

    if (suburbs.length === 0) {
      // No suburbs seeded — skip drill-down, proceed to experience
      await sendExperiencePrompt(phone)
      return {
        nextStep: 'reg_collect_availability',
        nextData: {
          locationNodeIds: [regionId],
          selectedRegionLabels: [regionLabel],
          selectedRegionStatus: regionStatus,
        },
      }
    }

    await sendText(
      phone,
      buildSuburbPromptText(regionLabel, suburbs, pageOffset, selectedLabels),
    )

    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId,
        regionLabel,
        suburbPage: pageOffset,
        suburbOptions: suburbs.map(s => ({ id: s.id, label: s.label })),
        locationNodeIds: selectedIds,
        selectedSuburbLabels: selectedLabels,
        selectedRegionStatus: regionStatus,
      },
    }
  } catch {
    await sendExperiencePrompt(phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: { locationNodeIds: [regionId], selectedRegionLabels: [regionLabel], selectedRegionStatus: regionStatus },
    }
  }
}

async function handleCollectSuburbSelect(ctx: FlowContext): Promise<FlowResult> {
  const regionId = ctx.data.regionId as string ?? ''
  const regionLabel = ctx.data.regionLabel as string ?? ''
  const suburbOptions = (ctx.data.suburbOptions ?? []) as Array<{ id: string; label: string }>
  const suburbPage = (ctx.data.suburbPage as number) ?? 0
  const existingIds: string[] = (ctx.data.locationNodeIds as string[]) ?? []
  const existingLabels: string[] = (ctx.data.selectedSuburbLabels as string[]) ?? []
  const selectedRegionStatus = (ctx.data.selectedRegionStatus as ServiceAreaStatus | undefined) ?? 'coming_soon'

  // ── Button replies (from confirmation screen) ──────────────────────────────

  if (ctx.reply.id === 'suburb_confirm') {
    if (existingIds.length === 0) {
      await showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
      return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
    }
    await sendExperiencePrompt(ctx.phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: {
        locationNodeIds: existingIds,
        selectedRegionLabels: [regionLabel],
        selectedSuburbLabels: existingLabels,
        selectedRegionStatus,
      },
    }
  }

  // "add more" — show numbered list keeping current selections
  if (ctx.reply.id === 'suburb_add_more') {
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, 0, selectedRegionStatus)
  }

  // "change" — clear all and restart
  if (ctx.reply.id === 'suburb_change') {
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
  }

  // ── Text reply ─────────────────────────────────────────────────────────────

  const raw = ctx.reply.text?.trim() ?? ''
  const rawLower = raw.toLowerCase()

  if (rawLower === 'done') {
    if (existingIds.length === 0) {
      await sendText(ctx.phone, '📍 Please choose at least one suburb first.')
      return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
    }
    await sendExperiencePrompt(ctx.phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: {
        locationNodeIds: existingIds,
        selectedRegionLabels: [regionLabel],
        selectedSuburbLabels: existingLabels,
        selectedRegionStatus,
      },
    }
  }

  if (rawLower === 'more') {
    const nextOffset = suburbPage + SUBURB_TEXT_PAGE_SIZE
    if (nextOffset >= suburbOptions.length) {
      await sendText(
        ctx.phone,
        `📍 You have seen all ${suburbOptions.length} suburbs in ${regionLabel}.\n\nReply with numbers to select, or *done* to continue.`
      )
      return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
    }
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, nextOffset, selectedRegionStatus)
  }

  if (rawLower === 'all') {
    // TODO: If a business limit on max suburbs per provider is introduced, enforce it here.
    const allIds = suburbOptions.map(s => s.id)
    const allLabels = suburbOptions.map(s => s.label)
    const preview = allLabels.length > 8
      ? `${allLabels.slice(0, 8).join(', ')} + ${allLabels.length - 8} more`
      : allLabels.join(', ')
    await sendButtons(
      ctx.phone,
      `✅ *All ${allLabels.length} suburbs in ${regionLabel} selected!*\n\n${preview}\n\nContinue?`,
      [
        { id: 'suburb_confirm', title: '✅ Continue' },
        { id: 'suburb_change', title: '✏️ Change' },
      ],
    )
    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId, regionLabel, suburbPage, suburbOptions,
        locationNodeIds: allIds,
        selectedSuburbLabels: allLabels,
        selectedRegionStatus,
      },
    }
  }

  // ── Parse number input ─────────────────────────────────────────────────────
  // Numbers are 1-based and global (refer to suburbOptions index, not the current page).

  const indices = parseNumberedInput(raw)

  if (indices.length === 0) {
    if (!raw) {
      return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, suburbPage, selectedRegionStatus)
    }
    await sendText(ctx.phone, '📍 Please reply with suburb numbers from the list, e.g. *1,3,5*')
    return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
  }

  // Validate against full suburbOptions (global, 1-based)
  const newIds: string[] = []
  const newLabels: string[] = []
  const invalidNums: number[] = []

  for (const n of indices) {
    const suburb = suburbOptions[n - 1]
    if (!suburb) {
      invalidNums.push(n)
    } else if (!existingIds.includes(suburb.id)) {
      newIds.push(suburb.id)
      newLabels.push(suburb.label)
    }
    // silently skip already-selected suburbs (no duplicate message needed)
  }

  // Every number was invalid and nothing was already selected
  if (newIds.length === 0 && existingIds.length === 0 && invalidNums.length > 0) {
    await sendText(
      ctx.phone,
      `❌ None of those numbers match suburbs on the list (${invalidNums.join(', ')}).\n\nPlease try again, e.g. *1,3,5*`
    )
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], suburbPage, selectedRegionStatus)
  }

  const mergedIds = [...existingIds, ...newIds]
  const mergedLabels = [...existingLabels, ...newLabels]

  let confirmBody = `✅ *Selected suburbs:* ${mergedLabels.join(', ')}`
  if (invalidNums.length > 0) {
    confirmBody += `\n\n_(We ignored numbers not on the list: ${invalidNums.join(', ')})_`
  }
  confirmBody += '\n\nReady to continue?'

  await sendButtons(
    ctx.phone,
    confirmBody,
    [
      { id: 'suburb_confirm', title: '✅ Continue' },
      { id: 'suburb_add_more', title: '➕ Add more' },
      { id: 'suburb_change', title: '✏️ Change' },
    ],
  )

  return {
    nextStep: 'reg_collect_suburb_select',
    nextData: {
      regionId, regionLabel, suburbPage, suburbOptions,
      locationNodeIds: mergedIds,
      selectedSuburbLabels: mergedLabels,
      selectedRegionStatus,
    },
  }
}

// ─── Suburb free-text fallback (when location_nodes DB has no region data) ────

async function handleCollectSuburbText(ctx: FlowContext): Promise<FlowResult> {
  const typed = ctx.reply.text?.trim() ?? ''
  if (!typed || typed.length < 2) {
    await sendText(
      ctx.phone,
      `📍 Please type your main working suburb or area (e.g. *Randburg*, *Allen's Nek*):`,
    )
    return { nextStep: 'reg_collect_suburb_text' }
  }

  const suburbLabel = normaliseLocationDisplayName(typed)
  const city = normaliseLocationDisplayName(ctx.data.city)
  const area = city ? `${suburbLabel}, ${city}` : suburbLabel

  await sendExperiencePrompt(ctx.phone)
  return {
    nextStep: 'reg_collect_availability',
    nextData: { serviceAreas: [area] },
  }
}

async function handleCollectAvailability(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('exp_')) {
    await sendText(ctx.phone, 'Please choose your experience level from the list above.')
    return { nextStep: 'reg_collect_availability' }
  }

  const expLabels: Record<string, string> = {
    exp_lt1: 'Less than 1 year',
    exp_1_3: '1–3 years',
    exp_3_5: '3–5 years',
    exp_5plus: '5+ years',
  }
  const experience = expLabels[ctx.reply.id] ?? ctx.reply.title ?? ''

  await sendButtons(
    ctx.phone,
    '📅 Are you available on weekends?\n\nWe get many weekend requests — workers who work Saturdays often get more leads.',
    [
      { id: 'avail_weekdays_only', title: '📋 Weekdays only' },
      { id: 'avail_incl_sat', title: '📅 Mon–Sat' },
      { id: 'avail_any_day', title: '✅ Any day' },
    ]
  )
  return { nextStep: 'reg_collect_evidence', nextData: { experience } }
}

async function handleCollectEvidence(ctx: FlowContext): Promise<FlowResult> {
  const availMap: Record<string, { label: string; days: string[] }> = {
    avail_weekdays_only: { label: 'Weekdays only', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    avail_incl_sat: { label: 'Mon–Sat', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
    avail_any_day: { label: 'Any day', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  }

  if (ctx.reply.id?.startsWith('avail_')) {
    const avail = availMap[ctx.reply.id]
    const availability = avail?.days ?? []

    await sendText(
      ctx.phone,
      '💰 What is your usual *call-out fee* for labour (excluding materials)?\n\nReply with a number, for example *250* or *R250*.\n\nIf you do not charge a call-out fee, reply *0*.\n\nCustomers compare providers by labour rate, so make this accurate.'
    )
    return { nextStep: 'reg_collect_rates', nextData: { availability } }
  }

  if (ctx.reply.id === 'evidence_add') {
    await sendText(
      ctx.phone,
      '🧾 Share optional work examples — you can send:\n• A text note about past jobs or references\n• One photo or PDF at a time (up to 5 files)\n\nOr type *skip* to continue without one.'
    )
    return { nextStep: 'reg_collect_evidence' }
  }

  if (ctx.reply.id === 'evidence_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    return showRegistrationSummary(ctx, { evidenceNote: '' })
  }

  // ── Media upload (image or document) ──────────────────────────────────────
  if (ctx.reply.type === 'image' || ctx.reply.type === 'document') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, "⚠️ Couldn't process that file. Please try again or type *skip* to continue without one.")
      return { nextStep: 'reg_collect_evidence' }
    }
    const existing = uniqueStrings(ctx.data.evidenceFileUrls ?? [])
    const existingMediaIds = uniqueStrings(ctx.data.evidenceMediaIds ?? [])

    if (existingMediaIds.includes(ctx.reply.mediaId)) {
      console.info('[registration:handleCollectEvidence] duplicate media skipped', {
        phone: ctx.phone, mediaId: ctx.reply.mediaId, currentCount: existing.length,
      })
      if (!ctx.suppressEvidenceFileProgress) {
        await sendEvidenceFileProgress(ctx.phone, existing.length)
      }
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: existing, evidenceMediaIds: existingMediaIds },
      }
    }

    if (existing.length >= MAX_EVIDENCE_FILES) {
      if (!ctx.suppressEvidenceFileProgress) {
        await sendEvidenceFileProgress(ctx.phone, existing.length)
      }
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: existing, evidenceMediaIds: existingMediaIds },
      }
    }

    // providerApplicationId is not yet created — attachment starts with null FK.
    // handlePending backfills the FK once the ProviderApplication row exists.
    try {
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        // no providerApplicationId yet — backfilled at submission
      })
      const updated = uniqueStrings([...existing, attachmentId]).slice(0, MAX_EVIDENCE_FILES)
      const updatedMediaIds = uniqueStrings([...existingMediaIds, ctx.reply.mediaId])

      console.info('[registration:handleCollectEvidence] evidence file saved', {
        phone: ctx.phone,
        mediaId: ctx.reply.mediaId,
        mimeType: ctx.reply.mimeType ?? 'unknown',
        attachmentId,
        newCount: updated.length,
        batchSize: ctx.evidenceFileBatchSize ?? 1,
        suppressed: ctx.suppressEvidenceFileProgress ?? false,
      })

      if (!ctx.suppressEvidenceFileProgress) {
        await sendEvidenceFileProgress(ctx.phone, updated.length)
      }
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: updated, evidenceMediaIds: updatedMediaIds },
      }
    } catch (err) {
      console.error(
        `[registration:handleCollectEvidence] media upload failed — mediaId=${ctx.reply.mediaId} mimeType=${ctx.reply.mimeType ?? 'unknown'}:`,
        err
      )
      await sendText(ctx.phone, "⚠️ Couldn't upload that file. Please try again or type *skip* to continue without one.")
      return { nextStep: 'reg_collect_evidence' }
    }
  }

  if (ctx.reply.id === 'evidence_done') {
    return showRegistrationSummary(ctx, {})
  }

  if (ctx.reply.id === 'evidence_add_more') {
    const existing = uniqueStrings(ctx.data.evidenceFileUrls ?? [])
    const remaining = Math.max(0, MAX_EVIDENCE_FILES - existing.length)
    await sendText(ctx.phone, `📎 Send your next file — one at a time. You can add up to ${remaining} more, or type *skip* to finish.`)
    return { nextStep: 'reg_collect_evidence' }
  }

  const evidenceNote = ctx.reply.text?.trim()
  if (!evidenceNote) {
    await sendText(ctx.phone, 'Reply with your proof note or send a file, or type *skip* if you do not want to add one now.')
    return { nextStep: 'reg_collect_evidence' }
  }

  return showRegistrationSummary(ctx, { evidenceNote })
}

async function handleCollectRates(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'rate_negotiable_yes' || ctx.reply.id === 'rate_negotiable_no') {
    const rateNegotiable = ctx.reply.id === 'rate_negotiable_yes'
    const callOutFee = Number(ctx.data.callOutFee ?? 0)

    // Phase 4 follow-up Task 1: optional hourly rate. Customers can use this
    // to compare providers by labour cost; ProviderApplication.hourlyRate
    // already exists in the schema, so this just collects the value.
    await sendButtons(
      ctx.phone,
      [
        '⏱️ *Optional:* what is your usual *hourly rate* (Rand) for labour, excluding materials?',
        '',
        `Call-out fee saved: *${formatRandAmountForProviderOnboarding(callOutFee)}*`,
        `Rate negotiable: *${rateNegotiable ? 'Yes' : 'No'}*`,
        '',
        'Reply with a number (e.g. *250* or *R250*), or tap *Skip* to continue without one.',
      ].join('\n'),
      [
        { id: 'hourly_rate_skip', title: '⏭️ Skip' },
      ]
    )
    return { nextStep: 'reg_collect_hourly_rate', nextData: { callOutFee, rateNegotiable } }
  }

  try {
    const rates = validateProviderOnboardingRates({ callOutFeeText: ctx.reply.text })
    if (rates.callOutFee == null) {
      throw new ProviderOnboardingValidationError('INVALID_FEE', 'Call-out fee is required.')
    }
    await sendButtons(
      ctx.phone,
      [
        `✅ Call-out fee saved: *${formatRandAmountForProviderOnboarding(rates.callOutFee)}*`,
        '',
        'Is this rate negotiable?',
      ].join('\n'),
      [
        { id: 'rate_negotiable_yes', title: 'Yes, negotiable' },
        { id: 'rate_negotiable_no', title: 'No, fixed' },
      ],
    )
    return { nextStep: 'reg_collect_rates', nextData: { callOutFee: rates.callOutFee } }
  } catch (error) {
    if (error instanceof ProviderOnboardingValidationError) {
      await sendText(ctx.phone, 'Please reply with a valid call-out fee number, for example *250* or *R250*.')
      return { nextStep: 'reg_collect_rates' }
    }
    throw error
  }
}

async function showRegistrationSummary(
  ctx: FlowContext,
  overrides?: Partial<FlowContext['data']>
): Promise<FlowResult> {
  const availLabel =
    (overrides?.availability?.length ?? ctx.data.availability?.length ?? 0) >= 7 ? 'Any day'
    : (overrides?.availability?.length ?? ctx.data.availability?.length ?? 0) >= 6 ? 'Mon–Sat'
    : 'Weekdays only'

  const merged = { ...ctx.data, ...overrides }
  const {
    name,
    skills,
    serviceAreas,
    experience,
    evidenceNote,
    evidenceFileUrls,
    callOutFee,
    rateNegotiable,
  } = merged
  const skillList = (skills ?? []).join(', ')
  // Prefer suburb-level labels if the provider drilled down, else fall back to region/area labels
  const suburbLabels = merged.selectedSuburbLabels as string[] | undefined
  const regionLabels = merged.selectedRegionLabels as string[] | undefined
  const areaList = (suburbLabels?.length ? suburbLabels : regionLabels?.length ? regionLabels : serviceAreas ?? []).join(', ')
  const fileCount = evidenceFileUrls?.length ?? 0

  await sendButtons(
    ctx.phone,
    `📋 *Your Application Summary*\n\n👤 Name: *${name}*\n🪪 Identity: *${verificationStatusLabel(merged)}*\n👷 Provider type: *Independent service provider*\n🔧 Skills: *${skillList}*\n📍 Area: *${areaList}*\n💼 Experience: *${experience ?? 'Not specified'}*\n📅 Availability: *${availLabel}*\n💰 Call-out fee: *${formatRandAmountForProviderOnboarding(typeof callOutFee === 'number' ? callOutFee : null)}*\n⏱️ Hourly rate: *${typeof merged.hourlyRate === 'number' ? `${formatRandAmountForProviderOnboarding(merged.hourlyRate)}/hour` : 'Not provided'}*\n🤝 Rate negotiable: *${rateNegotiable === false ? 'No' : 'Yes'}*\n📸 Profile photo: *${merged.profilePhotoAttachmentId ? 'Uploaded' : 'Skipped'}*\n📝 Bio: *${merged.providerBio ? 'Added' : 'Skipped'}*\n${evidenceNote ? `🧾 Proof note: *${evidenceNote}*\n` : ''}${fileCount > 0 ? `📎 Files: *${fileCount} uploaded*\n` : ''}\n${WHATSAPP_COPY.confirmSubmitApplication}`,
    [
      { id: 'submit_yes', title: '✅ Submit' },
      { id: 'reg_edit', title: '✏️ Edit' },
      { id: 'submit_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'reg_pending', nextData: overrides }
}

// Phase 4 follow-up Task 1: optional hourly rate. Captured between the
// negotiable yes/no and the profile photo step. Skip is always allowed.
async function handleCollectHourlyRate(ctx: FlowContext): Promise<FlowResult> {
  const callOutFee = typeof ctx.data.callOutFee === 'number' ? ctx.data.callOutFee : 0
  const rateNegotiable = ctx.data.rateNegotiable !== false

  // Skip path — explicit button or text fallback.
  if (
    ctx.reply.id === 'hourly_rate_skip' ||
    ctx.reply.text?.trim().toLowerCase() === 'skip'
  ) {
    await sendText(ctx.phone, 'No hourly rate for now. You can add one later from the Worker Portal.')
    return promptProfilePhotoAfterRate(ctx, { hourlyRateSkipped: true, callOutFee, rateNegotiable })
  }

  // Number capture — accept "250", "R250", "250.00", etc.
  try {
    const rates = validateProviderOnboardingRates({ hourlyRateText: ctx.reply.text })
    if (rates.hourlyRate == null || rates.hourlyRate < 0) {
      // INVALID_FEE is the existing error code in the validation helper —
      // reuse it so the catch handler below renders the same recovery copy
      // as the call-out fee path.
      throw new ProviderOnboardingValidationError('INVALID_FEE', 'Hourly rate is required.')
    }
    await sendText(
      ctx.phone,
      `✅ Hourly rate saved: *${formatRandAmountForProviderOnboarding(rates.hourlyRate)}/hour*`,
    )
    return promptProfilePhotoAfterRate(ctx, {
      hourlyRate: rates.hourlyRate,
      hourlyRateSkipped: false,
      callOutFee,
      rateNegotiable,
    })
  } catch (error) {
    if (error instanceof ProviderOnboardingValidationError) {
      await sendText(
        ctx.phone,
        'Please reply with a valid hourly rate number (e.g. *250* or *R250*), or tap *Skip*.',
      )
      return { nextStep: 'reg_collect_hourly_rate' }
    }
    throw error
  }
}

// Centralised "transition to profile photo prompt" so both the hourly rate
// handler (skip + capture) emit the same downstream UX.
async function promptProfilePhotoAfterRate(
  ctx: FlowContext,
  nextData: Partial<typeof ctx.data>,
): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    [
      '📸 Add an optional *profile photo* — customers are more likely to choose providers with a clear photo.',
      '',
      'Send one photo of yourself, or tap *Skip* to continue without one. You can add it later from the Worker Portal.',
    ].join('\n'),
    [
      { id: 'profile_photo_skip', title: '⏭️ Skip' },
    ],
  )
  return { nextStep: 'reg_collect_profile_photo', nextData }
}

// Phase 4b: optional profile photo step. Provider may upload one image or
// type "skip" / tap the Skip button. Persisted as Attachment with the
// `provider_profile_photo` label. Linked to ProviderApplication on submit
// (the existing evidence backfill handles attachmentId linkage). Customer
// shortlist cards consume this via the existing avatar resolver once
// approval copies it onto Provider.avatarUrl.
async function handleCollectProfilePhoto(ctx: FlowContext): Promise<FlowResult> {
  // Skip path — explicit button or text fallback.
  if (
    ctx.reply.id === 'profile_photo_skip' ||
    ctx.reply.text?.trim().toLowerCase() === 'skip'
  ) {
    await sendText(
      ctx.phone,
      'No photo for now. You can add one later from the Worker Portal. Continuing to the next step…'
    )
    return promptEvidenceAfterPhoto(ctx, { profilePhotoSkipped: true })
  }

  // Image upload — replace any prior photo. Single image only; if a previous
  // attachment exists for this provider's photo we accept the new one.
  if (ctx.reply.type === 'image') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, "⚠️ Couldn't read that photo. Please try again or tap *Skip*.")
      return { nextStep: 'reg_collect_profile_photo' }
    }
    if (ctx.data.profilePhotoMediaId === ctx.reply.mediaId) {
      // Same media re-delivered — idempotent.
      return promptEvidenceAfterPhoto(ctx, {})
    }
    try {
      const { PROVIDER_PROFILE_PHOTO_LABEL } = await import('../provider-attachment-labels')
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        prefix: 'profile_photo',
        label: PROVIDER_PROFILE_PHOTO_LABEL,
      })
      console.info('[registration:handleCollectProfilePhoto] profile photo saved', {
        phone: ctx.phone,
        mediaIdSuffix: ctx.reply.mediaId.slice(-8),
        attachmentId,
      })
      await sendText(ctx.phone, '✅ Profile photo saved. Continuing to the next step…')
      return promptEvidenceAfterPhoto(ctx, {
        profilePhotoAttachmentId: attachmentId,
        profilePhotoMediaId: ctx.reply.mediaId,
        profilePhotoSkipped: false,
      })
    } catch (err) {
      console.error(
        `[registration:handleCollectProfilePhoto] media upload failed — mediaId=${ctx.reply.mediaId}:`,
        err,
      )
      await sendWhatsAppJourneyRecovery(ctx.phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: ctx.flow,
        currentStep: ctx.step,
        failureType: 'storage_failure',
        recoveryClass: 'retry_same_step',
        error: err,
      })
      return { nextStep: 'reg_collect_profile_photo' }
    }
  }

  // Anything else (free text other than skip, document upload, button reply
  // we don't handle) — re-prompt.
  await sendText(
    ctx.phone,
    'Send one *photo* of yourself, or tap *Skip* (or type *skip*) to continue without a profile photo.',
  )
  return { nextStep: 'reg_collect_profile_photo' }
}

// After the profile photo step (upload OR skip), route through the optional
// bio step (Phase 4 follow-up Task 2) before reaching evidence/work-note.
// Centralised so the photo handler never re-creates the bio prompt by hand.
async function promptEvidenceAfterPhoto(
  ctx: FlowContext,
  nextData: Partial<typeof ctx.data>,
): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    [
      '📝 Add an optional *short bio* — 1–2 sentences customers will see on your profile card.',
      '',
      'Examples:',
      '• "10 years fixing geysers and bathroom leaks. Gauteng-based. Always on time."',
      '• "Friendly handyman, no job too small. Family business since 2018."',
      '',
      'Type your bio (max 280 characters), or tap *Skip*.',
    ].join('\n'),
    [
      { id: 'provider_bio_skip', title: '⏭️ Skip' },
    ],
  )
  return { nextStep: 'reg_collect_bio', nextData }
}

// Phase 4 follow-up Task 2: optional bio capture. Skip is always allowed.
// Bio shows on the customer shortlist provider card; long bios are
// truncated to 280 chars to keep cards uniform.
const PROVIDER_BIO_MAX_CHARS = 280

async function handleCollectBio(ctx: FlowContext): Promise<FlowResult> {
  if (
    ctx.reply.id === 'provider_bio_skip' ||
    ctx.reply.text?.trim().toLowerCase() === 'skip'
  ) {
    await sendText(ctx.phone, 'No bio for now. You can add one later from the Worker Portal.')
    return promptEvidenceAfterBio(ctx, { providerBioSkipped: true })
  }

  const bio = ctx.reply.text?.trim()
  if (!bio) {
    await sendText(ctx.phone, 'Type your short bio, or tap *Skip*.')
    return { nextStep: 'reg_collect_bio' }
  }

  const trimmed = bio.length > PROVIDER_BIO_MAX_CHARS ? bio.slice(0, PROVIDER_BIO_MAX_CHARS) : bio
  await sendText(
    ctx.phone,
    bio.length > PROVIDER_BIO_MAX_CHARS
      ? `✅ Bio saved (trimmed to ${PROVIDER_BIO_MAX_CHARS} characters for the customer card).`
      : '✅ Bio saved.',
  )
  return promptEvidenceAfterBio(ctx, { providerBio: trimmed, providerBioSkipped: false })
}

// Centralised "transition to evidence/work-note prompt".
async function promptEvidenceAfterBio(
  ctx: FlowContext,
  nextData: Partial<typeof ctx.data>,
): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    [
      '🧾 Would you like to add an optional work note?',
      '',
      'Examples: past jobs, references, or types of repairs you have done. This stays provider-supplied unless Plug A Pro says a specific item was reviewed.',
    ].join('\n'),
    [
      { id: 'evidence_add', title: '✍️ Add proof note' },
      { id: 'evidence_skip', title: '⏭️ Skip for now' },
    ],
  )
  return { nextStep: 'reg_collect_evidence', nextData }
}

async function handleConfirm(ctx: FlowContext): Promise<FlowResult> {
  return showRegistrationSummary(ctx)
}

async function handlePending(ctx: FlowContext): Promise<FlowResult> {
  // Edit — show field selection, not full restart
  if (ctx.reply.id === 'reg_edit') {
    return showEditMenu(ctx)
  }

  if (ctx.reply.id === 'submit_no') {
    const normalizedPhone = normalizePhone(ctx.phone)
    const cancelTraceId = `provider_app_cancel_${crypto.randomUUID().slice(0, 12)}`
    const cohort = createTestCohortContext(normalizedPhone)
    const name = ctx.data.name?.trim() ?? 'unknown'
    const skills = uniqueStrings(ctx.data.skills ?? [])
    const serviceAreas = uniqueStrings(
      (ctx.data.selectedSuburbLabels?.length ? ctx.data.selectedSuburbLabels :
       ctx.data.selectedRegionLabels?.length ? ctx.data.selectedRegionLabels :
       ctx.data.serviceAreas) ?? [],
    )
    const now = new Date()
    let cancelledApplicationId: string | undefined

    try {
      const cancelled = await db.$transaction(async (tx) => {
        const app = await tx.providerApplication.create({
          data: {
            phone: normalizedPhone,
            email: ctx.data.providerEmail ?? null,
            name,
            skills,
            serviceAreas,
            experience: ctx.data.experience ?? null,
            availability: formatAvailabilityLabel(uniqueStrings(ctx.data.availability ?? [])),
            callOutFee: typeof ctx.data.callOutFee === 'number' ? ctx.data.callOutFee : null,
            hourlyRate: typeof ctx.data.hourlyRate === 'number' ? ctx.data.hourlyRate : null,
            rateNegotiable: ctx.data.rateNegotiable !== false,
            evidenceNote: ctx.data.evidenceNote ?? null,
            evidenceFileUrls: uniqueStrings(ctx.data.evidenceFileUrls ?? []),
            idNumber: ctx.data.providerIdNumber?.trim(),
            isTestUser: cohort.isTestUser,
            cohortName: cohort.cohortName,
            status: 'CANCELLED',
            cancelledAt: now,
          },
          select: { id: true },
        })
        await (tx as any).auditLog?.create?.({
          data: {
            actorId: normalizedPhone,
            actorRole: 'provider_applicant',
            action: 'provider_application.cancelled',
            entityType: 'ProviderApplication',
            entityId: app.id,
            after: {
              status: 'CANCELLED',
              cancelledAt: now.toISOString(),
              selectedSkillsCount: skills.length,
              selectedAreasCount: serviceAreas.length,
              traceId: cancelTraceId,
            },
            isTestEvent: cohort.isTestUser,
            cohortName: cohort.cohortName,
          },
        })
        return app
      })
      cancelledApplicationId = cancelled.id
    } catch (err) {
      console.warn('[registration-flow] cancel record creation failed (non-fatal)', {
        trace_id: cancelTraceId,
        normalized_phone: normalizedPhone,
        error: safeErrorMessage(err),
      })
    }

    console.info('[registration-flow] provider application cancelled at summary', {
      trace_id: cancelTraceId,
      normalized_phone: normalizedPhone,
      cancelled_application_id: cancelledApplicationId ?? null,
      is_test_user: cohort.isTestUser,
    })
    await sendText(ctx.phone, "Application cancelled. Reply *join* anytime to apply again.")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id !== 'submit_yes') {
    return { nextStep: 'reg_pending' }
  }

  const traceId = createSubmitTraceId()
  const normalizedPhone = normalizePhone(ctx.phone)
  const digits = normalizedPhone.replace(/\D/g, '')
  const phoneVariants = Array.from(new Set([
    normalizedPhone,
    digits ? `+${digits}` : null,
    digits || null,
    digits.startsWith('27') ? `0${digits.slice(2)}` : null,
  ].filter(Boolean) as string[]))

  try {
    const submitData = validateSubmitData(ctx)
    const cohort = createTestCohortContext(normalizedPhone)
    const sessionUploadedFileCount = submitData.evidenceAttachmentIds.length

    console.info('[registration-flow] provider application submit started', {
      trace_id: traceId,
      normalized_phone: normalizedPhone,
      reply_id: ctx.reply.id ?? null,
      selected_skills_count: submitData.skills.length,
      selected_areas_count: submitData.resolvedAreaLabels.length,
      selected_location_node_count: submitData.locationNodeIds.length,
      uploaded_files_count_from_session: sessionUploadedFileCount,
      is_test_user: cohort.isTestUser,
      cohort_name: cohort.cohortName,
    })

    const submitResult: ProviderApplicationSubmitResult = await db.$transaction(async (tx) => {
      const existingCustomer = await tx.customer.findFirst({
        where: { phone: { in: phoneVariants } },
        select: { id: true },
      })
      if (existingCustomer) {
        throw new ProviderApplicationSubmitError(
          'PROVIDER_APPLICATION_ALREADY_EXISTS',
          'This number is already registered as a customer on Plug A Pro.',
          { customerId: existingCustomer.id },
        )
      }

      const existingApp = await findLatestActiveProviderApplicationByPhone(tx as typeof db, normalizedPhone)
      if (existingApp?.status === 'APPROVED') {
        return {
          outcome: 'existing_approved',
          applicationId: existingApp.id,
          ref: existingApp.id.slice(-8).toUpperCase(),
        }
      }
      if (existingApp?.status === 'PENDING') {
        return {
          outcome: 'existing_pending',
          applicationId: existingApp.id,
          ref: existingApp.id.slice(-8).toUpperCase(),
        }
      }

      if (submitData.evidenceAttachmentIds.length > 0) {
        const attachments = await tx.attachment.findMany({
          where: { id: { in: submitData.evidenceAttachmentIds } },
          select: { id: true, providerApplicationId: true },
        })
        const foundAttachmentIds = new Set(attachments.map((attachment) => attachment.id))
        const missingAttachmentIds = submitData.evidenceAttachmentIds.filter((id) => !foundAttachmentIds.has(id))

        console.info('[registration-flow] provider application attachment validation', {
          trace_id: traceId,
          normalized_phone: normalizedPhone,
          expected_files_count: submitData.evidenceAttachmentIds.length,
          saved_files_count: attachments.length,
          missing_files_count: missingAttachmentIds.length,
        })

        if (missingAttachmentIds.length > 0) {
          throw new ProviderApplicationSubmitError(
            'PROVIDER_APPLICATION_ATTACHMENTS_NOT_READY',
            'One or more uploaded provider application files are not available yet.',
            {
              expectedFiles: submitData.evidenceAttachmentIds.length,
              savedFiles: attachments.length,
            },
          )
        }

        const alreadyLinkedElsewhere = attachments.filter((attachment) => attachment.providerApplicationId)
        if (alreadyLinkedElsewhere.length > 0) {
          throw new ProviderApplicationSubmitError(
            'PROVIDER_APPLICATION_FILE_LINK_FAILED',
            'One or more uploaded files are already linked to another provider application.',
            { linkedFiles: alreadyLinkedElsewhere.length },
          )
        }
      }

      const providerId = await syncProviderRecord(tx as typeof db, {
        phone: normalizedPhone,
        name: submitData.name,
        email: ctx.data.providerEmail ?? null,
        skills: submitData.skills,
        serviceAreas: submitData.resolvedAreaLabels,
        active: true,
        availableNow: true,
        verified: false,
        isTestUser: cohort.isTestUser,
        cohortName: cohort.cohortName,
        locationNodeIds: submitData.locationNodeIds,
        // Enrichment (syncProviderSkills, upsertStructuredServiceAreas) must not run
        // inside the transaction — a caught DB error inside those helpers puts the
        // PostgreSQL connection in ABORTED state even when swallowed at the JS level,
        // causing all subsequent tx queries to fail. Run enrichment post-commit below.
        skipEnrichment: true,
      })

      const application = await tx.providerApplication.create({
        data: {
          providerId,
          phone: normalizedPhone,
          email: ctx.data.providerEmail ?? null,
          name: submitData.name,
          skills: submitData.skills,
          serviceAreas: submitData.resolvedAreaLabels,
          experience: ctx.data.experience ?? null,
          availability: formatAvailabilityLabel(submitData.availability),
          callOutFee: typeof ctx.data.callOutFee === 'number' ? ctx.data.callOutFee : null,
          // Phase 4 follow-up Task 1: optional hourly rate.
          hourlyRate: typeof ctx.data.hourlyRate === 'number' ? ctx.data.hourlyRate : null,
          rateNegotiable: ctx.data.rateNegotiable !== false,
          weekendJobs: (submitData.availability ?? []).includes('Sat') || (submitData.availability ?? []).includes('Sun'),
          sameDayJobs: true,
          evidenceNote: ctx.data.evidenceNote ?? null,
          evidenceFileUrls: submitData.evidenceAttachmentIds,
          idNumber: submitData.idNumber,
          isTestUser: cohort.isTestUser,
          cohortName: cohort.cohortName,
          status: 'PENDING',
        },
      })

      const providerCategoryRows = submitData.skills.map((skill) => ({
        providerId,
        categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
        yearsExperience: yearsExperienceFromLabel(ctx.data.experience),
        skillLevel: skillLevelFromExperienceLabel(ctx.data.experience),
        approvalStatus: 'PENDING_REVIEW',
      }))

      if (providerCategoryRows.length > 0) {
        await (tx as any).providerCategory?.createMany?.({
          data: providerCategoryRows,
          skipDuplicates: true,
        })
      }

      if (typeof ctx.data.callOutFee === 'number') {
        await (tx as any).providerRate?.createMany?.({
          data: providerCategoryRows.map((row) => ({
            providerId,
            categorySlug: row.categorySlug,
            callOutFee: ctx.data.callOutFee,
            // Phase 4 follow-up Task 1: hourly rate stored per-category if
            // provided. ProviderRate.hourlyRate already exists in schema.
            hourlyRate: typeof ctx.data.hourlyRate === 'number' ? ctx.data.hourlyRate : null,
            rateNegotiable: ctx.data.rateNegotiable !== false,
            quoteAfterInspection: false,
          })),
          skipDuplicates: true,
        })
      }

      // Phase 4 follow-up Task 2: optional bio onto Provider.bio. Non-fatal
      // failure mirrors the profile-photo pattern.
      const providerBio = ctx.data.providerBio?.trim()
      if (providerBio) {
        try {
          await tx.provider.updateMany({
            where: { id: providerId },
            data: { bio: providerBio },
          })
        } catch (err) {
          console.warn('[registration-flow] provider bio update failed (non-fatal)', {
            trace_id: traceId,
            providerId,
            error: safeErrorMessage(err),
          })
        }
      }

      if (submitData.evidenceAttachmentIds.length > 0) {
        const linked = await tx.attachment.updateMany({
          where: {
            id: { in: submitData.evidenceAttachmentIds },
            providerApplicationId: null,
          },
          data: { providerApplicationId: application.id },
        })

        if (linked.count !== submitData.evidenceAttachmentIds.length) {
          throw new ProviderApplicationSubmitError(
            'PROVIDER_APPLICATION_FILE_LINK_FAILED',
            'Uploaded provider application files could not all be linked.',
            {
              expectedFiles: submitData.evidenceAttachmentIds.length,
              linkedFiles: linked.count,
            },
          )
        }
      }

      // Phase 4b: link the optional profile photo Attachment to the
      // ProviderApplication, then copy its URL onto Provider.avatarUrl so
      // the customer-facing shortlist card has a photo to render
      // immediately. Failures here are non-fatal — the application still
      // goes through; the photo can be re-attached from admin tooling.
      const profilePhotoAttachmentId = ctx.data.profilePhotoAttachmentId
      if (profilePhotoAttachmentId) {
        try {
          await tx.attachment.updateMany({
            where: { id: profilePhotoAttachmentId, providerApplicationId: null },
            data: { providerApplicationId: application.id },
          })
          const photoRow = await tx.attachment.findUnique({
            where: { id: profilePhotoAttachmentId },
            select: { url: true },
          })
          if (photoRow?.url) {
            await tx.provider.updateMany({
              where: { id: providerId },
              data: { avatarUrl: photoRow.url },
            })
          }
        } catch (err) {
          console.warn('[registration-flow] profile photo link/avatar update failed (non-fatal)', {
            trace_id: traceId,
            providerApplicationId: application.id,
            profilePhotoAttachmentId,
            error: safeErrorMessage(err),
          })
        }
      }

      // Link optional verification doc and selfie attachments (non-fatal).
      const verificationAttachmentIds = [
        ctx.data.verificationDocAttachmentId,
        ctx.data.verificationSelfieAttachmentId,
      ].filter((id): id is string => Boolean(id))
      if (verificationAttachmentIds.length > 0) {
        try {
          await tx.attachment.updateMany({
            where: { id: { in: verificationAttachmentIds }, providerApplicationId: null },
            data: { providerApplicationId: application.id },
          })
        } catch (err) {
          console.warn('[registration-flow] verification attachment link failed (non-fatal)', {
            trace_id: traceId,
            providerApplicationId: application.id,
            verificationAttachmentIds,
            error: safeErrorMessage(err),
          })
        }
      }

      await (tx as any).auditLog?.create?.({
        data: {
          actorId: normalizedPhone,
          actorRole: 'provider_applicant',
          action: 'provider_application.submit',
          entityType: 'ProviderApplication',
          entityId: application.id,
          after: {
            status: 'PENDING',
            providerId,
            selectedSkillsCount: submitData.skills.length,
            selectedAreasCount: submitData.resolvedAreaLabels.length,
            uploadedFilesCount: submitData.evidenceAttachmentIds.length,
            traceId,
          },
          isTestEvent: cohort.isTestUser,
          cohortName: cohort.cohortName,
        },
      })

      return {
        outcome: 'created',
        applicationId: application.id,
        providerId,
        ref: application.id.slice(-8).toUpperCase(),
      }
    })

    if (submitResult.outcome === 'existing_approved') {
      await sendButtons(
        ctx.phone,
        `✅ You're already registered as a Plug A Pro provider.\n\nRef: *${submitResult.ref}*\n\nYou can manage jobs from the provider menu.`,
        [
          { id: 'provider_my_jobs', title: 'My Jobs' },
          { id: 'back_home', title: 'Main Menu' },
        ],
        undefined,
        { metadata: { traceId, applicationId: submitResult.applicationId } },
      )
      return { nextStep: 'done' }
    }

    if (submitResult.outcome === 'existing_pending') {
      await sendButtons(
        ctx.phone,
        `⏳ Your provider application is already submitted and waiting for review.\n\nRef: *${submitResult.ref}*\n\nApproval is not automatic. We'll update you here after the review is complete.`,
        [
          { id: 'provider_application_status', title: 'Check Status' },
          { id: 'back_home', title: 'Main Menu' },
        ],
        undefined,
        { metadata: { traceId, applicationId: submitResult.applicationId } },
      )
      return { nextStep: 'done' }
    }

    if (submitResult.outcome === 'created') {
      // Post-commit enrichment: skills and structured service areas are non-critical.
      // Run on the real db client (not tx) so a transient error never rolls back the application.
      syncProviderSkills(db, submitResult.providerId, submitData.skills).catch((err) =>
        console.error('[registration-flow] post-commit skills sync failed', {
          trace_id: traceId,
          provider_id: submitResult.providerId,
          error: safeErrorMessage(err),
        })
      )
      if (submitData.locationNodeIds.length > 0) {
        upsertStructuredServiceAreas(db, submitResult.providerId, submitData.locationNodeIds).catch((err) =>
          console.error('[registration-flow] post-commit service areas sync failed', {
            trace_id: traceId,
            provider_id: submitResult.providerId,
            error: safeErrorMessage(err),
          })
        )
      }
    }

    const isComingSoonRegion = ctx.data.selectedRegionStatus === 'coming_soon'
    try {
      await sendButtons(
        ctx.phone,
        buildProviderApplicationSubmittedMessage({
          providerName: ctx.data.name,
          applicationRef: submitResult.ref,
          isComingSoonRegion,
        }),
        [
          { id: 'provider_application_status', title: WHATSAPP_COPY.checkStatusButton },
          { id: 'back_home', title: WHATSAPP_COPY.mainMenuButton },
        ],
        undefined,
        { metadata: { traceId, applicationId: submitResult.applicationId } },
      )
      // Follow-up CTA so the terms URL is exposed via a labelled button rather
      // than raw text in the body. The submitted message body has no URL.
      try {
        await sendCtaUrl(
          ctx.phone,
          'Provider terms and credit rules.',
          ctaLabelFor('credit_policy'),
          getProviderTermsUrl(),
          undefined,
          {
            templateName: 'interactive:provider_application_submitted_terms_cta',
            metadata: { traceId, applicationId: submitResult.applicationId },
          },
        )
      } catch (error) {
        console.warn('[registration-flow] terms CTA follow-up failed (submitted)', {
          trace_id: traceId,
          application_id: submitResult.applicationId,
          error,
        })
      }
    } catch (error) {
      console.error('[registration-flow] provider application WhatsApp confirmation failed after commit', {
        trace_id: traceId,
        application_id: submitResult.applicationId,
        error: safeErrorMessage(error),
      })
    }

    console.info('[registration-flow] provider application submit committed', {
      trace_id: traceId,
      normalized_phone: normalizedPhone,
      application_id: submitResult.applicationId,
      provider_id: submitResult.providerId,
      application_ref: submitResult.ref,
      uploaded_files_count_from_session: sessionUploadedFileCount,
      final_status: 'PENDING',
    })

    // A new provider can unlock older unmatched demand, so check open and
    // recently expired jobs immediately instead of waiting for the next cron run.
    checkJobsForNewProviderAvailability(submitResult.providerId).catch((err) => {
      console.error(`[registration-flow] new-provider job check failed for provider ${submitResult.providerId}:`, err)
    })

    // Send template confirmation (covers the case where >24h passes before we reply)
    // Intentional direct sendTemplate bypass: provider applicants have no Customer record yet,
    // so canSend() would return 'customer_not_found'. This is a provider-facing transactional
    // message (application acknowledgement) — opt-in policy does not apply.
    const { sendTemplate } = await import('../whatsapp')
    sendTemplate({
      to: ctx.phone,
      template: 'technician_application_received',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: ctx.data.name ?? 'Applicant' }, { type: 'text', text: submitResult.ref }] },
      ],
    }).catch((error: unknown) => {
      console.error('[registration-flow] provider application template confirmation failed', {
        trace_id: traceId,
        application_id: submitResult.applicationId,
        error: safeErrorMessage(error),
      })
    }) // non-blocking

    // Notify admin of new application (non-blocking)
    const { sendAdminNewApplication } = await import('../whatsapp')
    sendAdminNewApplication({
      applicantName: ctx.data.name ?? 'Unknown',
      applicantPhone: ctx.phone,
      skills: ctx.data.skills ?? [],
      serviceAreas: normaliseLocationDisplayNames(ctx.data.locationNodeIds?.length
        ? (ctx.data.selectedRegionLabels ?? ctx.data.serviceAreas ?? [])
        : (ctx.data.serviceAreas ?? [])),
      applicationId: submitResult.applicationId,
    }).catch((error: unknown) => {
      console.error('[registration-flow] admin new application notification failed', {
        trace_id: traceId,
        application_id: submitResult.applicationId,
        error: safeErrorMessage(error),
      })
    })

    return { nextStep: 'done' }
  } catch (err) {
    const duplicateRace =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      err.code === 'P2002'

    if (duplicateRace) {
      const racedExisting = await findLatestActiveProviderApplicationByPhone(db, normalizedPhone)
      if (racedExisting) {
        const ref = racedExisting.id.slice(-8).toUpperCase()
        await sendButtons(
          ctx.phone,
          racedExisting.status === 'APPROVED'
            ? `✅ You're already registered as a Plug A Pro provider.\n\nRef: *${ref}*\n\nYou can manage jobs from the provider menu.`
            : `⏳ Your provider application is already submitted and waiting for review.\n\nRef: *${ref}*\n\nApproval is not automatic. We'll update you here after the review is complete.`,
          [
            { id: racedExisting.status === 'APPROVED' ? 'provider_my_jobs' : 'provider_application_status', title: racedExisting.status === 'APPROVED' ? 'My Jobs' : 'Check Status' },
            { id: 'back_home', title: 'Main Menu' },
          ],
          undefined,
          { metadata: { traceId, applicationId: racedExisting.id, recoveredFrom: 'P2002' } },
        )
        return { nextStep: 'done' }
      }
    }

    const errorCode = errorCodeFromUnknown(err)
    console.error('[registration-flow] provider application submit failed', {
      trace_id: traceId,
      normalized_phone: normalizedPhone,
      reply_id: ctx.reply.id ?? null,
      selected_skills_count: ctx.data.skills?.length ?? 0,
      selected_areas_count: ctx.data.locationNodeIds?.length ?? ctx.data.serviceAreas?.length ?? 0,
      uploaded_files_count_from_session: ctx.data.evidenceFileUrls?.length ?? 0,
      error_code: errorCode,
      error_message: safeErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    const detail =
      err instanceof ProviderApplicationSubmitError && err.code === 'PROVIDER_APPLICATION_ATTACHMENTS_NOT_READY'
        ? `\n\nExpected files: ${err.details.expectedFiles ?? 'unknown'}\nSaved files: ${err.details.savedFiles ?? 'unknown'}`
        : ''
    await sendButtons(
      ctx.phone,
      `😔 We couldn't submit your application.\n\nReason: ${err instanceof ProviderApplicationSubmitError ? err.message : 'An unexpected submit error occurred.'}${detail}\n\nError code: ${errorCode}\nTrace ID: ${traceId}\n\nYour progress is saved. Please try Submit again or choose Edit.`,
      [
        { id: 'submit_yes', title: 'Try Again' },
        { id: 'reg_edit', title: 'Edit Application' },
        { id: 'provider_support', title: 'Contact Support' },
      ],
      undefined,
      { metadata: { traceId, errorCode } },
    )
    return { nextStep: 'reg_pending', nextData: ctx.data }
  }
}

// ─── Field-level edit ─────────────────────────────────────────────────────────

async function showEditMenu(ctx: FlowContext): Promise<FlowResult> {
  const { name, skills, serviceAreas, experience, evidenceNote } = ctx.data
  const summary = [
    name            ? `👤 ${name}` : null,
    skills?.length  ? `🔧 ${skills.join(', ')}` : null,
    serviceAreas?.[0] ? `📍 ${serviceAreas[0]}` : null,
    experience      ? `💼 ${experience}` : null,
    evidenceNote    ? `🧾 ${evidenceNote}` : null,
  ].filter(Boolean).join('\n')

  await sendList(
    ctx.phone,
    `✏️ *What would you like to change?*\n\n${summary}\n\nTap a field to update it:`,
    [{ title: 'Your details', rows: [
      { id: 'edit_name',         title: '👤 Name' },
      { id: 'edit_skills',       title: '🔧 Skills' },
      { id: 'edit_area',         title: '📍 Area' },
      { id: 'edit_experience',   title: '💼 Experience' },
      { id: 'edit_evidence',     title: '🧾 Proof note' },
      { id: 'edit_availability', title: '📅 Availability' },
    ]}],
    { buttonLabel: 'Choose Field' }
  )
  return { nextStep: 'reg_edit_field' }
}

async function handleEditField(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.reply.id) {
    case 'edit_name':
      await sendText(ctx.phone, '👤 What is your *full name*?\n\n_(Type and send your name)_')
      return { nextStep: 'reg_collect_skills' }   // handleCollectSkills reads the text as the new name

    case 'edit_skills':
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }

    case 'edit_area':
      return promptArea(ctx)   // sends area list, nextStep: reg_collect_experience

    case 'edit_experience': {
      await sendList(
        ctx.phone,
        '💼 How many years of experience do you have in your trade?',
        [{
          title: 'Experience',
          rows: [
            { id: 'exp_lt1',   title: 'Less than 1 year', description: 'Just starting out' },
            { id: 'exp_1_3',   title: '1–3 years',        description: 'Some experience' },
            { id: 'exp_3_5',   title: '3–5 years',        description: 'Experienced' },
            { id: 'exp_5plus', title: '5+ years',          description: 'Highly experienced' },
          ],
        }],
        { buttonLabel: 'Choose Experience' }
      )
      return { nextStep: 'reg_collect_availability' }
    }

    case 'edit_evidence':
      await sendText(
        ctx.phone,
        '🧾 Share a short note about past work or references you want customers to see later.\n\nReply with your note, or type *skip* to clear it.'
      )
      return { nextStep: 'reg_collect_evidence' }

    case 'edit_availability':
      await sendButtons(
        ctx.phone,
        '📅 Are you available on weekends?\n\nWe get many weekend requests — workers who work Saturdays often get more leads.',
        [
          { id: 'avail_weekdays_only', title: '📋 Weekdays only' },
          { id: 'avail_incl_sat',      title: '📅 Mon–Sat' },
          { id: 'avail_any_day',       title: '✅ Any day' },
        ]
      )
      return { nextStep: 'reg_collect_evidence' }

    default:
      // Unknown reply — re-show the edit menu
      return showEditMenu(ctx)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a WhatsApp reply into a deduplicated, sorted list of 1-based positive integers.
 * Accepts comma, semicolon, and whitespace separators.
 * Rejects floats ("1.2"), non-numeric fragments, and zero/negative numbers.
 * Strips leading # (e.g. "#3" → 3) and trailing period (e.g. "1." → 1).
 * Trailing periods appear when users copy or mimic WhatsApp's rendered numbered list
 * format ("1. Plumbing" → user types "1.").
 *
 * Examples:
 *   "1,3,6"     → [1, 3, 6]
 *   "1 2 3"     → [1, 2, 3]
 *   "1;2;3"     → [1, 2, 3]
 *   "1, 2, 3"   → [1, 2, 3]
 *   "1,1,2,3,2" → [1, 2, 3]  (deduplicated)
 *   "#1,#3"     → [1, 3]
 *   "1.,3."     → [1, 3]      (trailing periods stripped)
 *   "1.2,3"     → [3]         (1.2 is not an integer — rejected)
 *   "1a,3"      → [3]         (1a is not a pure integer — rejected)
 */
function parseNumberedInput(raw: string): number[] {
  const parts = raw.trim().split(/[\s,;]+/).filter(Boolean)
  const seen = new Set<number>()
  for (const part of parts) {
    // Strip leading # (e.g. "#1") and trailing period (e.g. "1." from WhatsApp list copy)
    const stripped = part.replace(/^#/, '').replace(/\.$/, '')
    // Only accept pure digit strings — no floats, no mixed alphanumeric
    if (!/^\d+$/.test(stripped)) continue
    const n = parseInt(stripped, 10)
    if (n > 0) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * Builds a numbered skill selection prompt as a plain text message.
 * Skills are numbered 1–N (PROVIDER_SKILL_OPTIONS, 'other' excluded).
 * Provider replies with comma-separated numbers, e.g. "1,3,6".
 */
function buildSkillPromptText(intro: string, selected: string[] = []): string {
  const lines = PROVIDER_SKILL_OPTIONS.map((o, i) => {
    const selectedSuffix = selected.includes(o.label) ? ' (selected)' : ''
    return `${i + 1}. ${o.label}${selectedSuffix}`
  })
  return (
    `${intro}\n\n` +
    `Reply with all numbers that apply, separated by commas.\n` +
    `Example: *1,3,6*\n\n` +
    lines.join('\n')
  )
}

/**
 * Builds a numbered suburb selection prompt as a plain text message.
 * Numbers are global (1-based across all pages) so "8" always means the 8th suburb
 * regardless of the current page offset.
 */
function buildSuburbPromptText(
  regionLabel: string,
  allSuburbs: Array<{ id: string; label: string }>,
  pageOffset: number,
  selectedLabels: string[],
): string {
  const page = allSuburbs.slice(pageOffset, pageOffset + SUBURB_TEXT_PAGE_SIZE)
  const hasMore = allSuburbs.length > pageOffset + SUBURB_TEXT_PAGE_SIZE
  const total = allSuburbs.length

  const selectedSummary = selectedLabels.length > 0
    ? `\nSelected so far: *${selectedLabels.join(', ')}*\n`
    : ''

  // Global numbering: suburb at index i has number (pageOffset + i + 1)
  const lines = page.map((s, i) => {
    const selectedSuffix = selectedLabels.includes(s.label) ? ' (selected)' : ''
    return `${pageOffset + i + 1}. ${s.label}${selectedSuffix}`
  })

  // Build example numbers from the current page
  const exNums = [pageOffset + 1, Math.min(pageOffset + 3, total)].filter((v, i, a) => a.indexOf(v) === i)
  const example = exNums.join(',')

  const instructions: string[] = [
    `Reply with all numbers for suburbs you cover. Example: *${example}*`,
  ]
  if (selectedLabels.length > 0) instructions.push(`Reply *done* to continue with your current selection.`)
  if (hasMore) instructions.push(`Reply *more* to see the next batch of suburbs.`)
  instructions.push(`Reply *all* to cover the whole ${regionLabel} area.`)

  return (
    `📍 *Which suburbs in ${regionLabel} do you work in?*${selectedSummary}\n` +
    lines.join('\n') +
    `\n\n` +
    instructions.join('\n')
  )
}
