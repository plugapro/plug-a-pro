// ─── Job request / job status check flow ─────────────────────────────────────
// Customer replies "status" or taps "My Requests" → sees recent logged requests.
//
// Root cause note: this flow previously reused single-request tracking for the
// "My Requests" menu item. When the hidden latest-request render failed, the
// user saw a generic refresh loop instead of a request list. Keep list and
// specific-request status/refresh as separate concepts.

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import { getJobRequestAccessUrl } from '../job-request-access'
import { getPublicAppUrl } from '../provider-credit-copy'
import { maskPhone } from '../support-diagnostics'
import {
  RequestMatchingModeError,
  selectCustomerRequestMatchingMode,
  type CustomerMatchingMode,
} from '../request-matching-mode'
import type { FlowContext, FlowResult } from './types'

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
  PENDING_VALIDATION:              '🧭 Choose your matching mode',
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
const MY_REQUESTS_LIMIT = 10

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

type JobRequestWithRuntime = {
  id: string
  requestRef: string | null
  customerId: string
  status: string
  assignmentMode?: string
  latestDispatchDecisionId?: string | null
  createdAt: Date
  match: {
    booking: {
      job: {
        status: string
        id: string
      } | null
    } | null
  } | null
  category: string
}

type LeadSummaryErrorSafe = {
  total: number
  activeOutreach: number
  interested: number
}

function isRequestTerminalForTracking(request: Pick<JobRequestWithRuntime, 'status' | 'match'>) {
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) return true

  const job = request.match?.booking?.job ?? null
  return !!job && TERMINAL_JOB_STATUSES.includes(job.status)
}

function requestReference(request: Pick<JobRequestWithRuntime, 'id' | 'requestRef'>) {
  return request.requestRef || `PAP-${request.id.slice(-8).toUpperCase()}`
}

function requestStatusLabel(request: Pick<JobRequestWithRuntime, 'status' | 'match'>) {
  const job = request.match?.booking?.job ?? null
  const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null
  return activeJob
    ? JOB_STATUS_LABELS[activeJob.status] ?? 'Status update pending'
    : JOB_REQUEST_STATUS_LABELS[request.status] ?? 'Status update pending'
}

