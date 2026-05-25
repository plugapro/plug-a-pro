// ─── WhatsApp conversation bot — main inbound router ─────────────────────────
// All inbound WhatsApp messages pass through here.
// Resolves conversation state → dispatches to correct flow → saves new state.
//
// Architecture:
//   Webhook (POST /api/webhooks/whatsapp)
//     → processInboundMessage()
//     → loadConversation()
//     → dispatchToFlow()
//       → job-request.ts | registration.ts | status.ts
//     → saveConversation()

import { db } from './db'
import { Prisma } from '@prisma/client'
import {
  parseInbound,
  parseProviderLeadResponseAction,
  sendText,
  sendButtons,
  sendCtaUrl,
  type InboundMessage,
  type WhatsAppProviderLeadResponse,
  type WhatsAppProviderLeadResponseParseOutput,
} from './whatsapp-interactive'
import {
  handleJobRequestFlow,
  handleRebookFlow,
  showMainMenu,
} from './whatsapp-flows/job-request'
import {
  handleRegistrationFlow,
  REGISTRATION_TRIGGERS,
} from './whatsapp-flows/registration'
import { handleStatusFlow } from './whatsapp-flows/status'
import { handleHelpFlow, HELP_TRIGGERS } from './whatsapp-flows/help'
import {
  handleProviderJourneyFlow,
  handleRunningLateFlow,
  handleProviderDisputeFlow,
  handleInvoiceFlow,
  PROVIDER_JOURNEY_TRIGGERS,
} from './whatsapp-flows/provider-journey'
import type { FlowName, FlowStep, ConversationData } from './whatsapp-flows/types'
import { applyOptIn, applyOptOut } from './whatsapp-policy'
import { normalizePhone } from './utils'
import { createTraceId } from './support-diagnostics'
import { createTestCohortContext } from './internal-test-cohort'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { FLAG_KEYS, isEnabled } from './flags'
import { phoneLookupVariants, resolveWhatsAppUserContext } from './whatsapp-identity'
import { normaliseLocationDisplayName } from './location-format'
import { parseProviderOpportunityArrivalText } from './provider-opportunity-whatsapp'
import {
  buildLeadAcceptedCreditLine,
  buildInsufficientCreditsMessage,
  creditCountLabel,
  getPublicAppUrl,
  getWorkerPortalUrl,
  providerCreditBreakdownLabel,
} from './provider-credit-copy'
import { preferenceLabel } from './client-request-data'
import { ctaLabelFor } from './whatsapp-copy'
import { resolveJourneyRecovery, sendWhatsAppJourneyRecovery, type JourneyUserRole } from './journey-recovery'
import { cascadeToNextShortlistedProvider } from './review-first'
import { handleRfpLeadInterest } from './whatsapp-flows/rfp-lead'
import { resolveProviderWhatsappCommand } from './provider-whatsapp-command-model'
import { createBatchAccumulators } from './whatsapp-batch'
import {
  completeProviderJobFromWhatsApp,
  executeProviderJobCommand,
  findSingleActiveJobForProviderPhone,
  parseProviderJobCommand,
} from './provider-whatsapp-job-commands'
import { parseProviderInterestRateText } from './provider-whatsapp-interest-capture'

// Conversation TTL: configurable via WHATSAPP_SESSION_TIMEOUT_MS (default 30 min)
const DEFAULT_CONVERSATION_TTL_MS = 30 * 60 * 1000
const CONFIGURED_CONVERSATION_TTL_MS = Number(process.env.WHATSAPP_SESSION_TIMEOUT_MS) || DEFAULT_CONVERSATION_TTL_MS
const CONVERSATION_TTL_MS = Math.max(CONFIGURED_CONVERSATION_TTL_MS, DEFAULT_CONVERSATION_TTL_MS)
// 3 s default: WhatsApp delivers batch-selected images as separate events that
// can arrive over 1–3 s. 800 ms caused premature batch flush when the first 3
// of 5 images arrived before the remaining 2, producing a "3 files received"
// confirmation that the user acted on before the rest landed.
const MEDIA_UPLOAD_BATCH_WINDOW_MS = Number(process.env.WHATSAPP_MEDIA_UPLOAD_BATCH_WINDOW_MS) || 3000
// Each window can be tuned independently via its own env var.
// Note: WHATSAPP_PROVIDER_EVIDENCE_BATCH_WINDOW_MS only affects the provider path —
// setting it does NOT change the customer window. Use WHATSAPP_CUSTOMER_PHOTO_BATCH_WINDOW_MS
// to adjust customer batching, or WHATSAPP_MEDIA_UPLOAD_BATCH_WINDOW_MS to adjust both.
const CUSTOMER_PHOTO_BATCH_WINDOW_MS =
  Number(process.env.WHATSAPP_CUSTOMER_PHOTO_BATCH_WINDOW_MS) || MEDIA_UPLOAD_BATCH_WINDOW_MS
const PROVIDER_EVIDENCE_BATCH_WINDOW_MS =
  Number(process.env.WHATSAPP_PROVIDER_EVIDENCE_BATCH_WINDOW_MS) || MEDIA_UPLOAD_BATCH_WINDOW_MS
const CITY_TEXT_SUPERSEDE_WINDOW_MS = Number(process.env.WHATSAPP_CITY_TEXT_SUPERSEDE_WINDOW_MS) || 800
const phoneMessageQueues = new Map<string, Promise<void>>()
const {
  customerPhotoBatches,
  providerEvidenceBatches,
  pendingCityTextMessages,
  recentCityInteractiveSelections,
} = createBatchAccumulators()

