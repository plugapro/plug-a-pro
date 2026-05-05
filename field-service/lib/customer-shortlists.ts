import { Prisma } from '@prisma/client'
import { db } from './db'
import { getJobRequestAccessUrl } from './job-request-access'
import { getProviderLeadAccessUrlByLeadId } from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'
import { sendText } from './whatsapp'
import { sendButtons, sendCtaUrl } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'

export class CustomerShortlistError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'SHORTLIST_EMPTY'
      | 'SHORTLIST_NOT_FOUND'
      | 'ITEM_NOT_FOUND'
      | 'ITEM_NOT_SELECTABLE'
      | 'REQUEST_NOT_AWAITING_SELECTION',
    message: string,
  ) {
    super(message)
    this.name = 'CustomerShortlistError'
  }
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return null
  return Number(value)
}

function formatCredits(value: number) {
  return `${value} credit${value === 1 ? '' : 's'}`
}

export async function generateCustomerShortlistForRequest(requestId: string, limit = 5) {
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
    throw new CustomerShortlistError('REQUEST_NOT_FOUND', 'Job request not found.')
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
    throw new CustomerShortlistError('SHORTLIST_EMPTY', 'No interested providers are ready for shortlist.')
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

  await notifyCustomerShortlistReady({
    requestId: request.id,
    customerPhone: request.customer?.phone ?? null,
    category: request.category,
    suburb: request.address?.suburb ?? null,
    city: request.address?.city ?? null,
    optionCount: shortlist.items.length,
  }).catch((error) => {
    console.error('[customer-shortlists] shortlist-ready notification failed', {
      requestId,
      error,
    })
  })

  return shortlist
}

async function notifyCustomerShortlistReady(params: {
  requestId: string
  customerPhone: string | null
  category: string
  suburb: string | null
  city: string | null
  optionCount: number
}) {
  if (!params.customerPhone) return { sent: false as const, reason: 'no_customer_phone' }
  const ticketUrl = await getJobRequestAccessUrl(params.requestId, 'shortlist').catch(() => null)
  const area = [params.suburb, params.city].filter(Boolean).join(', ')
  await sendText({
    to: params.customerPhone,
    text:
      `Your ${params.category} shortlist is ready\n\n` +
      `${params.optionCount} suitable provider${params.optionCount === 1 ? '' : 's'} in ${area || 'your area'} responded with their call-out fee and earliest arrival.\n\n` +
      `You can compare providers before choosing.\n\n` +
      `Choose the provider you'd like for this job. Your phone number and exact address will only be shared after you select a provider and they accept.` +
      (ticketUrl ? `\n\nProvider selection is available below.` : ''),
    templateName: 'interactive:client_shortlist_ready',
    metadata: { requestId: params.requestId },
  })
  if (ticketUrl) {
    await sendCtaUrl(
      params.customerPhone,
      'Provider selection is available below.',
      ctaLabelFor('generic_details'),
      ticketUrl,
      undefined,
      { templateName: 'interactive:client_shortlist_ready_cta', metadata: { requestId: params.requestId } },
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
        callOutFee: decimalToNumber(item.displayCallOutFee ?? response?.callOutFee),
        estimatedArrivalAt: item.displayArrivalTime ?? response?.estimatedArrivalAt ?? null,
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
  const item = await db.providerShortlistItem.findUnique({
    where: { id: params.shortlistItemId },
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

  if (!item || item.shortlist.requestId !== params.requestId) {
    throw new CustomerShortlistError('ITEM_NOT_FOUND', 'Shortlist provider was not found.')
  }
  if (item.shortlist.status !== 'PUBLISHED' || item.leadInvite.status === 'EXPIRED') {
    throw new CustomerShortlistError('ITEM_NOT_SELECTABLE', 'This provider is no longer selectable.')
  }

  // Selection is only allowed while the request is awaiting customer selection.
  // Once it advances (provider confirmation pending, matched, etc.) re-selection
  // would silently overwrite the prior choice and re-notify a different
  // provider. The DB unique on selectedLeadInviteId prevents the same lead
  // being selected twice across requests, but does not prevent overwriting on
  // the same request.
  const requestStatus = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { status: true },
  })
  if (!requestStatus) {
    throw new CustomerShortlistError('ITEM_NOT_FOUND', 'Shortlist provider was not found.')
  }
  if (requestStatus.status !== 'SHORTLIST_READY') {
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'This request is no longer awaiting customer selection.',
    )
  }

  const selectedAt = new Date()
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

    await tx.auditLog.create({
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
    }).catch(() => undefined)

    return selectedItem
  })

  const notification = await notifySelectedProvider({
    leadId: item.leadInviteId,
    providerId: item.providerId,
    providerPhone: item.provider.phone,
    providerName: item.provider.name,
    category: item.leadInvite.jobRequest.category,
    suburb: item.leadInvite.jobRequest.address?.suburb ?? null,
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
export async function cancelRequestFromShortlist(params: { requestId: string }) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, status: true },
  })
  if (!request) {
    throw new CustomerShortlistError('REQUEST_NOT_FOUND', 'Job request not found.')
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
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', cancelledAt: new Date(), respondedAt: new Date() },
    })
    await tx.jobRequest.update({
      where: { id: params.requestId },
      data: {
        status: 'CANCELLED',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: 'customer-access-link',
        actorRole: 'customer',
        action: 'shortlist.request_cancelled',
        entityType: 'JobRequest',
        entityId: params.requestId,
        after: {} as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)
  })

  return { ok: true as const }
}

