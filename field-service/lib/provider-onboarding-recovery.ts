import { createHash } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { maskPhone } from './support-diagnostics'
import { normalizePhone, phoneLookupVariants } from './utils'
import { sendText as defaultSendText } from './whatsapp-interactive'

export type ProviderOnboardingRecoveryStage =
  | 'welcome_idle'
  | 'register_started_no_name'
  | 'id_verification_started'
  | 'skills_picker'
  | 'city_picker'
  | 'evidence_upload'
  | 'submitted'
  | 'approved'
  | 'pending'
  | 'flow_conflict'

export type ProviderOnboardingRecoveryOutcomeStatus =
  | 'not_contacted'
  | 'message_sent'
  | 'replied'
  | 'completed_registration'
  | 'submitted_application'
  | 'approved'
  | 'not_interested'
  | 'wrong_audience'
  | 'needs_help'
  | 'technical_issue'
  | 'no_response'
  | 'duplicate_or_invalid'
  | 'skipped'

export type ProviderOnboardingRecoveryTemplateKey =
  | 'evidence_upload'
  | 'started_blocked'
  | 'id_verification_stuck'
  | 'skills_picker_stuck'
  | 'location_picker_stuck'
  | 'register_started_no_name'
  | 'welcome_idle'
  | 'flow_conflict'
  | 'submitted_pending'
  | 'submitted_approved'

export type ProviderOnboardingFollowUpStatus =
  | 'due'
  | 'not_due'
  | 'already_sent_for_stage'
  | 'max_followups_24h_reached'
  | 'submitted_excluded'

type RecoveryClient = Pick<
  PrismaClient,
  'inboundWhatsAppMessage' | 'conversation' | 'providerApplication' | 'auditLog'
>

type ClassificationInput = {
  flow: string
  step: string
  data: unknown
  applicationStatus?: string | null
}

export type ProviderOnboardingRecoveryRow = {
  id: string
  source: 'inbound' | 'conversation' | 'application'
  safeUserRef: string
  phoneMasked: string
  phoneTail: string
  providerName: string | null
  serviceCategory: string | null
  area: string | null
  applicationStatus: string | null
  stage: ProviderOnboardingRecoveryStage
  priority: number
  priorityLabel: string
  flow: string | null
  step: string | null
  firstSeenAt: Date
  lastInteractionAt: Date
  messageCount: number
  messageTypes: string[]
  recommendedAction: string
  messageTemplateKey: ProviderOnboardingRecoveryTemplateKey
  followUpMessage: string
  followUpDueAt: Date | null
  followUpStatus: ProviderOnboardingFollowUpStatus
  lastOutcomeStatus: ProviderOnboardingRecoveryOutcomeStatus
  lastOutcomeAt: Date | null
  operatorNotes: string | null
  nextFollowUpAt: Date | null
}

type InboundSnapshot = {
  phone: string
  messageType: string
  firstSeenAt: Date
  lastSeenAt: Date
}

type ConversationSnapshot = {
  id: string
  phone: string
  flow: string
  step: string
  data: unknown
  updatedAt: Date
  timeoutNotifiedAt?: Date | null
}

type ApplicationSnapshot = {
  id: string
  phone: string
  name: string | null
  status: string
  submittedAt: Date
  reviewedAt?: Date | null
  skills?: string[]
  serviceAreas?: string[]
}

type OutcomeEventSnapshot = {
  entityId: string
  timestamp: Date
  after: unknown
}

type BuildRowsInput = {
  now?: Date
  inbound: InboundSnapshot[]
  conversations: ConversationSnapshot[]
  applications: ApplicationSnapshot[]
  outcomeEvents?: OutcomeEventSnapshot[]
}

type SendTextFn = typeof defaultSendText

export type ProviderOnboardingRecoverySendResult = {
  total: number
  due: number
  sent: number
  skipped: number
  errors: number
  rows: ProviderOnboardingRecoveryRow[]
  sentRefs: string[]
  skippedRefs: string[]
  errorRefs: string[]
}

