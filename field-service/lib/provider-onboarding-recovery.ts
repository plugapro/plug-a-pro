import type { Prisma } from '@prisma/client'
import { db } from './db'
import { normalizePhone, phoneLookupVariants } from './utils'

export const ONBOARDING_RECOVERY_STAGES = {
  idle_welcome: 'idle_welcome',
  register_no_name: 'register_no_name',
  id_verification_stuck: 'id_verification_stuck',
  skills_picker_stuck: 'skills_picker_stuck',
  location_picker_stuck: 'location_picker_stuck',
  evidence_upload_stuck: 'evidence_upload_stuck',
  flow_conflict: 'flow_conflict',
  submitted_pending: 'submitted_pending',
  submitted_approved: 'submitted_approved',
  completed: 'completed',
  unknown: 'unknown',
} as const

export type OnboardingRecoveryStage = keyof typeof ONBOARDING_RECOVERY_STAGES

export const ONBOARDING_RECOVERY_STAGE_LABELS: Record<OnboardingRecoveryStage, string> = {
  idle_welcome: 'Stuck at welcome',
  register_no_name: 'Tapped Register but no name typed',
  id_verification_stuck: 'Stuck at ID verification',
  skills_picker_stuck: 'Stuck at skills picker',
  location_picker_stuck: 'Stuck at city/location picker',
  evidence_upload_stuck: 'Near finish: evidence upload',
  flow_conflict: 'Flow conflict: customer/provider mixup',
  submitted_pending: 'Submitted: pending review',
  submitted_approved: 'Submitted: approved',
  completed: 'Completed',
  unknown: 'Unknown',
}

export const RECOVERY_MESSAGE_TEMPLATES: Partial<Record<OnboardingRecoveryStage, string>> = {
  idle_welcome: [
    'Hi, thanks for reaching out to Plug A Pro.',
    '',
    'Are you trying to register as a service provider to get more work?',
    '',
    'Reply with:',
    '',
    '1 - Yes, I want to register',
    '2 - I need help',
    '3 - I was just checking',
    '',
    'If you want to register, I can help you finish it quickly here.',
  ].join('\n'),
  register_no_name: [
    'Hi, I saw you started registering on Plug A Pro but did not complete the first step.',
    '',
    'Please reply with your full name and the type of work you do, for example:',
    '',
    '“Thabo Mokoena, plumber”',
    '',
    'Then I’ll help you continue the registration.',
  ].join('\n'),
  id_verification_stuck: [
    'Hi, you are already partway through your Plug A Pro registration.',
    '',
    'It looks like you got stuck at the verification step.',
    '',
    'Please continue inside the secure registration link rather than sending ID documents here.',
    '',
    'If something is not working, send me a screenshot of the error and I’ll help.',
  ].join('\n'),
  skills_picker_stuck: [
    'Hi, you are almost through the Plug A Pro registration.',
    '',
    'It looks like you still need to choose the type of work you do.',
    '',
    'Please select your main service category so we can match you to the right job requests.',
  ].join('\n'),
  location_picker_stuck: [
    'Hi, you are nearly done with your Plug A Pro registration.',
    '',
    'Please choose your area or city so we know where to send suitable job leads.',
    '',
    'If you are stuck, reply with your area and I’ll help.',
  ].join('\n'),
  evidence_upload_stuck: [
    'Hi, you are almost done with your Plug A Pro registration.',
    '',
    'The only thing still missing is the evidence upload step.',
    '',
    'Please go back to the secure registration link and upload the required evidence.',
    '',
    'If the upload is not working, send me a screenshot of the error and I’ll help.',
  ].join('\n'),
  submitted_pending: [
    'Hi, thanks for completing your Plug A Pro application.',
    '',
    'Your profile is now in review.',
    '',
    'Once approved, you’ll be eligible to receive suitable job leads in your area.',
    '',
    'Please keep this WhatsApp number active because this is where important updates will come through.',
  ].join('\n'),
  submitted_approved: [
    'Hi, your Plug A Pro provider application has been approved.',
    '',
    'Please keep this WhatsApp number active because job lead updates will come through here.',
  ].join('\n'),
  flow_conflict: [
    'Hi, it looks like your session may have gone into the wrong flow.',
    '',
    'Just to confirm, are you trying to:',
    '',
    '1 - Register as a service provider',
    '2 - Request a service for your home or business',
    '',
    'Reply with 1 or 2 and I’ll help you continue on the right path.',
  ].join('\n'),
}

