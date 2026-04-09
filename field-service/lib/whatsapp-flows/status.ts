// ─── Job request / job status check flow ─────────────────────────────────────
// Customer replies "status" or taps "My Request" → sees their latest job request

import { sendText, sendButtons, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import type { FlowContext, FlowResult } from './types'

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: '📋 Worker scheduled',
  EN_ROUTE: '🚗 Worker on the way',
  ARRIVED: '🏠 Worker arrived',
  STARTED: '🔧 Work in progress',
  PAUSED: '⏸ Job paused',
  AWAITING_APPROVAL: '⚠️ Needs your approval',
  PENDING_COMPLETION_CONFIRMATION: '✅ Awaiting your sign-off',
  COMPLETED: '✅ Job completed',
  FAILED: '❌ Job could not be completed',
  CALLBACK_REQUIRED: '📞 Callback required',
}

const JOB_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING_VALIDATION: '🔍 Checking your request',
  OPEN: '📢 Finding a worker',
  MATCHING: '🔎 Matching you with a worker',
  MATCHED: '✅ Worker matched',
  EXPIRED: '⏰ Request expired',
  CANCELLED: '❌ Cancelled',
}

export async function handleStatusFlow(ctx: FlowContext): Promise<FlowResult> {
  const customer = await db.customer.findUnique({
    where: { phone: ctx.phone },
  })

  if (!customer) {
    await sendButtons(
      ctx.phone,
      "📋 I couldn't find any requests for your number.\n\nWould you like to submit a job request?",
      [
        { id: 'book', title: '🔧 Request a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ],
      { footer: 'Reply "menu" for main menu' }
    )
    return { nextStep: 'welcome' }
  }

  const jobRequests = await db.jobRequest.findMany({
    where: { customerId: customer.id },
    include: {
      match: {
        include: {
          booking: {
            include: { job: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })

  if (jobRequests.length === 0) {
    await sendButtons(
      ctx.phone,
      "📋 You don't have any job requests yet. Would you like to submit one?",
      [
        { id: 'book', title: '🔧 Request a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ],
      { footer: 'Reply "menu" for main menu' }
    )
    return { nextStep: 'welcome' }
  }

  const latest = jobRequests[0]
  const job = latest.match?.booking?.job ?? null
  // Use the most recent active job if present
  const activeJob = (job && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) ? job : job ?? null

  const jobStatus = activeJob?.status
  const requestStatus = latest.status

  const statusLabel = jobStatus
    ? JOB_STATUS_LABELS[jobStatus] ?? jobStatus
    : JOB_REQUEST_STATUS_LABELS[requestStatus] ?? requestStatus

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const trackingUrl = appUrl
    ? `${appUrl}/requests/${latest.id}`
    : `/requests/${latest.id}`

  // Extra work pending? Send approval reminder
  if (jobStatus === 'AWAITING_APPROVAL' && activeJob) {
    const extra = await db.extraWork.findFirst({
      where: { jobId: activeJob.id, status: 'PENDING' },
    })
    if (extra) {
      const approvalUrl = `${appUrl}/approve/${extra.approvalToken}`
      await sendCtaUrl(
        ctx.phone,
        `⚠️ *Action needed on your job*\n\n🔧 ${latest.category}\n${statusLabel}\n\nYour worker needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nTap below to approve or decline:`,
        'Review & Approve',
        approvalUrl
      )
      return { nextStep: 'done' }
    }
  }

  // Default: show status with tracking link
  await sendCtaUrl(
    ctx.phone,
    `📋 *Your latest request*\n\n🔧 ${latest.category}\n${statusLabel}`,
    'View Request',
    trackingUrl,
    { footer: 'Reply "menu" to return to main menu' }
  )

  return { nextStep: 'done' }
}
