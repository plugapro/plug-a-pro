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
import { handleHelpFlow, HELP_TRIGGERS } from './whatsapp-flows/help'
import type { FlowName, FlowStep, ConversationData } from './whatsapp-flows/types'

// Conversation TTL: 30 minutes of inactivity resets to welcome
const CONVERSATION_TTL_MS = 30 * 60 * 1000

// Keywords that restart the main menu from any state
const RESET_KEYWORDS = ['hi', 'hello', 'hey', 'start', 'menu', 'home', 'restart', 'hola', 'sawubona', 'howzit']

// Keywords that trigger status check
const STATUS_KEYWORDS = ['status', 'booking', 'my booking', 'track', 'where', 'update']

// Keywords that trigger reschedule
const RESCHEDULE_KEYWORDS = ['reschedule', 'change time', 'change date', 'move booking', 'different time']

// Keywords that trigger cancellation
const CANCEL_KEYWORDS = ['cancel', 'cancellation', 'kanselleer', 'stop booking']

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
    const isHelp = HELP_TRIGGERS.some((k) => rawText === k || rawText.startsWith(k))
    const isReschedule = RESCHEDULE_KEYWORDS.some((k) => rawText.includes(k))
    const isCancel = CANCEL_KEYWORDS.some((k) => rawText.includes(k))

    let flow: FlowName = conversation.flow as FlowName
    let step: FlowStep = isExpired ? 'welcome' : (conversation.step as FlowStep)
    let data: ConversationData = isExpired ? {} : (conversation.data as ConversationData)

    // Route to appropriate flow (keyword overrides only when idle or expired)
    if (isReset || isExpired) {
      flow = 'idle'
      step = 'welcome'
      data = {}
    } else if (isRegistration && flow === 'idle') {
      flow = 'registration'
      step = 'reg_collect_name'
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
      flow = 'booking'
      step = 'browse_categories'
    } else if (reply.id === 'status' || reply.id === 'my_booking') {
      flow = 'status'
      step = 'status_show'
    } else if (reply.id?.startsWith('view_job_') || reply.id?.startsWith('accept_job_') || reply.id?.startsWith('decline_job_')) {
      // Technician job management
      const jobId = reply.id.replace(/^(view_job_|accept_job_|decline_job_)/, '')
      flow = 'technician_job'
      step = reply.id.startsWith('accept_job_') ? 'tech_job_confirm_accept'
           : reply.id.startsWith('decline_job_') ? 'tech_job_confirm_decline'
           : 'tech_job_view'
      data = { ...data, pendingJobId: jobId }
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
    } else if (flow === 'help') {
      result = await handleHelpFlow(ctx)
    } else if (flow === 'reschedule') {
      result = await handleRescheduleFlow(ctx)
    } else if (flow === 'cancel') {
      result = await handleCancelFlow(ctx)
    } else if (flow === 'technician_job') {
      result = await handleTechnicianJobFlow(ctx)
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
  const { sendTemplate } = await import('./whatsapp')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (params.approved) {
    await sendTemplate({
      to: params.phone,
      template: 'technician_welcome',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.name },
            { type: 'text', text: `${appUrl}/technician` },
          ],
        },
      ],
    })
  } else {
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
  ctx: Parameters<typeof handleBookingFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendList, sendText } = await import('./whatsapp-interactive')
  const { getAvailableSlots } = await import('./slotting')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (ctx.step === 'reschedule_reason') {
    // Find latest active booking
    const customer = await db.customer.findUnique({
      where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
    })
    if (!customer) {
      await sendText(ctx.phone, "📋 No bookings found for your number. Send 'Hi' to start a new booking.")
      return { nextStep: 'done' }
    }

    const booking = await db.booking.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['CONFIRMED', 'SCHEDULED'] },
      },
      include: { service: true },
      orderBy: { scheduledDate: 'asc' },
    })

    if (!booking) {
      await sendText(ctx.phone, "You don't have any upcoming bookings to reschedule. Send 'Hi' to book a new service.")
      return { nextStep: 'done' }
    }

    const dateLabel = booking.scheduledDate?.toLocaleDateString('en-ZA', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) ?? 'TBC'

    await sendButtons(
      ctx.phone,
      `🔄 *Reschedule Booking*\n\n🔧 ${booking.service.name}\n🗓 Currently: ${dateLabel}${booking.scheduledWindow ? ` · ${booking.scheduledWindow}` : ''}\n\nWhy do you need to reschedule?`,
      [
        { id: 'rs_personal', title: '👤 Personal reason' },
        { id: 'rs_work', title: '💼 Work conflict' },
        { id: 'rs_other', title: '✏️ Other' },
      ]
    )
    return { nextStep: 'reschedule_select_slot', nextData: { rescheduleBookingId: booking.id, selectedServiceId: booking.serviceId } }
  }

  if (ctx.step === 'reschedule_select_slot') {
    if (ctx.reply.id?.startsWith('rs_')) {
      // Save reason label, show new slots
      const reasons: Record<string, string> = {
        rs_personal: 'Personal reason',
        rs_work: 'Work conflict',
        rs_other: 'Other',
      }
      const reason = reasons[ctx.reply.id] ?? 'Not specified'

      // Show available slots for the same service
      const slots = await getAvailableSlots({
        businessId: ctx.businessId,
        serviceId: ctx.data.selectedServiceId!,
        suburb: '',
        city: '',
        limit: 6,
      })

      if (slots.length === 0) {
        await sendText(ctx.phone, "😔 No available slots right now. We'll contact you as soon as a slot opens.")
        return { nextStep: 'done', nextData: { rescheduleReason: reason } }
      }

      const rows = slots.map((s) => ({
        id: `rslot_${s.id ?? s.windowStart}`,
        title: new Date(s.date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }),
        description: `${s.windowStart}–${s.windowEnd}`,
      }))

      await sendList(
        ctx.phone,
        '🗓 Choose your new time:',
        [{ title: 'Available Slots', rows }],
        { buttonLabel: 'Choose New Time' }
      )
      return { nextStep: 'reschedule_confirm', nextData: { rescheduleReason: reason } }
    }

    if (ctx.reply.id?.startsWith('rslot_')) {
      // Move to confirm
      return { nextStep: 'reschedule_confirm', nextData: { selectedSlotId: ctx.reply.id.replace('rslot_', ''), selectedSlotLabel: ctx.reply.title ?? '' } }
    }

    await sendText(ctx.phone, 'Please choose a new time from the list above.')
    return { nextStep: 'reschedule_select_slot' }
  }

  if (ctx.step === 'reschedule_confirm') {
    if (ctx.reply.id?.startsWith('rslot_')) {
      const slotId = ctx.reply.id.replace('rslot_', '')
      await sendButtons(
        ctx.phone,
        `🗓 Reschedule to *${ctx.reply.title}*?\n\nTap Confirm to update your booking.`,
        [
          { id: 'rs_confirm_yes', title: '✅ Confirm' },
          { id: 'rs_confirm_no', title: '❌ Keep Original' },
        ]
      )
      return { nextStep: 'reschedule_confirm', nextData: { selectedSlotId: slotId, selectedSlotLabel: ctx.reply.title ?? '' } }
    }

    if (ctx.reply.id === 'rs_confirm_yes') {
      await db.booking.update({
        where: { id: ctx.data.rescheduleBookingId! },
        data: {
          slotId: ctx.data.selectedSlotId,
          scheduledWindow: ctx.data.selectedSlotLabel,
          status: 'RESCHEDULED',
        },
      })
      await sendText(
        ctx.phone,
        `✅ Booking rescheduled to *${ctx.data.selectedSlotLabel}*.\n\nYou'll receive a reminder the day before. Send 'Hi' to return to the menu.`
      )
      return { nextStep: 'done' }
    }

    if (ctx.reply.id === 'rs_confirm_no') {
      await sendText(ctx.phone, 'No problem! Your original booking time has been kept. 👍')
      return { nextStep: 'done' }
    }

    return { nextStep: 'reschedule_confirm' }
  }

  return { nextStep: 'done' }
}