const RECOMMENDED_ACTIONS: Record<OnboardingRecoveryStage, string> = {
  idle_welcome: 'Ask if they want to register as a service provider and offer help finishing the flow.',
  register_no_name: 'Ask for full name and trade, then resume provider registration.',
  id_verification_stuck: 'Guide them back to the secure registration or verification link; do not collect ID documents in WhatsApp.',
  skills_picker_stuck: 'Ask for their main service category and help them choose it in the flow.',
  location_picker_stuck: 'Ask for area/city and help them select the correct service area.',
  evidence_upload_stuck: 'Prioritise this user; help them finish the evidence upload from the secure flow.',
  flow_conflict: 'Confirm whether they are registering as a provider or requesting a customer service, then reset the session to the correct flow.',
  submitted_pending: 'No sales follow-up needed; check review queue age and keep the provider informed.',
  submitted_approved: 'No recovery needed; confirm they know how to receive and respond to leads.',
  completed: 'No recovery needed.',
  unknown: 'Inspect the session state before messaging the user.',
}

const FOLLOW_UP_STAGES = new Set<OnboardingRecoveryStage>([
  'idle_welcome',
  'register_no_name',
  'id_verification_stuck',
  'skills_picker_stuck',
  'location_picker_stuck',
  'evidence_upload_stuck',
  'flow_conflict',
  'submitted_pending',
])

const NUDGE_THRESHOLDS_MINUTES: Partial<Record<OnboardingRecoveryStage, number>> = {
  idle_welcome: 15,
  register_no_name: 15,
  id_verification_stuck: 30,
  skills_picker_stuck: 30,
  location_picker_stuck: 30,
  evidence_upload_stuck: 30,
  flow_conflict: 30,
}

const RECOVERY_PRIORITY: Record<OnboardingRecoveryStage, number> = {
  evidence_upload_stuck: 10,
  id_verification_stuck: 20,
  skills_picker_stuck: 20,
  location_picker_stuck: 20,
  register_no_name: 30,
  idle_welcome: 40,
  flow_conflict: 50,
  submitted_pending: 60,
  submitted_approved: 90,
  completed: 100,
  unknown: 999,
}

const ID_VERIFICATION_STEPS = new Set([
  'reg_collect_id',
  'reg_verify_enter_id',
  'reg_verify_upload_doc',
  'reg_verify_upload_selfie',
  'pj_verify_identity',
  'pj_identity_start',
  'pj_identity_consent',
  'pj_identity_basis',
  'pj_identity_identifier',
  'pj_identity_document',
  'pj_identity_selfie',
])

const SKILLS_STEPS = new Set([
  'reg_collect_skills_more',
])

const LOCATION_STEPS = new Set([
  'reg_collect_area',
  'reg_collect_experience',
  'reg_collect_city',
  'reg_collect_region',
  'reg_collect_region_more',
  'reg_collect_suburb_select',
  'reg_collect_suburb_text',
])

type JsonRecord = Record<string, unknown>

export type OnboardingRecoveryConversationInput = {
  id: string
  phone: string
  flow: string
  step: string
  data?: JsonRecord | null
  createdAt?: Date
  updatedAt?: Date
  expiresAt?: Date
}

export type OnboardingRecoveryApplicationInput = {
  id: string
  phone?: string | null
  status: string
  providerId?: string | null
  skills?: string[] | null
  serviceAreas?: string[] | null
  submittedAt?: Date
  updatedAt?: Date
}

export type OnboardingRecoveryProviderInput = {
  id: string
  phone?: string | null
  status?: string | null
  active?: boolean | null
  verified?: boolean | null
  skills?: string[] | null
  serviceAreas?: string[] | null
  updatedAt?: Date
}

