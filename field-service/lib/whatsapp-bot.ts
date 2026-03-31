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
import { parseInbound, sendText, type InboundMessage } from './whatsapp-interactive'
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

// Keywords that show a provider's active jobs list
const PROVIDER_KEYWORDS = ['myjobs', 'my jobs', 'my work', 'jobs']

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processInboundMessage(
  message: InboundMessage
): Promise<void> {
  const phone = message.from
  const reply = parseInbound(message)

  try {
    // Load or create conversation session
    const conversation = await loadConversation(phone)
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

    // Notify provider if their session expired mid-flow (before silently resetting)
    if (isExpired && conversation.flow !== 'idle' && !isReset) {
      await sendText(
        phone,
        "⏰ Your session timed out after 30 minutes of inactivity. Send 'Hi' to start again."
      )
      await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
      return
    }

    const isProviderJobList = PROVIDER_KEYWORDS.some((k) => rawText === k)

    // Route to appropriate flow (keyword overrides only when idle or expired)
    if (isReset || isExpired) {
      flow = 'idle'
      step = 'welcome'
      data = {}
    } else if (isProviderJobList && flow === 'idle') {
      flow = 'provider_job'
      step = 'tech_job_list'
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
      flow = 'job_request'
      step = 'browse_categories'
    } else if (reply.id === 'status' || reply.id === 'my_booking') {
      flow = 'status'
      step = 'status_show'
    } else if (reply.id?.startsWith('mdc_')) {
      // ── Match decline reason responses ──────────────────────────────────────
      const matchId = reply.id.replace(/^mdc_(unavailable|area|other)_/, '')
      const reasonMap: Record<string, string> = {
        [`mdc_unavailable_${matchId}`]: 'Not available',
        [`mdc_area_${matchId}`]: 'Too far',
        [`mdc_other_${matchId}`]: 'Other',
      }
      const reason = reasonMap[reply.id] ?? 'Declined'

      const provider = await db.provider.findUnique({ where: { phone } })
      if (provider) {
        const match = await db.match.findUnique({ where: { id: matchId } })
        if (match && match.providerId === provider.id) {
          await db.lead.updateMany({
            where: { jobRequestId: match.jobRequestId, providerId: provider.id },
            data: { status: 'DECLINED', respondedAt: new Date() },
          })
          await db.match.update({
            where: { id: matchId },
            data: { status: 'CANCELLED' },
          }).catch(() => {})
        }
      }

      const { sendText } = await import('./whatsapp-interactive')
      await sendText(phone, `Got it — lead declined (${reason}). We'll find another provider. 👍`)
      return
    } else if (
      reply.id?.startsWith('match_accept_') ||
      reply.id?.startsWith('match_inspect_') ||
      reply.id?.startsWith('match_decline_')
    ) {
      // ── Match-level lead responses (quote flow) ─────────────────────────────
      await handleMatchLeadResponse(phone, reply.id)
      return
    } else if (reply.id?.startsWith('quote_accept_') || reply.id?.startsWith('quote_decline_')) {
      // ── Customer quote response buttons ─────────────────────────────────────
      await handleCustomerQuoteResponse(phone, reply.id)
      return
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
    const ctx = { phone, step, data, reply, flow }
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
  const existing = await db.conversation.findUnique({
    where: { phone },
  })

  if (existing) return existing

  // Create fresh conversation
  return db.conversation.create({
    data: {
      phone,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
  })
}

async function saveConversation(params: {
  phone: string
  flow: FlowName
  step: FlowStep
  data: ConversationData
}): Promise<void> {
  await db.conversation.upsert({
    where: { phone: params.phone },
    create: {
      phone: params.phone,
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

// ─── Job notification to provider via WhatsApp ───────────────────────────────
// Replaces direct customer ↔ provider contact — all mediated through the platform

export async function notifyProviderNewJob(params: {
  providerPhone: string
  matchId: string          // Match.id — used for quote routing
  category: string
  area: string             // suburb/city for display
  description: string      // short job description
  customerInitial: string  // first name only
}): Promise<void> {
  const { sendButtons } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendButtons(
    params.providerPhone,
    `🔔 *New Job Lead*\n\n🔧 ${params.category}\n📍 ${params.area}\n📋 ${params.description}\n👤 Customer: ${params.customerInitial}\n\nHow would you like to proceed?`,
    [
      { id: `match_accept_${params.matchId}`, title: '✅ Accept & Quote' },
      { id: `match_inspect_${params.matchId}`, title: '🔍 Inspect First' },
      { id: `match_decline_${params.matchId}`, title: '❌ Decline' },
    ],
    { footer: `Lead ref: ${params.matchId.slice(-8).toUpperCase()}` }
  )
}

export async function notifyProviderApplicationResult(params: {
  phone: string
  name: string
  approved: boolean
  reason?: string
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (params.approved) {
    // Use sendCtaUrl so the provider can tap directly into their portal
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    await sendCtaUrl(
      params.phone,
      `🎉 *Congratulations, ${params.name}!*\n\nYour application to join Plug a Pro has been *approved*.\n\nYou can now log in to your provider portal to complete your profile, set your schedule, and start receiving job assignments.`,
      'Open Provider Portal',
      `${appUrl}/provider`,
      { footer: 'Welcome to the Plug a Pro network! 👋' }
    )
  } else {
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
    // Find latest active job request
    const customer = await db.customer.findUnique({
      where: { phone: ctx.phone },
    })
    if (!customer) {
      await sendText(ctx.phone, "📋 No job requests found for your number. Send 'Hi' to submit a new request.")
      return { nextStep: 'done' }
    }

    const jobRequest = await db.jobRequest.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['OPEN', 'MATCHING', 'MATCHED'] },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!jobRequest) {
      await sendText(ctx.phone, "You don't have any active job requests to reschedule. Send 'Hi' to submit a new request.")
      return { nextStep: 'done' }
    }

    await sendButtons(
      ctx.phone,
      `🔄 *Reschedule Request*\n\n🔧 ${jobRequest.category}\n\nWhy do you need to reschedule?`,
      [
        { id: 'rs_personal', title: '👤 Personal reason' },
        { id: 'rs_work', title: '💼 Work conflict' },
        { id: 'rs_other', title: '✏️ Other' },
      ]
    )
    return { nextStep: 'reschedule_confirm', nextData: { rescheduleBookingId: jobRequest.id } }
  }

  if (ctx.step === 'reschedule_confirm') {
    if (ctx.reply.id?.startsWith('rs_')) {
      const reasons: Record<string, string> = {
        rs_personal: 'Personal reason',
        rs_work: 'Work conflict',
        rs_other: 'Other',
      }
      const reason = reasons[ctx.reply.id] ?? 'Not specified'

      await sendButtons(
        ctx.phone,
        `🗓 Please reply with your preferred new availability (e.g. "Next week, mornings" or "Saturday afternoon").\n\nReason noted: _${reason}_`,
        [
          { id: 'rs_confirm_yes', title: '✅ Send Availability' },
          { id: 'rs_confirm_no', title: '❌ Keep Original' },
        ]
      )
      return { nextStep: 'reschedule_confirm', nextData: { rescheduleReason: reason } }
    }

    if (ctx.reply.id === 'rs_confirm_yes') {
      await sendText(
        ctx.phone,
        `✅ Got it! Please type your preferred new availability and we'll update your request.\n\nSend 'Hi' to return to the menu.`
      )
      return { nextStep: 'done' }
    }

    if (ctx.reply.id === 'rs_confirm_no') {
      await sendText(ctx.phone, 'No problem! Your original availability has been kept. 👍')
      return { nextStep: 'done' }
    }

    return { nextStep: 'reschedule_confirm' }
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const matchId = buttonId
    .replace('match_accept_', '')
    .replace('match_inspect_', '')
    .replace('match_decline_', '')

  const provider = await db.provider.findUnique({ where: { phone } })
  if (!provider) {
    await sendText(phone, "You're not registered as a provider.")
    return
  }

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { jobRequest: { include: { address: true } } },
  })

  if (!match || match.providerId !== provider.id) {
    await sendText(phone, '⚠️ This lead is no longer available.')
    return
  }

  const quoteUrl = `${appUrl}/technician/quotes/${matchId}`

  if (buttonId.startsWith('match_accept_')) {
    await sendCtaUrl(
      phone,
      `✅ *Great! Submit your quote here:*\n\nInclude your labour cost, any materials, and estimated time.`,
      'Submit Quote',
      quoteUrl,
      { footer: 'Quote will be sent to the customer for approval' }
    )
    return
  }

  if (buttonId.startsWith('match_inspect_')) {
    await db.match.update({
      where: { id: matchId },
      data: { inspectionNeeded: true, status: 'INSPECTION_SCHEDULED' },
    })
    await sendCtaUrl(
      phone,
      `🔍 *Inspection noted.*\n\nVisit the customer to assess the job, then submit your quote:`,
      'Submit Quote After Inspection',
      quoteUrl,
      { footer: 'Contact the customer to arrange the inspection time' }
    )
    return
  }

  if (buttonId.startsWith('match_decline_')) {
    await sendButtons(
      phone,
      '❌ *Decline Lead*\n\nWhy are you declining?',
      [
        { id: `mdc_unavailable_${matchId}`, title: '📅 Not available' },
        { id: `mdc_area_${matchId}`, title: '📍 Too far' },
        { id: `mdc_other_${matchId}`, title: '✏️ Other reason' },
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

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
      await sendText(ctx.phone, "📋 You have no active jobs right now.\n\nNew jobs will be sent to you when available. 👍")
      return { nextStep: 'done' }
    }

    const statusEmoji: Record<string, string> = {
      SCHEDULED: '📅', EN_ROUTE: '🚗', ARRIVED: '📍',
      STARTED: '🔧', PAUSED: '⏸', AWAITING_APPROVAL: '⌛',
    }

    if (activeJobs.length === 1) {
      const j = activeJobs[0]
      const req = j.booking.match.jobRequest
      const addr = req.address
      await sendButtons(
        ctx.phone,
        `📋 *Your Active Job*\n\n${statusEmoji[j.status] ?? '📋'} ${req.category}\n📍 ${addr ? `${addr.street}, ${addr.suburb}` : 'See app'}\nStatus: ${j.status.replace(/_/g, ' ')}`,
        [{ id: `view_job_${j.id}`, title: '📋 View Details' }]
      )
    } else {
      const rows = activeJobs.map((j) => {
        const req = j.booking.match.jobRequest
        const suburb = req.address?.suburb ?? 'TBA'
        return {
          id: `view_job_${j.id}`,
          title: req.category.slice(0, 24),
          description: `${suburb} • ${j.status.replace(/_/g, ' ')}`.slice(0, 72),
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
              jobRequest: { include: { address: true } },
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
    const addrLabel = addr ? `${addr.street}, ${addr.suburb}` : 'Address in app'
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

    // No status change needed (already SCHEDULED); just confirm acceptance
    const jobUrl = `${appUrl}/provider/jobs/${jobId}`
    await sendCtaUrl(
      ctx.phone,
      `✅ *Job Confirmed!*\n\nSee full customer notes and directions in the app:`,
      'Open Job',
      jobUrl,
      { footer: 'Navigate and update job status from the app' }
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
      "Got it. This job has been returned to the queue. Our team will reassign it. 👍"
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
  const { sendButtons } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const webLink = `${appUrl}/quotes/${params.approvalToken}`

  const materialsLine = params.materialsCost > 0
    ? `\nMaterials:  R ${params.materialsCost.toFixed(2)}`
    : ''
  const hoursLine = params.estimatedHours ? `\nEst. time:  ${params.estimatedHours}h` : ''
  const validLine = `\nValid until: ${params.validUntil.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`

  await sendButtons(
    params.customerPhone,
    `💼 *Quote from ${params.providerName}*\n\nLabour:     R ${params.labourCost.toFixed(2)}${materialsLine}\n──────────────────\nTotal:      R ${params.totalAmount.toFixed(2)}${hoursLine}${validLine}\n\n📋 ${params.description}\n\nOr review online:\n${webLink}`,
    [
      { id: `quote_accept_${params.quoteId}`, title: '✅ Accept Quote' },
      { id: `quote_decline_${params.quoteId}`, title: '❌ Decline' },
    ]
  )
}

// ─── Customer quote response handler ─────────────────────────────────────────

async function handleCustomerQuoteResponse(phone: string, buttonId: string): Promise<void> {
  const { sendText, sendCtaUrl } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const quoteId = buttonId.replace('quote_accept_', '').replace('quote_decline_', '')
  const action = buttonId.startsWith('quote_accept_') ? 'approve' : 'decline'

  try {
    const result = await db.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: quoteId },
        include: {
          match: {
            include: {
              provider: { select: { id: true, phone: true, name: true } },
              jobRequest: {
                include: {
                  customer: { select: { id: true, phone: true, name: true } },
                },
              },
            },
          },
        },
      })

      if (!quote) throw new Error('NOT_FOUND')
      if (quote.match.jobRequest.customer.phone !== phone) throw new Error('FORBIDDEN')
      if (quote.status !== 'PENDING') throw new Error('ALREADY_ACTIONED')
      if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

      if (action === 'decline') {
        await tx.quote.update({ where: { id: quoteId }, data: { status: 'DECLINED', declinedAt: new Date() } })
        await tx.match.update({ where: { id: quote.matchId }, data: { status: 'QUOTE_DECLINED' } })
        return {
          action: 'declined' as const,
          providerPhone: quote.match.provider.phone,
          category: quote.match.jobRequest.category,
        }
      }

      await tx.quote.update({ where: { id: quoteId }, data: { status: 'APPROVED', approvedAt: new Date() } })
      await tx.match.update({ where: { id: quote.matchId }, data: { status: 'QUOTE_APPROVED' } })

      const scheduledDate = quote.preferredDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000)

      const booking = await tx.booking.create({
        data: {
          matchId: quote.matchId,
          quoteId: quote.id,
          status: 'SCHEDULED',
          scheduledDate,
        },
      })

      await tx.job.create({
        data: {
          bookingId: booking.id,
          providerId: quote.match.provider.id,
          status: 'SCHEDULED',
        },
      })

      return {
        action: 'approved' as const,
        providerPhone: quote.match.provider.phone,
        providerName: quote.match.provider.name,
        category: quote.match.jobRequest.category,
        scheduledDate,
      }
    })

    if (result.action === 'approved') {
      const dateStr = result.scheduledDate.toLocaleDateString('en-ZA', {
        weekday: 'short', day: 'numeric', month: 'short',
      })
      await sendCtaUrl(
        result.providerPhone,
        `✅ *Quote Approved!*\n\n${result.category} job confirmed for ${dateStr}.`,
        'View Job',
        `${appUrl}/technician`
      ).catch(() => {})
      await sendText(
        phone,
        `✅ *Booking Confirmed!*\n\n${result.providerName} will arrive on ${dateStr}. You'll receive a reminder the day before.`
      )
    } else {
      await sendText(
        result.providerPhone,
        `❌ The customer declined your quote for the ${result.category} job.`
      ).catch(() => {})
      await sendText(phone, "❌ *Quote declined.* We've notified the provider. We'll find you another option.")
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    if (msg === 'ALREADY_ACTIONED') {
      await sendText(phone, action === 'approve'
        ? "✅ You've already accepted this quote."
        : "❌ You've already declined this quote.")
    } else if (msg === 'EXPIRED') {
      await sendText(phone, "⏱️ This quote has expired. Please ask the provider to send a new one.")
    } else {
      await sendText(phone, "Something went wrong. Please try the link in the original message.")
    }
  }
}

// ─── Backwards-compat alias ───────────────────────────────────────────────────
/** @deprecated use notifyProviderApplicationResult */
export const notifyTechnicianApplicationResult = notifyProviderApplicationResult
