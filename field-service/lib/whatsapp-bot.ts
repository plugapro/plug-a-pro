// ─── WhatsApp conversation bot — main inbound router ─────────────────────────
// All inbound WhatsApp messages pass through here.
// Resolves conversation state → dispatches to correct flow → saves new state.
//
// Architecture:
//   Webhook (POST /api/webhooks/whatsapp)
//     → processInboundMessage()
//     → loadConversation()
//     → dispatchToFlow()
//       → booking.ts | registration.ts | status.ts
//     → saveConversation()

import { db } from './db'
import type { Prisma } from '@prisma/client'
import { parseInbound, sendText, type InboundMessage } from './whatsapp-interactive'
import {
  handleBookingFlow,
  showMainMenu,
} from './whatsapp-flows/booking'
import {
  handleRegistrationFlow,
  REGISTRATION_TRIGGERS,
} from './whatsapp-flows/registration'
import { handleStatusFlow } from './whatsapp-flows/status'
import type { FlowName, FlowStep, ConversationData } from './whatsapp-flows/types'

// Conversation TTL: 30 minutes of inactivity resets to welcome
const CONVERSATION_TTL_MS = 30 * 60 * 1000

// Keywords that restart the main menu from any state
const RESET_KEYWORDS = ['hi', 'hello', 'hey', 'start', 'menu', 'home', 'restart', 'hola', 'sawubona', 'howzit']

// Keywords that trigger status check
const STATUS_KEYWORDS = ['status', 'booking', 'my booking', 'track', 'where', 'update']

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processInboundMessage(
  message: InboundMessage,
  businessId: string
): Promise<void> {
  const phone = message.from
  const reply = parseInbound(message)

  try {
    // Load or create conversation session
    const conversation = await loadConversation(phone, businessId)
    const isExpired = conversation.expiresAt < new Date()

    // Override: reset keywords always restart
    const rawText = reply.text?.toLowerCase() ?? ''
    const isReset = RESET_KEYWORDS.some((k) => rawText === k || rawText.startsWith(k + ' '))
    const isStatus = STATUS_KEYWORDS.some((k) => rawText.includes(k))
    const isRegistration = REGISTRATION_TRIGGERS.some(
      (k) => rawText === k || rawText.startsWith(k)
    )

    let flow: FlowName = conversation.flow as FlowName
    let step: FlowStep = isExpired ? 'welcome' : (conversation.step as FlowStep)
    let data: ConversationData = isExpired ? {} : (conversation.data as ConversationData)

    // Route to appropriate flow
    if (isReset || isExpired) {
      flow = 'idle'
      step = 'welcome'
      data = {}
    } else if (isRegistration && flow === 'idle') {
      flow = 'registration'
      step = 'reg_collect_name'
    } else if (isStatus && flow === 'idle') {
      flow = 'status'
      step = 'status_show'
    } else if (reply.id === 'book' || reply.id === 'browse_categories') {
      flow = 'booking'
      step = 'browse_categories'
    } else if (reply.id === 'status' || reply.id === 'my_booking') {
      flow = 'status'
      step = 'status_show'
    }

    // Dispatch to flow handler
    const ctx = { phone, businessId, step, data, reply, flow }
    let result: { nextStep: FlowStep; nextData?: Partial<ConversationData> } = { nextStep: step, nextData: data }

    if (flow === 'booking' || step === 'browse_categories') {
      result = await handleBookingFlow({ ...ctx, step: step === 'welcome' && flow === 'booking' ? 'browse_categories' : step })
    } else if (flow === 'registration') {
      result = await handleRegistrationFlow(ctx)
    } else if (flow === 'status') {
      result = await handleStatusFlow(ctx)
    } else {
      // Idle / unknown — show main menu
      await showMainMenu(phone)
      result = { nextStep: 'welcome', nextData: {} }
      flow = 'idle'
    }

    // Determine if flow is complete
    const terminalSteps: FlowStep[] = ['done', 'cancelled']
    const isTerminal = terminalSteps.includes(result.nextStep)

    await saveConversation({
      phone,
      businessId,
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

async function loadConversation(phone: string, businessId: string) {
  const existing = await db.conversation.findUnique({
    where: { phone_businessId: { phone, businessId } },
  })

  if (existing) return existing

  // Create fresh conversation
  return db.conversation.create({
    data: {
      phone,
      businessId,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
  })
}

async function saveConversation(params: {
  phone: string
  businessId: string
  flow: FlowName
  step: FlowStep
  data: ConversationData
}): Promise<void> {
  await db.conversation.upsert({
    where: { phone_businessId: { phone: params.phone, businessId: params.businessId } },
    create: {
      phone: params.phone,
      businessId: params.businessId,
      flow: params.flow,
      step: params.step,
      data: params.data as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
    update: {
      flow: params.flow,
      step: params.step,
      data: params.data as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
  })
}

// ─── Job notification to technician via WhatsApp ─────────────────────────────
// Replaces direct customer ↔ technician contact — all mediated through the platform

export async function notifyTechnicianNewJob(params: {
  technicianPhone: string
  jobId: string
  serviceName: string
  address: string
  scheduledWindow: string
  customerInitial: string  // First name only — never share full customer contact
  bookingId: string
}): Promise<void> {
  const { sendButtons } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendButtons(
    params.technicianPhone,
    `🔔 *New Job Assigned*\n\n🔧 ${params.serviceName}\n📍 ${params.address}\n🗓 ${params.scheduledWindow}\n👤 Customer: ${params.customerInitial}\n\nOpen the job for full details:`,
    [
      { id: `view_job_${params.jobId}`, title: '📋 View Job' },
      { id: `accept_job_${params.jobId}`, title: '✅ Accept' },
    ],
    { footer: `Booking ref: ${params.bookingId.slice(-8).toUpperCase()}` }
  )
}

export async function notifyTechnicianApplicationResult(params: {
  phone: string
  name: string
  approved: boolean
  reason?: string
}): Promise<void> {
  if (params.approved) {
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    await sendCtaUrl(
      params.phone,
      `🎉 *Welcome to Plug a Pro, ${params.name}!*\n\nYour application has been approved. You can now receive job assignments.\n\nDownload the Technician App to get started:`,
      'Open Technician App',
      `${appUrl}/technician`,
      { footer: 'Use the same number to sign in' }
    )
  } else {
    await sendText(
      params.phone,
      `Hi ${params.name}, thank you for applying to Plug a Pro.\n\nUnfortunately we're unable to onboard you at this time${params.reason ? `: ${params.reason}` : ''}.\n\nYou're welcome to apply again in the future.`
    )
  }
}