export type OnboardingRecoveryClassification = {
  stage: OnboardingRecoveryStage
  label: string
  recommendedNextAction: string
  templateKey: OnboardingRecoveryStage | null
  followUpMessage: string | null
}

export type OnboardingRecoveryRow = OnboardingRecoveryClassification & {
  phoneTail: string
  maskedPhone: string
  lastMessageAt?: Date | null
  lastStateUpdateAt?: Date | null
  source?: string | null
  providerCategory?: string | null
  area?: string | null
  applicationStatus?: string | null
  applicationId?: string | null
  conversationId?: string | null
}

export type OnboardingRecoveryAuditActionType =
  | 'classification'
  | 'manual_follow_up_copied'
  | 'manual_follow_up_sent'
  | 'automated_nudge_sent'
  | 'automated_nudge_skipped'
  | 'user_replied_after_nudge'
  | 'flow_conflict_detected'
  | 'flow_conflict_resolved'
  | 'operator_note'

export type OnboardingRecoveryAuditEvent = {
  actionType: OnboardingRecoveryAuditActionType
  stage: OnboardingRecoveryStage
  createdAt: Date
  result: string
}

export type AutomatedNudgeDecision =
  | { eligible: true; reason: 'eligible'; thresholdMinutes: number }
  | { eligible: false; reason: 'not_nudgeable_stage' | 'stage_already_nudged' | 'daily_cap_reached' | 'not_inactive_long_enough' | 'missing_template'; thresholdMinutes?: number }

export function getRecoveryMessageTemplate(stage: OnboardingRecoveryStage) {
  return RECOVERY_MESSAGE_TEMPLATES[stage] ?? null
}

export function getRecommendedNextAction(stage: OnboardingRecoveryStage) {
  return RECOMMENDED_ACTIONS[stage]
}

export function maskRecoveryPhone(phone: string | null | undefined) {
  const normalized = normalizePhone(phone ?? '')
  const digits = normalized.replace(/\D/g, '')
  if (digits.length < 8) return '***'
  return `+${digits.slice(0, 4)}***${digits.slice(-4)}`
}

export function phoneTail(phone: string | null | undefined) {
  const digits = normalizePhone(phone ?? '').replace(/\D/g, '')
  return digits.slice(-4) || '----'
}

function hasProviderIntentData(data: JsonRecord) {
  return Boolean(
    data.intendedFlow === 'registration' ||
    data.intent === 'provider' ||
    data.providerIntent === true ||
    data.helpRequested === true ||
    Array.isArray(data.skills) ||
    Array.isArray(data.serviceAreas),
  )
}

function isCompletedProvider(provider?: OnboardingRecoveryProviderInput | null) {
  return Boolean(
    provider &&
    provider.active &&
    provider.verified &&
    provider.status === 'ACTIVE',
  )
}

function stageResult(stage: OnboardingRecoveryStage): OnboardingRecoveryClassification {
  const followUpMessage = getRecoveryMessageTemplate(stage)
  return {
    stage,
    label: ONBOARDING_RECOVERY_STAGE_LABELS[stage],
    recommendedNextAction: getRecommendedNextAction(stage),
    templateKey: followUpMessage ? stage : null,
    followUpMessage,
  }
}

