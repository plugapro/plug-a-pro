import { Prisma } from '@prisma/client'
import { db } from './db'
import { getJobRequestAccessUrl } from './job-request-access'
import { getProviderLeadAccessUrlByLeadId } from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'
import { orchestrateMatch } from './matching/orchestrator'
import { sendText } from './whatsapp'
import { sendButtons, sendCtaUrl } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'

// How long the provider has to accept/decline after customer selection.
const PROVIDER_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000

// Provider lead notification reservation TTL in milliseconds.
// A reservation prevents duplicate notifications when a retry occurs.
export const NOTIFICATION_ATTEMPT_TTL_MS = 5 * 60 * 1000

export class CustomerShortlistError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'SHORTLIST_EMPTY'
      | 'SHORTLIST_NOT_FOUND'
      | 'ITEM_NOT_FOUND'
      | 'ITEM_NOT_SELECTABLE'
      | 'FORBIDDEN'
      | 'INVALID_REQUEST_STATUS'
      | 'INVALID_PROVIDER_SELECTION'
      | 'REQUEST_NOT_AWAITING_SELECTION',
    message: string,
  ) {
    super(message)
    this.name = 'CustomerShortlistError'
  }
}

class SelectedProviderDeclineStateChangedError extends Error {
  constructor() {
    super('Selected provider decline lost a state race.')
    this.name = 'SelectedProviderDeclineStateChangedError'
  }
}

function requestCanAcceptSelection(
  status: string,
): status is 'SHORTLIST_READY' | 'PENDING_VALIDATION' {
  return status === 'SHORTLIST_READY' || status === 'PENDING_VALIDATION'
}

type ProviderSelectionLead = {
  id: string
  status: string
  dispatchDecisionId: string | null
  matchAttemptId: string | null
  matchScore: number | Prisma.Decimal | null
  rankingPosition: number | null
  customerSelectedAt: Date | null
  expiresAt: Date | null
  provider: {
    id: string
    active: boolean
    status: string
    verified: boolean
    name: string
    phone: string | null
  }
}

function isLeadSelectableForFinalSelection(leadStatus: string) {
  return [
    'SHORTLISTED',
    'SENT',
    'VIEWED',
    'INTERESTED',
    'CUSTOMER_SELECTED',
    'ACCEPTED',
  ].includes(leadStatus)
}

function throwDuplicateSelectionError(message: string) {
  throw new CustomerShortlistError('REQUEST_NOT_AWAITING_SELECTION', message)
}

function logSelectionRejected(reason: string, details: Record<string, unknown>) {
  console.warn(`[customer-shortlists.selection] reject:${reason}`, details)
}

function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
) {
  if (value == null) return null
  return Number(value)
}

function formatCredits(value: number) {
  return `${value} credit${value === 1 ? '' : 's'}`
}

type NotifySelectedProviderResult = {
  sent: boolean
  reason?:
    | 'already_notified'
    | 'request_not_ready'
    | 'not_applicable'
    | 'missing_provider_phone'
    | 'provider_not_active'
    | 'not_found'
    | 'not_selected'
    | 'send_failed'
    | 'db_update_failed'
}

function formatProviderLeadNotificationTiming(params: {
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
}) {
  if (params.requestedWindowStart && params.requestedWindowEnd) {
    return `Preferred time: ${params.requestedWindowStart.toLocaleString('en-ZA')} - ${params.requestedWindowEnd.toLocaleString('en-ZA')}`
  }
  if (params.requestedWindowStart) {
    return `Preferred time: ${params.requestedWindowStart.toLocaleString('en-ZA')}`
  }
  if (params.requestedWindowEnd) {
    return `Latest arrival: ${params.requestedWindowEnd.toLocaleString('en-ZA')}`
  }
  return 'Preferred time: flexible'
}

function buildProviderSelectedNotificationBody(params: {
  category: string
  suburb: string | null
  urgency: string | null
  title: string
  description: string
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  attachmentCount: number
  remainingCreditLabel: string
  balanceLabel: string
}) {
  const area = params.suburb ? ` in ${params.suburb}` : ''
  return (
    `✅ Customer selected you\n\n` +
    `The customer selected you for this ${params.category} job${area}.\n\n` +
    `${params.urgency ? `Urgency: ${params.urgency}\n` : ''}` +
    `Issue: ${params.title || params.description || 'Service request'}\n` +
    `${formatProviderLeadNotificationTiming({
      requestedWindowStart: params.requestedWindowStart,
      requestedWindowEnd: params.requestedWindowEnd,
    })}\n` +
    `Photos: ${params.attachmentCount}\n\n` +
    `Accepting this job uses 1 credit.\n\n` +
    `Available balance: ${params.balanceLabel}\n` +
    `After acceptance: ${params.remainingCreditLabel}`
  )
}

