// ─── Job request / job status check flow ─────────────────────────────────────
// Customer replies "status" or taps "My Request" → sees their latest job request
//
// Multi-request users (>1 active) get a disambiguation list.
// Single-active or latest-only users see status + deep-link CTA.

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import type { FlowContext, FlowResult } from './types'

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED:                      '📋 Provider scheduled',
  EN_ROUTE:                       '🚗 Provider on the way',
  ARRIVED:                        '🏠 Provider arrived',
  STARTED:                        '🔧 Work in progress',
  PAUSED:                         '⏸ Job paused',
  AWAITING_APPROVAL:              '⚠️ Needs your approval',
  PENDING_COMPLETION_CONFIRMATION:'✅ Awaiting your sign-off',
  COMPLETED:                      '✅ Job completed',
  FAILED:                         '❌ Job could not be completed',
  CALLBACK_REQUIRED:              '📞 Callback required',
}

const JOB_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING_VALIDATION: '🔍 Checking your request',
  OPEN:               '📢 Finding a provider',
  MATCHING:           '🔎 Matching you with a provider',
  MATCHED:            '✅ Provider matched',
  EXPIRED:            '⏰ Request expired',
  CANCELLED:          '❌ Cancelled',
}

const TERMINAL_JOB_STATUSES   = ['COMPLETED', 'FAILED', 'CANCELLED']
const TERMINAL_REQUEST_STATUSES = ['EXPIRED', 'CANCELLED']

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleStatusFlow(ctx: FlowContext): Promise<FlowResult> {
  const reqId = crypto.randomUUID().slice(0, 8)
  const log = (msg: string) => console.log(`[status-flow:${reqId}] phone=${ctx.phone} ${msg}`)

  // ── Step: customer chose one request from disambiguation list ────────────
  if (ctx.step === 'status_pick' && ctx.reply.id?.startsWith('status_req_')) {
    const jobRequestId = ctx.reply.id.replace('status_req_', '')
    log(`disambiguation pick → jobRequestId=${jobRequestId}`)
    return showRequestStatus(ctx.phone, jobRequestId, reqId)
  }

  // ── Step: initial status query ───────────────────────────────────────────
  log('step=status_show — looking up customer')

  const customer = await db.customer.findUnique({
    where: { phone: ctx.phone },
  })

  if (!customer) {
    log('customer not found')
    await sendButtons(
      ctx.phone,
      "📋 I couldn't find any requests for your number.\n\nWould you like to submit a job request?",
      [
        { id: 'book',      title: '🔧 Request a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ],
      { footer: 'Reply "menu" for main menu' }
    )
    return { nextStep: 'welcome' }
  }

  log(`customerId=${customer.id} — fetching job requests`)

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
    take: 10,
  })

  if (jobRequests.length === 0) {
    log('no job requests found')
    await sendButtons(
      ctx.phone,
      "📋 You don't have any job requests yet. Would you like to submit one?",
      [
        { id: 'book',      title: '🔧 Request a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ],
      { footer: 'Reply "menu" for main menu' }
    )
    return { nextStep: 'welcome' }
  }

  // Separate active from terminal requests
  const activeRequests = jobRequests.filter((jr) => {
    if (TERMINAL_REQUEST_STATUSES.includes(jr.status)) return false
    const job = jr.match?.booking?.job ?? null
    if (job && TERMINAL_JOB_STATUSES.includes(job.status)) return false
    return true
  })

  log(`total=${jobRequests.length} active=${activeRequests.length}`)

  // ── Disambiguation: >1 active requests ──────────────────────────────────
  if (activeRequests.length > 1) {
    log('multiple active requests — sending disambiguation list')
    await sendList(
      ctx.phone,
      `📋 *You have ${activeRequests.length} active requests.*\n\nWhich one would you like to check?`,
      [{
        title: 'Active Requests',
        rows: activeRequests.slice(0, 9).map((jr) => {
          const job = jr.match?.booking?.job ?? null
          const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null
          const statusLabel = activeJob
            ? JOB_STATUS_LABELS[activeJob.status] ?? activeJob.status
            : JOB_REQUEST_STATUS_LABELS[jr.status] ?? jr.status
          const date = jr.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
          return {
            id:          `status_req_${jr.id}`,
            title:       jr.category,
            description: `${statusLabel} · ${date}`,
          }
        }),
      }],
      { buttonLabel: 'Choose Request' }
    )
    return { nextStep: 'status_pick' }
  }

  // ── Single active request — or fall back to most recent ─────────────────
  const target = activeRequests[0] ?? jobRequests[0]
  log(`resolved to jobRequestId=${target.id} category=${target.category} status=${target.status}`)
  return showRequestStatus(ctx.phone, target.id, reqId)
}

// ─── Shared: fetch + render a single request status ──────────────────────────

async function showRequestStatus(
  phone: string,
  jobRequestId: string,
  reqId: string,
): Promise<FlowResult> {
  const log = (msg: string) => console.log(`[status-flow:${reqId}] phone=${phone} ${msg}`)

  const jr = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    include: {
      match: {
        include: {
          booking: {
            include: { job: true },
          },
        },
      },
    },
  })

  if (!jr) {
    log(`jobRequest not found id=${jobRequestId}`)
    await sendText(phone, "⚠️ Sorry, I couldn't load that request. Reply 'menu' to start again.")
    return { nextStep: 'welcome' }
  }

  const job = jr.match?.booking?.job ?? null
  // Fix: correctly null-out completed/failed jobs so request status labels show instead
  const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null

  const jobStatus     = activeJob?.status
  const requestStatus = jr.status

  const statusLabel = jobStatus
    ? JOB_STATUS_LABELS[jobStatus] ?? jobStatus
    : JOB_REQUEST_STATUS_LABELS[requestStatus] ?? requestStatus

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim()

  log(`resolved status=${statusLabel} jobStatus=${jobStatus ?? 'none'} requestStatus=${requestStatus} appUrl=${appUrl || '(empty)'}`)

  // ── Extra work pending approval ──────────────────────────────────────────
  if (jobStatus === 'AWAITING_APPROVAL' && activeJob) {
    const extra = await db.extraWork.findFirst({
      where: { jobId: activeJob.id, status: 'PENDING' },
    })
    if (extra) {
      if (!appUrl) {
        log('WARN: NEXT_PUBLIC_APP_URL is not set — cannot send approval CTA')
        await sendText(
          phone,
          `⚠️ *Action needed: ${jr.category}*\n\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nContact support to approve or decline: support@plugapro.co.za`
        )
        return { nextStep: 'done' }
      }
      const approvalUrl = `${appUrl}/approve/${extra.approvalToken}`
      log(`sending extra-work approval CTA approvalUrl=${approvalUrl}`)
      await sendCtaUrl(
        phone,
        `⚠️ *Action needed on your job*\n\n🔧 ${jr.category}\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nTap below to approve or decline:`,
        'Review & Approve',
        approvalUrl
      )
      return { nextStep: 'done' }
    }
  }

  // ── Default: show status + tracking link ────────────────────────────────
  const trackingLink = appUrl ? `\n\n🔗 ${appUrl}/requests/${jr.id}` : ''
  log(`sending status buttons trackingLink=${trackingLink || '(none)'}`)

  await sendButtons(
    phone,
    `📋 *Your request*\n\n🔧 ${jr.category}\n${statusLabel}${trackingLink}`,
    [
      { id: 'back_home', title: '🏠 Main Menu' },
    ],
    { footer: 'Reply "menu" to return to main menu' }
  )

  return { nextStep: 'done' }
}