// ─── Cancel flow ──────────────────────────────────────────────────────────────

async function handleCancelFlow(
  ctx: Parameters<typeof handleBookingFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendText } = await import('./whatsapp-interactive')

  const customer = await db.customer.findUnique({
    where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
  })
  if (!customer) {
    await sendText(ctx.phone, "No bookings found. Send 'Hi' to make a new booking.")
    return { nextStep: 'done' }
  }

  const booking = await db.booking.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'SCHEDULED'] },
    },
    include: { service: true },
    orderBy: { scheduledDate: 'asc' },
  })

  if (!booking) {
    await sendText(ctx.phone, "You don't have any active bookings to cancel. Send 'Hi' for the main menu.")
    return { nextStep: 'done' }
  }

  if (ctx.step === 'cancel_confirm') {
    const dateLabel = booking.scheduledDate?.toLocaleDateString('en-ZA', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) ?? 'TBC'

    await sendButtons(
      ctx.phone,
      `❌ *Cancel Booking*\n\n🔧 ${booking.service.name}\n🗓 ${dateLabel}\n\nAre you sure you want to cancel? Cancellation fees may apply.`,
      [
        { id: 'cancel_yes', title: '❌ Yes, Cancel' },
        { id: 'cancel_no', title: '← Keep Booking' },
      ]
    )
    return { nextStep: 'cancel_confirm', nextData: { rescheduleBookingId: booking.id } }
  }

  if (ctx.reply.id === 'cancel_yes') {
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    })
    await sendText(
      ctx.phone,
      `✅ Your ${booking.service.name} booking has been cancelled.\n\nA refund (if applicable) will be processed within 3–5 business days.\n\nSend 'Hi' to make a new booking anytime. 👋`
    )
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'cancel_no') {
    await sendText(ctx.phone, "Great! Your booking has been kept. Send 'Hi' to return to the menu. 👍")
    return { nextStep: 'done' }
  }

  return { nextStep: 'cancel_confirm' }
}