export async function generateCustomerShortlistForRequest(
  requestId: string,
  limit = 5,
  options?: { quickMatch?: boolean },
) {
  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      category: true,
      customer: { select: { phone: true } },
      address: { select: { suburb: true, city: true } },
    },
  })
  if (!request) {
    throw new CustomerShortlistError(
      'REQUEST_NOT_FOUND',
      'Job request not found.',
    )
  }

  const responses = await db.providerLeadResponse.findMany({
    where: {
      response: 'INTERESTED',
      callOutFee: { not: null },
      estimatedArrivalAt: { not: null },
      leadInvite: {
        jobRequestId: requestId,
        status: { in: ['SENT', 'VIEWED'] },
        expiresAt: { gt: new Date() },
      },
      provider: {
        active: true,
        status: 'ACTIVE',
        verified: true,
      },
    },
    include: {
      leadInvite: true,
      provider: true,
    },
    orderBy: [
      { estimatedArrivalAt: 'asc' },
      { callOutFee: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  })

  if (responses.length === 0) {
    throw new CustomerShortlistError(
      'SHORTLIST_EMPTY',
      'No interested providers are ready for shortlist.',
    )
  }

  const shortlist = await db.$transaction(async (tx) => {
    await tx.providerShortlist.updateMany({
      where: { requestId, status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })

    const shortlist = await tx.providerShortlist.create({
      data: {
        requestId,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        items: {
          create: responses.map((response, index) => ({
            leadInviteId: response.leadInviteId,
            providerId: response.providerId,
            rank: index + 1,
            matchScore: response.leadInvite.matchScore,
            displayCallOutFee: response.callOutFee,
            displayArrivalTime: response.estimatedArrivalAt,
          })),
        },
      },
      include: { items: true },
    })

    await tx.jobRequest.update({
      where: { id: requestId },
      data: { status: 'SHORTLIST_READY' },
    })

    return shortlist
  })

  if (options?.quickMatch && responses.length === 1) {
    const top = responses[0]
    await notifyCustomerQuickMatchProviderAvailable({
      requestId: request.id,
      customerPhone: request.customer?.phone ?? null,
      category: request.category,
      providerName: top.provider.name ?? 'the provider',
      callOutFee: top.callOutFee,
      estimatedArrivalAt: top.estimatedArrivalAt,
    }).catch((error) => {
      console.error(
        '[customer-shortlists] quick-match available notification failed',
        { requestId, error },
      )
    })
  } else {
    await notifyCustomerShortlistReady({
      requestId: request.id,
      customerPhone: request.customer?.phone ?? null,
      category: request.category,
      suburb: request.address?.suburb ?? null,
      city: request.address?.city ?? null,
      optionCount: shortlist.items.length,
    }).catch((error) => {
      console.error(
        '[customer-shortlists] shortlist-ready notification failed',
        { requestId, error },
      )
    })
  }

  return shortlist
}

async function notifyCustomerQuickMatchProviderAvailable(params: {
  requestId: string
  customerPhone: string | null
  category: string
  providerName: string
  callOutFee: Parameters<typeof decimalToNumber>[0]
  estimatedArrivalAt: Date | null
}) {
  if (!params.customerPhone)
    return { sent: false as const, reason: 'no_customer_phone' }
  const rawUrl = await getJobRequestAccessUrl(params.requestId).catch(
    () => null,
  )
  const safeTicketUrl = rawUrl?.startsWith('https://') ? rawUrl : null
  if (!safeTicketUrl && rawUrl) {
    console.warn(
      '[customer-shortlists] dropped CTA URL — non-https ticket url',
      { requestId: params.requestId },
    )
  }
  const feeDisplay =
    params.callOutFee != null
      ? `R${decimalToNumber(params.callOutFee)}`
      : 'To be confirmed'
  const etaDisplay = params.estimatedArrivalAt
    ? params.estimatedArrivalAt.toLocaleString('en-ZA', {
        timeStyle: 'short',
        dateStyle: 'medium',
      })
    : 'To be confirmed'
  await sendText({
    to: params.customerPhone,
    text:
      `Good news. ${params.providerName} is available for your ${params.category} request.\n\n` +
      `Call-out fee: ${feeDisplay}\n` +
      `Estimated arrival: ${etaDisplay}\n\n` +
      `Choose this provider or ask us to try another.` +
      (safeTicketUrl ? `\n\nYour options are available below.` : ''),
    templateName: 'interactive:client_quick_match_available',
    metadata: { requestId: params.requestId },
  })
  if (safeTicketUrl) {
    await sendCtaUrl(
      params.customerPhone,
      'Your options are available below.',
      ctaLabelFor('generic_details'),
      safeTicketUrl,
      undefined,
      {
        templateName: 'interactive:client_quick_match_available_cta',
        metadata: { requestId: params.requestId },
      },
    )
  }
  return { sent: true as const }
}

async function notifyCustomerShortlistReady(params: {
  requestId: string
  customerPhone: string | null
  category: string
  suburb: string | null
  city: string | null
  optionCount: number
}) {
  if (!params.customerPhone)
    return { sent: false as const, reason: 'no_customer_phone' }
  const rawUrl = await getJobRequestAccessUrl(
    params.requestId,
    'shortlist',
  ).catch(() => null)
  const safeTicketUrl = rawUrl?.startsWith('https://') ? rawUrl : null
  if (!safeTicketUrl && rawUrl) {
    console.warn(
      '[customer-shortlists] dropped CTA URL — non-https ticket url',
      { requestId: params.requestId },
    )
  }
  const area = [params.suburb, params.city].filter(Boolean).join(', ')
  await sendText({
    to: params.customerPhone,
    text:
      `Your ${params.category} shortlist is ready\n\n` +
      `${params.optionCount} suitable provider${params.optionCount === 1 ? '' : 's'} in ${area || 'your area'} responded with their call-out fee and earliest arrival.\n\n` +
      `You can compare providers before choosing.\n\n` +
      `Choose the provider you'd like for this job. Your phone number and exact address will only be shared after you select a provider and they accept.` +
      (safeTicketUrl ? `\n\nProvider selection is available below.` : ''),
    templateName: 'interactive:client_shortlist_ready',
    metadata: { requestId: params.requestId },
  })
  if (safeTicketUrl) {
    await sendCtaUrl(
      params.customerPhone,
      'Provider selection is available below.',
      ctaLabelFor('generic_details'),
      safeTicketUrl,
      undefined,
      {
        templateName: 'interactive:client_shortlist_ready_cta',
        metadata: { requestId: params.requestId },
      },
    )
  }
  return { sent: true as const }
}

export async function getCustomerShortlistForRequest(requestId: string) {
  const shortlist = await db.providerShortlist.findFirst({
    where: { requestId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    include: {
      items: {
        orderBy: { rank: 'asc' },
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
            select: {
              id: true,
              name: true,
              bio: true,
              experience: true,
              skills: true,
              serviceAreas: true,
              evidenceNote: true,
              portfolioUrls: true,
              avatarUrl: true,
              verified: true,
              averageRating: true,
              completedJobsCount: true,
            },
          },
        },
      },
    },
  })

  if (!shortlist) return null

  return {
    id: shortlist.id,
    requestId: shortlist.requestId,
    status: shortlist.status,
    publishedAt: shortlist.publishedAt,
    items: shortlist.items.map((item) => {
      const response = item.leadInvite.providerResponses[0] ?? null
      return {
        id: item.id,
        rank: item.rank,
        leadInviteId: item.leadInviteId,
        providerId: item.providerId,
        customerSelectedAt: item.customerSelectedAt,
        callOutFee: decimalToNumber(
          item.displayCallOutFee ?? response?.callOutFee,
        ),
        estimatedArrivalAt:
          item.displayArrivalTime ?? response?.estimatedArrivalAt ?? null,
        rateType: response?.rateType ?? null,
        rateAmount: decimalToNumber(response?.rateAmount),
        negotiable: response?.negotiable ?? true,
        providerNote: response?.providerNote ?? null,
        provider: item.provider,
      }
    }),
  }
}

export async function selectShortlistedProviderForRequest(params: {
  requestId: string
  shortlistItemId: string
}) {
  const requestId = params.requestId?.trim()
  const shortlistItemId = params.shortlistItemId?.trim()

  if (!requestId || !shortlistItemId) {
    logSelectionRejected('invalid_ids', {
      requestId: params.requestId,
      shortlistItemId: params.shortlistItemId,
    })
    throw new CustomerShortlistError(
      'ITEM_NOT_FOUND',
      'Shortlist provider was not found.',
    )
  }

  const item = await db.providerShortlistItem.findUnique({
    where: { id: shortlistItemId },
    include: {
      shortlist: true,
      leadInvite: {
        include: {
          jobRequest: {
            include: { address: true },
          },
          provider: true,
        },
      },
      provider: true,
    },
  })

  if (!item || item.shortlist.requestId !== requestId) {
    logSelectionRejected('item_missing', {
      requestId,
      shortlistItemId,
    })
    throw new CustomerShortlistError(
      'ITEM_NOT_FOUND',
      'Shortlist provider was not found.',
    )
  }
  if (
    item.shortlist.status !== 'PUBLISHED' ||
    item.leadInvite.status === 'EXPIRED'
  ) {
    throw new CustomerShortlistError(
      'ITEM_NOT_SELECTABLE',
      'This provider is no longer selectable.',
    )
  }

  // Selection is only allowed while the request is awaiting customer selection.
  // Once it advances (provider confirmation pending, matched, etc.) re-selection
  // would silently overwrite the prior choice and re-notify a different
  // provider. The DB unique on selectedLeadInviteId prevents the same lead
  // being selected twice across requests, but does not prevent overwriting on
  // the same request.
  const requestStatus = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  })
  if (!requestStatus) {
    throw new CustomerShortlistError(
      'ITEM_NOT_FOUND',
      'Shortlist provider was not found.',
    )
  }
  if (requestStatus.status !== 'SHORTLIST_READY') {
    logSelectionRejected('request_status_not_selectable', {
      requestId,
      shortlistItemId,
      requestStatus: requestStatus.status,
    })
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'This request is no longer awaiting customer selection.',
    )
  }

  if (!item.provider) {
    logSelectionRejected('provider_not_found', {
      requestId,
      providerId: item.providerId,
      shortlistItemId,
    })
    throw new CustomerShortlistError(
      'INVALID_PROVIDER_SELECTION',
      'This provider is no longer available.',
    )
  }

  if (!item.provider?.active || item.provider.status !== 'ACTIVE') {
    logSelectionRejected('provider_not_active', {
      requestId,
      providerId: item.providerId,
      providerStatus: item.provider.status,
      active: item.provider.active,
    })
    throw new CustomerShortlistError(
      'INVALID_PROVIDER_SELECTION',
      'This provider is no longer active.',
    )
  }

  const selectedAt = new Date()
  const leadExpiryTs = new Date(selectedAt.getTime() + PROVIDER_CONFIRMATION_WINDOW_MS)

  const result = await db.$transaction(async (tx) => {
    await tx.jobRequest.update({
      where: { id: params.requestId },
      data: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: item.providerId,
        selectedLeadInviteId: item.leadInviteId,
      },
    })

    await tx.lead.update({
      where: { id: item.leadInviteId },
      data: { customerSelectedAt: selectedAt },
    })

    const selectedItem = await tx.providerShortlistItem.update({
      where: { id: item.id },
      data: { customerSelectedAt: selectedAt },
    })

    await tx.auditLog
      .create({
        data: {
          actorId: 'customer-access-link',
          actorRole: 'customer',
          action: 'shortlist.provider_selected',
          entityType: 'JobRequest',
          entityId: params.requestId,
          after: {
            providerId: item.providerId,
            leadInviteId: item.leadInviteId,
            shortlistItemId: item.id,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)

    return selectedItem
  })

  const notification = await notifySelectedProvider({
    leadId: item.leadInviteId,
  })

  return {
    selectedItem: result,
    provider: item.provider,
    notification,
  }
}

/**
 * Customer cancels their request from the shortlist UI before any provider
 * has been confirmed. No credit was ever deducted, so this is a clean state
 * transition: the request moves to CANCELLED, the active shortlist is
 * superseded, and any pending lead invites are marked CANCELLED. Providers
 * will see "no longer needed" via the existing pending-lead lifecycle.
 */
export async function cancelRequestFromShortlist(params: {
  requestId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, status: true },
  })
  if (!request) {
    throw new CustomerShortlistError(
      'REQUEST_NOT_FOUND',
      'Job request not found.',
    )
  }
  // Only allow cancellation while the request is awaiting customer action.
  // Once a provider has accepted, the customer must use the standard
  // booking-cancellation flow (which involves the assigned provider).
  if (
    request.status !== 'OPEN' &&
    request.status !== 'MATCHING' &&
    request.status !== 'SHORTLIST_READY'
  ) {
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'This request can no longer be cancelled here.',
    )
  }

  await db.$transaction(async (tx) => {
    await tx.providerShortlist.updateMany({
      where: { requestId: params.requestId, status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
    await tx.lead.updateMany({
      where: {
        jobRequestId: params.requestId,
        // Include INTERESTED so providers who already responded are also notified
        // that the request has been cancelled, not just those still in preview.
        status: { in: ['SENT', 'VIEWED', 'INTERESTED'] },
      },
      data: {
        status: 'EXPIRED',
        cancelledAt: new Date(),
        respondedAt: new Date(),
      },
    })
    await tx.jobRequest.update({
      where: { id: params.requestId },
      data: {
        status: 'CANCELLED',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      },
    })
    await tx.auditLog
      .create({
        data: {
          actorId: 'customer-access-link',
          actorRole: 'customer',
          action: 'shortlist.request_cancelled',
          entityType: 'JobRequest',
          entityId: params.requestId,
          after: {} as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)
  })

  return { ok: true as const }
}

/**
 * Customer asks for more shortlist options. We mark the current shortlist as
 * superseded and reopen the request so the dispatch pipeline can run another
 * match pass. Existing interested responses remain valid and will be
 * re-included in the next shortlist generation.
 */
export async function requestMoreShortlistOptions(params: {
  requestId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      status: true,
      customer: { select: { phone: true } },
    },
  })
  if (!request) {
    throw new CustomerShortlistError(
      'REQUEST_NOT_FOUND',
      'Job request not found.',
    )
  }
  if (request.status !== 'SHORTLIST_READY') {
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'More options can only be requested while the shortlist is awaiting selection.',
    )
  }

  const activeLeadOffers =
    typeof (db as any).lead?.findMany === 'function'
      ? await db.lead.findMany({
          where: {
            jobRequestId: params.requestId,
            status: { in: ['SENT', 'VIEWED', 'INTERESTED'] },
            assignmentHold: { status: 'ACTIVE' },
          },
          select: {
            id: true,
            providerId: true,
          },
        })
      : []

  await db.$transaction(async (tx) => {
    await tx.providerShortlist.updateMany({
      where: { requestId: params.requestId, status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
    await tx.jobRequest.update({
      where: { id: params.requestId },
      data: { status: 'OPEN' },
    })
    await tx.auditLog
      .create({
        data: {
          actorId: 'customer-access-link',
          actorRole: 'customer',
          action: 'shortlist.more_options_requested',
          entityType: 'JobRequest',
          entityId: params.requestId,
          after: {} as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)
  })

  if (activeLeadOffers.length > 0) {
    const { rejectAssignmentOffer } = await import('./matching/service')
    for (const lead of activeLeadOffers) {
      await rejectAssignmentOffer({
        leadId: lead.id,
        providerId: lead.providerId,
        reasonCode: 'CUSTOMER_REQUESTED_NEXT_PROVIDER',
      }).catch((error) => {
        console.error(
          '[customer-shortlists] failed to release active lead while requesting more options',
          {
            requestId: params.requestId,
            leadId: lead.id,
            providerId: lead.providerId,
            error,
          },
        )
      })
    }
  } else {
    // Continue matching immediately for the reopen rematch request.
    try {
      await orchestrateMatch(params.requestId, { triggeredBy: 'rematch' })
    } catch (error) {
      console.error(
        '[customer-shortlists] rematch orchestration failed:',
        error,
      )
    }
  }

  if (request.customer?.phone) {
    await sendText({
      to: request.customer.phone,
      text: `No problem. We'll check with another suitable provider now.`,
      templateName: 'interactive:quick_match_try_another',
      metadata: { requestId: params.requestId },
    }).catch(() => undefined)
  }

  return { ok: true as const }
}

/**
 * Selected provider declined the customer-confirmed lead. We reverse the
 * customer selection so the customer can either pick another provider from the
 * existing shortlist or be informed that the shortlist is exhausted. No credit
 * has been deducted at this point because deduction only occurs on final
 * acceptance.
 */
export async function declineSelectedProviderJob(params: {
  leadId: string
  providerId: string
}) {
  console.info('[provider-lead-action]', {
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'decline',
    result: 'attempt',
    source: 'provider_confirmation',
  })

  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      status: true,
      expiresAt: true,
      cancelledAt: true,
      jobRequest: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
        },
      },
    },
  })

  if (!lead) {
    console.info('[provider-lead-action]', {
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'NOT_FOUND',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'NOT_FOUND' as const }
  }
  if (lead.providerId !== params.providerId) {
    console.info('[provider-lead-action]', {
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'FORBIDDEN',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'FORBIDDEN' as const }
  }
  if (lead.status === 'DECLINED') {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'idempotent',
      reason: 'ALREADY_DECLINED',
      source: 'provider_confirmation',
    })
    return {
      ok: true as const,
      alreadyDeclined: true as const,
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
    }
  }
  if (lead.status === 'ACCEPTED' || lead.status === 'ACCEPTED_LOCKED' || lead.status === 'PROVIDER_ACCEPTED' || lead.status === 'CREDIT_REQUIRED') {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'LEAD_ALREADY_ACCEPTED',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'LEAD_ALREADY_ACCEPTED' as const }
  }
  if (
    lead.status === 'CANCELLED' ||
    lead.cancelledAt ||
    lead.jobRequest.status === 'CANCELLED'
  ) {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'REQUEST_CANCELLED',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'REQUEST_CANCELLED' as const }
  }
  if (
    lead.status === 'EXPIRED' ||
    (lead.expiresAt && lead.expiresAt <= new Date()) ||
    (lead.jobRequest.expiresAt && lead.jobRequest.expiresAt <= new Date())
  ) {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'LEAD_EXPIRED',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'LEAD_EXPIRED' as const }
  }
  if (lead.status !== 'CUSTOMER_SELECTED') {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'LEAD_NOT_PROVIDER_NOTIFIED',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'LEAD_NOT_PROVIDER_NOTIFIED' as const }
  }
  if (
    lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING' ||
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    console.info('[provider-lead-action]', {
      leadId: lead.id,
      providerId: params.providerId,
      action: 'decline',
      result: 'blocked',
      reason: 'NOT_AWAITING_CONFIRMATION',
      source: 'provider_confirmation',
    })
    return { ok: false as const, reason: 'NOT_AWAITING_CONFIRMATION' as const }
  }

  try {
    const transition = await db.$transaction(async (tx) => {
      const declinedAt = new Date()
      const leadUpdate = await tx.lead.updateMany({
        where: {
          id: lead.id,
          providerId: params.providerId,
          status: 'CUSTOMER_SELECTED',
        },
        data: { status: 'DECLINED', respondedAt: declinedAt, declinedAt },
      })

      if (leadUpdate.count === 0) {
        return { ok: false as const, reason: 'STATE_CHANGED' as const }
      }

      // Mark the corresponding shortlist item as superseded by clearing the
      // customer-selected timestamp so the customer can pick again. We do not
      // delete the shortlist itself.
      await tx.providerShortlistItem.updateMany({
        where: { leadInviteId: lead.id },
        data: { customerSelectedAt: null },
      })

      // Reset request state only if it is still waiting for this provider. The
      // guarded update prevents a stale duplicate decline from reopening a
      // request that another path has already accepted or locked.
      const requestUpdate = await tx.jobRequest.updateMany({
        where: {
          id: lead.jobRequestId,
          status: 'PROVIDER_CONFIRMATION_PENDING',
          selectedProviderId: params.providerId,
          selectedLeadInviteId: lead.id,
        },
        data: {
          status: 'SHORTLIST_READY',
          selectedProviderId: null,
          selectedLeadInviteId: null,
        },
      })

      if (requestUpdate.count === 0) {
        throw new SelectedProviderDeclineStateChangedError()
      }

      await tx.auditLog
        .create({
          data: {
            actorId: params.providerId,
            actorRole: 'provider',
            action: 'shortlist.selected_provider_declined',
            entityType: 'Lead',
            entityId: lead.id,
            after: { jobRequestId: lead.jobRequestId } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined)

      return { ok: true as const }
    })

    if (!transition.ok) {
      const currentLead = await db.lead.findUnique({
        where: { id: lead.id },
        select: { status: true },
      })
      if (currentLead?.status === 'DECLINED') {
        console.info('[provider-lead-action]', {
          leadId: lead.id,
          providerId: params.providerId,
          action: 'decline',
          result: 'idempotent',
          reason: 'ALREADY_DECLINED',
          source: 'provider_confirmation',
        })
        return {
          ok: true as const,
          alreadyDeclined: true as const,
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
        }
      }
      console.info('[provider-lead-action]', {
        leadId: lead.id,
        providerId: params.providerId,
        action: 'decline',
        result: 'blocked',
        reason: 'LEAD_ALREADY_ACCEPTED',
        source: 'provider_confirmation',
      })
      return { ok: false as const, reason: 'LEAD_ALREADY_ACCEPTED' as const }
    }
  } catch (error) {
    if (error instanceof SelectedProviderDeclineStateChangedError) {
      console.info('[provider-lead-action]', {
        leadId: lead.id,
        providerId: params.providerId,
        action: 'decline',
        result: 'blocked',
        reason: 'NOT_AWAITING_CONFIRMATION',
        source: 'provider_confirmation',
      })
      return { ok: false as const, reason: 'NOT_AWAITING_CONFIRMATION' as const }
    }
    throw error
  }

  console.info('[provider-lead-action]', {
    leadId: lead.id,
    providerId: params.providerId,
    action: 'decline',
    result: 'declined',
    source: 'provider_confirmation',
  })

  return {
    ok: true as const,
    leadId: lead.id,
    jobRequestId: lead.jobRequestId,
  }
}

export async function notifySelectedProvider(params: { leadId: string }): Promise<NotifySelectedProviderResult> {
  console.info('[customer-shortlists.notification] attempt', {
    leadId: params.leadId,
  })

  let leadRef:
    | { id: string; status: string; providerId: string; requestId: string }
    | null = null

  try {
    const lead = await db.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        status: true,
        notifiedAt: true,
        notificationAttemptedAt: true,
        providerId: true,
        expiresAt: true,
        jobRequest: {
          select: {
            id: true,
            status: true,
            category: true,
            selectedProviderId: true,
            selectedLeadInviteId: true,
            expiresAt: true,
            title: true,
            description: true,
            urgency: true,
            requestedWindowStart: true,
            requestedWindowEnd: true,
            _count: { select: { attachments: true } },
            address: {
              select: {
                suburb: true,
                city: true,
              },
            },
          },
        },
        provider: {
          select: {
            id: true,
            phone: true,
            active: true,
            status: true,
            name: true,
          },
        },
      },
    })

    if (!lead?.provider || !lead.jobRequest) {
      console.warn('[customer-shortlists.notification] lead not found or missing request/provider', {
        leadId: params.leadId,
      })
      return { sent: false, reason: 'not_found' }
    }

    leadRef = {
      id: lead.id,
      status: lead.status,
      providerId: lead.providerId,
      requestId: lead.jobRequest.id,
    }

    // Guard only on notifiedAt — status is CUSTOMER_SELECTED immediately after selection,
    // so checking status here would suppress every notification send.
    if (lead.notifiedAt !== null) {
      console.info('[customer-shortlists.notification] already_notified', {
        leadId: lead.id,
        requestId: lead.jobRequest.id,
      })
      return { sent: false, reason: 'already_notified' }
    }

    const now = new Date()
    const staleAttemptCutoff = new Date(
      now.getTime() - NOTIFICATION_ATTEMPT_TTL_MS,
    )
    if (
      (lead.expiresAt != null && lead.expiresAt <= now) ||
      (lead.jobRequest.expiresAt != null && lead.jobRequest.expiresAt <= now)
    ) {
      console.info('[customer-shortlists.notification] request_or_lead_expired', {
        leadId: lead.id,
        requestId: lead.jobRequest.id,
      })
      return { sent: false, reason: 'request_not_ready' }
    }

    if (
      lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING' ||
      lead.jobRequest.selectedLeadInviteId !== lead.id ||
      lead.jobRequest.selectedProviderId !== lead.providerId
    ) {
      console.info('[customer-shortlists.notification] not_selected', {
        leadId: lead.id,
        requestId: lead.jobRequest.id,
      })
      return { sent: false, reason: 'request_not_ready' }
    }

    if (
      lead.status === 'ACCEPTED' ||
      lead.status === 'ACCEPTED_LOCKED' ||
      lead.status === 'PROVIDER_ACCEPTED' ||
      lead.status === 'CREDIT_REQUIRED' ||
      lead.status === 'DECLINED' ||
      lead.status === 'EXPIRED' ||
      lead.status === 'CANCELLED'
    ) {
      console.info('[customer-shortlists.notification] terminal_status', {
        leadId: lead.id,
        status: lead.status,
      })
      return { sent: false, reason: 'not_applicable' }
    }

    // Reserve the lead for notification before sending any outbound message.
    // This avoids duplicate sends during repeated callback/retry windows.
    const notificationAttemptStartedAt = new Date()
    try {
      await db.lead.update({
        where: {
          id: lead.id,
          status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED'] },
          notifiedAt: null,
          OR: [
            { notificationAttemptedAt: null },
            { notificationAttemptedAt: { lt: staleAttemptCutoff } },
          ],
        },
        data: {
          notificationAttemptedAt: notificationAttemptStartedAt,
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        console.info('[customer-shortlists.notification] already_in_progress', {
          leadId: lead.id,
          providerId: lead.providerId,
          requestId: lead.jobRequest.id,
          status: lead.status,
        })
        return { sent: false, reason: 'already_notified' }
      }
      throw error
    }

    if (!lead.provider.active || lead.provider.status !== 'ACTIVE') {
      console.info('[customer-shortlists.notification] provider_not_active', {
        leadId: lead.id,
        providerId: lead.providerId,
      })
      return { sent: false, reason: 'provider_not_active' }
    }

    if (!lead.provider.phone) {
      console.info('[customer-shortlists.notification] missing_provider_phone', {
        leadId: lead.id,
        providerId: lead.providerId,
      })
      await db.lead.updateMany({
        where: {
          id: lead.id,
          notificationAttemptedAt: notificationAttemptStartedAt,
        },
        data: {
          notificationAttemptedAt: null,
        },
      })
      return { sent: false, reason: 'missing_provider_phone' }
    }

    const clearNotificationAttempt = () =>
      db.lead.updateMany({
        where: {
          id: lead.id,
          notificationAttemptedAt: notificationAttemptStartedAt,
        },
        data: {
          notificationAttemptedAt: null,
        },
      }).catch(() => undefined)

    const [balance, leadUrl] = await Promise.all([
      getProviderWalletBalanceReadOnly(lead.providerId),
      getProviderLeadAccessUrlByLeadId(lead.id),
    ])
    const remainingCredits = Math.max(0, balance.totalCreditBalance - 1)
    const area = lead.jobRequest.address?.suburb ?? lead.jobRequest.address?.city ?? null
    const body = buildProviderSelectedNotificationBody({
      category: lead.jobRequest.category,
      suburb: area,
      urgency: lead.jobRequest.urgency ?? null,
      title: lead.jobRequest.title,
      description: lead.jobRequest.description,
      requestedWindowStart: lead.jobRequest.requestedWindowStart,
      requestedWindowEnd: lead.jobRequest.requestedWindowEnd,
      attachmentCount: lead.jobRequest._count.attachments,
      balanceLabel: formatCredits(balance.totalCreditBalance),
      remainingCreditLabel: formatCredits(remainingCredits),
    })

    let notificationMessageId: string | null = null
    try {
      const sentMessageId = await sendButtons(
        lead.provider.phone,
        body,
        [
          { id: `confirm_accept:${lead.id}`, title: 'Accept job' },
          { id: `confirm_decline:${lead.id}`, title: 'Decline' },
        ],
        undefined,
        {
          templateName: 'interactive:provider_selected_for_confirmation',
          metadata: {
            leadId: lead.id,
            providerId: lead.providerId,
          },
        },
      )
      if (typeof sentMessageId === 'string') {
        notificationMessageId = sentMessageId
      }
    } catch (sendError) {
      console.warn(
        '[customer-shortlists.notification] send_buttons_failed',
        {
          leadId: lead.id,
          providerId: lead.providerId,
          requestId: lead.jobRequest.id,
          error: sendError instanceof Error ? sendError.message : 'unknown',
        },
      )
      await db.lead.updateMany({
        where: {
          id: lead.id,
          notificationAttemptedAt: notificationAttemptStartedAt,
        },
        data: {
          notificationAttemptedAt: null,
        },
      }).catch(() => undefined)
      return { sent: false, reason: 'send_failed' }
    }

    let ctaMessageId: string | null = null
    if (leadUrl) {
      const ctaDispatchResult = await sendCtaUrl(
        lead.provider.phone,
        'Open this offer in the app to review job details.',
        ctaLabelFor('generic_details'),
        leadUrl,
        undefined,
        {
          templateName: 'interactive:provider_selected_for_confirmation_cta',
          metadata: {
            leadId: lead.id,
            providerId: lead.providerId,
          },
        },
      ).catch((ctaError) => {
        console.warn(
          '[customer-shortlists] CTA URL message failed (non-fatal)',
          {
            leadId: lead.id,
            providerId: lead.providerId,
            error: ctaError instanceof Error ? ctaError.message : 'unknown',
          },
        )
      })
        if (typeof ctaDispatchResult === 'string') {
        ctaMessageId = ctaDispatchResult
      }
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.lead.update({
          where: {
            id: lead.id,
            status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED'] },
            notifiedAt: null,
            notificationAttemptedAt: notificationAttemptStartedAt,
          },
          data: {
            status: 'CUSTOMER_SELECTED',
            notifiedAt: new Date(),
            notificationAttemptedAt: null,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: lead.providerId,
            actorRole: 'provider',
            action: 'lead.provider_selected_notified',
            entityType: 'Lead',
            entityId: lead.id,
            after: {
              leadStatus: 'CUSTOMER_SELECTED',
              jobRequestId: lead.jobRequest.id,
              providerId: lead.providerId,
            } as Prisma.InputJsonValue,
          },
        }).catch(() => undefined)
      })
    } catch (error) {
      await clearNotificationAttempt()
      throw error
    }

    console.info('[customer-shortlists.notification] provider selected notification sent', {
      leadId: lead.id,
      providerId: lead.providerId,
      requestId: lead.jobRequest.id,
      whatsappMessageId: notificationMessageId,
      ctaMessageId,
    })

    return { sent: true }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025' &&
      leadRef != null
    ) {
      console.warn(
        '[customer-shortlists.notification] race_update_conflict',
        {
          leadId: leadRef.id,
          requestId: leadRef.requestId,
          providerId: leadRef.providerId,
          status: leadRef.status,
        },
      )
      return { sent: false, reason: 'already_notified' }
    }

    console.error(
      '[customer-shortlists] selected provider notification failed',
      {
        leadId: params.leadId,
        error,
      },
    )
    return {
      sent: false,
      reason: leadRef == null ? 'send_failed' : 'db_update_failed',
    }
  }
}