const STAGE_LABELS: Record<ProviderOnboardingRecoveryStage, string> = {
  welcome_idle: 'Stuck at welcome',
  register_started_no_name: 'Tapped Register but no name typed',
  id_verification_started: 'Stuck at ID verification',
  skills_picker: 'Stuck at skills picker',
  city_picker: 'Stuck at city/location picker',
  evidence_upload: 'Near finish: evidence upload',
  submitted: 'Submitted: pending review',
  approved: 'Submitted: approved',
  pending: 'Submitted: pending review',
  flow_conflict: 'Flow conflict: customer/provider mixup',
}

const OUTCOME_STATUSES: ReadonlySet<string> = new Set<ProviderOnboardingRecoveryOutcomeStatus>([
  'not_contacted',
  'message_sent',
  'replied',
  'completed_registration',
  'submitted_application',
  'approved',
  'not_interested',
  'wrong_audience',
  'needs_help',
  'technical_issue',
  'no_response',
  'duplicate_or_invalid',
  'skipped',
])

const WHATSAPP_RECOVERY_SESSION_WINDOW_MS = 23 * 60 * 60_000
const CONVERSATION_RECOVERY_LOCK = new Date(0)

const CUSTOMER_FLOW_MARKERS = [
  'selectedCategory',
  'addressLine1',
  'addressStreet',
  'addrProvinceKey',
  'category',
  'issueDescription',
]

function dataRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function safeRefForPhone(phone: string) {
  const normalizedPhone = normalizePhone(phone)
  return `wa_${createHash('sha256').update(normalizedPhone).digest('hex').slice(0, 10)}`
}

function phoneTail(phone: string) {
  const digits = normalizePhone(phone).replace(/\D/g, '')
  return digits.slice(-4)
}

function latestDate(...dates: Array<Date | null | undefined>) {
  return dates
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0)
}

function isWithinWhatsAppRecoveryWindow(now: Date, lastInteractionAt: Date) {
  return lastInteractionAt.getTime() >= now.getTime() - WHATSAPP_RECOVERY_SESSION_WINDOW_MS
}

function hasCustomerFlowConflict(input: ClassificationInput) {
  const data = dataRecord(input.data)
  if (data.flowConflictDetectedAt) return true
  return input.flow === 'registration' && CUSTOMER_FLOW_MARKERS.some((key) => data[key] != null)
}

export function providerOnboardingStageLabel(stage: ProviderOnboardingRecoveryStage) {
  return STAGE_LABELS[stage]
}

export function classifyProviderOnboardingStage(input: ClassificationInput): ProviderOnboardingRecoveryStage {
  const data = dataRecord(input.data)
  if (hasCustomerFlowConflict(input)) return 'flow_conflict'

  if (input.applicationStatus === 'APPROVED') return 'approved'
  if (input.applicationStatus === 'PENDING' || input.applicationStatus === 'MORE_INFO_REQUIRED') return 'pending'
  if (input.applicationStatus) return 'submitted'

  if (input.flow !== 'registration') return 'welcome_idle'

  if (input.step === 'reg_collect_evidence') return 'evidence_upload'
  if (
    input.step === 'reg_collect_id' ||
    input.step === 'reg_verify_enter_id' ||
    input.step === 'reg_verify_upload_doc' ||
    input.step === 'reg_verify_upload_selfie'
  ) return 'id_verification_started'
  if (input.step === 'reg_collect_name' || input.step === 'reg_start') return 'register_started_no_name'
  if (input.step === 'reg_collect_skills' && !data.name) return 'register_started_no_name'
  if (input.step === 'reg_collect_skills' || input.step === 'reg_collect_skills_more') return 'skills_picker'
  if (
    input.step === 'reg_collect_area' ||
    input.step === 'reg_collect_experience' ||
    input.step === 'reg_collect_city' ||
    input.step === 'reg_collect_region' ||
    input.step === 'reg_collect_region_more' ||
    input.step === 'reg_collect_suburb_select' ||
    input.step === 'reg_collect_suburb_text'
  ) return 'city_picker'
  if (input.step === 'reg_confirm' || input.step === 'reg_pending') return 'submitted'

  return 'welcome_idle'
}