export function classifyProviderOnboardingRecovery(params: {
  conversation?: OnboardingRecoveryConversationInput | null
  application?: OnboardingRecoveryApplicationInput | null
  provider?: OnboardingRecoveryProviderInput | null
}): OnboardingRecoveryClassification {
  const { conversation, application, provider } = params
  const data = (conversation?.data ?? {}) as JsonRecord

  if (isCompletedProvider(provider)) return stageResult('completed')

  if (application?.status === 'APPROVED') return stageResult('submitted_approved')
  if (application && ['PENDING', 'MORE_INFO_REQUIRED'].includes(application.status)) {
    return stageResult('submitted_pending')
  }

  if (!conversation) return stageResult('unknown')

  if (conversation.flow === 'help' && data.previousFlow === 'registration') {
    return stageResult('flow_conflict')
  }

  if (conversation.flow === 'job_request' && hasProviderIntentData(data)) {
    return stageResult('flow_conflict')
  }

  if (conversation.flow === 'idle' && conversation.step === 'welcome') {
    return stageResult('idle_welcome')
  }

  if (conversation.flow !== 'registration') return stageResult('unknown')

  if (
    conversation.step === 'reg_collect_name' ||
    (conversation.step === 'reg_collect_skills' && !data.name)
  ) {
    return stageResult('register_no_name')
  }

  if (ID_VERIFICATION_STEPS.has(conversation.step)) return stageResult('id_verification_stuck')
  if (SKILLS_STEPS.has(conversation.step)) return stageResult('skills_picker_stuck')
  if (LOCATION_STEPS.has(conversation.step)) return stageResult('location_picker_stuck')
  if (conversation.step === 'reg_collect_evidence') return stageResult('evidence_upload_stuck')

  return stageResult('unknown')
}

export function shouldSendAutomatedOnboardingNudge(params: {
  stage: OnboardingRecoveryStage
  lastStateUpdateAt: Date
  now: Date
  recentAuditEvents: OnboardingRecoveryAuditEvent[]
}): AutomatedNudgeDecision {
  const thresholdMinutes = NUDGE_THRESHOLDS_MINUTES[params.stage]
  if (!thresholdMinutes) return { eligible: false, reason: 'not_nudgeable_stage' }
  if (!getRecoveryMessageTemplate(params.stage)) return { eligible: false, reason: 'missing_template', thresholdMinutes }

  const dayAgo = new Date(params.now.getTime() - 24 * 60 * 60 * 1000)
  const sentEvents = params.recentAuditEvents.filter((event) =>
    event.actionType === 'automated_nudge_sent' &&
    event.result === 'sent' &&
    event.createdAt >= dayAgo
  )

  if (sentEvents.some((event) => event.stage === params.stage)) {
    return { eligible: false, reason: 'stage_already_nudged', thresholdMinutes }
  }

  if (sentEvents.length >= 3) {
    return { eligible: false, reason: 'daily_cap_reached', thresholdMinutes }
  }

  const inactiveMinutes = Math.floor((params.now.getTime() - params.lastStateUpdateAt.getTime()) / 60_000)
  if (inactiveMinutes < thresholdMinutes) {
    return { eligible: false, reason: 'not_inactive_long_enough', thresholdMinutes }
  }

  return { eligible: true, reason: 'eligible', thresholdMinutes }
}

export function buildDailyActivationReport(params: {
  from: Date
  to: Date
  inboundPhones: string[]
  rows: OnboardingRecoveryRow[]
}) {
  const canonicalInbound = new Set(params.inboundPhones.map((phone) => normalizePhone(phone)))
  const dropOffCounts = Object.fromEntries(
    Object.keys(ONBOARDING_RECOVERY_STAGES).map((stage) => [stage, 0]),
  ) as Record<OnboardingRecoveryStage, number>

  for (const row of params.rows) {
    dropOffCounts[row.stage] += 1
  }

  const followUpRows = params.rows
    .filter((row) => FOLLOW_UP_STAGES.has(row.stage))
    .sort((a, b) => {
      const priority = RECOVERY_PRIORITY[a.stage] - RECOVERY_PRIORITY[b.stage]
      if (priority !== 0) return priority
      return (a.lastStateUpdateAt?.getTime() ?? 0) - (b.lastStateUpdateAt?.getTime() ?? 0)
    })

  const frictionDetected = Object.entries(dropOffCounts)
    .filter(([stage, count]) => count > 0 && FOLLOW_UP_STAGES.has(stage as OnboardingRecoveryStage))
    .map(([stage, count]) => `${ONBOARDING_RECOVERY_STAGE_LABELS[stage as OnboardingRecoveryStage]}: ${count}`)

  return {
    range: { from: params.from.toISOString(), to: params.to.toISOString() },
    totalInboundWhatsAppUsers: canonicalInbound.size,
    welcomeMenuShown: params.rows.length,
    dropOffCounts,
    submittedApplications: dropOffCounts.submitted_pending + dropOffCounts.submitted_approved + dropOffCounts.completed,
    approvedApplications: dropOffCounts.submitted_approved + dropOffCounts.completed,
    pendingApplications: dropOffCounts.submitted_pending,
    usersRequiringFollowUp: followUpRows.length,
    topRecoveryPriorityList: followUpRows.slice(0, 25),
    frictionDetected,
    suggestedOperatorActions: Array.from(new Set(followUpRows.map((row) => row.recommendedNextAction))).slice(0, 8),
  }
}