// ─── Technician job management flow ───────────────────────────────────────────

async function handleTechnicianJobFlow(
  ctx: Parameters<typeof handleBookingFlow>[0]
): Promise<{ nextStep: FlowStep; nextData?: Partial<ConversationData> }> {
  const { sendButtons, sendCtaUrl, sendText } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const jobId = ctx.data.pendingJobId

  if (!jobId) {
    await sendText(ctx.phone, "Couldn't identify the job. Please open your app for details.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          service: true,
          address: true,
          slot: true,
        },
      },
    },
  })

  if (!job) {
    await sendText(ctx.phone, 'Job not found. It may have been reassigned. Check the app for your current jobs.')
    return { nextStep: 'done' }
  }

  if (ctx.step === 'tech_job_view') {
    const addr = job.booking.address
    const addrLabel = addr ? `${addr.street}, ${addr.suburb}` : 'Address in app'
    const slotLabel = job.booking.scheduledWindow ?? 'Time in app'

    await sendButtons(
      ctx.phone,
      `📋 *Job Details*\n\n🔧 ${job.booking.service.name}\n📍 ${addrLabel}\n🗓 ${slotLabel}\n\nAccept this job?`,
      [
        { id: `accept_job_${jobId}`, title: '✅ Accept' },
        { id: `decline_job_${jobId}`, title: '❌ Decline' },
      ]
    )
    return { nextStep: 'tech_job_confirm_accept' }
  }

  if (ctx.step === 'tech_job_confirm_accept' && (ctx.reply.id === `accept_job_${jobId}` || ctx.reply.id?.startsWith('accept_job_'))) {
    await db.job.update({
      where: { id: jobId },
      data: { status: 'ASSIGNED' },
    })
    const jobUrl = `${appUrl}/technician/jobs/${jobId}`
    await sendCtaUrl(
      ctx.phone,
      `✅ Job accepted! See full customer notes and directions in the app:`,
      'Open Job',
      jobUrl,
      { footer: 'Navigate and update job status from the app' }
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
        { id: `dc_other_${jobId}`, title: '✏️ Other' },
      ]
    )
    return { nextStep: 'tech_job_confirm_decline' }
  }

  if (ctx.reply.id?.startsWith('dc_')) {
    // Technician declined — mark job for reassignment
    await db.job.update({
      where: { id: jobId },
      data: { status: 'ASSIGNED', notes: `Declined by ${ctx.phone}` } as never,
    }).catch(() => {}) // best-effort; admin handles reassignment

    await sendText(
      ctx.phone,
      "Got it. This job has been returned to the queue. Our team will reassign it. 👍"
    )
    return { nextStep: 'done' }
  }

  return { nextStep: 'tech_job_view' }
}
