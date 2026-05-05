// ─── Job request / job status check flow ─────────────────────────────────────
// Customer replies "status" or taps "My Request" → sees their latest job request
//
// Multi-request users (>1 active) get a disambiguation list.
// Single-active or latest-only users see status + deep-link CTA.

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import { getJobRequestAccessUrl } from '../job-request-access'
import { getPublicAppUrl } from '../provider-credit-copy'
import type { FlowContext, FlowResult } from './types'
import { sendWhatsAppJourneyRecovery } from '../journey-recovery'

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED:                       '📋 Provider scheduled',
  EN_ROUTE:                        '🚗 Provider on the way',
  ARRIVED:                         '🏠 Provider arrived',
  STARTED:                         '🔧 Work in progress',
  PAUSED:                          '⏸ Job paused',
  AWAITING_APPROVAL:               '⚠️ Needs your approval',
  PENDING_COMPLETION_CONFIRMATION:  '✅ Awaiting your sign-off',
  COMPLETED:                       '✅ Job completed',
  FAILED:                          '❌ Job could not be completed',
  CALLBACK_REQUIRED:               '📞 Callback required',
}

const JOB_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING_VALIDATION:              '🔍 Checking your request',
  OPEN:                            '📢 Finding a provider',
  MATCHING:                        '🔎 Matching you with a provider',
  SHORTLIST_READY:                 '✅ Provider options are ready',
  MATCHED:                         '✅ Provider matched',
  PROVIDER_CONFIRMATION_PENDING:    '⏳ Waiting for your selected provider to confirm',
  EXPIRED:                         '⏰ Request expired',
  CANCELLED:                       '❌ Cancelled',
}

const TERMINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED']
const TERMINAL_REQUEST_STATUSES = ['EXPIRED', 'CANCELLED']

type LeadStatusSummary = {
  total: number
  activeOutreach: number
  interested: number
}

type ShortlistOption = {
  name: string
  verified: boolean
  callOutFee: number | null
  estimatedArrivalAt: Date | null
  note: string | null
}

type DispatchDecisionStatus = 'RANKED' | 'OFFERING' | 'ASSIGNED' | 'NO_MATCH' | 'OVERRIDDEN' | 'CANCELLED'

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