function maxDate(values: Array<Date | null | undefined>) {
  const timestamps = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime())
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps))
}

function latestByPhone<T extends { phone?: string | null; submittedAt?: Date; updatedAt?: Date }>(records: T[]) {
  const map = new Map<string, T>()
  for (const record of records) {
    const phone = normalizePhone(record.phone ?? '')
    const existing = map.get(phone)
    const existingTime = existing ? (existing.updatedAt ?? existing.submittedAt ?? new Date(0)).getTime() : 0
    const recordTime = (record.updatedAt ?? record.submittedAt ?? new Date(0)).getTime()
    if (!existing || recordTime >= existingTime) map.set(phone, record)
  }
  return map
}

function sourceFrom(data: JsonRecord, messages: Array<{ payload?: unknown; body?: string | null }>) {
  const direct = data.source ?? data.utmSource ?? data.whatsappSource ?? data.referralSource
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  for (const message of messages) {
    const payload = message.payload as { referral?: { source_type?: string; source_url?: string; headline?: string } } | undefined
    const referral = payload?.referral
    if (referral?.source_type) return referral.source_type
    if (referral?.headline) return referral.headline
    if (referral?.source_url) return referral.source_url
  }
  return null
}

export async function getProviderOnboardingRecoveryDashboardData(params: {
  from: Date
  to: Date
  client?: typeof db
}): Promise<{ rows: OnboardingRecoveryRow[]; report: ReturnType<typeof buildDailyActivationReport> }> {
  const client = params.client ?? db
  const inboundMessages = await (client as any).inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: params.from, lte: params.to } },
    orderBy: { firstSeenAt: 'desc' },
    select: { phone: true, body: true, payload: true, firstSeenAt: true, lastSeenAt: true },
  }) as Array<{ phone: string; body: string | null; payload: unknown; firstSeenAt: Date; lastSeenAt: Date }>

  const inboundPhones = Array.from(new Set(inboundMessages.map((message) => normalizePhone(message.phone))))
  const lookupPhones = Array.from(new Set(inboundPhones.flatMap((phone) => phoneLookupVariants(phone))))

  const [conversations, applications, providers] = await Promise.all([
    lookupPhones.length
      ? (client as any).conversation.findMany({
          where: { phone: { in: lookupPhones } },
          select: {
            id: true,
            phone: true,
            flow: true,
            step: true,
            data: true,
            createdAt: true,
            updatedAt: true,
            expiresAt: true,
          },
        })
      : [],
    lookupPhones.length
      ? (client as any).providerApplication.findMany({
          where: { phone: { in: lookupPhones } },
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            phone: true,
            status: true,
            providerId: true,
            skills: true,
            serviceAreas: true,
            submittedAt: true,
            updatedAt: true,
          },
        })
      : [],
    lookupPhones.length
      ? (client as any).provider.findMany({
          where: { phone: { in: lookupPhones } },
          select: {
            id: true,
            phone: true,
            status: true,
            active: true,
            verified: true,
            skills: true,
            serviceAreas: true,
            updatedAt: true,
          },
        })
      : [],
  ]) as [
    OnboardingRecoveryConversationInput[],
    OnboardingRecoveryApplicationInput[],
    OnboardingRecoveryProviderInput[],
  ]

  const conversationsByPhone = latestByPhone(conversations)
  const applicationsByPhone = latestByPhone(applications)
  const providersByPhone = latestByPhone(providers)
  const messagesByPhone = new Map<string, typeof inboundMessages>()
  for (const message of inboundMessages) {
    const phone = normalizePhone(message.phone)
    messagesByPhone.set(phone, [...(messagesByPhone.get(phone) ?? []), message])
  }

  const allPhones = Array.from(new Set([
    ...inboundPhones,
    ...conversations.map((item) => normalizePhone(item.phone)),
    ...applications.map((item) => normalizePhone(item.phone ?? '')),
    ...providers.map((item) => normalizePhone(item.phone ?? '')),
  ].filter(Boolean)))

  const rows = allPhones.map((phone): OnboardingRecoveryRow => {
    const conversation = conversationsByPhone.get(phone) ?? null
    const application = applicationsByPhone.get(phone) ?? null
    const provider = providersByPhone.get(phone) ?? null
    const classification = classifyProviderOnboardingRecovery({ conversation, application, provider })
    const messages = messagesByPhone.get(phone) ?? []
    const lastMessageAt = maxDate(messages.map((message) => message.lastSeenAt))
    const lastStateUpdateAt = maxDate([conversation?.updatedAt, application?.updatedAt, application?.submittedAt, provider?.updatedAt])
    const category = application?.skills?.[0] ?? provider?.skills?.[0] ?? null
    const area = application?.serviceAreas?.[0] ?? provider?.serviceAreas?.[0] ?? null

    return {
      ...classification,
      phoneTail: phoneTail(phone),
      maskedPhone: maskRecoveryPhone(phone),
      lastMessageAt,
      lastStateUpdateAt,
      source: sourceFrom((conversation?.data ?? {}) as JsonRecord, messages),
      providerCategory: category,
      area,
      applicationStatus: application?.status ?? null,
      applicationId: application?.id ?? null,
      conversationId: conversation?.id ?? null,
    }
  }).sort((a, b) => {
    const priority = RECOVERY_PRIORITY[a.stage] - RECOVERY_PRIORITY[b.stage]
    if (priority !== 0) return priority
    return (b.lastStateUpdateAt?.getTime() ?? 0) - (a.lastStateUpdateAt?.getTime() ?? 0)
  })

  return {
    rows,
    report: buildDailyActivationReport({
      from: params.from,
      to: params.to,
      inboundPhones: inboundMessages.map((message) => message.phone),
      rows,
    }),
  }
}