export function recoveryPriorityForStage(stage: ProviderOnboardingRecoveryStage) {
  if (stage === 'evidence_upload') return 1
  if (stage === 'id_verification_started' || stage === 'skills_picker' || stage === 'city_picker') return 2
  if (stage === 'register_started_no_name') return 3
  if (stage === 'welcome_idle') return 4
  if (stage === 'flow_conflict') return 5
  if (stage === 'pending' || stage === 'submitted') return 6
  return 7
}

export function recoveryPriorityLabel(priority: number) {
  switch (priority) {
    case 1: return 'Evidence upload user'
    case 2: return 'Skills/location/ID stuck user'
    case 3: return 'Register tapped, no name'
    case 4: return 'Idle/welcome user'
    case 5: return 'Flow conflict user'
    case 6: return 'Submitted pending'
    default: return 'Submitted approved'
  }
}

export function messageTemplateKeyForStage(stage: ProviderOnboardingRecoveryStage): ProviderOnboardingRecoveryTemplateKey {
  if (stage === 'evidence_upload') return 'evidence_upload'
  if (stage === 'id_verification_started') return 'id_verification_stuck'
  if (stage === 'skills_picker') return 'skills_picker_stuck'
  if (stage === 'city_picker') return 'location_picker_stuck'
  if (stage === 'register_started_no_name') return 'register_started_no_name'
  if (stage === 'flow_conflict') return 'flow_conflict'
  if (stage === 'approved') return 'submitted_approved'
  if (stage === 'pending' || stage === 'submitted') return 'submitted_pending'
  return 'welcome_idle'
}

export function recommendedActionForStage(stage: ProviderOnboardingRecoveryStage) {
  if (stage === 'welcome_idle') return 'Ask if they want to register as a service provider and offer help finishing the flow.'
  if (stage === 'register_started_no_name') return 'Ask for full name and trade, then resume provider registration.'
  if (stage === 'id_verification_started') return 'Guide them back to the secure registration or verification link; do not collect ID documents in WhatsApp.'
  if (stage === 'skills_picker') return 'Ask for their main service category and help them choose it in the flow.'
  if (stage === 'city_picker') return 'Ask for area/city and help them select the correct service area.'
  if (stage === 'evidence_upload') return 'Prioritise this user; help them finish the evidence upload from the secure flow.'
  if (stage === 'flow_conflict') return 'Confirm whether they are registering as a provider or requesting a customer service, then reset the session to the correct flow.'
  if (stage === 'approved') return 'No recovery needed; confirm they know how to receive and respond to leads.'
  return 'No sales follow-up needed; check review queue age and keep the provider informed.'
}

export function buildProviderOnboardingRecoveryMessage(stage: ProviderOnboardingRecoveryStage) {
  switch (stage) {
    case 'evidence_upload':
      return [
        'Hi, you are almost done with your Plug A Pro registration.',
        '',
        'The only thing still missing is the evidence upload step.',
        '',
        'Please go back to the secure registration link and upload the required evidence.',
        '',
        "If the upload is not working, send me a screenshot of the error and I'll help.",
      ].join('\n')
    case 'id_verification_started':
      return [
        'Hi, you are already partway through your Plug A Pro registration.',
        '',
        'It looks like you got stuck at the verification step.',
        '',
        'Please continue inside the secure registration link rather than sending ID documents here.',
        '',
        "If something is not working, send me a screenshot of the error and I'll help.",
      ].join('\n')
    case 'skills_picker':
      return [
        'Hi, you are almost through the Plug A Pro registration.',
        '',
        'It looks like you still need to choose the type of work you do.',
        '',
        'Please select your main service category so we can match you to the right job requests.',
      ].join('\n')
    case 'city_picker':
      return [
        'Hi, you are nearly done with your Plug A Pro registration.',
        '',
        'Please choose your area or city so we know where to send suitable job leads.',
        '',
        "If you are stuck, reply with your area and I'll help.",
      ].join('\n')
    case 'register_started_no_name':
      return [
        'Hi, I saw you started registering on Plug A Pro but did not complete the first step.',
        '',
        'Please reply with your full name and the type of work you do, for example:',
        '',
        '"Thabo Mokoena, plumber"',
        '',
        "Then I'll help you continue the registration.",
      ].join('\n')
    case 'flow_conflict':
      return [
        'Hi, it looks like your session may have gone into the wrong flow.',
        '',
        'Just to confirm, are you trying to:',
        '',
        '1 - Register as a service provider',
        '2 - Request a service for your home or business',
        '',
        "Reply with 1 or 2 and I'll help you continue on the right path.",
      ].join('\n')
    case 'approved':
      return [
        'Hi, your Plug A Pro provider application has been approved.',
        '',
        'Please keep this WhatsApp number active because job lead updates will come through here.',
      ].join('\n')
    case 'pending':
    case 'submitted':
      return [
        'Hi, thanks for completing your Plug A Pro application.',
        '',
        'Your profile is now in review.',
        '',
        "Once approved, you'll be eligible to receive suitable job leads in your area.",
        '',
        'Please keep this WhatsApp number active because this is where important updates will come through.',
      ].join('\n')
    default:
      return [
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
      ].join('\n')
  }
}

