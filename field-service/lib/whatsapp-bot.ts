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
import type { Prisma } from '@prisma/client'
import { parseInbound, sendText, sendButtons, sendCtaUrl, type InboundMessage } from './whatsapp-interactive'
import {
  handleJobRequestFlow,
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
  PROVIDER_JOURNEY_TRIGGERS,
} from './whatsapp-flows/provider-journey'
import type { FlowName, FlowStep, ConversationData } from './whatsapp-flows/types'
import { applyOptIn, applyOptOut } from './whatsapp-policy'
import { normalizePhone } from './utils'
import { createTraceId } from './support-diagnostics'
import { createTestCohortContext } from './internal-test-cohort'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { phoneLookupVariants, resolveWhatsAppIdentity } from './whatsapp-identity'
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
import { resolveProviderWhatsappCommand } from './provider-whatsapp-command-model'
import {
  completeProviderJobFromWhatsApp,
  executeProviderJobCommand,
  findSingleActiveJobForProviderPhone,
  parseProviderJobCommand,
} from './provider-whatsapp-job-commands'
import { parseProviderInterestRateText } from './provider-whatsapp-interest-capture'

// Conversation TTL: configurable via WHATSAPP_SESSION_TIMEOUT_MS (default 30 min)
const CONVERSATION_TTL_MS = Number(process.env.WHATSAPP_SESSION_TIMEOUT_MS) || 30 * 60 * 1000
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
const customerPhotoBatches = new Map<string, {
  messages: InboundMessage[]
  timer: ReturnType<typeof setTimeout>
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>
}>()
const providerEvidenceBatches = new Map<string, {
  messages: InboundMessage[]
  timer: ReturnType<typeof setTimeout>
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>
}>()
const pendingCityTextMessages = new Map<string, {
  message: InboundMessage
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: unknown) => void
}>()
const recentCityInteractiveSelections = new Map<string, {
  messageId: string
  timer: ReturnType<typeof setTimeout>
}>()

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
    `You used 1 credit to accept this lead.\n\n` +
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
      await sendCtaUrl(params.phone, body, 'View Job', jobUrl, undefined, fallbackContext)
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