async function sendAcceptedLeadFallbackConfirmation(params: {
  phone: string
  leadId: string
  providerId: string
  traceId: string
  holdId?: string
  currentCreditBalance?: number
}) {
  let balance = {
    totalCreditBalance: params.currentCreditBalance ?? 0,
    promoCreditBalance: 0,
    paidCreditBalance: 0,
  }

  try {
    const { getProviderWalletBalanceReadOnly } = await import('./provider-wallet')
    const wallet = await getProviderWalletBalanceReadOnly(params.providerId)
    balance = {
      totalCreditBalance: wallet.totalCreditBalance,
      promoCreditBalance: wallet.promoCreditBalance,
      paidCreditBalance: wallet.paidCreditBalance,
    }
  } catch (error) {
    console.warn('[whatsapp-bot] accept: fallback balance lookup failed', {
      traceId: params.traceId,
      holdId: params.holdId,
      leadId: params.leadId,
      providerId: params.providerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const body =
    `✅ *Lead accepted*\n\n` +
    `You used 1 credit to accept this customer-selected job.\n\n` +
    `💳 ${buildLeadAcceptedCreditLine({
      creditsUsed: LEAD_UNLOCK_COST_CREDITS,
      remainingCredits: balance.totalCreditBalance,
      starterCredits: balance.promoCreditBalance,
      paidCredits: balance.paidCreditBalance,
    })}\n\n` +
    `Full customer details are now unlocked.\n\n` +
    `Reply *menu* to view your active jobs.\n\n` +
    `_Ref: ${params.traceId}_`

  let jobUrl: string | null = null
  try {
    const { getProviderSignedJobHandoverUrlByLeadId } = await import('./provider-lead-access')
    jobUrl = await getProviderSignedJobHandoverUrlByLeadId(params.leadId)
  } catch (error) {
    console.warn('[whatsapp-bot] accept: fallback job URL generation failed', {
      traceId: params.traceId,
      holdId: params.holdId,
      leadId: params.leadId,
      providerId: params.providerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const fallbackContext = {
    templateName: 'post_match_provider_fallback',
    metadata: {
      leadId: params.leadId,
      providerId: params.providerId,
      traceId: params.traceId,
      holdId: params.holdId ?? null,
      source: 'accepted_lead_fallback',
    },
  }

  try {
    if (jobUrl) {
      await sendCtaUrl(params.phone, body, ctaLabelFor('view_job'), jobUrl, undefined, fallbackContext)
    } else {
      await sendText(params.phone, body, fallbackContext)
    }
  } catch (error) {
    console.error('[whatsapp-bot] accept: fallback confirmation failed', {
      traceId: params.traceId,
      holdId: params.holdId,
      leadId: params.leadId,
      providerId: params.providerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Keywords that restart the main menu from any state
const RESET_KEYWORDS = [
  'hi', 'hello', 'hey', 'start', 'menu', 'home', 'restart', 'hola', 'sawubona', 'howzit',
  '0', 'stop', 'exit',          // universal escape
  'terug', 'phinda',            // Afrikaans: "back", Zulu: "again/return"
]

// Keywords that trigger status check
const STATUS_KEYWORDS = ['status', 'booking', 'my booking', 'track', 'where', 'update']

// Keywords that trigger reschedule
const RESCHEDULE_KEYWORDS = ['reschedule', 'change time', 'change date', 'move booking', 'different time']

// Keywords that trigger cancellation
const CANCEL_KEYWORDS = ['cancel', 'cancellation', 'kanselleer', 'stop booking']

// Keywords that show a provider's active jobs list
const PROVIDER_KEYWORDS = ['myjobs', 'my jobs', 'my work', 'jobs']

// Keywords that trigger marketing opt-out
const STOP_PHRASES = ['stop offers', 'unsubscribe', 'stop marketing', 'no marketing', 'opt out', 'optout']

// Keywords that trigger marketing opt-in
const START_PHRASES = ['start offers', 'subscribe', 'start marketing', 'opt in', 'optin']

// Keywords that trigger re-booking from the last completed job
const REBOOK_KEYWORDS = ['rebook', 'book again', 'same job', 'repeat', 'book same']
const ACTIVE_FLOW_NAMES: FlowName[] = [
  'job_request',
  'registration',
  'status',
  'reschedule',
  'cancel',
  'help',
  'provider_job',
  'provider_journey',
  'alt_slot',
]

const RFP_LEAD_RESPONSE_ACTION_STATUSES = [
  'SHORTLISTED',
  'SEND_PENDING',
  'SEND_FAILED',
  'SENT',
  'VIEWED',
  'INTERESTED',
] as const

const RFP_JOB_WINDOW_STATUSES = ['MATCHING', 'SHORTLIST_READY'] as const

type ProviderLeadResponseFallbackHint = 'payload' | 'context' | 'unresolved'

type OpsActionButton = {
  buttonType: 'ops_accept' | 'ops_decline'
  leadId: string
  providerId: string | null
}

function parseOpsActionButton(buttonId: string): OpsActionButton | null {
  const [prefix, leadIdRaw, providerIdRaw] = buttonId.split(':')
  if (prefix !== 'ops_accept' && prefix !== 'ops_decline') {
    return null
  }

  const leadId = leadIdRaw?.trim()
  if (!leadId) return null

  return {
    buttonType: prefix,
    leadId,
    providerId: providerIdRaw?.trim() ? providerIdRaw.trim() : null,
  }
}

type ProviderLeadResponseResolutionSource = 'payload' | 'context' | 'fallback'
type ProviderLeadResponseResolutionErrorCode =
  | 'LEAD_NOT_FOUND'
  | 'LEAD_NOT_ASSIGNED'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_CONTEXT_MISMATCH'
  | 'MISSING_CONTEXT_REFERENCE'
  | 'CONTEXT_LOOKUP_FAILED'
  | 'NO_ACTIVE_LEAD'
  | 'MULTIPLE_ACTIVE_LEADS'

type ProviderLeadResponseResolution =
  | {
      ok: true
      leadId: string
      providerId: string
      requestId: string | null
      source: ProviderLeadResponseResolutionSource
    }
  | {
      ok: false
      reason: ProviderLeadResponseResolutionErrorCode
    }

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const maybeValue = (metadata as Record<string, unknown>)[key]
  return typeof maybeValue === 'string' && maybeValue.trim().length > 0 ? maybeValue.trim() : null
}

function mapProviderLeadResponseFailureMessage(reason: ProviderLeadResponseResolutionErrorCode) {
  if (reason === 'LEAD_NOT_FOUND' || reason === 'LEAD_NOT_ASSIGNED') {
    return '⚠️ This lead could not be found or is not assigned to your account.'
  }
  if (reason === 'PROVIDER_NOT_FOUND') {
    return "We couldn't find your provider profile. Reply *Hi* to continue."
  }
  if (reason === 'PROVIDER_CONTEXT_MISMATCH') {
    return '⚠️ This lead is linked to a different provider profile. Please use the latest lead message.'
  }
  if (reason === 'MISSING_CONTEXT_REFERENCE' || reason === 'CONTEXT_LOOKUP_FAILED') {
    return 'We couldn\'t match this reply to an active lead. Please tap "I\'m Available" from the latest lead message and try again.'
  }
  if (reason === 'MULTIPLE_ACTIVE_LEADS') {
    return 'We found multiple active lead replies. Please use the latest message, or type *menu* and open your jobs list.'
  }
  return 'No matching open lead was found for that response. Reply *menu* to continue.'
}

function mapProviderLeadResponseFailureToActionMessage(reason: ProviderLeadResponseResolutionErrorCode, action: 'available' | 'not_available') {
  const base = action === 'available'
    ? 'Couldn\'t record your availability response.'
    : 'Couldn\'t record your availability response.'

  if (reason === 'NO_ACTIVE_LEAD') {
    return `${base} We couldn't find an open lead for that response.`
  }
  if (reason === 'MULTIPLE_ACTIVE_LEADS') {
    return `${base} We found multiple open leads, so please tap the button from the latest lead message.`
  }
  if (reason === 'CONTEXT_LOOKUP_FAILED' || reason === 'MISSING_CONTEXT_REFERENCE') {
    return `${base} We couldn't link this reply to the lead message. Please tap "I'm Available" from the latest lead message again.`
  }
  if (reason === 'PROVIDER_CONTEXT_MISMATCH') {
    return '⚠️ This lead is linked to a different provider profile. Please use the latest lead message.'
  }
  if (reason === 'LEAD_NOT_FOUND' || reason === 'LEAD_NOT_ASSIGNED') {
    return '⚠️ This lead could not be found or is not assigned to your account.'
  }
  if (reason === 'PROVIDER_NOT_FOUND') {
    return "We couldn't find your provider profile. Reply *Hi* to continue."
  }
  return mapProviderLeadResponseFailureMessage(reason)
}

function mapProviderLeadParseErrorMessage(
  reason: 'UNSUPPORTED_MESSAGE_SHAPE' | 'MALFORMED_PAYLOAD' | 'UNRESOLVED_TEXT_ACTION' | 'NO_CONTEXT_REFERENCE',
): string {
  if (reason === 'NO_CONTEXT_REFERENCE') {
    return 'We couldn\'t match this reply to a lead message. Please tap "I\'m Available" or "Not Available" from the latest lead message.'
  }
  if (reason === 'UNRESOLVED_TEXT_ACTION') {
    return 'We couldn\'t read your lead response text. Tap "I\'m Available" or "Not Available" from the latest lead message.'
  }
  return '⚠️ We couldn\'t read that lead action button. Please tap "I\'m Available" or "Not Available" from the latest lead message.'
}

async function resolveProviderLeadResponseFromContext(contextMessageId: string) {
  const messageEvent = await db.messageEvent.findFirst({
    where: {
      externalId: contextMessageId,
      templateName: 'rfp:job_lead_actions',
    },
    select: { id: true, metadata: true },
  })

  const leadId = metadataString(messageEvent?.metadata, 'leadId')
  const providerId = metadataString(messageEvent?.metadata, 'providerId')
  const requestId = metadataString(messageEvent?.metadata, 'requestId')
  if (!messageEvent || !leadId || !providerId) {
    return {
      ok: false as const,
      messageEventId: messageEvent?.id ?? null,
      reason: 'CONTEXT_LOOKUP_FAILED' as const,
    }
  }

  return {
    ok: true as const,
    messageEventId: messageEvent.id,
    leadId,
    providerId,
    requestId,
  }
}

async function resolveProviderLeadResponse(
  parsed: WhatsAppProviderLeadResponse,
  fallbackHint: ProviderLeadResponseFallbackHint,
): Promise<ProviderLeadResponseResolution> {
  const provider = await findProviderByWhatsAppPhone(parsed.providerPhone, { id: true })
  if (!provider) {
    return { ok: false, reason: 'PROVIDER_NOT_FOUND' }
  }

  if (parsed.providerId && parsed.providerId !== provider.id) {
    return { ok: false, reason: 'PROVIDER_CONTEXT_MISMATCH' }
  }

  let leadId = parsed.leadId
  let requestId: string | null = null
  let source: ProviderLeadResponseResolutionSource = fallbackHint === 'context'
    ? 'context'
    : fallbackHint === 'payload'
      ? 'payload'
      : 'fallback'

  if (!leadId) {
    if (parsed.contextMessageId) {
      const context = await resolveProviderLeadResponseFromContext(parsed.contextMessageId)
      if (!context.ok) {
        return { ok: false, reason: context.reason === 'CONTEXT_LOOKUP_FAILED' ? 'CONTEXT_LOOKUP_FAILED' : 'MISSING_CONTEXT_REFERENCE' }
      }
      if (context.providerId !== provider.id) {
        return { ok: false, reason: 'PROVIDER_CONTEXT_MISMATCH' }
      }
      leadId = context.leadId
      requestId = context.requestId
      source = 'context'
    } else {
      const openLeadCandidates = await db.lead.findMany({
        where: {
          providerId: provider.id,
          status: { in: [...RFP_LEAD_RESPONSE_ACTION_STATUSES] },
          jobRequest: { status: { in: [...RFP_JOB_WINDOW_STATUSES] } },
        },
        select: { id: true, jobRequestId: true },
      })

      if (openLeadCandidates.length === 0) {
        return { ok: false, reason: 'NO_ACTIVE_LEAD' }
      }
      if (openLeadCandidates.length > 1) {
        return { ok: false, reason: 'MULTIPLE_ACTIVE_LEADS' }
      }
      leadId = openLeadCandidates[0]?.id ?? null
      requestId = openLeadCandidates[0]?.jobRequestId ?? null
      source = 'fallback'
    }
  }

  if (!leadId) {
    return { ok: false, reason: 'LEAD_NOT_FOUND' }
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      status: true,
      jobRequest: {
        select: {
          status: true,
        },
      },
    },
  })

  if (!lead) {
    return { ok: false, reason: 'LEAD_NOT_FOUND' }
  }
  if (lead.providerId !== provider.id) {
    return { ok: false, reason: 'LEAD_NOT_ASSIGNED' }
  }
  if (requestId && requestId !== lead.jobRequestId) {
    return {
      ok: false,
      reason: 'PROVIDER_CONTEXT_MISMATCH',
    }
  }

  return {
    ok: true,
    leadId: lead.id,
    providerId: provider.id,
    requestId: lead.jobRequestId,
    source,
  }
}

function firstName(name: string | null | undefined) {
  return (name?.trim() || 'there').split(/\s+/)[0]
}

function maskedPhone(phone: string) {
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`
}

function truncateField(value: string | null | undefined, maxLen: number): string {
  if (!value) return ''
  return value.length > maxLen ? value.slice(0, maxLen - 1) + '…' : value
}

function hasActiveFlow(flow: FlowName, step: FlowStep) {
  return ACTIVE_FLOW_NAMES.includes(flow) && step !== 'welcome' && step !== 'done' && step !== 'cancelled'
}

function activeFlowResumeCopy(flow: FlowName, step: FlowStep) {
  return resolveJourneyRecovery({
    userRole: flow === 'registration' || flow === 'provider_journey' || flow === 'provider_job' ? 'provider' : 'customer',
    channel: 'whatsapp',
    flowName: flow,
    currentStep: step,
    failureType: 'stale_action',
    recoveryClass: 'resume_step',
  }).message
}

async function findProviderByWhatsAppPhone(phone: string, select?: Prisma.ProviderSelect) {
  const normalizedPhone = normalizePhone(phone)
  const exact = await db.provider.findUnique({
    where: { phone: normalizedPhone },
    ...(select ? { select } : {}),
  } as Prisma.ProviderFindUniqueArgs)
  if (exact) return exact as any

  return (db as any).provider.findFirst?.({
    where: { phone: { in: phoneLookupVariants(phone) } },
    ...(select ? { select } : {}),
  }) ?? null
}

function isStatelessNotificationReply(
  reply: ReturnType<typeof parseInbound>,
  rawText: string,
) {
  const id = reply.id ?? ''
  return (
    id === 'back_home' ||
    id === 'session_restart' ||
    id === 'provider_top_up_credits' ||
    id.startsWith('topup_payat_') ||
    id.startsWith('mdc_') ||
    id.startsWith('accept:') ||
    id.startsWith('decline:') ||
    id.startsWith('ops_accept:') ||
    id.startsWith('ops_decline:') ||
    id.startsWith('ops_hd_unavail:') ||
    id.startsWith('ops_hd_toofar:') ||
    id.startsWith('ops_hd_other:') ||
    id.startsWith('hd_unavailable:') ||
    id.startsWith('hd_area:') ||
    id.startsWith('hd_other:') ||
    id.startsWith('match_accept_') ||
    id.startsWith('match_inspect_') ||
    id.startsWith('match_decline_') ||
    id.startsWith('confirm_accept:') ||
    id.startsWith('confirm_decline:') ||
    id.startsWith('not_interested:') ||
    id.startsWith('interested:') ||
    id.startsWith('alt_slot_c:') ||
    id.startsWith('alt_slot_p:') ||
    id.startsWith('alt_cust_ok:') ||
    id.startsWith('alt_cust_no:') ||
    id.startsWith('rematch_yes:') ||
    id.startsWith('rematch_no:') ||
    id.startsWith('quote_accept_') ||
    id.startsWith('quote_decline_') ||
    id.startsWith('completion_yes_') ||
    id.startsWith('completion_no_') ||
    id.startsWith('completion_why_rescheduled_') ||
    id.startsWith('completion_why_not_finished_') ||
    id.startsWith('completion_why_didnt_show_') ||
    id.startsWith('post_match_contact:') ||
    id.startsWith('rebook_confirm:') ||
    id === 'rebook_cancel' ||
    id.startsWith('status_mode_quick_') ||
    id.startsWith('status_mode_review_') ||
    id.startsWith('status_refresh_') ||
    id.startsWith('status_req_') ||
    (!id && (rawText === 'accept' || rawText === 'decline'))
  )
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processInboundMessage(
  message: InboundMessage
): Promise<void> {
  // Normalise to E.164 (+27…). Meta sends without the leading '+'.
  const phone = normalizePhone(message.from)
  if (await shouldBatchCustomerPhotoMessage(phone, message)) {
    return enqueueCustomerPhotoBatch(phone, message)
  }
  if (await shouldBatchProviderEvidenceMessage(phone, message)) {
    return enqueueProviderEvidenceBatch(phone, message)
  }

  if (isCustomerCityInteractiveMessage(message)) {
    markRecentCityInteractiveSelection(phone, message.id)
    cancelPendingCityTextMessage(phone, message.id)
  } else if (await shouldDelayCustomerCityTextMessage(phone, message)) {
    const recentSelection = recentCityInteractiveSelections.get(phone)
    if (recentSelection) {
      console.info('[whatsapp-bot] dropped typed city text because an interactive city selection was just processed', {
        phone,
        droppedMessageId: message.id,
        supersedingMessageId: recentSelection.messageId,
      })
      return
    }
    return enqueuePendingCityTextMessage(phone, message)
  }

  return enqueuePhoneMessage(phone, message)
}

async function shouldBatchCustomerPhotoMessage(phone: string, message: InboundMessage): Promise<boolean> {
  if (message.type !== 'image') return false

  const conversation = await db.conversation.findUnique({
    where: { phone },
    select: { flow: true, step: true, expiresAt: true },
  })

  return Boolean(
    conversation &&
    conversation.flow === 'job_request' &&
    conversation.step === 'collect_photos' &&
    conversation.expiresAt > new Date()
  )
}

async function shouldBatchProviderEvidenceMessage(phone: string, message: InboundMessage): Promise<boolean> {
  if (message.type !== 'image' && message.type !== 'document') return false

  const conversation = await db.conversation.findUnique({
    where: { phone },
    select: { flow: true, step: true, expiresAt: true },
  })

  return Boolean(
    conversation &&
    conversation.flow === 'registration' &&
    conversation.step === 'reg_collect_evidence' &&
    conversation.expiresAt > new Date()
  )
}

function enqueueCustomerPhotoBatch(phone: string, message: InboundMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = customerPhotoBatches.get(phone)
    if (existing) {
      existing.messages.push(message)
      existing.waiters.push({ resolve, reject })
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => flushCustomerPhotoBatch(phone), CUSTOMER_PHOTO_BATCH_WINDOW_MS)
      console.info('[whatsapp-bot] customer photo batch refreshed', {
        normalized_phone: phone,
        whatsapp_message_id: message.id,
        whatsapp_media_id: message.image?.id ?? null,
        batch_size: existing.messages.length,
        batch_window_ms: CUSTOMER_PHOTO_BATCH_WINDOW_MS,
      })
      return
    }

    const batch = {
      messages: [message],
      waiters: [{ resolve, reject }],
      timer: setTimeout(() => flushCustomerPhotoBatch(phone), CUSTOMER_PHOTO_BATCH_WINDOW_MS),
    }
    customerPhotoBatches.set(phone, batch)
    console.info('[whatsapp-bot] customer photo batch started', {
      normalized_phone: phone,
      whatsapp_message_id: message.id,
      whatsapp_media_id: message.image?.id ?? null,
      batch_size: 1,
      batch_window_ms: CUSTOMER_PHOTO_BATCH_WINDOW_MS,
    })
  })
}

function enqueueProviderEvidenceBatch(phone: string, message: InboundMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = providerEvidenceBatches.get(phone)
    if (existing) {
      existing.messages.push(message)
      existing.waiters.push({ resolve, reject })
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => flushProviderEvidenceBatch(phone), PROVIDER_EVIDENCE_BATCH_WINDOW_MS)
      return
    }

    const batch = {
      messages: [message],
      waiters: [{ resolve, reject }],
      timer: setTimeout(() => flushProviderEvidenceBatch(phone), PROVIDER_EVIDENCE_BATCH_WINDOW_MS),
    }
    providerEvidenceBatches.set(phone, batch)
  })
}

function flushCustomerPhotoBatch(phone: string) {
  const batch = customerPhotoBatches.get(phone)
  if (!batch) return
  customerPhotoBatches.delete(phone)
  const batchId = `customer_photo_${crypto.randomUUID().slice(0, 12)}`
  console.info('[whatsapp-bot] customer photo batch flushing', {
    trace_id: batchId,
    normalized_phone: phone,
    files_received: batch.messages.length,
    whatsapp_message_ids: batch.messages.map((message) => message.id),
    whatsapp_media_ids: batch.messages.map((message) => message.image?.id ?? null),
  })

  enqueuePhoneMessageBatch(phone, batch.messages, 'customer_photo')
    .then(() => batch.waiters.forEach((waiter) => waiter.resolve()))
    .catch((error: unknown) => batch.waiters.forEach((waiter) => waiter.reject(error)))
}

function flushProviderEvidenceBatch(phone: string) {
  const batch = providerEvidenceBatches.get(phone)
  if (!batch) return
  providerEvidenceBatches.delete(phone)

  enqueuePhoneMessageBatch(phone, batch.messages, 'provider_evidence')
    .then(() => batch.waiters.forEach((waiter) => waiter.resolve()))
    .catch((error: unknown) => batch.waiters.forEach((waiter) => waiter.reject(error)))
}

async function shouldDelayCustomerCityTextMessage(phone: string, message: InboundMessage): Promise<boolean> {
  if (message.type !== 'text' || !message.text?.body?.trim()) return false

  const conversation = await db.conversation.findUnique({
    where: { phone },
    select: { flow: true, step: true, expiresAt: true },
  })

  return Boolean(
    conversation &&
    conversation.flow === 'job_request' &&
    conversation.step === 'addr_select_city' &&
    conversation.expiresAt > new Date()
  )
}

function isCustomerCityInteractiveMessage(message: InboundMessage): boolean {
  if (message.type !== 'interactive') return false
  const id = message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.id ?? ''
  return id.startsWith('city__') || id === 'city_prev' || id === 'city_next'
}

function enqueuePendingCityTextMessage(phone: string, message: InboundMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = pendingCityTextMessages.get(phone)
    if (existing) {
      clearTimeout(existing.timer)
      existing.resolve()
    }

    const pending = {
      message,
      resolve,
      reject,
      timer: setTimeout(() => flushPendingCityTextMessage(phone), CITY_TEXT_SUPERSEDE_WINDOW_MS),
    }
    pendingCityTextMessages.set(phone, pending)
  })
}

function markRecentCityInteractiveSelection(phone: string, messageId: string) {
  const existing = recentCityInteractiveSelections.get(phone)
  if (existing) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    const current = recentCityInteractiveSelections.get(phone)
    if (current?.messageId === messageId) {
      recentCityInteractiveSelections.delete(phone)
    }
  }, CITY_TEXT_SUPERSEDE_WINDOW_MS)

  recentCityInteractiveSelections.set(phone, { messageId, timer })
}

function cancelPendingCityTextMessage(phone: string, supersedingMessageId: string) {
  const pending = pendingCityTextMessages.get(phone)
  if (!pending) return

  clearTimeout(pending.timer)
  pendingCityTextMessages.delete(phone)
  console.info('[whatsapp-bot] dropped typed city text because an interactive city selection arrived', {
    phone,
    droppedMessageId: pending.message.id,
    supersedingMessageId,
  })
  pending.resolve()
}

function flushPendingCityTextMessage(phone: string) {
  const pending = pendingCityTextMessages.get(phone)
  if (!pending) return
  pendingCityTextMessages.delete(phone)

  enqueuePhoneMessage(phone, pending.message)
    .then(() => pending.resolve())
    .catch((error: unknown) => pending.reject(error))
}

type MediaBatchOptions = {
  suppressCustomerPhotoProgress?: boolean
  customerPhotoBatchSize?: number
  suppressEvidenceFileProgress?: boolean
  evidenceFileBatchSize?: number
}

type MessageBatchMode = 'customer_photo' | 'provider_evidence'

function enqueuePhoneMessage(
  phone: string,
  message: InboundMessage,
  options?: MediaBatchOptions
): Promise<void> {
  const previous = phoneMessageQueues.get(phone) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(() => processInboundMessageUnlocked(message, options))

  phoneMessageQueues.set(phone, current)
  current.finally(() => {
    if (phoneMessageQueues.get(phone) === current) {
      phoneMessageQueues.delete(phone)
    }
  }).catch(() => undefined)
  return current
}

async function handleProviderLeadResponseFromParsedAction(
  phone: string,
  parsedResult: Extract<WhatsAppProviderLeadResponseParseOutput, { ok: true }>,
) {
  const parsed = parsedResult.parsed
  const traceId = createTraceId('wbot')
  const { inboundMessageId, contextMessageId, action, providerPhone } = parsed
  console.info('[whatsapp-bot] rfp_lead_response: parse_hit', {
    traceId,
    inboundMessageId,
    contextMessageId,
    normalizedAction: action,
    rawMessageType: parsed.rawMessageType,
    providerPhoneMasked: maskedPhone(providerPhone),
  })

  const resolved = await resolveProviderLeadResponse(parsed, parsedResult.fallback.leadId)
  if (!resolved.ok) {
    console.warn('[whatsapp-bot] rfp_lead_response: resolution_failed', {
      traceId,
      inboundMessageId,
      contextMessageId,
      providerPhoneMasked: maskedPhone(providerPhone),
      action,
      reason: resolved.reason,
      rawMessageType: parsed.rawMessageType,
    })
    await sendText(
      phone,
      `${mapProviderLeadResponseFailureToActionMessage(resolved.reason, action)}\n\n_Ref: ${traceId}_`,
    )
    return
  }

  console.info('[whatsapp-bot] rfp_lead_response: response_resolved', {
    traceId,
    inboundMessageId,
    contextMessageId,
    leadId: resolved.leadId,
    providerId: resolved.providerId,
    requestId: resolved.requestId,
    source: resolved.source,
    normalizedAction: action,
  })

  if (action === 'available') {
    await handleRfpLeadInterest(phone, resolved.providerId, resolved.leadId, traceId, {
      inboundMessageId,
      contextMessageId,
      source: resolved.source,
    })
    return
  }

  await handleOpsLeadDeclineWithProviderId(phone, resolved.leadId, resolved.providerId, traceId)
}

function enqueuePhoneMessageBatch(phone: string, messages: InboundMessage[], mode: MessageBatchMode): Promise<void> {
  const previous = phoneMessageQueues.get(phone) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      for (let index = 0; index < messages.length; index += 1) {
        const isLast = index === messages.length - 1
        const opts: MediaBatchOptions = mode === 'customer_photo'
          ? { suppressCustomerPhotoProgress: !isLast, customerPhotoBatchSize: messages.length }
          : { suppressEvidenceFileProgress: !isLast, evidenceFileBatchSize: messages.length }
        await processInboundMessageUnlocked(messages[index], opts)
      }
    })

  phoneMessageQueues.set(phone, current)
  current.finally(() => {
    if (phoneMessageQueues.get(phone) === current) {
      phoneMessageQueues.delete(phone)
    }
  }).catch(() => undefined)
  return current
}

async function processInboundMessageUnlocked(
  message: InboundMessage,
  options?: MediaBatchOptions
): Promise<void> {
  // Normalise to E.164 (+27…). Meta sends without the leading '+'.
  const phone = normalizePhone(message.from)
  const reply = parseInbound(message)
  const providerLeadResponse = parseProviderLeadResponseAction(message)
  let flow: FlowName = 'idle'
  let step: FlowStep = 'welcome'
  let data: ConversationData = {}
  let recoveryRole: JourneyUserRole = 'unknown'

  try {
    if (providerLeadResponse.ok && providerLeadResponse.parsed.actionType === 'provider_lead_response') {
      await handleProviderLeadResponseFromParsedAction(phone, providerLeadResponse)
      return
    }
    if (
      !providerLeadResponse.ok &&
      (
        providerLeadResponse.reason.code === 'MALFORMED_PAYLOAD' ||
        (providerLeadResponse.reason.code === 'UNRESOLVED_TEXT_ACTION' && providerLeadResponse.reason.rawMessageType === 'button')
      )
    ) {
      const traceId = createTraceId('wbot')
      if (
        providerLeadResponse.reason.code === 'MALFORMED_PAYLOAD' ||
        providerLeadResponse.reason.code === 'UNRESOLVED_TEXT_ACTION'
      ) {
        console.warn('[whatsapp-bot] rfp_lead_response: malformed_lead_reply', {
          traceId,
          inboundMessageId: providerLeadResponse.reason.inboundMessageId,
          contextMessageId: providerLeadResponse.reason.contextMessageId,
          rawMessageType: providerLeadResponse.reason.rawMessageType,
          value: providerLeadResponse.reason.value,
        })
        await sendText(
          phone,
          `${mapProviderLeadParseErrorMessage(providerLeadResponse.reason.code)}\n\n_Ref: ${traceId}_`,
        )
        return
      }
      await sendText(
        phone,
        `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${traceId}_`,
      )
      return
    }

    // Load or create conversation session
    const conversation = await loadConversation(phone)
    const isExpired = conversation.expiresAt < new Date()
    flow = conversation.flow as FlowName
    step = isExpired ? 'welcome' : (conversation.step as FlowStep)
    data = isExpired ? {} : (conversation.data as ConversationData)

    // Override: reset keywords always restart
    const rawText = reply.text?.toLowerCase() ?? ''

    // ── Marketing opt-out/in — must precede RESET_KEYWORDS and CANCEL_KEYWORDS checks
    // Ordering: marketing consent > cancel booking > reset to menu
    // 'stop offers' / 'unsubscribe' → opt-out (not the same as 'stop' → menu reset)
    if (STOP_PHRASES.some((p) => rawText === p || rawText.startsWith(p + ' '))) {
      await applyOptOut(phone, 'bot', { note: `keyword: "${reply.text?.trim()}"` })
      await sendText(
        phone,
        "✅ You've been unsubscribed from promotional messages.\n\nYou'll still receive important updates about your bookings. 📋\n\nTo re-subscribe, reply: *START OFFERS*"
      )
      return
    }

    // ── Marketing opt-in ──────────────────────────────────────────────────────
    if (START_PHRASES.some((p) => {
      if (p === 'subscribe') return rawText === p   // exact match only
      return rawText === p || rawText.startsWith(p + ' ')
    })) {
      await applyOptIn(phone, 'bot', { note: `keyword: "${reply.text?.trim()}"` })
      await sendText(
        phone,
        "✅ You're now subscribed to special offers and promotions! 🎉\n\nReply *STOP OFFERS* at any time to unsubscribe."
      )
      return
    }

    // Drop reactions, voice notes, stickers — nothing actionable.
    // image/document are allowed through for:
    //   - evidence collection in the provider registration flow (reg_collect_evidence)
    //   - profile photo capture in the provider registration flow (reg_collect_profile_photo)
    //   - customer photo upload in the job-request flow (collect_photos)
    //   - completion photo upload in the provider job completion flow (providerCompletionStep === 'photo')
    // Must be checked BEFORE flow dispatch so mid-flow reactions don't retrigger menus.
    // WHY profile-photo is here: omitting it caused images uploaded at the
    // profile-photo step to be silently dropped — the flow went dead, the user
    // typed "Hi" and got the main menu (provider onboarding silent-failure
    // incident, LoveMojo / Lovemore application).
    if (reply.type === 'other') return
    const isMediaAllowedStep =
      (conversation.flow === 'registration' &&
        (conversation.step === 'reg_collect_evidence' ||
          conversation.step === 'reg_collect_profile_photo')) ||
      (conversation.flow === 'job_request' && conversation.step === 'collect_photos') ||
      // Provider completion photo: conversation is in tech_job_view with a pending
      // completion job and the provider has already supplied the note (photo step).
      (conversation.flow === 'provider_job' &&
        conversation.step === 'tech_job_view' &&
        Boolean((data as ConversationData).pendingCompletionJobId) &&
        (data as ConversationData).providerCompletionStep === 'photo')
    if ((reply.type === 'image' || reply.type === 'document') && !isMediaAllowedStep) {
      console.info('[whatsapp-bot] dropped media at non-media step', {
        normalized_phone: phone,
        whatsapp_message_id: message.id,
        flow: conversation.flow,
        step: conversation.step,
        replyType: reply.type,
        mediaIdSuffix: reply.mediaId?.slice(-8) ?? null,
      })
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'unknown',
        channel: 'whatsapp',
        flowName: conversation.flow,
        currentStep: conversation.step,
        failureType: 'stale_action',
        recoveryClass: hasActiveFlow(conversation.flow as FlowName, conversation.step as FlowStep) ? 'resume_step' : 'return_main_menu',
        messageId: message.id,
      })
      return
    }

    const isReset = RESET_KEYWORDS.some((k) => rawText === k || rawText.startsWith(k + ' '))
    const isStatus = STATUS_KEYWORDS.some((k) => rawText.includes(k))
    const isRegistration = REGISTRATION_TRIGGERS.some(
      (k) => rawText === k || rawText.startsWith(k)
    )
    const isHelp = HELP_TRIGGERS.some((k) => rawText === k || rawText.startsWith(k))
    const isReschedule = RESCHEDULE_KEYWORDS.some((k) => rawText.includes(k))
    const isCancel = CANCEL_KEYWORDS.some((k) => rawText.includes(k))
    const isRebook = REBOOK_KEYWORDS.some((k) => rawText === k || rawText.includes(k))
    const providerCommand = resolveProviderWhatsappCommand(rawText)

    const persistedFlow = conversation.flow as FlowName
    const persistedStep = conversation.step as FlowStep
    const isStatelessReply = isStatelessNotificationReply(reply, rawText)
    const isProviderMenuReply = Boolean(reply.id && [
      'provider_available_jobs',
      'provider_my_jobs',
      'provider_check_status',
      'provider_availability',
      'provider_pause_leads',
      'provider_pause_today',
      'provider_pause_manual',
      'provider_pause_cancel',
      'provider_go_available',
      'pause_30m',
      'pause_1h',
      'pause_2h',
      'pause_today',
      'pause_indefinite',
      'provider_worker_portal',
      'provider_service_areas',
      'provider_profile',
      'provider_support',
      'provider_status',
      'provider_status_retry',
      'provider_application_status',
      'provider_update_application',
      'provider_top_up_credits',
      'provider_topup',
    ].includes(reply.id))
    const identity = await resolveWhatsAppUserContext(phone)
    const selectedMenuPath = reply.id ?? rawText ?? 'unknown'
    const isCustomerRole = identity.role === 'customer'
    const isProviderRole = identity.role === 'provider' || identity.role === 'provider_pending' || identity.role === 'provider_inactive'
    recoveryRole = isCustomerRole ? 'customer' : isProviderRole ? 'provider' : 'unknown'
    const isCustomerJourneyAction = Boolean(
      ['book', 'browse_categories', 'status', 'my_booking', 'start_reschedule', 'start_cancel'].includes(reply.id ?? '') ||
      flow === 'job_request' ||
      flow === 'status' ||
      flow === 'reschedule' ||
      flow === 'cancel'
    )
    const isProviderJourneyAction = Boolean(
      reply.id === 'find_work' ||
      isRegistration ||
      isProviderMenuReply ||
      (isProviderRole && Boolean(providerCommand)) ||
      PROVIDER_JOURNEY_TRIGGERS.some((k) => rawText === k || rawText.startsWith(k)) ||
      flow === 'registration' ||
      flow === 'provider_journey' ||
      flow === 'provider_job'
    )

    if (isProviderRole && isCustomerJourneyAction && !isStatelessReply) {
      console.info('[whatsapp-bot] blocked provider from customer journey', {
        traceId: identity.traceId,
        messageId: message.id,
        rawPhone: message.from,
        normalizedPhone: phone,
        resolvedRole: identity.role,
        providerId: identity.providerId ?? null,
        selectedMenuPath,
        blockedRoleConflict: true,
      })
      await sendText(
        phone,
        `This number is registered as a Plug A Pro provider.\n\nFor now, provider and customer profiles must use separate WhatsApp numbers.\n\nPlease request a service using a different number.`
      )
      await showMainMenu(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (isCustomerRole && isProviderJourneyAction && !isStatelessReply) {
      console.info('[whatsapp-bot] blocked customer from provider journey', {
        traceId: identity.traceId,
        messageId: message.id,
        rawPhone: message.from,
        normalizedPhone: phone,
        resolvedRole: identity.role,
        customerId: identity.customerId ?? null,
        selectedMenuPath,
        blockedRoleConflict: true,
      })
      await sendText(
        phone,
        `This number is already registered as a customer on Plug A Pro.\n\nFor now, customers and providers must use separate WhatsApp numbers.\n\nPlease apply as a provider using a different number.`
      )
      await showMainMenu(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    // Session expired mid-flow — offer contextual resume instead of silently resetting
    // Stateless notification replies must bypass this guard: these button IDs carry
    // all routing context needed to process the action even when the conversation
    // session has timed out.
    if (isExpired && conversation.flow !== 'idle' && !isReset && !isStatelessReply && !isProviderMenuReply) {
      const oldFlow = conversation.flow as FlowName
      const oldData = conversation.data as ConversationData

      if (oldFlow === 'job_request' && oldData.selectedCategory) {
        await sendButtons(
          phone,
          `👋 Your session timed out. You were booking *${oldData.selectedCategory}*.\n\nPick up where you left off?`,
          [
            { id: 'book', title: '🔧 Continue booking' },
            { id: 'session_restart', title: '🏠 Main Menu' },
          ]
        )
        // Preserve category + name so returning customer flow can pre-fill
        await saveConversation({
          phone, flow: 'idle', step: 'welcome',
          data: { selectedCategory: oldData.selectedCategory, category: oldData.category, customerName: oldData.customerName },
        })
        return
      }

      if (oldFlow === 'registration') {
        await sendButtons(
          phone,
          `👋 Your session timed out during your provider application.\n\nContinue where you left off?`,
          [
            { id: 'reg_start', title: '▶️ Continue application' },
            { id: 'session_restart', title: '🏠 Main Menu' },
          ]
        )
        // Keep accumulated registration data so they don't restart from scratch
        await saveConversation({ phone, flow: 'registration', step: 'reg_start', data: oldData })
        return
      }

      // Other flows — just return to main menu
      await showMainMenu(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    // Active onboarding: never let a casual "hi"/"menu"/etc. silently wipe an
    // in-progress provider application. Offer a resume prompt instead. Without
    // this guard, a brief silence — e.g. while a media upload is being
    // processed — followed by "Hi" would dump the user at the main menu and
    // lose every step they had already filled in.
    if (
      isReset &&
      !isExpired &&
      conversation.flow === 'registration' &&
      conversation.step !== 'welcome' &&
      conversation.step !== 'reg_start' &&
      !isStatelessReply &&
      !isProviderMenuReply
    ) {
      await sendButtons(
        phone,
        "👋 You're still completing your provider application.\n\nContinue from where you left off?",
        [
          { id: 'reg_start', title: '▶️ Continue application' },
          { id: 'session_restart', title: '🏠 Main Menu' },
        ],
      )
      // Preserve the current step + accumulated data: do NOT call
      // saveConversation. The user picks Continue (resumes) or Main Menu
      // (which clears state via the existing session_restart handler).
      return
    }

    const isProviderJobList = PROVIDER_KEYWORDS.some((k) => rawText === k)

    // ─── Stateless notification-response intercepts ─────────────────────────────
    // These run regardless of session state — push-notification button replies can
    // arrive hours after the user last interacted; session expiry must not block them.

    if (data.pendingOpportunityLeadId) {
      await handleProviderOpportunityCapture(phone, reply, data)
      return
    }

    if (data.pendingCompletionJobId) {
      await handleProviderCompletionCapture(phone, reply, data)
      return
    }

    // ── Provider location share (post-accept) ──────────────────────────────────
    if (step === 'post_accept_location_prompt') {
      if (reply.id === 'location_skip' || rawText === 'skip') {
        await sendText(phone, "No problem! You can share your location later if needed.")
        await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
        return
      }
      if (reply.type === 'location' && reply.latitude != null && reply.longitude != null) {
        await handleProviderLocationShare(phone, reply.latitude, reply.longitude)
        return
      }
      // Any other message while waiting — re-prompt or ignore
      // Fall through so reset keywords still work
    }

    if (reply.id === 'back_home' || reply.id === 'session_restart' || reply.id === 'cancel_flow') {
      await showMainMenu(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (reply.id === 'flow_continue' && hasActiveFlow(flow, step)) {
      console.info('[whatsapp-bot] active flow continued from resume prompt', {
        traceId: identity.traceId,
        messageId: message.id,
        phone: maskedPhone(phone),
        flow,
        step,
      })
      // Let the current flow re-render its current prompt/list. This preserves
      // accumulated data and avoids treating a casual greeting as new field data.
      reply.id = undefined
      reply.text = undefined
    }

    if (reply.id === 'provider_top_up_credits') {
      const feeRaw = process.env.PAYAT_MERCHANT_FEE_FIXED_CENTS
      const feeCents = feeRaw && Number.isFinite(parseInt(feeRaw, 10)) ? parseInt(feeRaw, 10) : 700
      const feeR = Math.round(feeCents / 100)
      await sendButtons(
        phone,
        `Choose a top-up amount. A R${feeR} counter service fee is added to the amount you pay at the till. Credits are issued automatically once payment is confirmed.`,
        [
          { id: 'topup_payat_10000', title: `R${Math.round((10_000 + feeCents) / 100)} — 2 credits` },
          { id: 'topup_payat_20000', title: `R${Math.round((20_000 + feeCents) / 100)} — 4 credits` },
          { id: 'topup_payat_50000', title: `R${Math.round((50_000 + feeCents) / 100)} — 10 credits` },
        ],
      )
      return
    }

    if (reply.id?.startsWith('topup_payat_')) {
      const amountCents = parseInt(reply.id.replace('topup_payat_', ''), 10)
      const provider = await findProviderByWhatsAppPhone(phone, { id: true })
      if (!provider || !Number.isFinite(amountCents)) {
        await sendText(phone, 'Unable to start top-up. Please try again or visit the provider portal.')
        return
      }
      try {
        const { createPayatTopUpIntent } = await import('./provider-credit-payment-intents')
        const feeRaw = process.env.PAYAT_MERCHANT_FEE_FIXED_CENTS
        const feeAmountCents = feeRaw && Number.isFinite(parseInt(feeRaw, 10)) ? parseInt(feeRaw, 10) : 700
        const result = await createPayatTopUpIntent({
          providerId: provider.id,
          amountCents,
          feeAmountCents,
          providerCellphone: phone,
          metadata: { source: 'whatsapp' },
        })
        const totalR = Math.round(result.payAtAmountCents / 100)
        const creditsR = Math.round(amountCents / 100)
        const feeR = Math.round(feeAmountCents / 100)
        const credits = amountCents / 5000
        // H-10: Send a direct CTA URL as a delivery guarantee — the template
        // notification from notifyProviderPayatTopUpInitiated may be delayed or
        // fail if the template is pending approval.
        if (result.payat.paymentLink) {
          await sendCtaUrl(
            phone,
            `✅ *Pay@ Top-Up Ready*\n\nTap *Pay now* to get your payment barcode.\n\n*Total to pay at the till: R${totalR}*\n  • Credits: R${creditsR} (${credits} credit${credits !== 1 ? 's' : ''})\n  • Counter service fee: R${feeR}\n\nShow the barcode at any Pick n Pay, Shoprite, or Checkers till.`,
            'Pay now',
            result.payat.paymentLink,
          ).catch((error: unknown) => {
            console.error('[whatsapp-bot] Pay@ payment link direct sendCtaUrl failed', {
              intentId: result.intent.id,
              error,
            })
          })
        }
      } catch (err: unknown) {
        // H-4: DUPLICATE_INTENT means an active Pay@ link already exists for this
        // amount. Telling the provider to "try again" would loop — give them a
        // specific message directing them to the link already sent.
        const isIdentityNotVerified =
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: unknown }).code === 'IDENTITY_NOT_VERIFIED'
        const isDuplicate =
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: unknown }).code === 'DUPLICATE_INTENT'
        if (isIdentityNotVerified) {
          let verificationUrl = getPublicAppUrl('/provider/verification')
          try {
            const { issueProviderIdentityVerificationLink } = await import('./identity-verification/link')
            const verificationLink = await issueProviderIdentityVerificationLink({
              providerId: provider.id,
              channel: 'PWA',
            })
            verificationUrl = verificationLink.verificationUrl ?? verificationUrl
          } catch (linkError) {
            console.error('[whatsapp-bot] identity verification link issue failed', {
              providerId: provider.id,
              error: linkError instanceof Error ? linkError.message : String(linkError),
            })
          }
          if (verificationUrl) {
            await sendCtaUrl(
              phone,
              '🛡️ *Identity check required*\n\nYou must complete identity verification before purchasing top-up credits.',
              ctaLabelFor('identity_verification'),
              verificationUrl,
            )
          } else {
            await sendText(
              phone,
              '🛡️ Identity check required. Reply *verify identity* to continue top-ups.',
            )
          }
        } else if (!isDuplicate) {
          console.error('[whatsapp-bot] createPayatTopUpIntent failed', {
            phone,
            amountCents,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        await sendText(
          phone,
          isIdentityNotVerified
            ? 'Please complete identity verification before creating another top-up link.'
            : (isDuplicate
            ? `You already have an active Pay@ top-up link for R${Math.round(amountCents / 100)}. Check your earlier WhatsApp messages for the payment link, or visit the provider portal to start a new one after it expires.`
            : 'Could not create a Pay@ payment link. Please try again or visit the provider portal.')
        )
      }
      return
    }

    if (reply.id?.startsWith('mdc_')) {
      // ── Match decline reason responses ──────────────────────────────────────
      const leadId = reply.id.replace(/^mdc_(unavailable|area|other)_/, '')
      const reasonMap: Record<string, string> = {
        [`mdc_unavailable_${leadId}`]: 'Not available',
        [`mdc_area_${leadId}`]: 'Too far',
        [`mdc_other_${leadId}`]: 'Other',
      }
      const reason = reasonMap[reply.id] ?? 'Declined'
      const provider = await findProviderByWhatsAppPhone(phone, { id: true })
      if (provider) {
        const { declineLead } = await import('./matching-engine')
        await declineLead({ leadId, providerId: provider.id })
      }
      await sendText(phone, `Understood — lead passed (${reason}). We'll keep matching this job with other providers.`)
      return
    }

    if (reply.id?.startsWith('accept:')) {
      // ── Matching engine v2: AssignmentHold acceptance ────────────────────────
      const isShortlistDispatchEnabled = await isEnabled(FLAG_KEYS.SHORTLIST_DISPATCH_V2).catch(() => false)
      // In shortlisted flow, paid accept actions are no longer surfaced and we
      // must prevent any hidden legacy acceptance path from deducting credits.
      if (isShortlistDispatchEnabled) {
        await sendText(
          phone,
          "This lead is in shortlist mode.\n\nNo credits are deducted for the preview step. Please use your shortlist responses (\"I'm interested\" / \"Not interested\") from the lead message.",
        )
        return
      }
      await handleAssignmentHoldAcceptance(phone, reply.id)
      return
    }

    if (!reply.id && (rawText === 'accept' || rawText === 'decline')) {
      // ── Provider typed "accept"/"decline" instead of tapping the button ──────
      // Prefer the current selected-provider confirmation workflow because it is
      // the notified-lead flow and carries the guarded credit handoff.
      const providerForAccept = await findProviderByWhatsAppPhone(phone, { id: true })
      if (providerForAccept) {
        const selectedLead = await db.lead.findFirst({
          where: {
            providerId: providerForAccept.id,
            status: { in: ['CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
            expiresAt: { gt: new Date() },
            jobRequest: {
              status: 'PROVIDER_CONFIRMATION_PENDING',
              selectedProviderId: providerForAccept.id,
            },
          },
          orderBy: [{ notifiedAt: 'desc' }, { sentAt: 'desc' }],
          select: { id: true },
        })
        if (selectedLead) {
          await handleSelectedProviderConfirmation(
            phone,
            `${rawText === 'accept' ? 'confirm_accept' : 'confirm_decline'}:${selectedLead.id}`,
          )
          return
        }

        if (rawText === 'decline') {
          await sendText(
            phone,
            'No current notified lead found to decline. Please use the latest lead message or reply *menu*.',
          )
          return
        }

        // Legacy preview path: find the most recent pending (SENT/VIEWED) lead
        // for this provider and accept it only when shortlist dispatch is off.
        const activeLead = await db.lead.findFirst({
          where: {
            providerId: providerForAccept.id,
            status: { in: ['SENT', 'VIEWED'] },
            expiresAt: { gt: new Date() },
          },
          orderBy: { sentAt: 'desc' },
          select: { assignmentHoldId: true },
        })
        if (activeLead) {
          const isShortlistDispatchEnabled = await isEnabled(FLAG_KEYS.SHORTLIST_DISPATCH_V2).catch(() => false)
          // Keep shortlist lead capture free until customer confirmation; never
          // fall back to legacy paid acceptance by typed "accept".
          if (isShortlistDispatchEnabled) {
            await sendText(
              phone,
              "This lead is in shortlist mode.\n\nNo credits are deducted for the preview step. Tap \"I'm interested\" on the lead message and submit your rate/arrival.",
            )
            return
          }
          if (activeLead.assignmentHoldId) {
            await handleAssignmentHoldAcceptance(phone, `accept:${activeLead.assignmentHoldId}`)
            return
          }
        }
      } else {
        await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
        return
      }
      // No active lead — fall through to main menu
    }

    if (reply.id?.startsWith('decline:')) {
      // ── Matching engine v2: show decline reason sub-menu ─────────────────────
      const holdId = reply.id.slice('decline:'.length)
      await sendButtons(
        phone,
        '❌ *Decline Lead*\n\nWhy are you declining?',
        [
          { id: `hd_unavailable:${holdId}`, title: '📅 Not available' },
          { id: `hd_area:${holdId}`, title: '📍 Too far' },
          { id: `hd_other:${holdId}`, title: '✏️ Other reason' },
        ]
      )
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (
      reply.id?.startsWith('hd_unavailable:') ||
      reply.id?.startsWith('hd_area:') ||
      reply.id?.startsWith('hd_other:')
    ) {
      // ── Matching engine v2: AssignmentHold decline with reason ───────────────
      await handleAssignmentHoldDecline(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('ops_accept:')) {
      // ── OPS_REVIEW / RFP direct lead acceptance (no AssignmentHold) ──────────
      await handleOpsLeadAcceptance(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('ops_decline:')) {
      // ── OPS_REVIEW / RFP direct lead decline — show reason sub-menu ──────────
      const parsed = parseOpsActionButton(reply.id)
      const leadId = parsed?.leadId
      if (!parsed || !leadId) {
        await sendText(phone, `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${createTraceId('wbot')}_`)
        return
      }
      await sendButtons(
        phone,
        '❌ *Not Available*\n\nWhat\'s the reason?',
        [
          { id: `ops_hd_unavail:${leadId}`, title: '📅 Not available' },
          { id: `ops_hd_toofar:${leadId}`, title: '📍 Too far' },
          { id: `ops_hd_other:${leadId}`, title: '✏️ Other reason' },
        ]
      )
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (
      reply.id?.startsWith('ops_hd_unavail:') ||
      reply.id?.startsWith('ops_hd_toofar:') ||
      reply.id?.startsWith('ops_hd_other:')
    ) {
      // ── OPS_REVIEW / RFP lead decline with reason ─────────────────────────────
      await handleOpsLeadDecline(phone, reply.id)
      return
    }

    if (
      reply.id?.startsWith('match_accept_') ||
      reply.id?.startsWith('match_inspect_') ||
      reply.id?.startsWith('match_decline_')
    ) {
      // ── Match-level lead responses (quote flow) ─────────────────────────────
      await handleMatchLeadResponse(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('confirm_accept:') || reply.id?.startsWith('confirm_decline:')) {
      // ── Qualified Shortlist: selected-provider final acceptance/decline ─────
      await handleSelectedProviderConfirmation(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('not_interested:')) {
      // ── Qualified Shortlist: provider declines opportunity preview ──────────
      await handleProviderOpportunityNotInterested(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('interested:')) {
      // ── Qualified Shortlist: provider expresses interest in opportunity ─────
      await handleProviderOpportunityInterested(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('alt_slot_c:')) {
      // ── Phase 5: customer picks / declines an alternative slot ───────────────
      const { handleCustomerSlotResponse } = await import('./whatsapp-flows/alternative-slot')
      await handleCustomerSlotResponse(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('alt_slot_p:')) {
      // ── Phase 5: provider picks / declines an alternative slot ───────────────
      const { handleProviderSlotResponse } = await import('./whatsapp-flows/alternative-slot')
      await handleProviderSlotResponse(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('alt_cust_ok:') || reply.id?.startsWith('alt_cust_no:')) {
      // ── Phase 5: customer confirms / rejects provider's chosen slot ──────────
      const { handleCustomerSlotConfirmation } = await import('./whatsapp-flows/alternative-slot')
      await handleCustomerSlotConfirmation(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('rematch_yes:') || reply.id?.startsWith('rematch_no:')) {
      await handleCustomerRematchCheckResponse(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('quote_accept_') || reply.id?.startsWith('quote_decline_')) {
      // ── Customer quote response buttons ─────────────────────────────────────
      await handleCustomerQuoteResponse(phone, reply.id)
      return
    }


    if (reply.id?.startsWith('completion_yes_')) {
      const matchId = reply.id.slice('completion_yes_'.length)
      const { handleCompletionCheckYes } = await import('./completion-check')
      await handleCompletionCheckYes({ matchId, customerPhone: phone })
      return
    }

    if (reply.id?.startsWith('completion_no_')) {
      const matchId = reply.id.slice('completion_no_'.length)
      const { handleCompletionCheckNo } = await import('./completion-check')
      const { db: _db } = await import('./db')
      const _m = await _db.match.findUnique({ where: { id: matchId }, select: { provider: { select: { name: true } } } })
      await handleCompletionCheckNo({ matchId, customerPhone: phone, providerFirstName: _m?.provider.name.split(' ')[0] ?? 'your provider' })
      return
    }

    if (reply.id?.startsWith('completion_why_rescheduled_')) {
      const matchId = reply.id.slice('completion_why_rescheduled_'.length)
      const { handleCompletionCheckWhyRescheduled } = await import('./completion-check')
      await handleCompletionCheckWhyRescheduled({ matchId, customerPhone: phone })
      return
    }

    if (reply.id?.startsWith('completion_why_not_finished_')) {
      const matchId = reply.id.slice('completion_why_not_finished_'.length)
      const { handleCompletionCheckWhyNotFinished } = await import('./completion-check')
      await handleCompletionCheckWhyNotFinished({ matchId, customerPhone: phone })
      return
    }

    if (reply.id?.startsWith('completion_why_didnt_show_')) {
      const matchId = reply.id.slice('completion_why_didnt_show_'.length)
      const { handleCompletionCheckWhyDidntShow } = await import('./completion-check')
      const { db: _db2 } = await import('./db')
      const _m2 = await _db2.match.findUnique({ where: { id: matchId }, select: { provider: { select: { name: true } } } })
      await handleCompletionCheckWhyDidntShow({ matchId, customerPhone: phone, providerName: _m2?.provider.name ?? 'the provider' })
      return
    }

    if (reply.id?.startsWith('post_match_contact:')) {
      await handlePostMatchContactCustomer(phone, reply.id)
      return
    }

    if (reply.id?.startsWith('rebook_confirm:')) {
      // ── Rebook: customer confirmed — load prior job and enter pre-fill flow ──
      await handleRebookConfirm(phone, reply.id)
      return
    }

    if (reply.id === 'rebook_cancel') {
      // ── Rebook: customer declined — graceful exit ────────────────────────────
      await sendText(phone, "No problem! Type *Request a job* when you're ready.")
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (isRebook && flow === 'idle' && !isReset) {
      // ── Rebook keyword — trigger from idle state only ────────────────────────
      await handleRebookFlow(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (flow === 'job_request' && step !== 'addr_select_city' &&
        (reply.id?.startsWith('city__') || reply.id === 'city_prev' || reply.id === 'city_next')) {
      console.info('[whatsapp-bot] ignored stale city-selection reply after flow advanced', {
        messageId: message.id,
        messageType: message.type,
        replyType: reply.type,
        replyId: reply.id,
        flow,
        step,
      })
      return
    }

    // Provider-journey button IDs can arrive from any flow (e.g. registration sends
    // pj_view_jobs after the "already registered" message). Force the correct flow so
    // the handler that owns these buttons always processes them.
    if (reply.id === 'pj_view_jobs' || reply.id === 'pj_toggle' ||
        reply.id === 'pj_go_online' || reply.id === 'pj_go_offline') {
      flow = 'provider_journey'
      step = 'pj_toggle_available'
    }

    if (reply.id === 'provider_available_jobs') {
      flow = 'provider_journey'
      step = 'pj_available_leads'
    } else if (reply.id === 'provider_my_jobs') {
      flow = 'provider_journey'
      step = 'pj_job_list'
    } else if (reply.id === 'provider_check_status') {
      flow = 'provider_journey'
      step = 'pj_provider_status'
    } else if (reply.id === 'provider_availability') {
      flow = 'provider_journey'
      step = 'pj_toggle_available'
    } else if (reply.id === 'provider_pause_leads' ||
      reply.id === 'provider_pause_today' ||
      reply.id === 'provider_pause_manual' ||
      reply.id === 'provider_pause_cancel' ||
      reply.id === 'pause_30m' ||
      reply.id === 'pause_1h' ||
      reply.id === 'pause_2h' ||
      reply.id === 'pause_today' ||
      reply.id === 'pause_indefinite') {
      flow = 'provider_journey'
      step = 'pj_pause_confirm'
    } else if (reply.id === 'provider_go_available') {
      flow = 'provider_journey'
      step = 'pj_toggle_available'
    } else if (reply.id === 'provider_worker_portal') {
      flow = 'provider_journey'
      step = 'pj_worker_portal'
    } else if (reply.id === 'provider_service_areas') {
      flow = 'provider_journey'
      step = 'pj_service_areas'
    } else if (reply.id === 'provider_profile') {
      flow = 'provider_journey'
      step = 'pj_profile'
    } else if (reply.id === 'provider_support') {
      flow = 'provider_journey'
      step = 'pj_support'
    } else if (reply.id === 'provider_verify_identity') {
      flow = 'provider_journey'
      step = 'pj_verify_identity'
    } else if (reply.id === 'provider_status' || reply.id === 'provider_status_retry') {
      flow = 'provider_journey'
      step = 'pj_provider_status'
    } else if (reply.id === 'provider_application_status') {
      flow = 'provider_journey'
      step = 'pj_application_status'
    } else if (reply.id === 'provider_topup') {
      flow = 'provider_journey'
      step = 'pj_topup_select_amount'
    } else if (reply.id === 'provider_update_application') {
      const application = await db.providerApplication.findFirst({
        // Include MORE_INFO_REQUIRED so providers awaiting requested admin follow-up
        // can continue onboarding from the same menu action.
        where: { phone, status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] } },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          name: true,
          skills: true,
          serviceAreas: true,
          experience: true,
          availability: true,
          evidenceNote: true,
        },
      })

      if (application) {
        flow = 'registration'
        step = 'reg_edit_field'
        data = {
          ...data,
          applicationId: application.id,
          name: application.name,
          skills: application.skills,
          serviceAreas: application.serviceAreas,
          experience: application.experience ?? undefined,
          evidenceNote: application.evidenceNote ?? undefined,
        }
      } else {
        flow = 'provider_journey'
        step = 'pj_profile'
      }
    }

    // ── Provider opportunity interest follow-up ────────────────────────────
    // After tapping "I'm interested" on a dispatched lead, the bot stored
    // pendingOpportunityLeadId and prompted the provider for fee + arrival.
    // Parse that follow-up reply so the response is captured server-side and
    // becomes eligible for customer shortlist generation.
    if (!reply.id && reply.text && data.pendingOpportunityLeadId) {
      const parsed = parseProviderInterestRateText(reply.text)
      if (parsed) {
        const provider = await findProviderByWhatsAppPhone(phone, { id: true })
        if (provider) {
          try {
            const { respondToProviderOpportunity } = await import('./provider-opportunity-responses')
            await respondToProviderOpportunity({
              leadId: data.pendingOpportunityLeadId,
              providerId: provider.id,
              response: 'INTERESTED',
              callOutFeeText: String(parsed.callOutFee),
              estimatedArrivalAt: parsed.estimatedArrivalAt,
              source: 'whatsapp',
              idempotencyKey: `whatsapp:${provider.id}:${data.pendingOpportunityLeadId}:interest:${parsed.raw.slice(0, 32)}`,
            })
            await sendText(
              phone,
              `Thanks — your interest is recorded. Call-out fee: R${parsed.callOutFee}. Earliest arrival: ${parsed.estimatedArrivalAt.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.\n\nThe customer will compare your response with other providers. We'll notify you here if you're selected.\n\nNo credits used.`,
            )
            await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
            return
          } catch (error) {
            console.warn('[whatsapp-bot] interest rate capture failed', {
              phone,
              error: error instanceof Error ? error.message : String(error),
            })
            await sendText(
              phone,
              "Sorry, we couldn't save that response. Please reply with your call-out fee in Rands and an arrival time, e.g. *R250 | tomorrow 09:00*.",
            )
            return
          }
        }
      } else {
        await sendText(
          phone,
          "Please include both your call-out fee in Rands and a clear arrival time, e.g. *R250 | tomorrow 09:00* or *250 today 14:00*.",
        )
        return
      }
    }

    // ── Provider MORE_INFO_REQUIRED reply recognizer ───────────────────────
    // If a provider has an open MORE_INFO_REQUIRED application and replies
    // with free text that is not a recognized command or a button payload,
    // treat the message as the requested more-info follow-up and move the
    // application back to PENDING for admin re-review. Defensive: skip silently
    // when the test/mock environment has no providerApplication delegate.
    if (
      !reply.id
      && reply.text
      && reply.text.trim().length > 4
      && !isReset
      && !isHelp
      && !providerCommand
      && typeof (db as any)?.providerApplication?.findFirst === 'function'
    ) {
      try {
        const moreInfoApp = await db.providerApplication.findFirst({
          where: { phone, status: 'MORE_INFO_REQUIRED' },
          orderBy: { submittedAt: 'desc' },
          select: { id: true },
        })
        if (moreInfoApp) {
          const { resumeMoreInfoApplication } = await import('./provider-applications')
          const result = await resumeMoreInfoApplication(db as any, {
            applicationId: moreInfoApp.id,
            providerNote: reply.text,
          })
          if (result.ok) {
            await sendText(
              phone,
              'Thanks — your reply has been added to your application. Our team will continue the review and update you here.',
            )
            return
          }
        }
      } catch (error) {
        console.warn('[whatsapp-bot] more_info reply check failed', {
          phone,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // ── Provider WhatsApp-complete: direct text shortcuts ──────────────────
    // When a provider with a single active job sends a job-state shortcut
    // ("arrive 14:00", "on the way", "arrived", "start", "complete") we apply
    // the transition directly so the provider does not have to open the menu
    // or the PWA. Multiple-active-job and ambiguous cases fall through to the
    // existing menu-based flow.
    if (isProviderRole && !reply.id) {
      const jobCommand = parseProviderJobCommand(reply.text)
      if (jobCommand) {
        if (jobCommand.kind === 'complete') {
          const lookup = await findSingleActiveJobForProviderPhone(phone)
          if (lookup.state === 'unique' && lookup.status === 'STARTED') {
            await saveConversation({
              phone,
              flow: 'provider_job',
              step: 'tech_job_view',
              data: {
                pendingCompletionJobId: lookup.jobId,
                providerCompletionStep: 'note',
              },
            })
            await sendText(phone, 'Please send a short completion note.')
            return
          }
        }
        const result = await executeProviderJobCommand({ phone, command: jobCommand })
        if (result.ok) {
          await sendText(phone, result.message)
          await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
          return
        }
        if (result.reason === 'NO_ACTIVE_JOB' || result.reason === 'PROVIDER_NOT_FOUND') {
          await sendText(phone, result.message)
          return
        }
        // For AMBIGUOUS_JOB, INVALID_COMMAND, or INVALID_TIME: fall through so
        // the menu can show the provider their list of active jobs.
      }
    }

    // Route to appropriate flow (keyword overrides only when idle or expired)
    if (providerCommand && isProviderRole && !reply.id) {
      // Provider text commands are recoverable from any state. Button replies
      // keep their original IDs because those carry lead/job routing context.
      flow = providerCommand.flow
      step = providerCommand.step
      if (providerCommand.replyId) {
        reply.id = providerCommand.replyId
        reply.title = providerCommand.command
      }
      data = providerCommand.flow === 'provider_journey' ? {} : data
    } else if ((isReset || isExpired) && !isProviderMenuReply) {
      flow = 'idle'
      step = 'welcome'
      data = {}
    } else if (isProviderJobList && flow === 'idle') {
      flow = 'provider_job'
      step = 'tech_job_list'
    } else if (
      flow === 'idle' &&
      ['verify', 'verification', 'verify identity', 'complete verification'].some((k) => rawText === k)
    ) {
      flow = 'provider_journey'
      step = 'pj_verify_identity'
    } else if (
      flow === 'idle' &&
      ['running late', 'delayed', 'late', 'stuck in traffic'].some((k) => rawText === k)
    ) {
      // M5-T3: running-late — stateless, handle immediately
      const lateResult = await handleRunningLateFlow(phone)
      await saveConversation({ phone, flow: 'idle', step: lateResult.nextStep === 'done' ? 'welcome' : lateResult.nextStep, data })
      return
    } else if (
      flow === 'idle' &&
      ['dispute', 'issue', 'issue with job', 'raise issue'].some((k) => rawText === k)
    ) {
      // M5-T4: dispute — two-step; first message sent here, reply handled by provider_journey dispatcher
      const disputeResult = await handleProviderDisputeFlow(phone)
      await saveConversation({ phone, flow: 'provider_journey', step: disputeResult.nextStep, data })
      return
    } else if (
      flow === 'idle' &&
      ['invoice', 'send invoice', 'receipt'].some((k) => rawText === k)
    ) {
      // M5-T5: invoice — stateless, handle immediately
      const invoiceResult = await handleInvoiceFlow(phone)
      await saveConversation({ phone, flow: 'idle', step: invoiceResult.nextStep === 'done' ? 'welcome' : invoiceResult.nextStep, data })
      return
    } else if (PROVIDER_JOURNEY_TRIGGERS.some((k) => rawText === k || rawText.startsWith(k)) && flow === 'idle') {
      flow = 'provider_journey'
      step = 'pj_menu'
    } else if ((isRegistration || reply.id === 'find_work') && flow === 'idle') {
      flow = 'registration'
      step = 'reg_start'
    } else if ((isReschedule || reply.id === 'start_reschedule') && flow === 'idle') {
      flow = 'reschedule'
      step = 'reschedule_reason'
    } else if ((isCancel || reply.id === 'start_cancel') && flow === 'idle') {
      flow = 'cancel'
      step = 'cancel_confirm'
    } else if (isStatus && flow === 'idle') {
      flow = 'status'
      step = 'status_show'
    } else if ((isHelp || reply.id === 'help') && flow === 'idle') {
      flow = 'help'
      step = 'help_menu'
    } else if (reply.id === 'book' || reply.id === 'browse_categories') {
      flow = 'job_request'
      step = 'browse_categories'
    } else if (reply.id === 'status' || reply.id === 'my_booking') {
      flow = 'status'
      step = 'status_show'
    } else if (
      reply.id?.startsWith('status_mode_quick_') ||
      reply.id?.startsWith('status_mode_review_') ||
      reply.id?.startsWith('status_refresh_') ||
      reply.id?.startsWith('status_req_')
    ) {
      flow = 'status'
      step = reply.id.startsWith('status_req_') ? 'status_pick' : 'status_show'
    } else if (reply.id?.startsWith('view_job_') || reply.id?.startsWith('accept_job_') || reply.id?.startsWith('decline_job_')) {
      // Provider job management
      const jobId = reply.id.replace(/^(view_job_|accept_job_|decline_job_)/, '')
      flow = 'provider_job'
      step = reply.id.startsWith('accept_job_') ? 'tech_job_confirm_accept'
           : reply.id.startsWith('decline_job_') ? 'tech_job_confirm_decline'
           : 'tech_job_view'
      data = { ...data, pendingJobId: jobId }
    }

    // Dispatch to flow handler
    const ctx = {
      phone,
      step,
      data,
      reply,
      flow,
      suppressCustomerPhotoProgress: options?.suppressCustomerPhotoProgress,
      customerPhotoBatchSize: options?.customerPhotoBatchSize,
      suppressEvidenceFileProgress: options?.suppressEvidenceFileProgress,
      evidenceFileBatchSize: options?.evidenceFileBatchSize,
    }
    let result: { nextStep: FlowStep; nextData?: Partial<ConversationData> } = { nextStep: step, nextData: data }

    if (
      isReset &&
      !isExpired &&
      reply.id !== 'flow_continue' &&
      hasActiveFlow(persistedFlow, persistedStep) &&
      !isStatelessReply &&
      !isProviderMenuReply
    ) {
      console.info('[whatsapp-bot] main menu blocked because active flow exists', {
        traceId: identity.traceId,
        messageId: message.id,
        phone: maskedPhone(phone),
        flow: persistedFlow,
        step: persistedStep,
        expired: isExpired,
      })
      await sendButtons(
        phone,
        activeFlowResumeCopy(persistedFlow, persistedStep),
        [
          { id: 'flow_continue', title: 'Continue' },
          { id: persistedFlow === 'job_request' ? 'start_cancel' : 'cancel_flow', title: persistedFlow === 'job_request' ? 'Cancel request' : 'Cancel' },
          { id: 'session_restart', title: 'Main menu' },
        ],
      )
      return
    }

    if (flow === 'job_request' || step === 'browse_categories') {
      result = await handleJobRequestFlow({ ...ctx, step: step === 'welcome' && flow === 'job_request' ? 'browse_categories' : step })
    } else if (flow === 'registration') {
      result = await handleRegistrationFlow(ctx)
    } else if (flow === 'status') {
      result = await handleStatusFlow(ctx)
    } else if (flow === 'help') {
      result = await handleHelpFlow(ctx)
    } else if (flow === 'reschedule') {
      result = await handleRescheduleFlow(ctx)
    } else if (flow === 'cancel') {
      result = await handleCancelFlow(ctx)
    } else if (flow === 'provider_job') {
      result = await handleProviderJobFlow(ctx)
    } else if (flow === 'provider_journey') {
      result = await handleProviderJourneyFlow(ctx)
    } else {
      // Only relay free-form text — never relay reset keywords (hi/hello/menu/etc.)
      // isReset means the user wants the main menu, not to message a provider
      if (flow === 'idle' && reply.type === 'text' && rawText.length >= 2 && !isReset) {
        const relayed = await tryMediatedRelay(phone, reply.text ?? '')
        if (relayed) {
          await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
          return
        }
      }

      // Idle / unknown — for providers with free-text input that didn't match
      // any command, show a tip with the most common shortcuts before the menu.
      if (isProviderRole && !reply.id && rawText.length >= 2) {
        await sendText(
          phone,
          `Sorry, I didn't understand "${reply.text?.slice(0, 60) ?? ''}".\n\n` +
          `Quick provider commands:\n` +
          `• *menu* — main menu\n` +
          `• *credits* — check balance\n` +
          `• *my jobs* — your active jobs\n` +
          `• *14:00* or *arrive 14:00* — confirm arrival\n` +
          `• *on the way* / *arrived* / *start* / *complete* — update job\n` +
          `• *interested* / *not interested* — respond to a lead\n` +
          `• Multiple jobs? Add the job ref, e.g. *arrive 14:00 #PAP-JOB-ABC12345*`,
        )
      }

      // Idle / unknown — show main menu
      await showMainMenu(phone)
      result = { nextStep: 'welcome', nextData: {} }
      flow = 'idle'
    }

    console.info('[whatsapp-bot] processed inbound message', {
      messageId: message.id,
      messageType: message.type,
      replyType: reply.type,
      replyId: reply.id,
      flow,
      step,
      nextStep: result.nextStep,
    })

    // Determine if flow is complete
    const terminalSteps: FlowStep[] = ['done', 'cancelled']
    const isTerminal = terminalSteps.includes(result.nextStep)

    await saveConversation({
      phone,
      flow: isTerminal ? 'idle' : flow,
      step: isTerminal ? 'welcome' : result.nextStep,
      data: { ...data, ...(result.nextData ?? {}) },
    })
  } catch (err) {
    console.error('[whatsapp-bot] Error processing inbound message', {
      traceId: createTraceId('wbot'),
      phone: maskedPhone(phone),
      messageId: message.id,
      flow,
      step,
      error: err instanceof Error ? err.message : String(err),
    })
    // Fail gracefully and preserve recoverable state. Do not tell the user to
    // restart blindly: the recovery resolver explains what happened and gives
    // safe next actions without exposing internals.
    try {
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: recoveryRole,
        channel: 'whatsapp',
        flowName: flow,
        currentStep: step,
        failureType: 'unexpected_error',
        // Status check errors should prioritize a refresh action, because users
        // are already expecting a request status result there.
        recoveryClass: flow === 'status' ? 'show_status' : 'retry_same_step',
        messageId: message.id,
        error: err,
      })
    } catch {
      // Ignore send errors in error handler
    }
  }
}

// ─── Conversation state ───────────────────────────────────────────────────────

async function loadConversation(phone: string) {
  const cohort = createTestCohortContext(phone)
  // Use upsert to avoid P2002 when two concurrent webhook deliveries for the same
  // new user both attempt `create` after seeing no existing record.
  return db.conversation.upsert({
    where: { phone },
    create: {
      phone,
      flow: 'idle',
      step: 'welcome',
      data: {},
      isTestSession: cohort.isTestUser,
      cohortName: cohort.cohortName,
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
    update: cohort.isTestUser
      ? { isTestSession: true, cohortName: cohort.cohortName }
      : {}, // no-op for live records when the record already exists
  })
}

async function saveConversation(params: {
  phone: string
  flow: FlowName
  step: FlowStep
  data: ConversationData
}): Promise<void> {
  const cohort = createTestCohortContext(params.phone)
  await db.conversation.upsert({
    where: { phone: params.phone },
    create: {
      phone: params.phone,
      flow: params.flow,
      step: params.step,
      data: params.data as Prisma.InputJsonValue,
      isTestSession: cohort.isTestUser,
      cohortName: cohort.cohortName,
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
    update: {
      flow: params.flow,
      step: params.step,
      data: params.data as Prisma.InputJsonValue,
      ...(cohort.isTestUser ? { isTestSession: true, cohortName: cohort.cohortName } : {}),
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
  })
}

async function tryMediatedRelay(phone: string, text: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) return false

  const provider = await db.provider.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true },
  })

  if (provider) {
    const activeJob = await db.job.findFirst({
      where: {
        providerId: provider.id,
        status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'] },
      },
      include: {
        booking: {
          include: {
            match: {
              include: {
                jobRequest: { include: { customer: true } },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const bookingId = activeJob?.bookingId
    const customer = activeJob?.booking.match.jobRequest.customer
    if (activeJob && customer?.phone) {
      await sendText(
        customer.phone,
        `💬 Message from your provider (${provider.name}):\n${trimmed}\n\nReply here and we'll pass your response back.`,
        {
          bookingId,
          templateName: 'interactive:relay_provider_to_customer',
          metadata: {
            direction: 'provider_to_customer',
            providerId: provider.id,
            jobId: activeJob.id,
          },
        }
      )
      await sendText(phone, '✅ We relayed your message to the customer.', {
        bookingId,
        templateName: 'interactive:relay_ack_provider',
      })
      return true
    }
  }

  const customer = await db.customer.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true },
  })

  if (!customer) return false

  const activeBooking = await db.booking.findFirst({
    where: {
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      match: {
        jobRequest: {
          customerId: customer.id,
        },
      },
    },
    include: {
      match: {
        include: {
          provider: true,
          jobRequest: true,
        },
      },
      job: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (activeBooking?.match.provider?.phone && activeBooking.job && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeBooking.job.status)) {
    await sendText(
      activeBooking.match.provider.phone,
      `💬 Message from your customer (${customer.name}):\n${trimmed}\n\nReply here and we'll pass your response back.`,
      {
        bookingId: activeBooking.id,
        templateName: 'interactive:relay_customer_to_provider',
        metadata: {
          direction: 'customer_to_provider',
          customerId: customer.id,
          jobId: activeBooking.job.id,
        },
      }
    )
    await sendText(phone, '✅ We relayed your message to the provider.', {
      bookingId: activeBooking.id,
      templateName: 'interactive:relay_ack_customer',
    })
    return true
  }

  const activeMatch = await db.match.findFirst({
    where: {
      status: { in: ['MATCHED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETE', 'QUOTED', 'QUOTE_DECLINED'] },
      jobRequest: { customerId: customer.id },
    },
    include: {
      provider: true,
      jobRequest: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (activeMatch?.provider?.phone) {
    await sendText(
      activeMatch.provider.phone,
      `💬 Message from your customer (${customer.name}):\n${trimmed}\n\nReply here and we'll pass your response back.`,
      {
        templateName: 'interactive:relay_customer_to_provider',
        metadata: {
          direction: 'customer_to_provider',
          customerId: customer.id,
          matchId: activeMatch.id,
        },
      }
    )
    await sendText(phone, '✅ We relayed your message to the provider.', {
      templateName: 'interactive:relay_ack_customer',
      metadata: { matchId: activeMatch.id },
    })
    return true
  }

  return false
}

async function handleCustomerRematchCheckResponse(phone: string, actionId: string): Promise<void> {
  const wantsRematch = actionId.startsWith('rematch_yes:')
  const jobRequestId = actionId.split(':')[1] ?? ''

  const customer = await db.customer.findUnique({
    where: { phone },
    select: { id: true, name: true },
  })

  if (!customer) {
    await sendText(phone, "We couldn't verify your request. Reply *Hi* to start again.")
    return
  }

  const jobRequest = await db.jobRequest.findFirst({
    where: {
      id: jobRequestId,
      customerId: customer.id,
    },
    select: {
      id: true,
      category: true,
      title: true,
      status: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      requestedArrivalLatest: true,
    },
  })

  if (!jobRequest) {
    await sendText(phone, "We couldn't find that request. Reply *Hi* if you still need help.")
    return
  }

  if (!wantsRematch) {
    await db.jobRequest.update({
      where: { id: jobRequest.id },
      data: {
        customerRematchCheckRespondedAt: new Date(),
        customerRematchCheckOutcome: 'NO',
      },
    })
    await sendText(phone, `Thanks, ${firstName(customer.name)}. We won't reopen that request.`)
    return
  }

  if (jobRequest.status !== 'EXPIRED') {
    await db.jobRequest.update({
      where: { id: jobRequest.id },
      data: {
        customerRematchCheckRespondedAt: new Date(),
        customerRematchCheckOutcome: 'ALREADY_ACTIVE',
      },
    })
    await sendText(phone, 'Your request is already active, so there is nothing else you need to do right now.')
    return
  }

  await db.jobRequest.update({
    where: { id: jobRequest.id },
    data: {
      status: 'OPEN',
      customerRematchCheckRespondedAt: new Date(),
      customerRematchCheckOutcome: 'YES',
    },
  })

  const { orchestrateMatch } = await import('./matching/orchestrator')
  const result = await orchestrateMatch(jobRequest.id, { triggeredBy: 'rematch' }).catch((error) => {
    console.error('[whatsapp-bot] rematch confirm failed:', error)
    return { status: 'ERROR' as const }
  })

  if (result.status === 'DISPATCHED') {
    await sendText(
      phone,
      `Thanks, ${firstName(customer.name)}. We've reopened your request and sent it to an available provider. We'll update you as soon as they respond.`
    )
    return
  }

  await sendText(
    phone,
    `Thanks, ${firstName(customer.name)}. We've reopened your request and will keep trying while your requested time is still valid.`
  )
}

// ─── Job notification to provider via WhatsApp ───────────────────────────────
// Replaces direct customer ↔ provider contact — all mediated through the platform

export async function notifyProviderNewJob(params: {
  providerPhone: string
  leadId: string
  category: string
  area: string             // suburb/city for display
  description: string      // short job description
  customerInitial: string  // first name only
  expiresInMinutes?: number
  isTestLead?: boolean
}): Promise<void> {
  const { sendCtaUrl } = await import('./whatsapp-interactive')
  const { getProviderLeadAccessUrlByLeadId } = await import('./provider-lead-access')
  const ref = params.leadId.slice(-8).toUpperCase()
  const expiryLabel = params.expiresInMinutes
    ? `${params.expiresInMinutes} min`
    : '4 hours'
  const leadUrl = await getProviderLeadAccessUrlByLeadId(params.leadId)

  if (!leadUrl) {
    throw new Error(`Could not create provider lead access URL for lead ${params.leadId}`)
  }

  const area = normaliseLocationDisplayName(params.area)
  let creditLine = `Showing interest is free. You spend ${creditCountLabel(LEAD_UNLOCK_COST_CREDITS)} only if the customer selects you and you accept the selected job.`
  let safePreview: Awaited<ReturnType<typeof import('./provider-opportunity-responses').getSafeProviderOpportunityPreview>> | null = null
  let providerIdForPreview: string | null = null
  try {
    const lead = await db.lead.findUnique({
      where: { id: params.leadId },
      select: { providerId: true },
    })
    if (lead?.providerId) {
      providerIdForPreview = lead.providerId
      const { getProviderWalletBalanceReadOnly } = await import('./provider-wallet')
      const balance = await getProviderWalletBalanceReadOnly(lead.providerId)
      creditLine = `Showing interest is free. You spend ${creditCountLabel(LEAD_UNLOCK_COST_CREDITS)} only if the customer selects you and you accept the selected job.\nAvailable credits: ${creditCountLabel(balance.totalCreditBalance)} (${providerCreditBreakdownLabel(balance)}).`
      const { getSafeProviderOpportunityPreview } = await import('./provider-opportunity-responses')
      safePreview = await getSafeProviderOpportunityPreview(params.leadId, lead.providerId)
    }
  } catch (error) {
    console.warn('[whatsapp-bot] unable to include provider credits balance in lead notification', {
      leadId: params.leadId,
      providerId: providerIdForPreview,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const preview = safePreview?.request
  const previewArea = preview?.area
    ? [
        preview.area.suburb,
        preview.area.city,
        preview.area.province,
      ].filter(Boolean).join(', ')
    : area
  const previewLines = [
    `*${truncateField(preview?.category ?? params.category, 50)}*${preview?.subcategory ? ` · ${preview.subcategory}` : ''}`,
    `Area: ${truncateField(previewArea, 60)}`,
    preview?.area?.region ? `Region: ${preview.area.region}` : null,
    preview?.urgency ? `Urgency: ${preview.urgency}` : null,
    (preview?.providerPreference ?? preview?.budgetPreference) ? `Matching preference: ${preferenceLabel(preview?.providerPreference ?? preview?.budgetPreference)}` : null,
    preview?.requestedWindowStart
      ? `Preferred time: ${preview.requestedWindowStart.toLocaleString('en-ZA')}`
      : preview?.requestedArrivalLatest
        ? `Preferred time: before ${preview.requestedArrivalLatest.toLocaleString('en-ZA')}`
        : null,
    `Photos: ${preview?.attachments.length ?? 0} available`,
    preview?.description ? `Issue: ${truncateField(preview.description, 200)}` : null,
  ].filter(Boolean).join('\n')

  await sendCtaUrl(
    params.providerPhone,
    `🔔 *New Job Opportunity*\n\n${previewLines}\n\nRef: ${ref} · Expires in ${expiryLabel}\n\nThe customer is comparing suitable providers.\n\n${creditLine}\n\nReply with the buttons sent below, or tap to view photos/full preview.`,
    ctaLabelFor('view_lead'),
    leadUrl,
    { footer: 'Safe preview only. Exact address stays locked.' },
    {
      templateName: 'interactive:new_lead_available',
      metadata: {
        leadId: params.leadId,
        isTestLead: Boolean(params.isTestLead),
        isTestRequest: Boolean(params.isTestLead),
      },
    },
  )
}

export async function notifyProviderApplicationResult(params: {
  applicationId?: string
  phone: string
  name: string
  approved: boolean
  reason?: string
}): Promise<void> {
  if (params.approved) {
    if (params.applicationId) {
      const { notifyProviderApplicationApprovedOnce } = await import('./provider-application-notifications')
      await notifyProviderApplicationApprovedOnce({
        applicationId: params.applicationId,
        phone: params.phone,
        name: params.name,
      })
      return
    }

    // Use sendCtaUrl so the provider can tap directly into their portal
    const { sendCtaUrl, sendText } = await import('./whatsapp-interactive')

    const portalUrl = getPublicAppUrl('/provider')
    if (!portalUrl) {
      await sendText(
        params.phone,
        `🎉 *Congratulations, ${params.name}!*

Your application to join Plug A Pro has been reviewed and you can now receive job leads on the platform.

Log in to complete your profile, set your schedule, and start responding to matching requests.`,
      )
      return
    }

    await sendCtaUrl(
      params.phone,
      `🎉 *Congratulations, ${params.name}!*\n\nYour application to join Plug A Pro has been reviewed and you can now receive job leads on the platform.\n\nLog in to complete your profile, set your schedule, and start responding to matching requests.`,
      ctaLabelFor('worker_portal'),
      portalUrl,
      { footer: 'Welcome to the Plug A Pro network! 👋' }
    )
  } else {
    // Intentional direct sendTemplate bypass: provider applicants have no Customer record,
    // so canSend() would return 'customer_not_found'. This is a provider-facing transactional
    // message (application outcome) — opt-in policy does not apply.
    const { sendTemplate } = await import('./whatsapp')
    await sendTemplate({
      to: params.phone,
      template: 'technician_application_declined',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.name },
            { type: 'text', text: params.reason ? `at this time: ${params.reason}` : 'at this time' },
          ],
        },
      ],
    })
  }
}

// ─── Reschedule flow ──────────────────────────────────────────────────────────

async function handleRescheduleFlow(
  ctx: Parameters<typeof handleJobRequestFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendText } = await import('./whatsapp-interactive')

  if (ctx.step === 'reschedule_reason') {
    // Find latest active booking
    const customer = await db.customer.findUnique({
      where: { phone: ctx.phone },
    })
    if (!customer) {
      await sendText(ctx.phone, "📋 No active bookings found for your number. Send 'Hi' to submit a new request.")
      return { nextStep: 'done' }
    }

    const booking = await db.booking.findFirst({
      where: {
        status: { in: ['SCHEDULED', 'RESCHEDULED'] },
        match: {
          jobRequest: { customerId: customer.id },
        },
      },
      include: {
        match: {
          include: {
            jobRequest: true,
          },
        },
        job: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!booking || (booking.job && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(booking.job.status))) {
      await sendText(ctx.phone, "You don't have any active bookings to reschedule. Send 'Hi' to submit a new request.")
      return { nextStep: 'done' }
    }

    await sendButtons(
      ctx.phone,
      `🔄 *Reschedule Request*\n\n🔧 ${truncateField(booking.match.jobRequest.category, 50)}\n\nWhy do you need to reschedule?`,
      [
        { id: 'rs_personal', title: '👤 Personal reason' },
        { id: 'rs_work', title: '💼 Work conflict' },
        { id: 'rs_other', title: '✏️ Other' },
      ]
    )
    return { nextStep: 'reschedule_confirm', nextData: { rescheduleBookingId: booking.id } }
  }

  if (ctx.step === 'reschedule_confirm') {
    if (ctx.reply.id?.startsWith('rs_')) {
      const reasons: Record<string, string> = {
        rs_personal: 'Personal reason',
        rs_work: 'Work conflict',
        rs_other: 'Other',
      }
      const reason = reasons[ctx.reply.id] ?? 'Not specified'

      await sendText(
        ctx.phone,
        `🗓 Please reply with your preferred new availability (e.g. "Next week, mornings" or "Saturday afternoon").\n\nReason noted: _${reason}_`
      )
      return { nextStep: 'reschedule_select_slot', nextData: { rescheduleReason: reason } }
    }

    return { nextStep: 'reschedule_confirm' }
  }

  if (ctx.step === 'reschedule_select_slot') {
    const requestedAvailability = ctx.reply.text?.trim()
    if (!requestedAvailability || requestedAvailability.length < 5) {
      await sendText(
        ctx.phone,
        'Please type the new availability you want us to work with, for example "Friday after 3pm" or "Saturday morning".'
      )
      return { nextStep: 'reschedule_select_slot', nextData: { rescheduleReason: ctx.data.rescheduleReason } }
    }

    const customer = await db.customer.findUnique({
      where: { phone: ctx.phone },
      select: { id: true },
    })

    if (!customer || !ctx.data.rescheduleBookingId) {
      await sendText(ctx.phone, "We couldn't find the booking to reschedule. Reply 'Hi' to start again.")
      return { nextStep: 'done' }
    }

    const { requestBookingReschedule } = await import('./bookings')
    await requestBookingReschedule({
      bookingId: ctx.data.rescheduleBookingId,
      actorId: customer.id,
      actorRole: 'customer',
      reason: ctx.data.rescheduleReason ?? 'Customer requested reschedule',
      requestedAvailability,
    })

    await sendText(
      ctx.phone,
      `✅ We’ve logged your reschedule request.\n\nRequested availability: ${requestedAvailability}\n\nOur team will confirm the updated booking time with you shortly.`
    )
    return { nextStep: 'done' }
  }

  return { nextStep: 'done' }
}

// ─── Cancel flow ──────────────────────────────────────────────────────────────

async function handleCancelFlow(
  ctx: Parameters<typeof handleJobRequestFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendText } = await import('./whatsapp-interactive')

  const customer = await db.customer.findUnique({
    where: { phone: ctx.phone },
  })
  if (!customer) {
    await sendText(ctx.phone, "No job requests found. Send 'Hi' to submit a new request.")
    return { nextStep: 'done' }
  }

  const jobRequest = await db.jobRequest.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ['PENDING_VALIDATION', 'OPEN', 'MATCHING', 'MATCHED'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!jobRequest) {
    await sendText(ctx.phone, "You don't have any active job requests to cancel. Send 'Hi' for the main menu.")
    return { nextStep: 'done' }
  }

  if (ctx.step === 'cancel_confirm') {
    await sendButtons(
      ctx.phone,
      `❌ *Cancel Job Request*\n\n🔧 ${truncateField(jobRequest.category, 50)}\n\nAre you sure you want to cancel this request?`,
      [
        { id: 'cancel_yes', title: '❌ Yes, Cancel' },
        { id: 'cancel_no', title: '← Keep Request' },
      ]
    )
    return { nextStep: 'cancel_confirm', nextData: { rescheduleBookingId: jobRequest.id } }
  }

  if (ctx.reply.id === 'cancel_yes') {
    await db.jobRequest.update({
      where: { id: jobRequest.id },
      data: { status: 'CANCELLED' },
    })
    await sendText(
      ctx.phone,
      `✅ Your ${truncateField(jobRequest.category, 50)} job request has been cancelled.\n\nSend 'Hi' to submit a new request anytime. 👋`
    )
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'cancel_no') {
    await sendText(ctx.phone, "Great! Your job request has been kept. Send 'Hi' to return to the menu. 👍")
    return { nextStep: 'done' }
  }

  return { nextStep: 'cancel_confirm' }
}

// ─── Match-level lead response handler ───────────────────────────────────────

async function handleMatchLeadResponse(phone: string, buttonId: string): Promise<void> {
  const { sendButtons, sendCtaUrl, sendText } = await import('./whatsapp-interactive')
  const leadId = buttonId
    .replace('match_accept_', '')
    .replace('match_inspect_', '')
    .replace('match_decline_', '')

  const provider = await db.provider.findUnique({ where: { phone } })
  if (!provider) {
    await sendText(phone, "You're not registered as a Plug A Pro provider. Reply *join* to apply, or contact support if you think this is an error.")
    return
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      jobRequest: { include: { address: true } },
      provider: { select: { id: true } },
    },
  })

  if (!lead || lead.providerId !== provider.id) {
    await sendText(phone, '⚠️ This lead is no longer available.')
    return
  }

  await db.lead.updateMany({
    where: { id: lead.id, status: 'SENT' },
    data: { status: 'VIEWED' },
  })

  if (buttonId.startsWith('match_accept_')) {
    const isShortlistDispatchEnabled = await isEnabled(FLAG_KEYS.SHORTLIST_DISPATCH_V2).catch(() => false)
    // In shortlist mode, legacy match_accept_ buttons must not deduct credits.
    if (isShortlistDispatchEnabled) {
      await sendText(
        phone,
        "This lead is in shortlist mode.\n\nNo credits are deducted for the preview step. Please use your shortlist responses (\"I'm interested\" / \"Not interested\") from the lead message.",
      )
      return
    }
    const { acceptLead } = await import('./matching-engine')
    let result
    try {
      result = await acceptLead({ leadId, providerId: provider.id, inspectionNeeded: false, source: 'whatsapp' })
    } catch (error) {
      const traceId = createTraceId('wbot')
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_matching',
        currentStep: 'match_accept',
        failureType: 'dependency_failure',
        actionId: buttonId,
        requestId: lead.id,
        error,
        traceId,
      })
      console.error('[whatsapp-bot] match accept: unhandled acceptLead exception', {
        traceId,
        leadId,
        providerId: provider.id,
        error_code: 'UNKNOWN_LEAD_ACCEPT_ERROR',
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (!result.ok) {
      if (result.reason === 'INSUFFICIENT_CREDITS') {
        await sendLeadInsufficientCreditsMessage(phone, leadId, result.currentCreditBalance ?? 0)
        return
      }
      if (result.reason === 'PROVIDER_NOT_APPROVED') {
        await sendText(phone, "Your provider application is still under review. You'll be able to receive and accept leads once approved.")
        return
      }
      if (result.reason === 'LEAD_ACCEPTANCE_FAILED') {
        await sendWhatsAppJourneyRecovery(phone, {
          userRole: 'provider',
          channel: 'whatsapp',
          flowName: 'provider_matching',
          currentStep: 'match_accept',
          failureType: 'matching_failure',
          actionId: buttonId,
          requestId: lead.id,
          traceId: result.traceId ?? createTraceId('wbot'),
        })
        return
      }
      const message =
        result.reason === 'TAKEN'
          ? '⚠️ Another provider has already accepted this job. No credits were used.\n\nNew leads will come through as jobs arise.'
          : result.reason === 'EXPIRED'
          ? '⏰ This lead expired before you responded. No credits were used.\n\nNew leads will come through as jobs arise.'
          : '⚠️ This lead is no longer available.'
      await sendText(phone, message)
      return
    }

    // Primary notifications handled inside acceptLead. Send fallback if they failed.
    if (!result.notificationSent) {
      await sendAcceptedLeadFallbackConfirmation({
        phone,
        leadId,
        providerId: provider.id,
        traceId: createTraceId('wbot'),
        currentCreditBalance: result.currentCreditBalance,
      })
    }
    return
  }

  if (buttonId.startsWith('match_inspect_')) {
    // Send a link to the lead detail page so the provider can review and decide
    const { getProviderLeadAccessUrl } = await import('./provider-lead-access')
    const leadUrl = await getProviderLeadAccessUrl({ leadId, providerId: provider.id })
    if (!leadUrl) {
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_matching',
        currentStep: 'match_preview',
        failureType: 'external_service_failure',
        actionId: buttonId,
        requestId: lead.id,
      })
      return
    }
    await sendCtaUrl(
      phone,
      `🔍 *View Lead Preview*\n\nOpen the link below to review the lead preview, then choose to accept or decline.`,
      ctaLabelFor('view_lead'),
      leadUrl,
      { footer: 'Tap to open your provider app' }
    )
    return
  }

  if (buttonId.startsWith('match_decline_')) {
      await sendButtons(
        phone,
        '❌ *Decline Lead*\n\nWhy are you declining?',
        [
        { id: `mdc_unavailable_${leadId}`, title: '📅 Not available' },
        { id: `mdc_area_${leadId}`, title: '📍 Too far' },
        { id: `mdc_other_${leadId}`, title: '✏️ Other reason' },
      ]
    )
    return
  }
}

// ─── Provider job management flow ────────────────────────────────────────────

async function handleProviderJobFlow(
  ctx: Parameters<typeof handleJobRequestFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendCtaUrl, sendText, sendList } = await import('./whatsapp-interactive')
  const appUrl = getPublicAppUrl()

  // ── "My jobs" list ──────────────────────────────────────────────────────────
  if (ctx.step === 'tech_job_list') {
    const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
    if (!provider) {
      await sendText(ctx.phone, "You're not registered as a service provider. Reply 'join' to apply.")
      return { nextStep: 'done' }
    }

    const activeJobs = await db.job.findMany({
      where: {
        providerId: provider.id,
        status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL'] },
      },
      include: {
        booking: {
          include: { match: { include: { jobRequest: { include: { address: true } } } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    if (activeJobs.length === 0) {
      await sendText(ctx.phone, "📋 *No active jobs right now.*\n\nYou'll receive a notification here when a new lead comes in. Make sure your WhatsApp notifications are turned on.")
      return { nextStep: 'done' }
    }

    const statusEmoji: Record<string, string> = {
      SCHEDULED: '📅', EN_ROUTE: '🚗', ARRIVED: '📍',
      STARTED: '🔧', PAUSED: '⏸', AWAITING_APPROVAL: '⌛',
    }
    const statusLabel: Record<string, string> = {
      SCHEDULED: 'Scheduled',
      EN_ROUTE: 'On the way',
      ARRIVED: 'Arrived on site',
      STARTED: 'Work in progress',
      PAUSED: 'Paused',
      AWAITING_APPROVAL: 'Awaiting approval',
    }

    if (activeJobs.length === 1) {
      const j = activeJobs[0]
      const req = j.booking.match.jobRequest
      const addr = req.address
      await sendButtons(
        ctx.phone,
        `📋 *Your Active Job*\n\n${statusEmoji[j.status] ?? '📋'} ${truncateField(req.category, 50)}\n📍 ${addr ? `${addr.street}, ${truncateField(normaliseLocationDisplayName(addr.suburb), 60)}` : 'See app'}\n${statusLabel[j.status] ?? j.status.replace(/_/g, ' ')}`,
        [{ id: `view_job_${j.id}`, title: '📋 View Details' }]
      )
    } else {
      const rows = activeJobs.map((j) => {
        const req = j.booking.match.jobRequest
        const suburb = normaliseLocationDisplayName(req.address?.suburb) || 'TBA'
        return {
          id: `view_job_${j.id}`,
          title: req.category.slice(0, 24),
          description: `${suburb} • ${statusLabel[j.status] ?? j.status.replace(/_/g, ' ')}`.slice(0, 72),
        }
      })
      await sendList(
        ctx.phone,
        `📋 *Your Active Jobs* (${activeJobs.length})`,
        [{ title: 'Active Jobs', rows }],
        { buttonLabel: 'View a Job' }
      )
    }

    return { nextStep: 'tech_job_view' }
  }

  // ── All other steps require a pendingJobId ─────────────────────────────────
  const jobId = ctx.data.pendingJobId
  if (!jobId) {
    await sendText(ctx.phone, "Couldn't identify the job. Please open your app for details.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      provider: true,
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  address: true,
                  leads: {
                    select: { id: true, providerId: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!job) {
    await sendText(ctx.phone, 'Job not found. It may have been reassigned. Check the app for your current jobs.')
    return { nextStep: 'done' }
  }

  // ── Authorization: verify the inbound phone owns this job ──────────────────
  if (job.provider.phone !== ctx.phone) {
    await sendText(ctx.phone, "⚠️ You're not authorised to manage this job.")
    return { nextStep: 'done' }
  }

  if (ctx.step === 'tech_job_view') {
    const addr = job.booking.match.jobRequest.address
    const addrLabel = addr ? `${addr.street}, ${truncateField(normaliseLocationDisplayName(addr.suburb), 60)}` : 'Address in app'
    const categoryLabel = truncateField(job.booking.match.jobRequest.category, 50)

    await sendButtons(
      ctx.phone,
      `📋 *Job Details*\n\n🔧 ${categoryLabel}\n📍 ${addrLabel}\n\nAccept this job?`,
      [
        { id: `accept_job_${jobId}`, title: '✅ Accept' },
        { id: `decline_job_${jobId}`, title: '❌ Decline' },
      ]
    )
    return { nextStep: 'tech_job_confirm_accept' }
  }

  if (ctx.step === 'tech_job_confirm_accept' && ctx.reply.id?.startsWith('accept_job_')) {
    // Idempotent — skip if already scheduled (e.g. duplicate button tap)
    if (job.status !== 'SCHEDULED') {
      await sendText(ctx.phone, '✅ Job already accepted. Check the app for details.')
      return { nextStep: 'done' }
    }

    // No status change needed (already SCHEDULED); just confirm acceptance.
    // Send only a signed no-login job link. Never send protected provider URLs
    // in WhatsApp CTAs.
    const acceptedLeadId = job.booking.match.jobRequest.leads.find((lead) => lead.providerId === job.providerId)?.id
    const jobUrl = acceptedLeadId
      ? await (await import('./provider-lead-access')).getProviderSignedJobHandoverUrl({
          leadId: acceptedLeadId,
          providerId: job.providerId,
          jobRequestId: job.booking.match.jobRequest.id,
          providerPhone: job.provider.phone,
        })
      : null
    if (jobUrl) {
      await sendCtaUrl(
        ctx.phone,
        '✅ *Job Confirmed!*\n\nYou can manage this accepted job from the secure link below.',
        ctaLabelFor('view_job'),
        jobUrl,
        { footer: 'Secure link for this accepted job only.' }
      )
    } else {
      await sendText(
        ctx.phone,
        "✅ *Job Confirmed!*\n\nWe couldn't generate your secure job link right now. Reply *menu* to continue in WhatsApp and request a fresh job link."
      )
    }
    return { nextStep: 'done' }
  }

  // ── dc_* must be checked BEFORE tech_job_confirm_decline (which returns early) ──
  if (ctx.reply.id?.startsWith('dc_')) {
    const reasonMap: Record<string, string> = {
      [`dc_unavailable_${jobId}`]: 'Not available',
      [`dc_area_${jobId}`]: 'Too far',
      [`dc_other_${jobId}`]: 'Other',
    }
    const declineReason = reasonMap[ctx.reply.id] ?? 'Declined'

    // Update the Lead record so dispatch knows this provider passed
    const jobRequestId = job.booking.match.jobRequest.id
    const declinedAt = new Date()
    await db.lead.updateMany({
      where: {
        jobRequestId,
        providerId: job.providerId,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'DECLINED', respondedAt: declinedAt, declinedAt },
    })

    // Log decline reason on the job for admin visibility
    await db.job.update({
      where: { id: jobId },
      data: { notes: `Declined by provider: ${declineReason}` },
    })

    await sendText(
      ctx.phone,
      "Understood — we'll reassign this job. Reply *my jobs* to check your remaining active assignments."
    )
    return { nextStep: 'done' }
  }

  if (ctx.step === 'tech_job_confirm_decline' || ctx.reply.id?.startsWith('decline_job_')) {
    await sendButtons(
      ctx.phone,
      '❌ *Decline Job*\n\nWhy are you declining?',
      [
        { id: `dc_unavailable_${jobId}`, title: '📅 Not available' },
        { id: `dc_area_${jobId}`, title: '📍 Too far' },
        { id: `dc_other_${jobId}`, title: '✏️ Other reason' },
      ]
    )
    return { nextStep: 'tech_job_confirm_decline' }
  }

  return { nextStep: 'tech_job_view' }
}

export async function sendQuoteToClient(params: {
  customerPhone: string
  providerName: string
  quoteId: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: Date
  approvalToken: string
}): Promise<void> {
  const { sendButtons, sendCtaUrl } = await import('./whatsapp-interactive')
  const { ctaLabelFor } = await import('./whatsapp-copy')
  const webLink = getPublicAppUrl(`/quotes/${params.approvalToken}`)

  const materialsLine = params.materialsCost > 0
    ? `\n• Materials: R ${params.materialsCost.toFixed(2)}`
    : ''
  const hoursLine = params.estimatedHours ? `\n• Est. time: ${params.estimatedHours}h` : ''
  const validLine = `\n• Valid until: ${params.validUntil.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`

  // Body intentionally contains no URL. Accept/Decline travel as quick-reply
  // buttons; the full quote URL is exposed via a sendCtaUrl follow-up below.
  await sendButtons(
    params.customerPhone,
    `💼 *Quote from ${params.providerName}*\n\n• Labour: R ${params.labourCost.toFixed(2)}${materialsLine}\n• *Total: R ${params.totalAmount.toFixed(2)}*${hoursLine}${validLine}\n\n📋 _${truncateField(params.description, 200)}_\n\nTap a button below to accept or decline, or open the full quote.`,
    [
      { id: `quote_accept_${params.quoteId}`, title: '✅ Accept Quote' },
      { id: `quote_decline_${params.quoteId}`, title: '❌ Decline' },
    ]
  )
  if (webLink) {
    try {
      await sendCtaUrl(
        params.customerPhone,
        'Open the full quote in your browser.',
        ctaLabelFor('quote_view'),
        webLink,
        undefined,
        { templateName: 'interactive:quote_view_cta', metadata: { quoteId: params.quoteId } },
      )
    } catch (error) {
      console.warn('[whatsapp-bot] quote view CTA follow-up failed', { quoteId: params.quoteId, error })
    }
  }
}

// ─── Customer quote response handler ─────────────────────────────────────────

async function handleCustomerQuoteResponse(phone: string, buttonId: string): Promise<void> {
  const { sendText } = await import('./whatsapp-interactive')
  const quoteId = buttonId.replace('quote_accept_', '').replace('quote_decline_', '')
  const action = buttonId.startsWith('quote_accept_') ? 'approve' : 'decline'

  const { processQuoteDecision } = await import('./quotes')
  const result = await processQuoteDecision(quoteId, action, { verifyCustomerPhone: phone })

  if ('error' in result) {
    if (result.error === 'ALREADY_ACTIONED') {
      await sendText(phone, action === 'approve'
        ? "✅ You've already accepted this quote. Check your messages for the booking confirmation."
        : "This quote has already been declined. Reply *Hi* if you'd like to submit a new service request.")
    } else if (result.error === 'EXPIRED') {
      await sendText(phone, "⏰ This quote has expired. Reply *Hi* to submit a new request and we'll get a fresh quote to you.")
    } else {
      await sendText(phone, "😔 Something went wrong on our end. Please use the link in the original quote message, or reply *Hi* to start again.")
    }
    return
  }

  if (result.action === 'approved') {
    const dateStr = result.scheduledDate.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    let providerJobUrl: string | null = null
    if (result.jobRequestId) {
      providerJobUrl = await (await import('./provider-lead-access')).getProviderSignedJobHandoverUrlForJobRequest({
        jobRequestId: result.jobRequestId,
        providerId: result.provider.id,
        providerPhone: result.provider.phone,
      }).catch(() => null)
    }
    if (providerJobUrl) {
      await sendCtaUrl(
        result.provider.phone,
        `✅ *Booking confirmed — ${truncateField(result.category, 50)}*\n\nThe customer accepted your quote. The job is scheduled for *${dateStr}*.\n\nOpen your secure job link to view full details and update status.`,
        ctaLabelFor('view_job'),
        providerJobUrl,
        { footer: 'Secure link for this accepted job only.' }
      ).catch(() => {})
    } else {
      await sendText(
        result.provider.phone,
        `✅ *Booking confirmed — ${truncateField(result.category, 50)}*\n\nThe customer accepted your quote. The job is scheduled for *${dateStr}*.\n\nReply *menu* to continue in WhatsApp and request your secure job link.`
      ).catch(() => {})
    }
    const { sendProviderAssigned } = await import('./whatsapp')
    await sendProviderAssigned({
      bookingId: result.bookingId,
      customerName: result.customer.name,
      customerPhone: phone,
      providerFirstName: result.provider.name.split(' ')[0],
      serviceName: result.category,
      scheduledWindow: dateStr,
    }).catch(() => {})
  } else {
    await sendText(
      result.provider.phone,
      `❌ *Quote not accepted*\n\nThe customer didn't proceed with your ${truncateField(result.category, 50)} quote. Your profile remains active and new leads will come through as they arise.`
    ).catch(() => {})
    await sendText(phone, `Got it — we've let the provider know. You're welcome to submit a new request whenever you're ready. Reply *Hi* to start.`)
  }
}

// ─── Matching engine v2: AssignmentHold acceptance ───────────────────────────
// Triggered when provider taps "Accept" on the hold notification sent by dispatch.ts.
// Button ID format: `accept:{holdId}`

async function handleAssignmentHoldAcceptance(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const holdId = buttonId.slice('accept:'.length)
  if (!holdId.trim()) {
    console.warn('[whatsapp-bot] accept: invalid WhatsApp payload', {
      traceId,
      buttonId,
      error_code: 'WHATSAPP_PAYLOAD_INVALID',
    })
    await sendText(phone, `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${traceId}_`)
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true, name: true })
  if (!provider) {
    console.warn('[whatsapp-bot] accept: provider not found', {
      traceId,
      holdId,
      normalizedPhone: phone,
      error_code: 'PROVIDER_NOT_FOUND',
    })
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  // Look up the lead via hold relationship
  const lead = await db.lead.findFirst({
    where: { assignmentHoldId: holdId },
    select: { id: true, jobRequestId: true, providerId: true },
  })
  if (!lead) {
    console.warn('[whatsapp-bot] accept: lead not found for hold', {
      traceId,
      holdId,
      providerId: provider.id,
      error_code: 'LEAD_INVITE_NOT_FOUND',
    })
    await sendText(phone, "⚠️ This lead invite could not be found. It may have expired or already been taken. New leads will come through as jobs arise.")
    return
  }

  const { acceptAssignmentOffer } = await import('./matching/service')
  let result
  try {
    result = await acceptAssignmentOffer({ leadId: lead.id, providerId: provider.id, source: 'whatsapp' })
  } catch (error) {
    await sendWhatsAppJourneyRecovery(phone, {
      userRole: 'provider',
      channel: 'whatsapp',
      flowName: 'provider_matching',
      currentStep: 'assignment_accept',
      failureType: 'dependency_failure',
      actionId: buttonId,
      requestId: lead.id,
      error,
      traceId,
    })
    console.error('[whatsapp-bot] accept: unhandled acceptAssignmentOffer exception', {
      traceId,
      holdId,
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      providerId: provider.id,
      error_code: 'UNKNOWN_LEAD_ACCEPT_ERROR',
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_CREDITS') {
      console.warn('[whatsapp-bot] accept: insufficient credits', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'INSUFFICIENT_CREDITS',
      })
      await sendLeadInsufficientCreditsMessage(phone, lead.id, result.currentCreditBalance ?? 0, holdId)
      return
    }
    if (result.reason === 'PROVIDER_NOT_APPROVED') {
      console.warn('[whatsapp-bot] accept: provider not approved', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'PROVIDER_NOT_APPROVED',
      })
      await sendText(phone, "Your provider application is still under review. You'll be able to receive and accept leads once approved.")
      return
    }
    if (result.reason === 'WALLET_SUSPENDED') {
      console.warn('[whatsapp-bot] accept: provider wallet suspended', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'WALLET_SUSPENDED',
      })
      await sendText(phone, "Your credit wallet is not active right now, so this lead cannot be accepted. Please contact support.")
      return
    }
    if (result.reason === 'FORBIDDEN') {
      console.warn('[whatsapp-bot] accept: provider not authorized for lead', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'PROVIDER_NOT_AUTHORIZED_FOR_LEAD',
      })
      await db.auditLog.create({
        data: {
          actorId: provider.id,
          actorRole: 'PROVIDER',
          action: 'CROSS_ACCOUNT_BUTTON_REPLAY',
          entityType: 'Lead',
          entityId: lead.id,
          ipAddress: null,
          userAgent: null,
          before: Prisma.DbNull,
          after: { claimingProviderId: provider.id, realOwnerId: lead.providerId } as Prisma.InputJsonValue,
          timestamp: new Date(),
        },
      }).catch((err) => console.error('[whatsapp-bot] security audit write failed:', err))
      await sendText(phone, "⚠️ This lead was not assigned to this provider number. Please use the WhatsApp number that received the lead.")
      return
    }
    if (result.reason === 'NOT_FOUND') {
      console.warn('[whatsapp-bot] accept: lead not found', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'LEAD_NOT_FOUND',
      })
      await sendText(phone, "⚠️ This lead could not be found. It may have expired or already been closed.")
      return
    }
    if (result.reason === 'CONCURRENT_UNLOCK') {
      console.warn('[whatsapp-bot] accept: concurrent unlock blocked', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'DUPLICATE_ACCEPT_IGNORED',
      })
      await sendText(phone, "We're already processing this lead response. Please wait a moment and check your job messages.")
      return
    }
    if (result.reason === 'LEAD_ACCEPTANCE_FAILED') {
      const supportRef = result.traceId ?? traceId
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_matching',
        currentStep: 'assignment_accept',
        failureType: 'matching_failure',
        actionId: `accept:${holdId}`,
        requestId: lead.id,
        traceId: supportRef,
      })
      console.error('[whatsapp-bot] accept: lead acceptance failed', {
        traceId: supportRef,
        holdId,
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        providerId: provider.id,
        error_code: 'LEAD_ACCEPTANCE_FAILED',
      })
      return
    }
    if (result.reason === 'EXPIRED') {
      console.info('[whatsapp-bot] accept: lead expired', { traceId, holdId, leadId: lead.id, providerId: provider.id })
      await sendText(phone, "⏰ This lead has expired and can no longer be accepted. No credits were used.\n\nNew leads will come through as jobs arise.")
    } else if (result.reason === 'TAKEN') {
      console.info('[whatsapp-bot] accept: lead taken', { traceId, holdId, leadId: lead.id, providerId: provider.id })
      await sendText(phone, "⚡ This job was just assigned to another provider. No credits were used.\n\nNew leads will come through as jobs arise.")
    } else {
      console.error('[whatsapp-bot] accept: unexpected failure', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, reason: result.reason,
        error_code: 'UNKNOWN_CREDIT_ERROR',
      })
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_matching',
        currentStep: 'assignment_accept',
        failureType: 'unexpected_error',
        actionId: `accept:${holdId}`,
        requestId: lead.id,
        traceId,
      })
    }
    return
  }

  // acceptAssignmentOffer does not send notifications — dispatch provider confirmation
  // and customer notification here, then fall back to a simpler message if the
  // provider notification fails (transient API error, URL generation failure, etc.).
  const { notifyPostMatchAcceptance } = await import('./post-match-communications')
  const notifyResult = await notifyPostMatchAcceptance({
    leadId: lead.id,
    providerId: provider.id,
    matchId: result.matchId,
    creditTransactionId: result.creditTransactionId,
  }).catch((err: unknown) => {
    console.error('[whatsapp-bot] accept: notifyPostMatchAcceptance failed (non-fatal)', {
      traceId,
      holdId,
      leadId: lead.id,
      providerId: provider.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { providerNotified: false, customerNotified: false }
  })
  if (!notifyResult.providerNotified) {
    console.warn('[whatsapp-bot] accept: primary provider notification failed; sending fallback confirmation', {
      traceId,
      holdId,
      leadId: lead.id,
      providerId: provider.id,
    })
    await sendAcceptedLeadFallbackConfirmation({
      phone,
      leadId: lead.id,
      providerId: provider.id,
      traceId,
      holdId,
      currentCreditBalance: result.currentCreditBalance,
    })
  }

  // ── Location prompt ──────────────────────────────────────────────────────────
  // Ask the provider to share their current location so the customer can be
  // notified the provider is en route. This is optional — the provider can skip.
  await saveConversation({ phone, flow: 'provider_journey', step: 'post_accept_location_prompt', data: {} })
  await sendButtons(
    phone,
    "📍 *Share your location*\n\nThanks for accepting! Share your current location so we can give your customer an estimated arrival time.",
    [{ id: 'location_skip', title: 'Skip for now' }],
    undefined,
    { templateName: 'provider_location_prompt' }
  )
}

async function handleProviderLocationShare(
  phone: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const traceId = createTraceId('wbot')

  const provider = await findProviderByWhatsAppPhone(phone, { id: true, name: true })
  if (!provider) {
    console.warn('[whatsapp-bot] location-share: provider not found', { traceId, normalizedPhone: maskedPhone(phone) })
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  // Find the provider's most recent active job (pre-completion statuses)
  const job = await db.job.findFirst({
    where: {
      providerId: provider.id,
      status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: {
                    select: { phone: true, name: true },
                  },
                  address: {
                    select: { suburb: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!job) {
    console.warn('[whatsapp-bot] location-share: no active job found for provider', {
      traceId, providerId: provider.id,
    })
    await sendText(phone, "We couldn't find an active job to attach your location to. If this looks wrong, please contact support.")
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  // Persist location on the Job
  await db.job.update({
    where: { id: job.id },
    data: {
      providerCurrentLat: latitude,
      providerCurrentLng: longitude,
      providerLocationSharedAt: new Date(),
    },
  })

  const jobRequest = job.booking?.match?.jobRequest
  const customer = jobRequest?.customer
  const jobCategory = jobRequest?.category ?? 'service'
  const jobSuburb = jobRequest?.address?.suburb ?? ''

  if (customer?.phone && jobRequest?.id) {
    const { sendCustomerEnRouteNotification } = await import('./whatsapp')
    await sendCustomerEnRouteNotification({
      customerPhone: customer.phone,
      providerName: provider.name ?? 'Your provider',
      jobCategory,
      jobSuburb,
      jobRequestId: jobRequest.id,
    }).catch((err) => {
      console.error('[whatsapp-bot] location-share: failed to notify customer', {
        traceId,
        jobId: job.id,
        providerId: provider.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  await sendText(phone, "✅ Location shared! Your customer has been notified.")
  await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
}

async function sendLeadInsufficientCreditsMessage(
  phone: string,
  leadId: string,
  currentCreditBalance: number,
  holdId?: string,
): Promise<void> {
  await sendButtons(
    phone,
    buildInsufficientCreditsMessage({
      availableCredits: currentCreditBalance,
      creditsRequired: LEAD_UNLOCK_COST_CREDITS,
    }),
    [
      { id: 'provider_top_up_credits', title: 'Top up credits' },
      { id: holdId ? `accept:${holdId}` : `match_inspect_${leadId}`, title: ctaLabelFor('view_lead') },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  const creditUrl = getWorkerPortalUrl('/provider/credits')
  if (creditUrl) {
    await sendCtaUrl(
      phone,
      'Credit top-up and history are available below.',
      ctaLabelFor('credits_history'),
      creditUrl,
    )
  }
}

async function handlePostMatchContactCustomer(phone: string, buttonId: string): Promise<void> {
  const leadId = buttonId.slice('post_match_contact:'.length)
  const { buildAcceptedLeadContactUrlForProvider } = await import('./post-match-communications')
  const url = await buildAcceptedLeadContactUrlForProvider({ leadId, providerPhone: phone })

  if (!url) {
    await sendText(phone, 'Customer contact is not available for this lead. Open the job details or contact support if this looks wrong.')
    return
  }

  await sendCtaUrl(
    phone,
    'Open the customer WhatsApp chat and confirm the job details. This contact handover has been logged on the ticket.',
    'Open Chat',
    url,
    { footer: 'Use this only for the accepted job.' },
    {
      templateName: 'post_match_provider_contact_customer',
      metadata: { leadId },
    },
  )
}

// ─── Matching engine v2: AssignmentHold decline ───────────────────────────────
// Triggered when provider taps a decline-reason button after the sub-menu.
// Button ID format: `hd_unavailable:{holdId}` | `hd_area:{holdId}` | `hd_other:{holdId}`

async function handleAssignmentHoldDecline(phone: string, buttonId: string): Promise<void> {
  const { sendText } = await import('./whatsapp-interactive')
  const traceId = createTraceId('wbot')

  const colonIdx = buttonId.indexOf(':')
  const prefix = buttonId.slice(0, colonIdx)
  const holdId = buttonId.slice(colonIdx + 1)

  const reasonMap: Record<string, string> = {
    hd_unavailable: 'Not available',
    hd_area: 'Too far',
    hd_other: 'Other',
  }
  const reason = reasonMap[prefix] ?? 'Declined'

  const provider = await db.provider.findUnique({ where: { phone }, select: { id: true } })
  if (!provider) {
    console.warn('[whatsapp-bot] decline: provider not found', { traceId, holdId })
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  const lead = await db.lead.findFirst({
    where: { assignmentHoldId: holdId },
    select: { id: true },
  })
  if (!lead) {
    console.info('[whatsapp-bot] decline: lead not found for hold (expired or already closed)', { traceId, holdId, providerId: provider.id })
    await sendText(phone, "Understood — we've noted your response. New leads will come through as jobs arise.")
    return
  }

  try {
    const { declineLead } = await import('./matching-engine')
    await declineLead({ leadId: lead.id, providerId: provider.id })

    await sendText(
      phone,
      `Understood — lead passed (${reason}). We'll keep matching this job with other providers. New leads will come through as they arise.`
    )
  } catch (error) {
    console.error('[whatsapp-bot] decline: unexpected failure', {
      traceId, phone, holdId, reason, leadId: lead.id, providerId: provider.id, error,
    })
    await sendWhatsAppJourneyRecovery(
      phone,
      {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_matching',
        currentStep: 'assignment_decline',
        failureType: 'dependency_failure',
        actionId: `hd_${reason}`,
        requestId: lead.id,
        traceId,
        error,
        recoveryClass: 'retry_same_step',
      },
    ).catch(() => {})
  }
}

// ─── RFP: register provider interest (no credit deduction, customer still selects) ──
// Button ID format: `ops_accept:{leadId}` (legacy) or `ops_accept:{leadId}:{providerId}`.
// These buttons are sent exclusively from sendRequestToShortlistedProviders (review-first
// flow). Tapping "I'm Available" marks the lead INTERESTED + records a ProviderLeadResponse
// so the customer can compare responses and select a provider. Credits are deducted only
// after the customer selects this provider and they confirm via confirm_accept.

async function handleOpsLeadAcceptance(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const parsed = parseOpsActionButton(buttonId)
  if (!parsed) {
    await sendText(phone, `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${traceId}_`)
    return
  }

  if (parsed.buttonType !== 'ops_accept') {
    await sendText(phone, `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${traceId}_`)
    return
  }

  const leadId = parsed.leadId
  if (!leadId) {
    await sendText(phone, `We couldn't read that lead response. Please use the latest lead message or reply *menu*.\n\n_Ref: ${traceId}_`)
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true, name: true })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  if (parsed.providerId && parsed.providerId !== provider.id) {
    await sendText(phone, '⚠️ This lead is linked to a different provider profile. Please use the latest lead message.')
    return
  }

  await handleRfpLeadInterest(phone, provider.id, leadId, traceId, { source: 'payload' })
}

async function handleOpsLeadDeclineWithProviderId(
  phone: string,
  leadId: string,
  providerId: string,
  traceId: string,
): Promise<void> {
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { id: true } })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        status: true,
        providerId: true,
        assignmentHoldId: true,
        jobRequestId: true,
      },
    })

    if (!lead || lead.providerId !== provider.id) {
      await sendText(phone, '⚠️ This lead could not be found or is not assigned to your account.')
      return
    }

    const rfpOpenStatuses = ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED'] as const
    if (rfpOpenStatuses.includes(lead.status as (typeof rfpOpenStatuses)[number]) && !lead.assignmentHoldId) {
      const now = new Date()
      const updatedCount = await db.lead.updateMany({
        where: { id: leadId, providerId: provider.id, status: { in: [...rfpOpenStatuses] } },
        data: { status: 'DECLINED', respondedAt: now, declinedAt: now },
      })

      if (updatedCount.count === 0) {
        await sendText(phone, `✅ This lead is already noted as unavailable.\n\nNew jobs will continue to come through as they are available.`)
        return
      }

      await sendText(phone, `Understood — noted as unavailable. You'll receive new job notifications as they arise.`)
      console.info('[whatsapp-bot] ops_decline: rfp_lead_declined', {
        traceId,
        leadId,
        providerId: provider.id,
      })
      if (updatedCount.count > 0) {
        await cascadeToNextShortlistedProvider({
          requestId: lead.jobRequestId,
          declinedLeadId: leadId,
        }).catch((err: unknown) => {
          console.warn('[whatsapp-bot] ops_decline: rfp_cascade_failed', {
            traceId,
            leadId,
            requestId: lead.jobRequestId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      return
    }

    const { declineLead } = await import('./matching-engine')
    await declineLead({ leadId, providerId: provider.id })
    await sendText(phone, `Understood — noted as unavailable. You'll receive new job notifications as they arise.`)
    console.info('[whatsapp-bot] ops_decline: lead declined', {
      traceId,
      leadId,
      providerId: provider.id,
    })
  } catch (error) {
    console.error('[whatsapp-bot] ops_decline: unexpected failure', {
      traceId,
      phone,
      leadId,
      providerId,
      error,
    })
    await sendText(phone, `We couldn't process your response right now. Reply *menu* to return to the main menu or *status* to check your active leads.\n\n_Ref: ${traceId}_`)
  }
}

// ─── OPS_REVIEW / RFP: direct lead decline with reason ───────────────────────
// Button ID format: `ops_hd_unavail:{leadId}` | `ops_hd_toofar:{leadId}` | `ops_hd_other:{leadId}`

async function handleOpsLeadDecline(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const colonIdx = buttonId.indexOf(':')
  const prefix = buttonId.slice(0, colonIdx)
  const leadId = buttonId.slice(colonIdx + 1).trim()

  const reasonMap: Record<string, string> = {
    ops_hd_unavail: 'Not available',
    ops_hd_toofar: 'Too far',
    ops_hd_other: 'Other',
  }
  const reason = reasonMap[prefix] ?? 'Declined'

  const provider = await db.provider.findUnique({ where: { phone }, select: { id: true } })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  try {
    // RFP leads (no assignmentHold) are not reachable via rejectAssignmentOffer, so
    // declineLead silently no-ops and returns alreadyClosed for INTERESTED/SENT/VIEWED.
    // Load the lead and handle pre-customer-selection RFP leads with a direct update.
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { id: true, status: true, providerId: true, assignmentHoldId: true, jobRequestId: true },
    })

    if (!lead || lead.providerId !== provider.id) {
      await sendText(phone, '⚠️ This lead could not be found or is not assigned to your account.')
      return
    }

    const rfpOpenStatuses = ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED'] as const
    if (
      rfpOpenStatuses.includes(lead.status as (typeof rfpOpenStatuses)[number]) &&
      !lead.assignmentHoldId
    ) {
      const now = new Date()
      const updatedCount = await db.lead.updateMany({
        where: { id: leadId, providerId: provider.id, status: { in: [...rfpOpenStatuses] } },
        data: { status: 'DECLINED', respondedAt: now, declinedAt: now },
      })
      await sendText(phone, `Understood — noted as unavailable (${reason}). You'll receive new job notifications as they arise.`)
      console.info('[whatsapp-bot] ops_decline: rfp_lead_declined', {
        traceId, leadId, providerId: provider.id, reason, prevStatus: lead.status,
      })
      if (updatedCount.count > 0) {
        await cascadeToNextShortlistedProvider({
          requestId: lead.jobRequestId,
          declinedLeadId: leadId,
        }).catch((err: unknown) => {
          console.warn('[whatsapp-bot] ops_decline: rfp_cascade_failed', {
            traceId, leadId, requestId: lead.jobRequestId, error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      return
    }

    // Standard path: customer-selected or assignment-hold (auto-assign v2) leads
    const { declineLead } = await import('./matching-engine')
    await declineLead({ leadId, providerId: provider.id })
    await sendText(phone, `Understood — noted as unavailable (${reason}). You'll receive new job notifications as they arise.`)
    console.info('[whatsapp-bot] ops_decline: lead declined', { traceId, leadId, providerId: provider.id, reason })
  } catch (error) {
    console.error('[whatsapp-bot] ops_decline: unexpected failure', {
      traceId, phone, leadId, reason, providerId: provider.id, error,
    })
    await sendText(phone, `We couldn't process your response right now. Reply *menu* to return to the main menu or *status* to check your active leads.\n\n_Ref: ${traceId}_`)
  }
}

// ─── Qualified Shortlist: selected-provider final acceptance / decline ───────

async function handleSelectedProviderConfirmation(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const isAccept = buttonId.startsWith('confirm_accept:')
  const leadId = buttonId.slice(buttonId.indexOf(':') + 1).trim()
  if (!leadId) {
    await sendText(phone, `We couldn't read that selection. Please use the latest message or reply *menu*.\n\n_Ref: ${traceId}_`)
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true, name: true })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  if (isAccept) {
    const { acceptSelectedProviderJob } = await import('./selected-provider-acceptance')
    const result = await acceptSelectedProviderJob({
      leadId,
      providerId: provider.id,
      source: 'whatsapp',
      traceId,
    })
    if (!result.ok) {
      if (result.reason === 'PROVIDER_NOT_SELECTED') {
        await sendText(phone, '⚠️ This job was offered to a different provider. No credits used.')
        return
      }
      if (result.reason === 'LEAD_INVITE_NOT_SELECTED') {
        await sendText(phone, '⚠️ This job has not been customer-selected for you. No action taken.')
        return
      }
      if (result.reason === 'LEAD_EXPIRED') {
        await sendText(phone, 'This job is no longer available. No credit was deducted.')
        return
      }
      if (result.reason === 'REQUEST_CANCELLED') {
        await sendText(phone, 'This request was cancelled. No credit was deducted.')
        return
      }
      if (result.reason === 'LEAD_DECLINED') {
        await sendText(phone, 'You have already declined this job. No credit was deducted.')
        return
      }
      if (result.reason === 'LEAD_ALREADY_ACCEPTED') {
        await sendText(phone, 'This job has already been accepted. No additional credit was deducted.')
        return
      }
      if (result.reason === 'LEAD_NOT_PROVIDER_NOTIFIED') {
        await sendText(phone, 'This lead is not currently awaiting your acceptance. No credit was deducted.')
        return
      }
      if (result.reason === 'REQUEST_NOT_AWAITING_CONFIRMATION') {
        await sendText(phone, 'This job is no longer available. No credit was deducted.')
        return
      }
      if (result.reason === 'DUPLICATE_ACCEPT_IGNORED') {
        await sendText(phone, 'Your acceptance is already being processed. Please wait a moment.')
        return
      }
      if (result.reason === 'CREDIT_APPLICATION_FAILED') {
        const supportNum = process.env.SUPPORT_WHATSAPP_NUMBER ?? ''
        await sendText(
          phone,
          `⚠️ We couldn't complete the job assignment. If a credit was deducted, please contact support — we'll investigate and refund any incorrectly deducted credit.\n\n_Ref: ${traceId}_\n\nSupport: wa.me/${supportNum.replace(/\D/g, '')}`,
        )
        return
      }
      if (result.reason === 'JOB_ASSIGNMENT_FAILED') {
        const supportNum = process.env.SUPPORT_WHATSAPP_NUMBER ?? ''
        await sendText(
          phone,
          `⚠️ Your credit was applied but we couldn't lock the job assignment. Please contact support — we'll check the job status and ensure you're not charged twice.\n\n_Ref: ${traceId}_\n\nSupport: wa.me/${supportNum.replace(/\D/g, '')}`,
        )
        return
      }
      if (result.reason === 'INSUFFICIENT_CREDITS') {
        const creditUrl = getWorkerPortalUrl('/provider/credits')
        const body = buildInsufficientCreditsMessage({ availableCredits: result.currentCreditBalance ?? 0 })
        if (creditUrl) {
          await sendCtaUrl(phone, body, ctaLabelFor('credits_history'), creditUrl)
        } else {
          await sendText(phone, body)
        }
        return
      }
      console.error('[whatsapp-bot] confirm_accept failed', {
        traceId,
        leadId,
        providerId: provider.id,
        reason: result.reason,
        currentCreditBalance: 'currentCreditBalance' in result ? result.currentCreditBalance : undefined,
      })
      await sendWhatsAppJourneyRecovery(phone, {
        userRole: 'provider',
        channel: 'whatsapp',
        flowName: 'provider_shortlist',
        currentStep: 'confirm_accept',
        failureType: 'dependency_failure',
        actionId: buttonId,
        requestId: leadId,
        traceId,
        error: new Error(`provider shortlist confirmation failed: ${String(result.reason)}`),
      })
      return
    }

    if (!result.creditCheck.ok) {
      if (
        result.creditCheck.reason === 'INSUFFICIENT_CREDITS' ||
        result.creditCheck.reason === 'WALLET_MISSING' ||
        result.creditCheck.reason === 'CORRUPT_CREDIT_BALANCE' ||
        result.creditCheck.reason === 'WALLET_NOT_ACTIVE'
      ) {
        const creditUrl = getWorkerPortalUrl('/provider/credits')
        const body = result.creditCheck.providerMessage || buildInsufficientCreditsMessage({
          availableCredits: result.creditCheck.currentCreditBalance ?? 0,
          creditsRequired: result.creditCheck.requiredCredits,
        })
        if (creditUrl) {
          await sendCtaUrl(phone, body, ctaLabelFor('credits_history'), creditUrl)
        } else {
          await sendText(phone, body)
        }
        return
      }

      await sendText(phone, `${result.creditCheck.providerMessage}\n\nNo credit was deducted and customer direct contact details remain locked.`)
      return
    }
    if (!result.notificationSent) {
      if (result.creditApplied || result.alreadyUnlocked) {
        await sendText(
          phone,
          '✅ Job accepted\n\nYour credit has been applied and the job is confirmed. The customer details are now available in your job view.',
        )
      } else {
        await sendText(
          phone,
          `${result.creditCheck.providerMessage}\n\nReply *credits* to view your balance.`,
        )
      }
    }
    return
  }

  // confirm_decline
  const { declineSelectedProviderJob } = await import('./customer-shortlists')
  const declineResult = await declineSelectedProviderJob({ leadId, providerId: provider.id })
  if (!declineResult.ok) {
    if (declineResult.reason === 'NOT_FOUND') {
      await sendText(phone, '⚠️ This job could not be found.')
      return
    }
    if (declineResult.reason === 'FORBIDDEN') {
      await sendText(phone, '⚠️ This job was offered to a different provider.')
      return
    }
    if (declineResult.reason === 'LEAD_ALREADY_ACCEPTED') {
      await sendText(phone, 'This job has already been accepted and can no longer be declined.')
      return
    }
    if (declineResult.reason === 'REQUEST_CANCELLED') {
      await sendText(phone, 'This request was cancelled, so no decline action is needed.')
      return
    }
    if (declineResult.reason === 'LEAD_EXPIRED') {
      await sendText(phone, 'This job is no longer available, so no decline action is needed.')
      return
    }
    await sendText(phone, '⚠️ This job is no longer awaiting your confirmation.')
    return
  }
  await sendText(
    phone,
    declineResult.alreadyDeclined
      ? 'You already declined this job. No further action was taken.'
      : 'No problem — we have let the customer know. They can pick another provider from the shortlist.',
  )
}

// ─── Qualified Shortlist: provider opportunity interest ──────────────────────

async function handleProviderOpportunityNotInterested(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const leadId = buttonId.slice(buttonId.indexOf(':') + 1).trim()
  if (!leadId) {
    await sendText(phone, `We couldn't read that response. Please use the latest message.\n\n_Ref: ${traceId}_`)
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  try {
    const { respondToProviderOpportunity } = await import('./provider-opportunity-responses')
    await respondToProviderOpportunity({
      leadId,
      providerId: provider.id,
      response: 'NOT_INTERESTED',
      source: 'whatsapp',
      idempotencyKey: `whatsapp:${provider.id}:${leadId}:not_interested`,
    })
    await sendText(phone, 'Thanks — we have marked you as not interested. No credits used.')
  } catch (error) {
    console.warn('[whatsapp-bot] not_interested response failed', { traceId, leadId, error: String(error) })
    await sendText(phone, 'Thanks — your response has been recorded.')
  }
}

async function handleProviderOpportunityInterested(phone: string, buttonId: string): Promise<void> {
  const traceId = createTraceId('wbot')
  const leadId = buttonId.slice(buttonId.indexOf(':') + 1).trim()
  if (!leadId) {
    await sendText(phone, `We couldn't read that response. Please use the latest message.\n\n_Ref: ${traceId}_`)
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    return
  }

  // The customer expects a call-out fee and an estimated arrival before they
  // see this provider in the shortlist. The conversational rate-capture flow
  // is a separate follow-up; for now, prompt the provider to either complete
  // their response in the provider portal/app or reply with structured text
  // (handled by the existing rate-capture code path on the next inbound).
  await saveConversation({
    phone,
    flow: 'idle',
    step: 'welcome',
    data: { pendingOpportunityLeadId: leadId, providerOpportunityStep: 'callout' } as ConversationData,
  })
  await sendText(
    phone,
    `Thanks for showing interest.\n\nWhat is your call-out fee for this job?\n\nReply with an amount, e.g. *R250* or *0*.\n\nNo credits are used at this stage.\n\n_Ref: ${traceId}_`,
  )
}

async function handleProviderOpportunityCapture(
  phone: string,
  reply: ReturnType<typeof parseInbound>,
  data: ConversationData,
) {
  const leadId = data.pendingOpportunityLeadId
  if (!leadId) return

  if (reply.id === 'back_home' || reply.text?.trim().toLowerCase() === 'cancel') {
    await sendText(phone, 'Opportunity response cancelled. No credits were used.')
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  const step = data.providerOpportunityStep ?? 'callout'

  if (step === 'callout') {
    const { validateProviderOnboardingRates } = await import('./provider-onboarding-data')
    try {
      const rates = validateProviderOnboardingRates({ callOutFeeText: reply.text })
      if (rates.callOutFee == null) throw new Error('missing fee')
      await sendText(phone, 'When can you arrive? Reply with a time like *today afternoon*, *tomorrow morning*, or an exact date/time.')
      await saveConversation({
        phone,
        flow: 'idle',
        step: 'welcome',
        data: {
          ...data,
          providerOpportunityStep: 'arrival',
          providerOpportunityCallOutFeeText: String(reply.text ?? '').trim(),
        },
      })
      return
    } catch {
      await sendText(phone, 'Please reply with a valid call-out fee, for example *R250* or *0*. No credits are used at this stage.')
      return
    }
  }

  if (step === 'arrival') {
    const estimatedArrivalAt = parseProviderOpportunityArrivalText(reply.text ?? '')
    if (!estimatedArrivalAt) {
      await sendText(phone, 'Please reply with a valid arrival time, for example *today afternoon*, *tomorrow morning*, or *2026-05-03 09:00*.')
      return
    }
    await sendButtons(
      phone,
      `Arrival saved: *${estimatedArrivalAt.toLocaleString('en-ZA')}*.\n\nIs your rate negotiable?`,
      [
        { id: 'provider_opp_negotiable_yes', title: 'Yes' },
        { id: 'provider_opp_negotiable_no', title: 'No' },
      ],
    )
    await saveConversation({
      phone,
      flow: 'idle',
      step: 'welcome',
      data: {
        ...data,
        providerOpportunityStep: 'negotiable',
        providerOpportunityEstimatedArrivalAtIso: estimatedArrivalAt.toISOString(),
      },
    })
    return
  }

  if (step === 'negotiable') {
    if (reply.id !== 'provider_opp_negotiable_yes' && reply.id !== 'provider_opp_negotiable_no') {
      await sendButtons(
        phone,
        'Please choose whether your rate is negotiable.',
        [
          { id: 'provider_opp_negotiable_yes', title: 'Yes' },
          { id: 'provider_opp_negotiable_no', title: 'No' },
        ],
      )
      return
    }
    await sendButtons(
      phone,
      'Add an optional note for the customer?',
      [
        { id: 'provider_opp_note_skip', title: 'Skip' },
        { id: 'provider_opp_note_add', title: 'Add note' },
      ],
    )
    await saveConversation({
      phone,
      flow: 'idle',
      step: 'welcome',
      data: {
        ...data,
        providerOpportunityStep: 'note',
        providerOpportunityNegotiable: reply.id === 'provider_opp_negotiable_yes',
      },
    })
    return
  }

  const providerNote =
    reply.id === 'provider_opp_note_skip'
      ? null
      : reply.text?.trim() || null
  if (reply.id === 'provider_opp_note_add') {
    await sendText(phone, 'Reply with the note you want the customer to see.')
    return
  }

  const provider = await findProviderByWhatsAppPhone(phone, { id: true })
  if (!provider) {
    await sendText(phone, "We couldn't find your provider profile. Reply *Hi* to continue.")
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  try {
    const { respondToProviderOpportunity } = await import('./provider-opportunity-responses')
    const result = await respondToProviderOpportunity({
      leadId,
      providerId: provider.id,
      response: 'INTERESTED',
      callOutFeeText: data.providerOpportunityCallOutFeeText,
      estimatedArrivalAt: data.providerOpportunityEstimatedArrivalAtIso
        ? new Date(data.providerOpportunityEstimatedArrivalAtIso)
        : null,
      negotiable: data.providerOpportunityNegotiable ?? true,
      providerNote,
      source: 'whatsapp',
      idempotencyKey: `whatsapp:${provider.id}:${leadId}:interested`,
    })
    if (!result.response) {
      await sendText(phone, '⚠️ We could not record your interest at this time. Please try again or reply *menu*.')
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }
    await sendText(
      phone,
      `Interest submitted.\n\nCall-out: ${data.providerOpportunityCallOutFeeText}\nArrival: ${data.providerOpportunityEstimatedArrivalAtIso ? new Date(data.providerOpportunityEstimatedArrivalAtIso).toLocaleString('en-ZA') : 'Saved'}\nRate: ${data.providerOpportunityNegotiable === false ? 'Fixed' : 'Negotiable'}${providerNote ? `\nNote: ${providerNote}` : ''}\n\nNo credits were used.\nWe'll notify you if the customer selects you.`,
    )
  } catch (err) {
    const { ProviderOpportunityResponseError } = await import('./provider-opportunity-responses')
    if (err instanceof ProviderOpportunityResponseError && err.code === 'INVALID_RESPONSE') {
      await sendText(phone, 'This opportunity has already been actioned. No further response is needed.')
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }
    console.error('[whatsapp-bot] handleProviderOpportunityCapture failed', { leadId, providerId: provider.id, err })
    await sendText(phone, '⚠️ Something went wrong recording your interest. Please try again or reply *menu*.')
  }
  await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
}

async function handleProviderCompletionCapture(
  phone: string,
  reply: ReturnType<typeof parseInbound>,
  data: ConversationData,
) {
  const jobId = data.pendingCompletionJobId
  if (!jobId) return

  const step = data.providerCompletionStep ?? 'note'
  if (reply.text?.trim().toLowerCase() === 'cancel') {
    await sendText(phone, 'Completion update cancelled. Reply *complete* when you are ready.')
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  if (step === 'note') {
    const note = reply.text?.trim()
    if (!note) {
      await sendText(phone, 'Please send a short completion note.')
      return
    }
    await sendText(phone, 'Please upload a completion photo, or reply SKIP.')
    await saveConversation({
      phone,
      flow: 'provider_job',
      step: 'tech_job_view',
      data: {
        ...data,
        providerCompletionStep: 'photo',
        providerCompletionNote: note.slice(0, 1000),
      },
    })
    return
  }

  if (step === 'photo') {
    let attachmentId: string | null = null
    const skipped = reply.text?.trim().toLowerCase() === 'skip'
    if (!skipped) {
      if (!reply.mediaId) {
        await sendText(phone, 'Please upload a completion photo, or reply SKIP.')
        return
      }
      try {
        const { downloadAndStoreWhatsAppMedia } = await import('./whatsapp-media')
        const stored = await downloadAndStoreWhatsAppMedia({
          mediaId: reply.mediaId,
          prefix: `jobs/${jobId}/completion`,
          label: 'completion_photo',
        })
        attachmentId = stored.attachmentId
      } catch (error) {
        console.error('[whatsapp-bot] completion photo upload failed', {
          jobId,
          mediaIdSuffix: reply.mediaId.slice(-8),
          error,
        })
        await sendText(phone, 'We could not save that photo. Please upload another photo, or reply SKIP.')
        return
      }
    }

    const result = await completeProviderJobFromWhatsApp({
      phone,
      jobId,
      completionNote: data.providerCompletionNote ?? '',
      attachmentId,
    })

    await sendText(phone, result.message)
    if (result.ok) {
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    }
  }
}

// ─── Rebook confirm handler ───────────────────────────────────────────────────

async function handleRebookConfirm(phone: string, buttonId: string): Promise<void> {
  const jobRequestId = buttonId.slice('rebook_confirm:'.length)

  const priorJob = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { id: true, category: true, title: true, description: true, customerId: true },
  })

  if (!priorJob) {
    await sendText(phone, "Sorry, we couldn't find that job. Type *Request a job* to start a new booking.")
    await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
    return
  }

  const identity = await resolveWhatsAppUserContext(phone)
  const baseData: ConversationData = {
    selectedCategory: priorJob.category ?? undefined,
    category: priorJob.category ?? undefined,
    customerName: identity.displayName ?? undefined,
    customerId: identity.customerId ?? undefined,
    issueDescription: priorJob.description ?? undefined,
    isFirstBooking: false,
  }

  const savedAddresses = identity.savedAddresses
  if (savedAddresses.length > 0) {
    // Has saved address(es) — show the site picker (collect_site handles the prompt)
    const ctx = {
      phone,
      flow: 'job_request' as const,
      step: 'collect_site' as const,
      data: baseData,
      reply: { type: 'button_reply' as const, id: 'collect_site_start', text: undefined, title: undefined },
    }
    const result = await handleJobRequestFlow(ctx)
    await saveConversation({ phone, flow: 'job_request', step: result.nextStep, data: { ...baseData, ...result.nextData } })
  } else {
    // No saved addresses — go straight to address entry; description is already pre-filled
    const category = priorJob.category ?? 'your service'
    await sendText(
      phone,
      `📍 *Where do you need the ${category} work done?*\n\nType your street address:\n\n_Example: 14 Main Street_`,
    )
    await saveConversation({ phone, flow: 'job_request', step: 'collect_address_street', data: baseData })
  }
}

// ─── Backwards-compat alias ───────────────────────────────────────────────────
/** @deprecated use notifyProviderApplicationResult */
export const notifyTechnicianApplicationResult = notifyProviderApplicationResult