function safeProviderFirstName(providerName: string | null) {
  const firstToken = providerName?.trim().split(/\s+/)[0] ?? ''
  const firstName = firstToken.replace(/[^A-Za-z'-]/g, '')
  return firstName.length >= 2 && firstName.length <= 40 ? firstName : null
}

export function personalizeProviderOnboardingRecoveryMessage(
  message: string,
  providerName: string | null,
) {
  const firstName = safeProviderFirstName(providerName)
  if (!firstName) return message
  return message.replace(/^Hi,/, `Hi ${firstName},`)
}

// Kept for existing WhatsApp bot imports while recovery sending lives in this module.
export const buildProviderOnboardingNudgeMessage = buildProviderOnboardingRecoveryMessage

export function buildProviderOnboardingHelpMessage() {
  return [
    '*Provider onboarding help*',
    '',
    'To register: reply JOIN or tap Continue application.',
    'To continue: follow the current WhatsApp step and type the requested detail.',
    'For your name: type your full name, for example Thabo Nkosi.',
    'For manual support: tap Support or reply with what went wrong.',
  ].join('\n')
}

export function buildProviderOnboardingUnsupportedInputMessage(step: string) {
  const stage = classifyProviderOnboardingStage({
    flow: 'registration',
    step,
    data: {},
  })
  if (stage === 'register_started_no_name' || step === 'reg_collect_name' || step === 'reg_collect_skills') {
    return 'Please type your full name in text. Example: Thabo Nkosi. Reply HELP if you are stuck.'
  }
  return 'Please reply in text or use the buttons for this provider application step. Reply HELP if you are stuck.'
}

function followUpThresholdMinutes(stage: ProviderOnboardingRecoveryStage) {
  if (stage === 'welcome_idle' || stage === 'register_started_no_name') return 15
  if (stage === 'flow_conflict') return 30
  if (stage === 'id_verification_started' || stage === 'skills_picker' || stage === 'city_picker') return 30
  if (stage === 'evidence_upload') return 30
  return null
}

function outcomeStatus(value: unknown): ProviderOnboardingRecoveryOutcomeStatus | null {
  return typeof value === 'string' && OUTCOME_STATUSES.has(value)
    ? value as ProviderOnboardingRecoveryOutcomeStatus
    : null
}

function dateFromUnknown(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function eventAfter(event: OutcomeEventSnapshot) {
  return dataRecord(event.after)
}

function followUpStatusForRow(params: {
  now: Date
  stage: ProviderOnboardingRecoveryStage
  dueAt: Date | null
  outcomeEvents: OutcomeEventSnapshot[]
}): ProviderOnboardingFollowUpStatus {
  if (params.stage === 'submitted' || params.stage === 'pending' || params.stage === 'approved') {
    return 'submitted_excluded' satisfies ProviderOnboardingFollowUpStatus
  }

  const stageAlreadySent = params.outcomeEvents.some((event) => {
    const after = eventAfter(event)
    return after.recoveryStage === params.stage && after.outcomeStatus === 'message_sent'
  })
  if (stageAlreadySent) return 'already_sent_for_stage' satisfies ProviderOnboardingFollowUpStatus

  const oneDayAgo = new Date(params.now.getTime() - 24 * 60 * 60_000)
  const sentInLastDay = params.outcomeEvents.filter((event) =>
    event.timestamp >= oneDayAgo && eventAfter(event).outcomeStatus === 'message_sent'
  ).length
  if (sentInLastDay >= 3) return 'max_followups_24h_reached' satisfies ProviderOnboardingFollowUpStatus

  if (params.dueAt && params.now >= params.dueAt) return 'due' satisfies ProviderOnboardingFollowUpStatus
  return 'not_due' satisfies ProviderOnboardingFollowUpStatus
}

function buildInboundStats(inbound: InboundSnapshot[]) {
  const statsByPhone = new Map<string, {
    phone: string
    firstSeenAt: Date
    lastSeenAt: Date
    messageCount: number
    messageTypes: Set<string>
  }>()

  for (const message of inbound) {
    const phone = normalizePhone(message.phone)
    const existing = statsByPhone.get(phone)
    if (!existing) {
      statsByPhone.set(phone, {
        phone,
        firstSeenAt: message.firstSeenAt,
        lastSeenAt: message.lastSeenAt,
        messageCount: 1,
        messageTypes: new Set([message.messageType]),
      })
      continue
    }

    existing.messageCount += 1
    existing.messageTypes.add(message.messageType)
    if (message.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = message.firstSeenAt
    if (message.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = message.lastSeenAt
  }

  return [...statsByPhone.values()]
}

function latestByPhone<T extends { phone: string }>(rows: T[], getDate: (row: T) => Date) {
  const byPhone = new Map<string, T>()
  for (const row of rows) {
    const phone = normalizePhone(row.phone)
    const current = byPhone.get(phone)
    if (!current || getDate(row) > getDate(current)) byPhone.set(phone, row)
  }
  return byPhone
}

export function buildProviderOnboardingRecoveryRowsFromSnapshots(input: BuildRowsInput): ProviderOnboardingRecoveryRow[] {
  const now = input.now ?? new Date()
  const conversationsByPhone = latestByPhone(input.conversations, (row) => row.updatedAt)
  const applicationsByPhone = latestByPhone(input.applications, (row) => row.reviewedAt ?? row.submittedAt)
  const outcomeEventsByRef = new Map<string, OutcomeEventSnapshot[]>()

  for (const event of input.outcomeEvents ?? []) {
    const list = outcomeEventsByRef.get(event.entityId) ?? []
    list.push(event)
    outcomeEventsByRef.set(event.entityId, list)
  }

  const rows = buildInboundStats(input.inbound).map((stats) => {
    const conversation = conversationsByPhone.get(stats.phone)
    const application = applicationsByPhone.get(stats.phone)
    const data = dataRecord(conversation?.data)
    const stage = classifyProviderOnboardingStage({
      flow: conversation?.flow ?? 'idle',
      step: conversation?.step ?? 'welcome',
      data: conversation?.data ?? {},
      applicationStatus: application?.status ?? null,
    })
    const priority = recoveryPriorityForStage(stage)
    const safeUserRef = safeRefForPhone(stats.phone)
    const outcomeEvents = (outcomeEventsByRef.get(safeUserRef) ?? [])
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    const lastOutcome = outcomeEvents[0]
    const lastOutcomeAfter = lastOutcome ? eventAfter(lastOutcome) : {}
    const thresholdMinutes = followUpThresholdMinutes(stage)
    const lastInteractionAt = latestDate(
      stats.lastSeenAt,
      conversation?.updatedAt,
      application?.reviewedAt,
      application?.submittedAt,
    )
    const followUpDueAt = thresholdMinutes
      ? new Date(lastInteractionAt.getTime() + thresholdMinutes * 60_000)
      : null
    const templateKey = messageTemplateKeyForStage(stage)
    const skills = application?.skills?.length ? application.skills : stringArray(data.skills)
    const providerName = application?.name ?? stringValue(data.name)
    const areas = application?.serviceAreas?.length
      ? application.serviceAreas
      : [
          ...stringArray(data.selectedSuburbLabels),
          ...stringArray(data.selectedRegionLabels),
          ...stringArray(data.serviceAreas),
          stringValue(data.city),
          stringValue(data.province),
        ].filter((item): item is string => Boolean(item))

    return {
      id: application?.id ?? conversation?.id ?? safeUserRef,
      source: application ? 'application' as const : conversation ? 'conversation' as const : 'inbound' as const,
      safeUserRef,
      phoneMasked: maskPhone(stats.phone) ?? 'masked',
      phoneTail: phoneTail(stats.phone),
      providerName,
      serviceCategory: skills[0] ?? null,
      area: areas[0] ?? null,
      applicationStatus: application?.status ?? null,
      stage,
      priority,
      priorityLabel: recoveryPriorityLabel(priority),
      flow: conversation?.flow ?? null,
      step: conversation?.step ?? null,
      firstSeenAt: stats.firstSeenAt,
      lastInteractionAt,
      messageCount: stats.messageCount,
      messageTypes: [...stats.messageTypes].sort(),
      recommendedAction: recommendedActionForStage(stage),
      messageTemplateKey: templateKey,
      followUpMessage: personalizeProviderOnboardingRecoveryMessage(
        buildProviderOnboardingRecoveryMessage(stage),
        providerName,
      ),
      followUpDueAt,
      followUpStatus: followUpStatusForRow({ now, stage, dueAt: followUpDueAt, outcomeEvents }),
      lastOutcomeStatus: outcomeStatus(lastOutcomeAfter.outcomeStatus) ?? 'not_contacted',
      lastOutcomeAt: lastOutcome?.timestamp ?? null,
      operatorNotes: stringValue(lastOutcomeAfter.notes),
      nextFollowUpAt: dateFromUnknown(lastOutcomeAfter.nextFollowUpAt),
    }
  })

  return rows.sort((a, b) =>
    a.priority - b.priority ||
    b.lastInteractionAt.getTime() - a.lastInteractionAt.getTime() ||
    a.phoneTail.localeCompare(b.phoneTail)
  )
}

export async function listProviderOnboardingRecoveryRows(
  client: RecoveryClient,
  options: { now?: Date; since?: Date; take?: number } = {},
): Promise<ProviderOnboardingRecoveryRow[]> {
  const now = options.now ?? new Date()
  const since = options.since ?? new Date(now.getTime() - 24 * 60 * 60_000)
  const inbound = await client.inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: since } },
    select: {
      phone: true,
      messageType: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
    orderBy: { firstSeenAt: 'asc' },
    take: options.take ?? 500,
  })
  const phones = [...new Set(inbound.map((row) => normalizePhone(row.phone)))]
  if (phones.length === 0) return []
  const phoneVariants = [...new Set(inbound.flatMap((row) => phoneLookupVariants(row.phone)))]

  const [conversations, applications] = await Promise.all([
    client.conversation.findMany({
      where: { phone: { in: phoneVariants } },
      select: {
        id: true,
        phone: true,
        flow: true,
        step: true,
        data: true,
        updatedAt: true,
        timeoutNotifiedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    client.providerApplication.findMany({
      where: { phone: { in: phoneVariants }, submittedAt: { gte: since } },
      select: {
        id: true,
        phone: true,
        name: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        skills: true,
        serviceAreas: true,
      },
      orderBy: { submittedAt: 'desc' },
    }),
  ])

  const rowsWithoutOutcomes = buildProviderOnboardingRecoveryRowsFromSnapshots({
    now,
    inbound,
    conversations,
    applications,
    outcomeEvents: [],
  })
  const safeRefs = rowsWithoutOutcomes.map((row) => row.safeUserRef)
  const outcomeEvents = safeRefs.length
    ? await client.auditLog.findMany({
        where: {
          action: 'provider_onboarding_recovery.outcome_logged',
          entityType: 'ProviderOnboardingRecovery',
          entityId: { in: safeRefs },
        },
        select: {
          entityId: true,
          timestamp: true,
          after: true,
        },
        orderBy: { timestamp: 'desc' },
        take: 2000,
      })
    : []

  return buildProviderOnboardingRecoveryRowsFromSnapshots({
    now,
    inbound,
    conversations,
    applications,
    outcomeEvents,
  })
}

export function summarizeProviderOnboardingRecoveryRows(rows: ProviderOnboardingRecoveryRow[]) {
  const byStage = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.stage] = (acc[row.stage] ?? 0) + 1
    return acc
  }, {})
  const byPriority = rows.reduce<Record<string, number>>((acc, row) => {
    acc[String(row.priority)] = (acc[String(row.priority)] ?? 0) + 1
    return acc
  }, {})

  return {
    total: rows.length,
    byStage,
    byPriority,
    dueFollowUps: rows.filter((row) => row.followUpStatus === 'due').length,
    submitted: rows.filter((row) => row.stage === 'pending' || row.stage === 'approved' || row.stage === 'submitted').length,
    approved: rows.filter((row) => row.stage === 'approved').length,
    pending: rows.filter((row) => row.stage === 'pending').length,
  }
}

async function buildPhoneMapForRecoveryRows(
  client: RecoveryClient,
  options: { since: Date; take?: number },
) {
  const inbound = await client.inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: options.since } },
    select: { phone: true },
    orderBy: { firstSeenAt: 'asc' },
    take: options.take ?? 500,
  })
  const phoneBySafeRef = new Map<string, string>()
  for (const row of inbound) {
    const normalizedPhone = normalizePhone(row.phone)
    phoneBySafeRef.set(safeRefForPhone(normalizedPhone), normalizedPhone)
  }
  return phoneBySafeRef
}