function firstName(name: string | null | undefined) {
  return (name?.trim() || 'there').split(/\s+/)[0]
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
    id.startsWith('mdc_') ||
    id.startsWith('accept:') ||
    id.startsWith('decline:') ||
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
    id.startsWith('post_match_contact:') ||
    (!id && rawText === 'accept')
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

  try {
    // Load or create conversation session
    const conversation = await loadConversation(phone)
    const isExpired = conversation.expiresAt < new Date()

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
    //   - evidence collection in the provider registration flow
    //   - customer photo upload in the job-request flow
    // Must be checked BEFORE flow dispatch so mid-flow reactions don't retrigger menus.
    if (reply.type === 'other') return
    if ((reply.type === 'image' || reply.type === 'document') &&
        !((conversation.flow === 'registration' && conversation.step === 'reg_collect_evidence') ||
          (conversation.flow === 'job_request' && conversation.step === 'collect_photos'))) {
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
    const providerCommand = resolveProviderWhatsappCommand(rawText)

    let flow: FlowName = conversation.flow as FlowName
    let step: FlowStep = isExpired ? 'welcome' : (conversation.step as FlowStep)
    let data: ConversationData = isExpired ? {} : (conversation.data as ConversationData)
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
      'provider_worker_portal',
      'provider_service_areas',
      'provider_profile',
      'provider_support',
      'provider_status',
      'provider_application_status',
      'provider_update_application',
      'provider_top_up_credits',
    ].includes(reply.id))
    const identity = await resolveWhatsAppIdentity(phone)
    const selectedMenuPath = reply.id ?? rawText ?? 'unknown'
    const isCustomerRole = identity.role === 'customer'
    const isProviderRole = identity.role === 'provider' || identity.role === 'provider_pending' || identity.role === 'provider_inactive'
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

    if (reply.id === 'back_home' || reply.id === 'session_restart') {
      await showMainMenu(phone)
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    if (reply.id === 'provider_top_up_credits') {
      await sendCtaUrl(
        phone,
        'Top up your Plug-A-Pro Credits before accepting more matched leads.',
        'Top Up Credits',
        getWorkerPortalUrl('/provider/credits'),
      )
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
      await handleAssignmentHoldAcceptance(phone, reply.id)
      return
    }

    if (!reply.id && rawText === 'accept') {
      // ── Provider typed "accept" as text instead of tapping the button ─────────
      // Find the most recent pending (SENT/VIEWED) lead for this provider and accept it.
      const providerForAccept = await findProviderByWhatsAppPhone(phone, { id: true })
      if (providerForAccept) {
        const activeLead = await db.lead.findFirst({
          where: {
            providerId: providerForAccept.id,
            status: { in: ['SENT', 'VIEWED'] },
            expiresAt: { gt: new Date() },
          },
          orderBy: { sentAt: 'desc' },
          select: { assignmentHoldId: true },
        })
        if (activeLead?.assignmentHoldId) {
          await handleAssignmentHoldAcceptance(phone, `accept:${activeLead.assignmentHoldId}`)
          return
        }
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

    if (reply.id?.startsWith('post_match_contact:')) {
      await handlePostMatchContactCustomer(phone, reply.id)
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
      reply.id === 'provider_pause_cancel') {
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
    } else if (reply.id === 'provider_status') {
      flow = 'provider_journey'
      step = 'pj_provider_status'
    } else if (reply.id === 'provider_application_status') {
      flow = 'provider_journey'
      step = 'pj_application_status'
    } else if (reply.id === 'provider_update_application') {
      const application = await db.providerApplication.findFirst({
        where: { phone, status: { in: ['PENDING', 'APPROVED'] } },
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
        // For AMBIGUOUS_JOB or INVALID_COMMAND: fall through so the menu can
        // show the provider their list of active jobs.
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
    console.error(`[whatsapp-bot] Error processing message from ${phone}:`, err)
    // Fail gracefully — send a generic error message
    try {
      await sendText(
        phone,
        "😔 Something went wrong on our end. Please try again or reply 'Hi' to restart."
      )
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
      creditLine = `Showing interest is free. You spend ${creditCountLabel(LEAD_UNLOCK_COST_CREDITS)} only if the customer selects you and you accept the selected job.\nAvailable balance: ${creditCountLabel(balance.totalCreditBalance)} (${providerCreditBreakdownLabel(balance)}).`
      const { getSafeProviderOpportunityPreview } = await import('./provider-opportunity-responses')
      safePreview = await getSafeProviderOpportunityPreview(params.leadId, lead.providerId)
    }
  } catch (error) {
    console.warn('[whatsapp-bot] unable to include provider credit balance in lead notification', {
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
    `*${preview?.category ?? params.category}*${preview?.subcategory ? ` · ${preview.subcategory}` : ''}`,
    `Area: ${previewArea}`,
    preview?.area?.region ? `Region: ${preview.area.region}` : null,
    preview?.urgency ? `Urgency: ${preview.urgency}` : null,
    preview?.budgetPreference ? `Budget: ${preview.budgetPreference}` : null,
    preview?.requestedWindowStart
      ? `Preferred time: ${preview.requestedWindowStart.toLocaleString('en-ZA')}`
      : preview?.requestedArrivalLatest
        ? `Preferred time: before ${preview.requestedArrivalLatest.toLocaleString('en-ZA')}`
        : null,
    `Photos: ${preview?.attachments.length ?? 0} available`,
    preview?.description ? `Issue: ${preview.description}` : null,
  ].filter(Boolean).join('\n')

  await sendCtaUrl(
    params.providerPhone,
    `🔔 *New Job Opportunity*\n\n${previewLines}\n\nRef: ${ref} · Expires in ${expiryLabel}\n\nThe customer is comparing suitable providers.\n\n${creditLine}\n\nReply with the buttons sent below, or tap to view photos/full preview.`,
    'View Lead',
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
      'Open Provider Portal',
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
      `🔄 *Reschedule Request*\n\n🔧 ${booking.match.jobRequest.category}\n\nWhy do you need to reschedule?`,
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
      `❌ *Cancel Job Request*\n\n🔧 ${jobRequest.category}\n\nAre you sure you want to cancel this request?`,
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
      `✅ Your ${jobRequest.category} job request has been cancelled.\n\nSend 'Hi' to submit a new request anytime. 👋`
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
    const { acceptLead } = await import('./matching-engine')
    let result
    try {
      result = await acceptLead({ leadId, providerId: provider.id, inspectionNeeded: false, source: 'whatsapp' })
    } catch (error) {
      const traceId = createTraceId('wbot')
      console.error('[whatsapp-bot] match accept: unhandled acceptLead exception', {
        traceId,
        leadId,
        providerId: provider.id,
        error_code: 'UNKNOWN_LEAD_ACCEPT_ERROR',
        error: error instanceof Error ? error.message : String(error),
      })
      await sendText(phone, `😔 Something went wrong processing your acceptance. Please try again or contact support.\n\n_Ref: ${traceId}_`)
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
        await sendText(phone, `😔 We couldn't accept this lead because of a technical issue. Please try again or contact support.\n\n_Ref: ${result.traceId ?? createTraceId('wbot')}_`)
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
      await sendText(phone, '😔 We could not generate a secure lead link. Please try again or contact support.')
      return
    }
    await sendCtaUrl(
      phone,
      `🔍 *View Lead Preview*\n\nOpen the link below to review the lead preview, then choose to accept or decline.`,
      'View Lead',
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
        `📋 *Your Active Job*\n\n${statusEmoji[j.status] ?? '📋'} ${req.category}\n📍 ${addr ? `${addr.street}, ${normaliseLocationDisplayName(addr.suburb)}` : 'See app'}\n${statusLabel[j.status] ?? j.status.replace(/_/g, ' ')}`,
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
    const addrLabel = addr ? `${addr.street}, ${normaliseLocationDisplayName(addr.suburb)}` : 'Address in app'
    const categoryLabel = job.booking.match.jobRequest.category

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
    // Prefer a scoped one-job WhatsApp link when this scheduled job originated
    // from a lead; fall back to the authenticated portal for legacy bookings.
  const acceptedLeadId = job.booking.match.jobRequest.leads.find((lead) => lead.providerId === job.providerId)?.id
    const fallbackJobUrl = getPublicAppUrl(`/provider/jobs/${jobId}`)
    const jobUrl = acceptedLeadId
      ? await (await import('./provider-lead-access')).getProviderSignedJobHandoverUrl({
          leadId: acceptedLeadId,
          providerId: job.providerId,
          jobRequestId: job.booking.match.jobRequest.id,
          providerPhone: job.provider.phone,
        }) ?? fallbackJobUrl
      : fallbackJobUrl
    await sendCtaUrl(
      ctx.phone,
      `✅ *Job Confirmed!*\n\nYou can manage this job from the link below. No login is needed when a secure job link is available.`,
      'Open Job',
      jobUrl,
      { footer: acceptedLeadId ? 'Secure link for this accepted job only.' : 'Sign in may be required for this booking.' }
    )
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
    await db.lead.updateMany({
      where: {
        jobRequestId,
        providerId: job.providerId,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'DECLINED', respondedAt: new Date() },
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
    `💼 *Quote from ${params.providerName}*\n\n• Labour: R ${params.labourCost.toFixed(2)}${materialsLine}\n• *Total: R ${params.totalAmount.toFixed(2)}*${hoursLine}${validLine}\n\n📋 _${params.description}_\n\nTap a button below to accept or decline, or open the full quote.`,
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
    await sendCtaUrl(
      result.provider.phone,
      `✅ *Booking confirmed — ${result.category}*\n\nThe customer accepted your quote. The job is scheduled for *${dateStr}*.\n\nOpen the app to view full details and the customer's address.`,
      'View Job',
      getPublicAppUrl('/technician')
    ).catch(() => {})
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
      `❌ *Quote not accepted*\n\nThe customer didn't proceed with your ${result.category} quote. Your profile remains active and new leads will come through as they arise.`
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
    select: { id: true, jobRequestId: true },
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

  const { acceptLead } = await import('./matching-engine')
  let result
  try {
    result = await acceptLead({ leadId: lead.id, providerId: provider.id, source: 'whatsapp' })
  } catch (error) {
    console.error('[whatsapp-bot] accept: unhandled acceptLead exception', {
      traceId,
      holdId,
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      providerId: provider.id,
      error_code: 'UNKNOWN_LEAD_ACCEPT_ERROR',
      error: error instanceof Error ? error.message : String(error),
    })
    await sendText(phone, `😔 Something went wrong processing your acceptance. Please try again or contact support.\n\n_Ref: ${traceId}_`)
    return
  }

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_CREDITS') {
      console.warn('[whatsapp-bot] accept: insufficient credits', {
        traceId, holdId, leadId: lead.id, providerId: provider.id, error_code: 'INSUFFICIENT_CREDITS',
      })
      await sendLeadInsufficientCreditsMessage(phone, lead.id, result.currentCreditBalance ?? 0)
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
      console.error('[whatsapp-bot] accept: lead acceptance failed', {
        traceId: supportRef,
        holdId,
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        providerId: provider.id,
        error_code: 'LEAD_ACCEPTANCE_FAILED',
      })
      await sendText(phone, `😔 We couldn't accept this lead because of a technical issue. Please try again or contact support.\n\n_Ref: ${supportRef}_`)
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
      await sendText(phone, `😔 Something went wrong processing your acceptance. Please try again or contact support.\n\n_Ref: ${traceId}_`)
    }
    return
  }

  // Primary post-match notifications (customer + provider) are dispatched inside
  // acceptLead via notifyPostMatchAcceptance. If that function failed to notify the
  // provider (e.g. customer WhatsApp error, URL generation issue, transient API
  // failure), send a reliable fallback so the provider is never left without a
  // response after successfully accepting a lead.
  if (!result.notificationSent) {
    console.warn('[whatsapp-bot] accept: primary notification failed; sending fallback confirmation', {
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
}

async function sendLeadInsufficientCreditsMessage(
  phone: string,
  leadId: string,
  currentCreditBalance: number,
): Promise<void> {
  await sendButtons(
    phone,
    buildInsufficientCreditsMessage({
      availableCredits: currentCreditBalance,
      creditsRequired: LEAD_UNLOCK_COST_CREDITS,
    }),
    [
      { id: 'provider_top_up_credits', title: 'Top Up Credits' },
      { id: `match_inspect_${leadId}`, title: 'View Lead' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
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

    const { releaseProviderCapacity } = await import('./matching/reservation')
    await releaseProviderCapacity(provider.id).catch(() => {})

    await sendText(
      phone,
      `Understood — lead passed (${reason}). We'll keep matching this job with other providers. New leads will come through as they arise.`
    )
  } catch (error) {
    console.error('[whatsapp-bot] decline: unexpected failure', {
      traceId, phone, holdId, reason, leadId: lead.id, providerId: provider.id, error,
    })
    await sendText(
      phone,
      `😔 Something went wrong recording your decline. Please try again or contact support.\n\n_Ref: ${traceId}_`
    ).catch(() => {})
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
      if (result.reason === 'INSUFFICIENT_CREDITS') {
        await sendText(
          phone,
          buildInsufficientCreditsMessage({ availableCredits: result.currentCreditBalance ?? 0 }),
        )
        return
      }
      if (result.reason === 'PROVIDER_NOT_SELECTED') {
        await sendText(phone, '⚠️ This job was offered to a different provider. No credits used.')
        return
      }
      if (result.reason === 'LEAD_INVITE_NOT_SELECTED') {
        await sendText(phone, '⚠️ This job has not been customer-selected for you. No action taken.')
        return
      }
      if (result.reason === 'LEAD_EXPIRED') {
        await sendText(phone, '⏰ This job has expired and can no longer be accepted. No credits used.')
        return
      }
      if (result.reason === 'REQUEST_NOT_AWAITING_CONFIRMATION') {
        await sendText(phone, '⚠️ This job is no longer awaiting your confirmation.')
        return
      }
      console.error('[whatsapp-bot] confirm_accept failed', { traceId, leadId, reason: result.reason })
      await sendText(phone, `😔 We couldn't process that confirmation. Please try again or contact support.\n\n_Ref: ${traceId}_`)
      return
    }
    if (result.alreadyUnlocked) {
      await sendText(phone, 'This job is already assigned to you. No additional credit was deducted. Reply *my jobs* to manage it.')
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
    await sendText(phone, '⚠️ This job is no longer awaiting your confirmation.')
    return
  }
  await sendText(
    phone,
    'No problem — we have let the customer know. They can pick another provider from the shortlist.',
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

  await sendText(
    phone,
    `Interest submitted.\n\nCall-out: ${data.providerOpportunityCallOutFeeText}\nArrival: ${data.providerOpportunityEstimatedArrivalAtIso ? new Date(data.providerOpportunityEstimatedArrivalAtIso).toLocaleString('en-ZA') : 'Saved'}\nRate: ${data.providerOpportunityNegotiable === false ? 'Fixed' : 'Negotiable'}${providerNote ? `\nNote: ${providerNote}` : ''}\n\nNo credits were used.\nWe'll notify you if the customer selects you.`,
  )
  await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
  void result
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

// ─── Backwards-compat alias ───────────────────────────────────────────────────
/** @deprecated use notifyProviderApplicationResult */
export const notifyTechnicianApplicationResult = notifyProviderApplicationResult