function sortRequestsForMyRequests<T extends Pick<JobRequestWithRuntime, 'status' | 'match' | 'createdAt'>>(requests: T[]) {
  return [...requests].sort((a, b) => {
    const aTerminal = isRequestTerminalForTracking(a)
    const bTerminal = isRequestTerminalForTracking(b)
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

function requestListLine(request: JobRequestWithRuntime, index: number) {
  return `${index + 1}. ${requestReference(request)} — ${request.category} — ${requestStatusLabel(request).replace(/^[^\p{L}\p{N}]+/u, '')}`
}

function createDefaultLeadSummary(): LeadSummaryErrorSafe {
  return { total: 0, activeOutreach: 0, interested: 0 }
}

function parseMatchingModeReply(replyId?: string): { requestId: string; mode: CustomerMatchingMode } | null {
  if (!replyId) return null
  if (replyId.startsWith('status_mode_quick_')) {
    return { requestId: replyId.replace('status_mode_quick_', ''), mode: 'quick_match' }
  }
  if (replyId.startsWith('status_mode_review_')) {
    return { requestId: replyId.replace('status_mode_review_', ''), mode: 'review_first' }
  }
  return null
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

    const matchingModeReply = parseMatchingModeReply(ctx.reply.id)
    if (matchingModeReply) {
      log(`matching mode selected via WhatsApp requestId=${matchingModeReply.requestId} mode=${matchingModeReply.mode}`)
      try {
        await selectCustomerRequestMatchingMode({
          requestId: matchingModeReply.requestId,
          customerId: customer.id,
          mode: matchingModeReply.mode,
        })
      } catch (error) {
        if (error instanceof RequestMatchingModeError) {
          const reason =
            error.code === 'REQUEST_NOT_EDITABLE'
              ? 'This request has already moved forward and matching mode can no longer be changed.'
              : error.code === 'FORBIDDEN'
                ? 'That request does not belong to this account.'
                : error.code === 'REQUEST_NOT_FOUND'
                  ? "We couldn't find that request."
                  : 'That matching mode selection is not available right now.'
          await sendButtons(
            ctx.phone,
            `⚠️ ${reason}\n\nPlease refresh your request status.`,
            [
              { id: `status_refresh_${matchingModeReply.requestId}`, title: 'Refresh status' },
              { id: 'status', title: 'My Requests' },
            ],
          )
          return { nextStep: 'done' }
        }
        throw error
      }
      return showRequestStatus(ctx.phone, matchingModeReply.requestId, reqId, customer.id)
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

    if (ctx.reply.id?.startsWith('status_refresh_')) {
      const jobRequestId = ctx.reply.id.replace('status_refresh_', '')
      if (jobRequestId) {
        log(`refresh requested → jobRequestId=${jobRequestId}`)
        return showRequestStatus(ctx.phone, jobRequestId, reqId, customer.id)
      }
    }

    if (ctx.step === 'status_pick' && ctx.reply.id?.startsWith('status_req_')) {
      const jobRequestId = ctx.reply.id.replace('status_req_', '')
      log(`disambiguation pick → jobRequestId=${jobRequestId}`)
      return showRequestStatus(ctx.phone, jobRequestId, reqId, customer.id)
    }

    if (ctx.step === 'status_pick') {
      log('status_pick reached with stale/invalid request id; showing request list')
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

    const sortedRequests = sortRequestsForMyRequests(jobRequests as JobRequestWithRuntime[])
    const activeRequests = sortedRequests.filter((jr) => !isRequestTerminalForTracking(jr))

    log(`total=${jobRequests.length} active=${activeRequests.length}`)

    // ── My Requests: list recent requests when there is more than one ───────
    if (sortedRequests.length > 1 || ctx.step === 'status_pick') {
      log('sending recent request list')
      const visibleRequests = sortedRequests.slice(0, MY_REQUESTS_LIMIT)
      const requestChoices = visibleRequests.slice(0, 9).map((jr) => {
        const date = formatRequestDate(jr.createdAt)
        return {
          id: `status_req_${jr.id}`,
          title: truncate(`${requestReference(jr)} · ${date}`, 24),
          description: truncate(`${jr.category} · ${requestStatusLabel(jr).replace(/^[^\p{L}\p{N}]+/u, '')} · ${date}`, 72),
          buttonTitle: truncate(requestReference(jr), 20),
        }
      })
      const listBody = `📋 *Here are your recent requests:*\n\n${visibleRequests.map(requestListLine).join('\n')}\n\nChoose a request to view its status.`

      try {
        await sendList(
          ctx.phone,
          listBody,
          [{
            title: 'Recent Requests',
            rows: requestChoices.map(({ id, title, description }) => ({
              id,
              title,
              description,
            })),
          }, {
            title: 'Actions',
            rows: [
              { id: 'book', title: 'Start new request', description: 'Log another service request' },
              { id: 'back_home', title: 'Main menu', description: 'Return to the main menu' },
            ],
          }],
          { buttonLabel: 'Choose Request' }
        )
        return { nextStep: 'status_pick' }
      } catch (error) {
        log(`WARN: sendList failed for request picker — falling back. error=${error instanceof Error ? error.message : String(error)}`)

        const buttonChoices = requestChoices.slice(0, 2).map(({ id, buttonTitle }) => ({
          id,
          title: buttonTitle,
        }))
        buttonChoices.push({ id: 'book', title: 'New Request' })

        try {
          await sendButtons(
            ctx.phone,
            listBody,
            buttonChoices,
            { footer: 'Reply "menu" for main menu' }
          )
          return { nextStep: 'status_pick' }
        } catch (fallbackError) {
          log(`WARN: sendButtons fallback failed for request picker — showing text list. error=${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
        }

        await sendText(
          ctx.phone,
          `${listBody}\n\nReply with the request reference you want to track, or reply *menu*.`
        )
        return { nextStep: 'status_pick' }
      }
    }

    // ── Single active request — or fall back to most recent ─────────────────
    const target = activeRequests[0] ?? sortedRequests[0]
    log(`resolved to jobRequestId=${target.id} category=${target.category} status=${target.status}`)
    return showRequestStatus(ctx.phone, target.id, reqId, customer.id)
  } catch (error) {
    log(`WARN: status flow failed before rendering. error=${error instanceof Error ? error.message : String(error)}`)
    await sendButtons(
      ctx.phone,
      "📋 We couldn't load your requests right now. Please try again.",
      [
        { id: 'status', title: 'Try again' },
        { id: 'book', title: 'Start new request' },
        { id: 'back_home', title: 'Main menu' },
      ],
      { footer: 'Reply "menu" for main menu' },
    )
    return { nextStep: 'welcome' }
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
  const log = (msg: string) => console.log(`[status-flow:${reqId}] phone=${maskPhone(phone)} ${msg}`)

  async function loadLatestRequestForCustomer() {
    if (!expectedCustomerId) return null

    // Prefer the latest non-terminal request so Track My Request continues with
    // the current active flow if the pinned ID is stale. If none is active,
    // fall back to the most recent request for transparent status visibility.
    const recentRequests = await db.jobRequest.findMany({
      where: { customerId: expectedCustomerId },
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
      orderBy: { createdAt: 'desc' },
      take: 8,
    }) as (JobRequestWithRuntime & { createdAt: Date })[] | undefined

    const latest = (recentRequests ?? []).find((request) => !isRequestTerminalForTracking(request))
      ?? recentRequests?.[0]
    return latest ?? null
  }

  async function loadLeadSummarySafe(id: string) {
    try {
      return await loadLeadSummary(id)
    } catch (error) {
      log(`WARN: lead summary lookup failed for id=${id}; defaulting to safe baseline. error=${error instanceof Error ? error.message : String(error)}`)
      return createDefaultLeadSummary()
    }
  }

  async function loadDispatchDecisionSafe(id: string) {
    try {
      return await loadLatestDispatchDecisionStatus(id)
    } catch (error) {
      log(`WARN: dispatch decision lookup failed for id=${id}; defaulting to null. error=${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  async function loadShortlistSafe(id: string) {
    try {
      return await loadPublishedShortlist(id)
    } catch (error) {
      log(`WARN: shortlist lookup failed for id=${id}; defaulting to null. error=${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

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
        "⚠️ We couldn't find that request. It may be old or no longer active.\n\nPlease choose the request you want to track.",
        [
          { id: 'status', title: 'My Requests' },
          { id: 'book', title: '🔧 New Request' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (expectedCustomerId && jr.customerId !== expectedCustomerId) {
      log(`request ownership mismatch id=${jobRequestId} expectedCustomerId=${expectedCustomerId}`)

      const latestForCustomer = await loadLatestRequestForCustomer()
      if (latestForCustomer && latestForCustomer.id !== jobRequestId) {
        log(`ownership mismatch fallback to latest request id=${latestForCustomer.id}`)
        return showRequestStatus(phone, latestForCustomer.id, reqId, expectedCustomerId)
      }

      // No valid fallback available (customer has no requests, or the fallback
      // query returned the same stale/foreign ID — both are safe-exit paths).
      log(`request ownership unresolvable for id=${jobRequestId} — sending safe error`)
      await sendButtons(
        phone,
        '⚠️ That request could not be loaded for this account.',
        [
          { id: 'status', title: 'My Requests' },
          { id: 'book', title: 'Request Service' },
        ],
      )
      return { nextStep: 'done' }
    }

    const job = jr.match?.booking?.job ?? null
    // Completed/terminal jobs should not override request-level status labels.
    const activeJob = (job && !TERMINAL_JOB_STATUSES.includes(job.status)) ? job : null
    const jobStatus = activeJob?.status
    const requestStatus = jr.status

    const [leadSummary, latestDispatchStatus, shortlist] = await Promise.all([
      loadLeadSummarySafe(jr.id),
      loadDispatchDecisionSafe(jr.id),
      loadShortlistSafe(jr.id),
    ])
    const reviewRankedCandidateCount =
      jr.assignmentMode === 'OPS_REVIEW'
        ? await loadReviewRankedCandidateCountSafe(jr.latestDispatchDecisionId)
        : 0

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
        `📋 *Request ${requestReference(jr)}*\n\nService: ${jr.category}\nStatus: ${fallbackText}\n\nIf you want, submit another request now.`,
        [
          { id: 'book', title: 'Start new request' },
          { id: 'back_home', title: 'Main menu' },
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
        `📋 *Request ${requestReference(jr)}*\n\nService: ${jr.category}\nStatus: ${statusLabel}${selectedLine}\n\nWe'll notify you when they confirm so we can unlock full details.`,
        [
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
          { id: 'back_home', title: 'Main menu' },
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
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
          { id: 'back_home', title: 'Main menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    const reviewFirstOptionsReady =
      requestStatus === 'PENDING_VALIDATION' &&
      jr.assignmentMode === 'OPS_REVIEW' &&
      Boolean(jr.latestDispatchDecisionId) &&
      latestDispatchStatus === 'RANKED' &&
      reviewRankedCandidateCount > 0

    const reviewFirstNoCandidates =
      requestStatus === 'PENDING_VALIDATION' &&
      jr.assignmentMode === 'OPS_REVIEW' &&
      Boolean(jr.latestDispatchDecisionId) &&
      (latestDispatchStatus === 'NO_MATCH' ||
        (latestDispatchStatus === 'RANKED' && reviewRankedCandidateCount === 0))

    if (reviewFirstOptionsReady) {
      const trackingUrl = await safeTrackingUrl(jr.id)
      const body =
        `📋 *Request ${requestReference(jr)}*\n\n` +
        `Review Providers First is ready.\n\n` +
        `We found ${reviewRankedCandidateCount} matching provider${reviewRankedCandidateCount === 1 ? '' : 's'}.\n\n` +
        `Open your request to view matching provider profiles, shortlist 1 to 3 providers, and send your request only to the providers you choose.`

      if (trackingUrl) {
        try {
          await sendCtaUrl(phone, body, 'View providers', trackingUrl)
          return { nextStep: 'done' }
        } catch (error) {
          log(`WARN: review-first CTA send failed — falling back to buttons. error=${error instanceof Error ? error.message : String(error)}`)
        }
      }

      await sendButtons(
        phone,
        `${body}\n\nIf the app link is unavailable, you can switch to Quick Match.`,
        [
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
          { id: `status_mode_quick_${jr.id}`, title: 'Quick Match' },
          { id: 'back_home', title: 'Main menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (reviewFirstNoCandidates) {
      await sendButtons(
        phone,
        `📋 *Request ${requestReference(jr)}*\n\nWe couldn't find matching providers for Review Providers First right now.\n\nYou can switch to Quick Match so we can try one suitable provider at a time.`,
        [
          { id: `status_mode_quick_${jr.id}`, title: 'Quick Match' },
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
          { id: 'back_home', title: 'Main menu' },
        ],
      )
      return { nextStep: 'done' }
    }

    if (requestStatus === 'PENDING_VALIDATION') {
      const body = `📋 *Request ${requestReference(jr)}*\n\n${requestStatusBody(
        requestStatus,
        `🔧 ${jr.category}`,
        statusLabel,
        leadSummary,
        shortlist,
        latestDispatchStatus,
      )}\n\nChoose an option below to continue.`
      await sendButtons(
        phone,
        body,
        [
          { id: `status_mode_quick_${jr.id}`, title: 'Quick Match' },
          { id: `status_mode_review_${jr.id}`, title: 'Review Providers' },
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
        ],
        { footer: 'Reply "menu" to return to the main menu' },
      )
      return { nextStep: 'done' }
    }

    if (requestStatus === 'OPEN' || requestStatus === 'MATCHING') {
      let body = requestStatusBody(
        requestStatus,
        `🔧 ${jr.category}`,
        statusLabel,
        leadSummary,
        shortlist,
        latestDispatchStatus,
      )
      body = `📋 *Request ${requestReference(jr)}*\n\n${body}`

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
          log(`INFO: request status CTA sent. requestId=${jr.id} label=Refresh status`)
        } catch (error) {
          log(`WARN: status CTA send failed — falling back to text. error=${error instanceof Error ? error.message : String(error)}`)
          await sendText(phone, `${body}\n\nTap Track My Request to refresh.`)
        }
      } else {
        await sendButtons(
          phone,
          `${body}\n\nTap Refresh status to check for provider responses.`,
          [
            { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
            { id: 'back_home', title: 'Main menu' },
          ],
          { footer: 'Reply "menu" to return to the main menu' },
        )
      }
      return { nextStep: 'done' }
    }

    const trackingUrl = await safeTrackingUrl(jr.id)

    if (trackingUrl) {
      await sendCtaUrl(
        phone,
        `📋 *Request ${requestReference(jr)}*\n\nService: ${jr.category}\nStatus: ${statusLabel}\n\nTap below to view your request.`,
        'View request',
        trackingUrl,
      )
      log(`INFO: request ticket CTA sent. requestId=${jr.id} label=View request`)
    } else {
      await sendButtons(
        phone,
        `📋 *Request ${requestReference(jr)}*\n\nService: ${jr.category}\nStatus: ${statusLabel}`,
        [
          { id: `status_refresh_${jr.id}`, title: 'Refresh status' },
          { id: 'back_home', title: 'Main menu' },
        ],
        { footer: 'Reply "menu" to return to the main menu' },
      )
    }

    return { nextStep: 'done' }
  } catch (error) {
    log(`WARN: status render failed, using fallback. error=${error instanceof Error ? error.message : String(error)}`)
    await sendButtons(
      phone,
      "📋 We couldn't load that request right now. Please try again or choose another request.",
      [
        { id: `status_refresh_${jobRequestId}`, title: 'Try again' },
        { id: 'status', title: 'My Requests' },
        { id: 'book', title: 'New request' },
      ],
    )
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
  if (requestStatus === 'PENDING_VALIDATION') {
    return `${statusLabel}\n\nChoose *Quick Match* to contact one suitable provider at a time, or *Review Providers First* to compare options before choosing.`
  }

  if (requestStatus === 'OPEN' || requestStatus === 'MATCHING') {
    if (leadSummary.total === 0 && latestDispatchStatus === 'NO_MATCH') {
      return `${statusLabel}\n\nWe haven't confirmed a provider yet. We're widening checks and will keep you updated.`
    }

    if (leadSummary.total === 0) {
      return `${statusLabel}\n\nWe're checking with suitable providers one at a time.`
    }

    if (leadSummary.interested > 0) {
      if (shortlist && shortlist.length > 0) {
        return formatShortlistBody(shortlist, categoryLine, statusLabel)
      }
      return `${statusLabel}\n\nGood news. Providers are interested in your request.`
    }

    if (leadSummary.activeOutreach > 0) {
      return `${statusLabel}\n\nA provider is reviewing your request now. If they don't respond in time, we'll try the next suitable provider.`
    }

    return `${statusLabel}\n\nWe're rotating through suitable providers and will update you here after each response.`
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

async function loadReviewRankedCandidateCountSafe(dispatchDecisionId: string | null | undefined) {
  if (!dispatchDecisionId) return 0
  try {
    return await db.matchAttempt.count({
      where: { dispatchDecisionId, stage: 'RANKED' },
    })
  } catch (error) {
    console.warn('[status-flow] review-first ranked candidate count failed', {
      dispatchDecisionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
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