async function claimRegistrationConversationForRecovery(
  client: RecoveryClient,
  row: ProviderOnboardingRecoveryRow,
) {
  if (row.source !== 'conversation' || row.flow !== 'registration') return true
  const claimed = await client.conversation.updateMany({
    where: { id: row.id, timeoutNotifiedAt: null },
    data: { timeoutNotifiedAt: CONVERSATION_RECOVERY_LOCK },
  })
  return claimed.count > 0
}

async function markRegistrationConversationRecovered(
  client: RecoveryClient,
  row: ProviderOnboardingRecoveryRow,
  now: Date,
) {
  if (row.source !== 'conversation' || row.flow !== 'registration') return
  await client.conversation.updateMany({
    where: { id: row.id, timeoutNotifiedAt: CONVERSATION_RECOVERY_LOCK },
    data: { timeoutNotifiedAt: now },
  })
}

async function releaseRegistrationConversationRecoveryClaim(
  client: RecoveryClient,
  row: ProviderOnboardingRecoveryRow,
) {
  if (row.source !== 'conversation' || row.flow !== 'registration') return
  await client.conversation.updateMany({
    where: { id: row.id, timeoutNotifiedAt: CONVERSATION_RECOVERY_LOCK },
    data: { timeoutNotifiedAt: null },
  }).catch(() => {})
}