export async function selectProviderForCustomerRequest(params: {
  requestId: string
  customerId: string
  providerId: string
}) {
  const requestId = params.requestId?.trim()
  const providerId = params.providerId?.trim()

  if (!requestId) {
    logSelectionRejected('request_id_missing', {
      requestId: params.requestId,
    })
    throw new CustomerShortlistError('REQUEST_NOT_FOUND', 'Job request not found.')
  }
  if (!providerId) {
    logSelectionRejected('provider_id_missing', {
      requestId,
    })
    throw new CustomerShortlistError(
      'INVALID_PROVIDER_SELECTION',
      'Invalid provider selection.',
    )
  }

  console.info('[customer-shortlists.selection] attempt', {
    requestId,
    providerId,
  })

  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      expiresAt: true,
      status: true,
      latestDispatchDecisionId: true,
      selectedProviderId: true,
      selectedLeadInviteId: true,
      address: { select: { suburb: true } },
      leads: {
        where: { providerId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          dispatchDecisionId: true,
          matchAttemptId: true,
          matchScore: true,
          rankingPosition: true,
          customerSelectedAt: true,
          provider: {
            select: {
              id: true,
              active: true,
              status: true,
              verified: true,
              name: true,
              phone: true,
            },
          },
        },
      },
    },
  })

  if (!request) {
    throw new CustomerShortlistError(
      'REQUEST_NOT_FOUND',
      'Job request not found.',
    )
  }
  if (!request.customerId) {
    console.error('[customer-shortlists.selection] request_corrupt', {
      requestId,
    })
    throw new CustomerShortlistError(
      'INVALID_REQUEST_STATUS',
      'Request is missing required customer reference.',
    )
  }
  if (request.customerId !== params.customerId) {
    logSelectionRejected('request_forbidden', {
      requestId,
      customerId: params.customerId,
    })
    throw new CustomerShortlistError(
      'FORBIDDEN',
      'Not allowed to select a provider for this request.',
    )
  }

  // Idempotent path: the same provider is already selected for this request.
  // Covers both PROVIDER_CONFIRMATION_PENDING (normal flow) and PENDING_VALIDATION
  // (admin review hold) to prevent re-triggering provider notification on a repeat tap.
  if (
    (request.status === 'PROVIDER_CONFIRMATION_PENDING' ||
      request.status === 'PENDING_VALIDATION') &&
    request.selectedProviderId === providerId &&
    request.selectedLeadInviteId
  ) {
    return {
      requestId: request.id,
      providerId,
      leadId: request.selectedLeadInviteId,
      alreadySelected: true,
    }
  }

  if (!requestCanAcceptSelection(request.status)) {
    logSelectionRejected('request_not_ready', {
      requestId,
      requestStatus: request.status,
      providerId,
    })
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'This request is no longer awaiting selection.',
    )
  }
  if (request.expiresAt && request.expiresAt <= new Date()) {
    console.info('[customer-shortlists.selection] expired_request_rejected', {
      requestId,
      requestStatus: request.status,
      expiresAt: request.expiresAt.toISOString(),
    })
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'This request has expired.',
    )
  }

  // Prefer an existing selectable lead for this provider; older or completed
  // leads are ignored so we do not resurrect stale state when the customer
  // re-opens this flow.
  let selectedLead: ProviderSelectionLead | null =
    request.leads
      .filter(
        (lead) =>
          Boolean(lead.provider) && isLeadSelectableForFinalSelection(lead.status),
      )
      .map((lead) => ({
        ...lead,
        provider: {
          id: lead.provider.id,
          active: lead.provider.active,
          status: lead.provider.status,
          verified: lead.provider.verified,
          name: lead.provider.name ?? 'Provider',
          phone: lead.provider.phone,
        },
      }))[0] ?? null

  // If we already have a lead for this provider, use that path first.
  // If there is no lead row yet, ensure the provider is in ranked matches and
  // creation now happens inside the selection transaction to keep lead and request
  // state updates in one atomic unit.
  let rankedMatch: {
    id: string
    score: number | null
    rankedPosition: number | null
    provider: {
      id: string
      active: boolean
      status: string
      verified: boolean | null
      name: string | null
      phone: string | null
    } | null
  } | null = null

      if (!selectedLead && request.latestDispatchDecisionId) {
    rankedMatch = await db.matchAttempt.findFirst({
      where: {
        dispatchDecisionId: request.latestDispatchDecisionId,
        providerId,
        stage: 'RANKED',
      },
      include: {
        provider: {
          select: {
            id: true,
            active: true,
            status: true,
            verified: true,
            name: true,
            phone: true,
          },
        },
      },
    })
  }

  if (!selectedLead && !rankedMatch) {
    throw new CustomerShortlistError(
      'ITEM_NOT_FOUND',
      'Could not resolve a selected provider lead.',
    )
  }

  if (
    selectedLead &&
    (!selectedLead.provider.active || selectedLead.provider.status !== 'ACTIVE')
  ) {
    throw new CustomerShortlistError(
      'INVALID_PROVIDER_SELECTION',
      'This provider is no longer active.',
    )
  }

  const selectedAt = new Date()
  // Keep lead response window deterministic and short-lived so providers cannot
  // accept a stale lead after long delays.
  const leadExpiryTs = new Date(
    selectedAt.getTime() + PROVIDER_CONFIRMATION_WINDOW_MS,
  )
  if (
    !selectedLead &&
    (!rankedMatch?.provider?.active || rankedMatch?.provider.status !== 'ACTIVE')
  ) {
    throw new CustomerShortlistError(
      'INVALID_PROVIDER_SELECTION',
      'This provider is no longer available.',
    )
  }

  let result: {
    requestId: string
    providerId: string
    leadId: string
    alreadySelected: boolean
  }

  try {
    result = await db.$transaction(async (tx) => {
      const reloaded = await tx.jobRequest.findUnique({
        where: { id: request.id },
        select: {
          status: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
          latestDispatchDecisionId: true,
        },
      })

    if (!reloaded) {
      throw new CustomerShortlistError(
        'REQUEST_NOT_FOUND',
        'Job request not found while confirming selection.',
      )
    }

    // Guard against concurrent selection: another request may have committed
    // PROVIDER_CONFIRMATION_PENDING between our pre-transaction checks and now.
    // selectedLead may still be null here (no existing lead row pre-transaction),
    // so we fall back to reloaded.selectedLeadInviteId for the idempotent return.
    // Re-check provider availability inside the transaction so we cannot select
    // a provider that was deactivated after the request was read.
    const matchedProvider = await tx.provider.findUnique({
      where: { id: providerId },
      select: { id: true, active: true, status: true },
    })
    if (!matchedProvider) {
      logSelectionRejected('provider_missing_in_tx', {
        requestId,
        providerId,
      })
      throw new CustomerShortlistError(
        'INVALID_PROVIDER_SELECTION',
        'The selected provider is no longer available.',
      )
    }
    if (!matchedProvider.active || matchedProvider.status !== 'ACTIVE') {
      logSelectionRejected('provider_not_active_in_tx', {
        requestId,
        providerId,
        active: matchedProvider.active,
        status: matchedProvider.status,
      })
      throw new CustomerShortlistError(
        'INVALID_PROVIDER_SELECTION',
        'This provider is no longer active.',
      )
    }

    if (reloaded.status === 'PROVIDER_CONFIRMATION_PENDING') {
      if (reloaded.selectedProviderId !== providerId) {
        throwDuplicateSelectionError(
          'A provider has already been selected for this request.',
        )
      }
      if (!reloaded.selectedLeadInviteId) {
        throw new CustomerShortlistError(
          'ITEM_NOT_FOUND',
          'Could not resolve the selected lead for this request.',
        )
      }
      const leadId = selectedLead?.id ?? reloaded.selectedLeadInviteId
      return {
        requestId: request.id,
        providerId,
        leadId,
        alreadySelected: true,
      }
    }

    if (!requestCanAcceptSelection(reloaded.status)) {
      throwDuplicateSelectionError(
        'This request is no longer awaiting customer selection.',
      )
    }

    if (!selectedLead && reloaded.latestDispatchDecisionId && rankedMatch) {
      // Guard provider presence before the write to avoid a wasted upsert
      // that would immediately roll back.
      if (!rankedMatch.provider) {
        throw new CustomerShortlistError(
          'ITEM_NOT_FOUND',
          'Could not resolve selected provider profile.',
        )
      }

        const now = new Date()
        const upserted = await tx.lead.upsert({
        where: {
          jobRequestId_providerId: {
            jobRequestId: request.id,
            providerId: params.providerId,
          },
        },
        create: {
          jobRequestId: request.id,
          providerId: params.providerId,
          dispatchDecisionId: reloaded.latestDispatchDecisionId,
          matchAttemptId: rankedMatch.id,
          status: 'VIEWED',
          sentAt: now,
          viewedAt: now,
          // Always give a bounded response window once the customer selects.
          expiresAt: leadExpiryTs,
          matchScore: rankedMatch.score,
          rankingPosition: rankedMatch.rankedPosition,
        },
        update: {
          dispatchDecisionId: reloaded.latestDispatchDecisionId,
          matchAttemptId: rankedMatch.id,
          status: 'VIEWED',
          viewedAt: now,
          // Refresh the selection window to avoid stale/indefinite response windows
          // when a customer re-runs selection for a valid lead row.
          expiresAt: leadExpiryTs,
          matchScore: rankedMatch.score,
          rankingPosition: rankedMatch.rankedPosition,
        },
      })

      selectedLead = {
        id: upserted.id,
        status: upserted.status,
        dispatchDecisionId: upserted.dispatchDecisionId,
        matchAttemptId: upserted.matchAttemptId,
        matchScore: upserted.matchScore,
        rankingPosition: upserted.rankingPosition,
        customerSelectedAt: upserted.customerSelectedAt,
        expiresAt: upserted.expiresAt,
        provider: {
          id: rankedMatch.provider.id,
          active: rankedMatch.provider.active,
          status: rankedMatch.provider.status,
          verified: rankedMatch.provider.verified ?? true,
          name: rankedMatch.provider.name ?? 'Provider',
          phone: rankedMatch.provider.phone,
        },
      }

      console.info('[customer-shortlists.selection] lead_upserted', {
        requestId: request.id,
        providerId: params.providerId,
        leadId: selectedLead.id,
      })
    }

    // If latestDispatchDecisionId was cleared between the outer fetch and the
    // in-transaction re-read, selectedLead may still be null. Throw a typed
    // error rather than letting the ! assertions below produce a cryptic TypeError.
    if (!selectedLead) {
      throw new CustomerShortlistError(
        'ITEM_NOT_FOUND',
        'Could not resolve a lead for the selected provider after concurrent update.',
      )
    }

    await tx.jobRequest.update({
      where: { id: request.id },
      data: {
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: providerId,
        selectedLeadInviteId: selectedLead.id,
      },
    })

    await tx.lead.update({
      where: { id: selectedLead.id },
      data: {
        // Refresh the response window on selection to prevent stale lead expiries.
        customerSelectedAt: selectedAt,
        expiresAt: leadExpiryTs,
      },
    })

    await tx.providerShortlistItem.updateMany({
      where: {
        shortlist: { requestId: request.id, status: 'PUBLISHED' },
        providerId,
      },
      data: { customerSelectedAt: selectedAt },
    })

    await tx.auditLog
      .create({
        data: {
          actorId: params.customerId,
            actorRole: 'customer',
          action: 'shortlist.provider_selected',
          entityType: 'JobRequest',
          entityId: request.id,
          after: {
            providerId,
            leadInviteId: selectedLead.id,
            selectedAt: selectedAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)

      return {
        requestId: request.id,
        providerId,
        leadId: selectedLead!.id,
        alreadySelected: false,
      }
    })
  } catch (error) {
    console.error('[customer-shortlists.selection] transaction_failed', {
      requestId,
      providerId,
      error: error instanceof Error ? error.message : 'unknown',
    })
    throw error
  }

  console.info('[customer-shortlists.selection] completed', {
    requestId: result.requestId,
    providerId: result.providerId,
    leadId: result.leadId,
  })

  if (result.alreadySelected) {
    console.info('[customer-shortlists.selection] already_selected', {
      requestId: result.requestId,
      providerId: result.providerId,
      leadId: result.leadId,
    })
    const notification = await notifySelectedProvider({
      leadId: result.leadId,
    })
    return { ...result, notification }
  }

  console.info('[customer-shortlists.selection] success', {
    requestId: result.requestId,
    providerId: result.providerId,
    leadId: result.leadId,
  })
  const notification = await notifySelectedProvider({
    leadId: result.leadId,
  })

  return { ...result, notification }
}
