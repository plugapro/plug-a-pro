// ─── Provider WhatsApp journey ────────────────────────────────────────────────
// Registered providers manage availability and job status through WhatsApp.
// Entry: keywords "available", "offline", "my jobs", or "provider menu"

import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import { db } from '../db'
import { transitionJob } from '../jobs'
import { promptCustomersForNewProviderAvailability } from '../matching/customer-recontact'
import type { FlowContext, FlowResult } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

export const PROVIDER_JOURNEY_TRIGGERS = [
  'available', 'online', 'im available', "i'm available", 'ek is beskikbaar',
  'offline', 'not available', 'not working', 'ek is nie beskikbaar',
  'provider menu', 'my dashboard',
]

export async function handleProviderJourneyFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'pj_menu':
      return handleProviderMenu(ctx)
    case 'pj_toggle_available':
      return handleToggleAvailable(ctx)
    case 'pj_job_detail':
      return handleJobDetail(ctx)
    case 'pj_status_confirm':
      return handleStatusConfirm(ctx)
    case 'pj_problem_report':
      return handleProblemReport(ctx)
    default:
      return handleProviderMenu(ctx)
  }
}

// ─── Provider Menu ────────────────────────────────────────────────────────────

async function handleProviderMenu(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })

  if (!provider) {
    await sendText(
      ctx.phone,
      "👷 You're not registered as a Plug A Pro provider yet.\n\nReply *join* to apply, or *Hi* for the main menu."
    )
    return { nextStep: 'done' }
  }

  const statusEmoji = provider.availableNow ? '🟢' : '🔴'
  const statusText = provider.availableNow ? 'Online — accepting leads' : 'Offline — not accepting leads'
  const toggleLabel = provider.availableNow ? '🔴 Go Offline' : '🟢 Go Online'

  await sendButtons(
    ctx.phone,
    `👷 *Provider Menu*\n\nHi ${provider.name}!\n${statusEmoji} Status: *${statusText}*\n\nWhat would you like to do?`,
    [
      { id: 'pj_toggle', title: toggleLabel },
      { id: 'pj_view_jobs', title: '📋 My Jobs' },
      { id: 'back_home', title: '🏠 Main Menu' },
    ]
  )

  return { nextStep: 'pj_toggle_available' }
}

// ─── Availability Toggle ──────────────────────────────────────────────────────