async function recordAutomatedRecoverySkip(
  client: RecoveryClient,
  row: ProviderOnboardingRecoveryRow,
  result: string,
  error?: string,
) {
  await recordProviderOnboardingRecoveryOutcome(client, {
    safeUserRef: row.safeUserRef,
    phoneMasked: row.phoneMasked,
    phoneTail: row.phoneTail,
    recoveryStage: row.stage,
    messageTemplateKey: row.messageTemplateKey,
    outcomeStatus: 'skipped',
    notes: result,
    actorId: 'cron:provider-onboarding-recovery',
    actorRole: 'system',
    actionType: 'automated_nudge_skipped',
    result,
    error,
  }).catch((logError) => {
    console.error('[provider-onboarding-recovery] skipped follow-up audit failed', {
      safeUserRef: row.safeUserRef,
      stage: row.stage,
      result,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  })
}

export async function sendProviderOnboardingRecoveryFollowUps(
  client: RecoveryClient,
  options: { now?: Date; since?: Date; take?: number; sendText?: SendTextFn } = {},
): Promise<ProviderOnboardingRecoverySendResult> {
  const now = options.now ?? new Date()
  const since = options.since ?? new Date(now.getTime() - 24 * 60 * 60_000)
  const sendText = options.sendText ?? defaultSendText
  const rows = await listProviderOnboardingRecoveryRows(client, {
    now,
    since,
    take: options.take,
  })
  const dueRows = rows.filter((row) => row.followUpStatus === 'due')
  const result: ProviderOnboardingRecoverySendResult = {
    total: rows.length,
    due: dueRows.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    rows,
    sentRefs: [],
    skippedRefs: [],
    errorRefs: [],
  }

  if (dueRows.length === 0) return result

  const phoneBySafeRef = await buildPhoneMapForRecoveryRows(client, {
    since,
    take: options.take,
  })

  for (const row of dueRows) {
    const phone = phoneBySafeRef.get(row.safeUserRef)
    if (!phone) {
      result.skipped += 1
      result.skippedRefs.push(row.safeUserRef)
      await recordAutomatedRecoverySkip(client, row, 'missing_phone_for_safe_ref')
      continue
    }
    if (!isWithinWhatsAppRecoveryWindow(now, row.lastInteractionAt)) {
      result.skipped += 1
      result.skippedRefs.push(row.safeUserRef)
      await recordAutomatedRecoverySkip(client, row, 'outside_whatsapp_session_window')
      continue
    }

    const claimed = await claimRegistrationConversationForRecovery(client, row)
    if (!claimed) {
      result.skipped += 1
      result.skippedRefs.push(row.safeUserRef)
      await recordAutomatedRecoverySkip(client, row, 'already_claimed_or_not_claimable')
      continue
    }

    try {
      await sendText(phone, row.followUpMessage, {
        templateName: `provider_onboarding_recovery:${row.messageTemplateKey}`,
        metadata: {
          safeUserRef: row.safeUserRef,
          recoveryStage: row.stage,
          followUpDueAt: row.followUpDueAt?.toISOString() ?? null,
        },
      })
      await markRegistrationConversationRecovered(client, row, now)
      await recordProviderOnboardingRecoveryOutcome(client, {
        safeUserRef: row.safeUserRef,
        phoneMasked: row.phoneMasked,
        phoneTail: row.phoneTail,
        recoveryStage: row.stage,
        messageTemplateKey: row.messageTemplateKey,
        outcomeStatus: 'message_sent',
        notes: 'Automatic WhatsApp onboarding recovery sent.',
        actorId: 'cron:provider-onboarding-recovery',
        actorRole: 'system',
        actionType: 'automated_nudge_sent',
        result: 'sent',
      }).catch((logError) => {
        console.error('[provider-onboarding-recovery] sent follow-up audit failed', {
          safeUserRef: row.safeUserRef,
          stage: row.stage,
          error: logError instanceof Error ? logError.message : String(logError),
        })
      })
      result.sent += 1
      result.sentRefs.push(row.safeUserRef)
    } catch (error) {
      await releaseRegistrationConversationRecoveryClaim(client, row)
      result.errors += 1
      result.errorRefs.push(row.safeUserRef)
      await recordAutomatedRecoverySkip(
        client,
        row,
        'send_failed',
        error instanceof Error ? error.message : String(error),
      )
      console.error('[provider-onboarding-recovery] follow-up send failed', {
        safeUserRef: row.safeUserRef,
        stage: row.stage,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export async function recordProviderOnboardingRecoveryOutcome(
  client: Pick<PrismaClient, 'auditLog'>,
  input: {
    safeUserRef: string
    phoneMasked: string
    phoneTail: string
    recoveryStage: ProviderOnboardingRecoveryStage
    messageTemplateKey: ProviderOnboardingRecoveryTemplateKey
    outcomeStatus: ProviderOnboardingRecoveryOutcomeStatus
    notes?: string | null
    nextFollowUpAt?: Date | null
    actorId?: string
    actorRole?: string
    actionType?: string
    result?: string
    error?: string | null
  },
) {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? 'operator:manual',
      actorRole: input.actorRole ?? 'operator',
      action: 'provider_onboarding_recovery.outcome_logged',
      entityType: 'ProviderOnboardingRecovery',
      entityId: input.safeUserRef,
      after: {
        phoneMasked: input.phoneMasked,
        phoneTail: input.phoneTail,
        recoveryStage: input.recoveryStage,
        messageTemplateKey: input.messageTemplateKey,
        outcomeStatus: input.outcomeStatus,
        notes: input.notes ?? null,
        nextFollowUpAt: input.nextFollowUpAt?.toISOString() ?? null,
        actionType: input.actionType ?? 'manual_follow_up_logged',
        result: input.result ?? input.outcomeStatus,
        error: input.error ?? null,
      } satisfies Prisma.InputJsonObject,
    },
  })
}