function formatRequestDate(date: Date) {
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleStatusFlow(ctx: FlowContext): Promise<FlowResult> {
  const { maskPhone } = await import('../support-diagnostics')
  const reqId = crypto.randomUUID().slice(0, 8)
  const log = (msg: string) => console.log(`[status-flow:${reqId}] phone=${maskPhone(ctx.phone)} ${msg}`)

  const conversationPinnedRequestId =
    typeof ctx.data?.jobRequestId === 'string' && ctx.data.jobRequestId.trim()
      ? ctx.data.jobRequestId
      : null

  try {
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
      // Return to welcome so the user's button tap (book / back_home) is handled
      return { nextStep: 'welcome' }
    }

    if (ctx.step === 'status_show' && conversationPinnedRequestId) {
      log(`status_show has pinned requestId=${conversationPinnedRequestId}`)
      return showRequestStatus(
        ctx.phone,
        conversationPinnedRequestId,
        reqId,
        customer.id,
      )
    }

    if (ctx.step === 'status_pick' && ctx.reply.id?.startsWith('status_req_')) {
      const jobRequestId = ctx.reply.id.replace('status_req_', '')
      log(`disambiguation pick → jobRequestId=${jobRequestId}`)
      return showRequestStatus(ctx.phone, jobRequestId, reqId, customer.id)
    }

    if (ctx.step === 'status_pick') {
      log('status_pick reached with stale/invalid request id; showing current status by latest request')
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
      // Return to welcome so the user's button tap (book / back_home) is handled
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
      const requestChoices = activeRequests.slice(0, 9).map((jr) => {
        const job = jr.match?.booking?.job ?? null
        const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null
        const statusLabel = activeJob
          ? JOB_STATUS_LABELS[activeJob.status] ?? activeJob.status
          : JOB_REQUEST_STATUS_LABELS[jr.status] ?? jr.status
        const date = formatRequestDate(jr.createdAt)
        return {
          id: `status_req_${jr.id}`,
          title: truncate(`${jr.category} · ${date}`, 24),
          description: truncate(`${statusLabel} · Ref ${jr.id.slice(-6).toUpperCase()}`, 72),
          buttonTitle: truncate(`${jr.category} ${date}`, 20),
        }
      })

      try {
        await sendList(
          ctx.phone,
          `📋 *You have ${activeRequests.length} active requests.*\n\nWhich one would you like to check?`,
          [{
            title: 'Active Requests',
            rows: requestChoices.map(({ id, title, description }) => ({
              id,
              title,
              description,
            })),
          }],
          { buttonLabel: 'Choose Request' }
        )
        return { nextStep: 'status_pick' }
      } catch (error) {
        log(`WARN: sendList failed for request picker — falling back. error=${error instanceof Error ? error.message : String(error)}`)

        const buttonChoices = requestChoices.slice(0, 3).map(({ id, buttonTitle }) => ({
          id,
          title: buttonTitle,
        }))

        if (buttonChoices.length >= 2) {
          try {
            await sendButtons(
              ctx.phone,
              `📋 *You have ${activeRequests.length} active requests.*\n\nTap one below to view its latest status.${activeRequests.length > 3 ? '\n\nIf you do not see the one you want, reply *status* again and we will show your newest request.' : ''}`,
              buttonChoices,
              { footer: 'Reply "menu" for main menu' }
            )
            return { nextStep: 'status_pick' }
          } catch (fallbackError) {
            log(`WARN: sendButtons fallback failed for request picker — showing latest request. error=${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
          }
        }

        await sendText(
          ctx.phone,
          `📋 I couldn't show the full request list right now, so I'm showing your newest active request instead.`
        )
        return showRequestStatus(ctx.phone, activeRequests[0].id, reqId, customer.id)
      }
    }

    // ── Single active request — or fall back to most recent ─────────────────
    const target = activeRequests[0] ?? jobRequests[0]
    log(`resolved to jobRequestId=${target.id} category=${target.category} status=${target.status}`)
    return showRequestStatus(ctx.phone, target.id, reqId, customer.id)
  } catch (error) {
    log(`WARN: status flow failed before rendering. error=${error instanceof Error ? error.message : String(error)}`)
    await sendWhatsAppJourneyRecovery(ctx.phone, {
      userRole: 'customer',
      channel: 'whatsapp',
      flowName: ctx.flow,
      currentStep: ctx.step,
      failureType: 'dependency_failure',
      recoveryClass: 'show_status',
      error,
    })
    return { nextStep: 'done' }
  }
}

// ─── Shared: fetch + render a single request status ──────────────────────────

async function showRequestStatus(
  phone: string,
  jobRequestId: string,
  reqId: string,
  ...ownership: [expectedCustomerId?: string]
): Promise<FlowResult> {
  const expectedCustomerId = ownership[0]
  const log = (msg: string) => console.log(`[status-flow:${reqId}] phone=${phone} ${msg}`)

  try {
    const jr = await db.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        selectedProvider: {
          select: {
            id: true,
            name: true,
          },
        },
        match: {
          include: {
            provider: {
              select: {
                id: true,
                name: true,
              },
            },
            booking: {
              include: { job: true },
            },
          },
        },
      },
    })

    if (!jr) {
      log(`jobRequest not found id=${jobRequestId}`)
      await sendButtons(
        phone,
        "⚠️ We couldn't find that request. Open your latest request message and tap Track My Request again, or go back to the main menu.",
        [
          { id: 'book', title: '🔧 New Request' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (expectedCustomerId && jr.customerId !== expectedCustomerId) {
      log(`request ownership mismatch id=${jobRequestId} expectedCustomerId=${expectedCustomerId}`)
      await sendButtons(
        phone,
        '⚠️ That request could not be loaded for this account.',
        [
          { id: 'book', title: '🔧 Request a Service' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    const job = jr.match?.booking?.job ?? null
    // Completed/terminal jobs should not override request-level status labels.
    const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null
    const jobStatus = activeJob?.status
    const requestStatus = jr.status

    const leadSummary = await loadLeadSummary(jr.id)
    const latestDispatchStatus = await loadLatestDispatchDecisionStatus(jr.id)
    const shortlist = await loadPublishedShortlist(jr.id)

    let statusLabel = jobStatus
      ? JOB_STATUS_LABELS[jobStatus] ?? jobStatus
      : JOB_REQUEST_STATUS_LABELS[requestStatus] ?? requestStatus

    // Extra work pending approval remains the highest-priority prompt for active jobs.
    if (jobStatus === 'AWAITING_APPROVAL' && activeJob) {
      const extra = await db.extraWork.findFirst({
        where: { jobId: activeJob.id, status: 'PENDING' },
      })
      if (extra) {
        const appUrl = getPublicAppUrl()
        if (!appUrl) {
          log('WARN: app base URL is not set — cannot send approval CTA')
          await sendText(
            phone,
            `⚠️ *Action needed: ${jr.category}*\n\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nContact support to approve or decline: support@plugapro.co.za`
          )
          return { nextStep: 'done' }
        }

        const approvalUrl = getPublicAppUrl(`/approve/${extra.approvalToken}`)
        if (!approvalUrl) {
          log('WARN: Could not build approval URL from app base config')
          await sendText(
            phone,
            `⚠️ *Action needed on your job*\n\n🔧 ${jr.category}\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nContact support to approve or decline: support@plugapro.co.za`
          )
          return { nextStep: 'done' }
        }

        log(`sending extra-work approval CTA approvalUrl=${approvalUrl}`)
        try {
          await sendCtaUrl(
            phone,
            `⚠️ *Action needed on your job*\n\n🔧 ${jr.category}\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nTap below to approve or decline:`,
            'Review & Approve',
            approvalUrl
          )
        } catch (error) {
          log(`WARN: sendCtaUrl failed for approval request — falling back to text. error=${error instanceof Error ? error.message : String(error)}`)
          await sendText(
            phone,
            `⚠️ *Action needed on your job*\n\n🔧 ${jr.category}\n${statusLabel}\n\nYour provider needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nOpen the Plug A Pro app or reply *menu* to manage your request.`
          )
        }
        return { nextStep: 'done' }
      }
    }

    if (requestStatus === 'CANCELLED' || requestStatus === 'EXPIRED') {
      const fallbackText = requestStatus === 'CANCELLED'
        ? 'This request is cancelled and no longer active.'
        : 'This request is no longer active.'
      await sendButtons(
        phone,
        `📋 *Ticket #${jr.id.slice(-6).toUpperCase()}*\n\n🔧 ${jr.category}\n${fallbackText}\n\nIf you want, submit another request now.`,
        [
          { id: 'book', title: '🔧 Start New Request' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (requestStatus === 'PROVIDER_CONFIRMATION_PENDING') {
      const selectedProviderName = jr.selectedProvider?.name ?? jr.match?.provider?.name
      const selectedLine = selectedProviderName
        ? `\n\n${selectedProviderName} is reviewing your selection.`
        : ''
      await sendButtons(
        phone,
        `📋 *Ticket #${jr.id.slice(-6).toUpperCase()}*\n\n🔧 ${jr.category}\n${statusLabel}${selectedLine}\n\nWe'll notify you when they confirm so we can unlock full details.`,
        [
          { id: 'status', title: '🔁 Refresh status' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (requestStatus === 'SHORTLIST_READY') {
      const body = formatShortlistBody(shortlist, `🔧 ${jr.category}`, statusLabel)
      await sendButtons(
        phone,
        body,
        [
          { id: 'status', title: '🔁 Refresh status' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (requestStatus === 'OPEN' || requestStatus === 'MATCHING' || requestStatus === 'PENDING_VALIDATION') {
      const ticketRef = jr.id.slice(-6).toUpperCase()
      let body = requestStatusBody(
        requestStatus,
        `🔧 ${jr.category}`,
        statusLabel,
        leadSummary,
        shortlist,
        latestDispatchStatus,
      )
      body = `📋 *Ticket #${ticketRef}*\n\n${body}`

      const appUrl = getPublicAppUrl()
      const trackingUrl = appUrl ? await safeTrackingUrl(jr.id) : null
      if (trackingUrl) {
        try {
          await sendCtaUrl(
            phone,
            body,
            'Refresh status',
            trackingUrl,
          )
        } catch (error) {
          log(`WARN: status CTA send failed — falling back to text. error=${error instanceof Error ? error.message : String(error)}`)
          await sendText(phone, `${body}\n\nTap Track My Request to refresh.`)
        }
      } else {
        await sendButtons(
          phone,
          `${body}\n\nTap Refresh status to check for provider responses.`,
          [
            { id: 'status', title: '🔁 Refresh status' },
            { id: 'back_home', title: '🏠 Main Menu' },
          ],
          { footer: 'Reply "menu" to return to the main menu' },
        )
      }
      return { nextStep: 'done' }
    }

    const ticketRef = jr.id.slice(-6).toUpperCase()
    const trackingUrl = await safeTrackingUrl(jr.id)

    if (trackingUrl) {
      await sendCtaUrl(
        phone,
        `📋 *Ticket #${ticketRef}*\n\n🔧 ${jr.category}\n${statusLabel}\n\nTap below to view your ticket.`,
        'View Ticket',
        trackingUrl,
      )
    } else {
      await sendButtons(
        phone,
        `📋 *Ticket #${ticketRef}*\n\n🔧 ${jr.category}\n${statusLabel}`,
        [
          { id: 'status', title: '🔁 Refresh status' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ],
        { footer: 'Reply "menu" to return to the main menu' },
      )
    }

    return { nextStep: 'done' }
  } catch (error) {
    log(`WARN: status render failed, using fallback. error=${error instanceof Error ? error.message : String(error)}`)
    await sendWhatsAppJourneyRecovery(phone, {
      userRole: 'customer',
      channel: 'whatsapp',
      flowName: 'status',
      currentStep: 'status_show',
      failureType: 'dependency_failure',
      recoveryClass: 'show_status',
      requestId: jobRequestId,
      error,
    })
    return { nextStep: 'done' }
  }
}

function requestStatusBody(
  requestStatus: string,
  categoryLine: string,
  statusLabel: string,
  leadSummary: LeadStatusSummary,
  shortlist: ShortlistOption[] | null,
  latestDispatchStatus: DispatchDecisionStatus | null,
) {
  if (requestStatus === 'OPEN' || requestStatus === 'MATCHING') {
    if (leadSummary.total === 0 && latestDispatchStatus === 'NO_MATCH') {
      return `${statusLabel}\n\nWe haven't found suitable available providers yet. We're still checking.`
    }

    if (leadSummary.total === 0) {
      return `${statusLabel}\n\nYour request is still checking suitable providers in your area.`
    }

    if (leadSummary.interested > 0) {
      if (shortlist && shortlist.length > 0) {
        return formatShortlistBody(shortlist, categoryLine, statusLabel)
      }
      return `${statusLabel}\n\nGood news. Providers are interested in your request.`
    }

    if (leadSummary.activeOutreach > 0) {
      return `${statusLabel}\n\nYour request is being matched with suitable providers. We'll update you here when providers respond.`
    }

    return `${statusLabel}\n\nWe're still checking for suitable providers.`
  }

  return `${categoryLine}\n${statusLabel}\n\nTap Refresh status to check for the latest update.`
}

function formatShortlistBody(
  shortlist: ShortlistOption[] | null,
  categoryLine: string,
  statusLabel: string,
) {
  if (!shortlist || shortlist.length === 0) {
    return `${categoryLine}\n${statusLabel}\n\nNo ready provider options are available yet. Tap Refresh status to check again.`
  }

  const options = shortlist.map((item, index) => {
    const feeLine = item.callOutFee == null ? 'fee pending' : `R${item.callOutFee.toFixed(0)}`
    const arrival = item.estimatedArrivalAt
      ? `arrival by ${item.estimatedArrivalAt.toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' })}`
      : 'arrival time pending'
    const verifiedLabel = item.verified ? ' ✓ verified' : ''
    const note = item.note ? `\n   ${item.note}` : ''
    return `${index + 1}. ${item.name}${verifiedLabel} · ${feeLine} · ${arrival}${note}`
  })

  return `${categoryLine}\n${statusLabel}\n\nGreat news. We found providers interested in your request.\n\n${options.join('\n')}`
}

async function loadLeadSummary(jobRequestId: string): Promise<LeadStatusSummary> {
  const rows = await db.lead.findMany({
    where: { jobRequestId },
    select: { status: true },
  })

  return rows.reduce<LeadStatusSummary>(
    (acc, row) => {
      acc.total += 1
      if (row.status === 'SENT' || row.status === 'VIEWED') acc.activeOutreach += 1
      if (row.status === 'INTERESTED') acc.interested += 1
      return acc
    },
    { total: 0, activeOutreach: 0, interested: 0 },
  )
}

async function loadPublishedShortlist(jobRequestId: string): Promise<ShortlistOption[] | null> {
  const shortlist = await db.providerShortlist.findFirst({
    where: { requestId: jobRequestId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    include: {
      items: {
        orderBy: { rank: 'asc' },
        take: 3,
        include: {
          leadInvite: {
            include: {
              providerResponses: {
                where: { response: 'INTERESTED' },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
          provider: {
            select: { id: true, name: true, verified: true },
          },
        },
      },
    },
  })

  if (!shortlist || shortlist.items.length === 0) return null

  return shortlist.items.map((item) => {
    const response = item.leadInvite.providerResponses[0]
    const fee = response?.callOutFee == null ? null : Number(response.callOutFee)
    const note = response?.providerNote ? response.providerNote.trim() : null

    return {
      name: item.provider?.name?.trim() || `Provider ${item.providerId.slice(-4).toUpperCase()}`,
      verified: item.provider?.verified ?? false,
      callOutFee: fee == null || Number.isNaN(fee) ? null : fee,
      estimatedArrivalAt: response?.estimatedArrivalAt ?? null,
      note,
    } satisfies ShortlistOption
  })
}

async function loadLatestDispatchDecisionStatus(jobRequestId: string): Promise<DispatchDecisionStatus | null> {
  const decision = await db.dispatchDecision.findFirst({
    where: { jobRequestId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  })

  return decision ? normalizeDispatchDecisionStatus(decision.status) : null
}

function normalizeDispatchDecisionStatus(
  value: string,
): DispatchDecisionStatus | null {
  if (value === 'RANKED' || value === 'OFFERING' || value === 'ASSIGNED' || value === 'NO_MATCH' || value === 'OVERRIDDEN' || value === 'CANCELLED') {
    return value
  }
  return null
}

async function safeTrackingUrl(jobRequestId: string): Promise<string | null> {
  try {
    return await getJobRequestAccessUrl(jobRequestId, 'matching_status')
  } catch (error) {
    console.warn('[status-flow] tracking URL generation failed', {
      jobRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