type RecoveryAuditClient = {
  auditLog?: {
    create: (args: any) => unknown
  }
}

export async function recordOnboardingRecoveryAudit(
  client: RecoveryAuditClient,
  params: {
    actionType: OnboardingRecoveryAuditActionType
    stage: OnboardingRecoveryStage
    result: string
    phone?: string
    phoneMasked?: string
    phoneTail?: string
    entityId?: string | null
    actorId?: string
    actorRole?: string
    messageTemplateKey?: string | null
    error?: string | null
    metadata?: Record<string, unknown>
    isTestEvent?: boolean
    cohortName?: string | null
  },
) {
  const action = `provider_onboarding_recovery.${params.actionType}`
  const maskedPhone = params.phoneMasked ?? maskRecoveryPhone(params.phone)
  const tail = params.phoneTail ?? phoneTail(params.phone)

  try {
    await client.auditLog?.create({
      data: {
        actorId: params.actorId ?? 'system',
        actorRole: params.actorRole ?? 'system',
        action,
        entityType: 'Conversation',
        entityId: params.entityId ?? `phone-tail:${tail}`,
        after: {
          stage: params.stage,
          phoneMasked: maskedPhone,
          phoneTail: tail,
          actionType: params.actionType,
          messageTemplateKey: params.messageTemplateKey ?? null,
          result: params.result,
          error: params.error ?? null,
          ...(params.metadata ?? {}),
        } as Prisma.InputJsonValue,
        isTestEvent: params.isTestEvent ?? false,
        cohortName: params.cohortName ?? undefined,
      },
    })
  } catch (error) {
    console.error('[provider-onboarding-recovery] audit log failed', {
      action,
      stage: params.stage,
      phoneMasked: maskedPhone,
      result: params.result,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