async function handleToggleAvailable(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_view_jobs') {
    return handleJobList(ctx)
  }

  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_toggle' || ctx.reply.id === 'pj_go_online' || ctx.reply.id === 'pj_go_offline') {
    const goingOnline = !provider.availableNow
    await db.provider.update({ where: { id: provider.id }, data: { availableNow: goingOnline } })

    if (goingOnline) {
      await promptCustomersForNewProviderAvailability(provider.id).catch((error) => {
        console.error('[provider-journey] customer recontact failed:', error)
      })
    }

    if (goingOnline) {
      await sendButtons(
        ctx.phone,
        `🟢 *You are now Online*\n\nYou'll receive job leads in your area. We'll send them here on WhatsApp.\n\nMake sure notifications are turned on!`,
        [
          { id: 'pj_view_jobs', title: '📋 View My Jobs' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
    } else {
      await sendButtons(
        ctx.phone,
        `🔴 *You are now Offline*\n\nYou won't receive new job leads until you go online again.\n\nReply *available* or tap Go Online when you're ready to work.`,
        [
          { id: 'pj_go_online', title: '🟢 Go Online' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
    }
    return { nextStep: 'pj_toggle_available' }
  }

  // Unexpected input — re-show menu
  return handleProviderMenu(ctx)
}

// ─── Job List ─────────────────────────────────────────────────────────────────

async function handleJobList(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const activeJobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'] },
    },
    include: {
      booking: {
        include: { match: { include: { jobRequest: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (activeJobs.length === 0) {
    await sendButtons(
      ctx.phone,
      `📋 *No active jobs right now.*\n\nYou'll receive a WhatsApp notification when a new lead comes in.\n\nMake sure you're online to receive leads.`,
      [
        { id: 'pj_toggle', title: '🟢 Check Status' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const statusLabel: Record<string, string> = {
    SCHEDULED: 'Scheduled',
    EN_ROUTE: 'On the way',
    ARRIVED: 'Arrived',
    STARTED: 'In progress',
    PAUSED: 'Paused',
    AWAITING_APPROVAL: 'Awaiting approval',
    PENDING_COMPLETION_CONFIRMATION: 'Awaiting customer confirmation',
  }

  const rows = activeJobs.slice(0, 5).map((job: any) => {
    const category = job.booking?.match?.jobRequest?.category ?? 'Job'
    const status = statusLabel[job.status] ?? job.status
    return {
      id: `pj_job_${job.id}`,
      title: category.slice(0, 24),
      description: status,
    }
  })

  rows.push({ id: 'back_home', title: '🏠 Main Menu', description: 'Back to main menu' })

  await sendList(
    ctx.phone,
    `📋 *Your Active Jobs*\n\nTap a job to update its status:`,
    [{ title: 'Active Jobs', rows }],
    { buttonLabel: 'Choose Job' }
  )

  return { nextStep: 'pj_job_detail' }
}

// ─── Job Detail & Status Update ───────────────────────────────────────────────

async function handleJobDetail(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (!ctx.reply.id?.startsWith('pj_job_')) {
    return handleJobList(ctx)
  }

  const jobId = ctx.reply.id.replace('pj_job_', '')

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
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
    await sendText(ctx.phone, "Job not found. Reply *my jobs* to see your active jobs.")
    return { nextStep: 'done' }
  }

  const jobAny = job as any
  const category = jobAny.booking?.match?.jobRequest?.category ?? 'Job'
  const address = jobAny.booking?.match?.jobRequest?.address
  const addressStr = address ? `${address.street}, ${address.suburb}` : 'Address on file'

  const statusLabel: Record<string, string> = {
    SCHEDULED: '📅 Scheduled',
    EN_ROUTE: '🚗 On the way',
    ARRIVED: '📍 Arrived',
    STARTED: '🔧 In progress',
    PAUSED: '⏸ Paused',
    AWAITING_APPROVAL: '⌛ Awaiting approval',
  }

  const currentStatus = statusLabel[(job as any).status] ?? (job as any).status
  const nextSteps = getNextStatusOptions((job as any).status)

  if (nextSteps.length === 0) {
    await sendText(
      ctx.phone,
      `🔧 *${category}*\n📍 ${addressStr}\n${currentStatus}\n\nNo more status updates for this job. Reply *my jobs* to see all jobs.`
    )
    return { nextStep: 'done' }
  }

  // Build button IDs: pj_upd_<jobId>_<newStatus>
  // WhatsApp button title max 20 chars — keep labels short
  const buttons = nextSteps.map((s) => ({
    id: `pj_upd_${jobId}_${s.id}`,
    title: s.label,
  }))

  await sendButtons(
    ctx.phone,
    `🔧 *${category}*\n📍 ${addressStr}\nCurrent: ${currentStatus}\n\nUpdate status to:`,
    buttons
  )

  return { nextStep: 'pj_status_confirm', nextData: { activeJobId: jobId } }
}

function getNextStatusOptions(currentStatus: string): Array<{ id: string; label: string }> {
  const transitions: Record<string, Array<{ id: string; label: string }>> = {
    SCHEDULED:         [{ id: 'EN_ROUTE', label: '🚗 On My Way' }],
    EN_ROUTE:          [{ id: 'ARRIVED', label: "📍 I've Arrived" }],
    ARRIVED:           [{ id: 'STARTED', label: '🔧 Start Work' }],
    STARTED:           [{ id: 'PENDING_COMPLETION_CONFIRMATION', label: '✅ Ready for Sign-Off' }, { id: 'PAUSED', label: '⏸ Pause' }],
    PAUSED:            [{ id: 'STARTED', label: '🔧 Resume Work' }],
    AWAITING_APPROVAL: [],
    PENDING_COMPLETION_CONFIRMATION: [],
  }
  return transitions[currentStatus] ?? []
}

async function handleStatusConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (!ctx.reply.id?.startsWith('pj_upd_')) {
    return { nextStep: 'pj_status_confirm' }
  }

  // Parse: pj_upd_<jobId>_<newStatus>
  // cuid IDs do not contain underscores, so the first underscore after the prefix
  // separates the job ID from the target status.
  const withoutPrefix = ctx.reply.id.replace('pj_upd_', '')
  const firstUnderscore = withoutPrefix.indexOf('_')
  const jobId = withoutPrefix.slice(0, firstUnderscore)
  const newStatus = withoutPrefix.slice(firstUnderscore + 1)

  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
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
  })

  const jobAny = job as any
  if (!jobAny || jobAny.providerId !== provider.id) {
    await sendText(ctx.phone, "⚠️ This job is no longer available or doesn't belong to you.")
    return { nextStep: 'done' }
  }

  await transitionJob({
    jobId,
    toStatus: newStatus as any,
    actorId: provider.id,
    actorRole: 'provider',
    notes: 'Updated via WhatsApp by provider',
  })

  const statusMessages: Record<string, string> = {
    EN_ROUTE:  '🚗 Status updated — *On My Way*!\n\nThe customer has been notified you are en route.',
    ARRIVED:   "📍 Status updated — *Arrived*!\n\nThe customer has been notified you're at the location.",
    STARTED:   '🔧 Status updated — *Work Started*!\n\nUpdate to ✅ Done when finished.',
    PAUSED:    '⏸ Job paused.\n\nReply *my jobs* to resume when ready.',
    PENDING_COMPLETION_CONFIRMATION: `✅ *Marked ready for customer sign-off!*\n\nThe customer has been asked to confirm completion.`,
  }

  await sendButtons(
    ctx.phone,
    statusMessages[newStatus] ?? `✅ Status updated to ${newStatus}.`,
    [
      { id: 'pj_view_jobs', title: '📋 My Jobs' },
      { id: 'back_home', title: '🏠 Main Menu' },
    ]
  )

  return { nextStep: 'pj_toggle_available' }
}

async function handleProblemReport(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  await sendText(
    ctx.phone,
    `🚨 *Report a Problem*\n\nPlease reply with a description of the issue and we'll follow up within 2 hours.\n\nInclude:\n• Your job reference number\n• What went wrong\n\nOr call: ${process.env.SUPPORT_WHATSAPP_NUMBER ?? 'our support line'}`
  )
  return { nextStep: 'done' }
}