/**
 * Customer asks for more shortlist options. We mark the current shortlist as
 * superseded and reset the request to MATCHING so the dispatch pipeline can
 * fan out to additional providers. Existing interested responses remain valid
 * and will be re-included in the next shortlist generation.
 */
export async function requestMoreShortlistOptions(params: { requestId: string }) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, status: true },
  })
  if (!request) {
    throw new CustomerShortlistError('REQUEST_NOT_FOUND', 'Job request not found.')
  }
  if (request.status !== 'SHORTLIST_READY') {
    throw new CustomerShortlistError(
      'REQUEST_NOT_AWAITING_SELECTION',
      'More options can only be requested while the shortlist is awaiting selection.',
    )
  }

  await db.$transaction(async (tx) => {
    await tx.providerShortlist.updateMany({
      where: { requestId: params.requestId, status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    })
    await tx.jobRequest.update({
      where: { id: params.requestId },
      data: { status: 'MATCHING' },
    })
    await tx.auditLog.create({
      data: {
        actorId: 'customer-access-link',
        actorRole: 'customer',
        action: 'shortlist.more_options_requested',
        entityType: 'JobRequest',
        entityId: params.requestId,
        after: {} as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)
  })

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
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      jobRequest: {
        select: { id: true, status: true, selectedProviderId: true, selectedLeadInviteId: true },
      },
    },
  })

  if (!lead) return { ok: false as const, reason: 'NOT_FOUND' as const }
  if (lead.providerId !== params.providerId) {
    return { ok: false as const, reason: 'FORBIDDEN' as const }
  }
  if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING'
      || lead.jobRequest.selectedLeadInviteId !== lead.id) {
    return { ok: false as const, reason: 'NOT_AWAITING_CONFIRMATION' as const }
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    })

    // Mark the corresponding shortlist item as superseded by clearing the
    // customer-selected timestamp so the customer can pick again. We do not
    // delete the shortlist itself.
    await tx.providerShortlistItem.updateMany({
      where: { leadInviteId: lead.id },
      data: { customerSelectedAt: null },
    })

    // Reset request state. selectedLeadInviteId/selectedProviderId are cleared
    // so the customer can re-select another provider from the same shortlist.
    await tx.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: {
        status: 'SHORTLIST_READY',
        selectedProviderId: null,
        selectedLeadInviteId: null,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: params.providerId,
        actorRole: 'provider',
        action: 'shortlist.selected_provider_declined',
        entityType: 'Lead',
        entityId: lead.id,
        after: { jobRequestId: lead.jobRequestId } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)
  })

  return { ok: true as const, leadId: lead.id, jobRequestId: lead.jobRequestId }
}

async function notifySelectedProvider(params: {
  leadId: string
  providerId: string
  providerPhone: string
  providerName: string
  category: string
  suburb: string | null
}) {
  try {
    const [balance, leadUrl] = await Promise.all([
      getProviderWalletBalanceReadOnly(params.providerId),
      getProviderLeadAccessUrlByLeadId(params.leadId),
    ])
    const remainingCredits = Math.max(0, balance.totalCreditBalance - 1)
    const area = params.suburb ? ` in ${params.suburb}` : ''
    const linkLine = leadUrl ? `\n\nOpen job: ${leadUrl}` : ''

    const body =
      `Customer selected you\n\n` +
      `The customer selected you for this ${params.category} job${area}.\n\n` +
      `Accepting this job uses 1 credit.\n\n` +
      `Available balance: ${formatCredits(balance.totalCreditBalance)}\n` +
      `After acceptance: ${formatCredits(remainingCredits)}${linkLine}`

    await sendButtons(
      params.providerPhone,
      body,
      [
        { id: `confirm_accept:${params.leadId}`, title: 'Accept job' },
        { id: `confirm_decline:${params.leadId}`, title: 'Decline' },
      ],
      undefined,
      {
        templateName: 'interactive:provider_selected_for_confirmation',
        metadata: {
          leadId: params.leadId,
          providerId: params.providerId,
        },
      },
    )

    return { sent: true as const }
  } catch (error) {
    console.error('[customer-shortlists] selected provider notification failed', {
      leadId: params.leadId,
      providerId: params.providerId,
      error,
    })
    return { sent: false as const }
  }
}
