import { db } from './db'
import type { LeadStatus } from '@prisma/client'
import { rankCandidatesForJobRequest } from './matching/service'
import { getReviewProviderProfileUrl } from './review-provider-profile-access'
import { sendButtons, sendCtaUrl, sendText } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'
import { buildProviderLeadActionsMessage, buildProviderLeadPreviewMessage } from './provider-credit-copy'
import { getProviderLeadAccessUrl } from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'
import { normaliseLocationDisplayName } from './location-format'

export const RFP_PROVIDER_RESPONSE_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.RFP_PROVIDER_RESPONSE_MINUTES ?? '15', 10) || 15,
)
export const MAX_PROVIDER_REVIEW_BATCHES = Math.max(
  1,
  Number.parseInt(process.env.MAX_PROVIDER_REVIEW_BATCHES ?? '3', 10) || 3,
)
export const MAX_SHORTLISTED_PROVIDERS = Math.max(
  1,
  Number.parseInt(process.env.MAX_SHORTLISTED_PROVIDERS ?? '3', 10) || 3,
)
export const MIN_SHORTLISTED_PROVIDERS = Math.max(
  1,
  Number.parseInt(process.env.MIN_SHORTLISTED_PROVIDERS ?? '1', 10) || 1,
)
const PROVIDERS_PER_BATCH = 3

export class ReviewFirstError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'FORBIDDEN'
      | 'NO_CANDIDATES'
      | 'PROVIDER_NOT_ELIGIBLE'
      | 'SHORTLIST_LIMIT_REACHED'
      | 'SHORTLIST_EMPTY'
      | 'REQUEST_NOT_READY'
      | 'INVALID_BATCH',
    message: string,
  ) {
    super(message)
    this.name = 'ReviewFirstError'
  }
}

async function ensureReviewRankingDecision(params: {
  requestId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      status: true,
      category: true,
      assignmentMode: true,
      latestDispatchDecisionId: true,
      customer: { select: { phone: true } },
      address: { select: { suburb: true, city: true } },
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')

  const existingDecision = request.latestDispatchDecisionId
    ? await db.dispatchDecision.findUnique({
        where: { id: request.latestDispatchDecisionId },
        select: { id: true, status: true, mode: true },
      })
    : null

  if (existingDecision && existingDecision.mode === 'OPS_REVIEW' && existingDecision.status === 'RANKED') {
    return existingDecision.id
  }

  const ranking = await rankCandidatesForJobRequest(request.id)

  const rankingSummary = ranking.candidates.map((candidate, index) => ({
    providerId: candidate.providerId,
    score: candidate.score,
    rankedPosition: index + 1,
    selectionReason: candidate.selectionReason,
    travelMinutes: candidate.travelMinutes,
    canMeetWindow: candidate.canMeetWindow,
  }))

  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId: request.id,
      mode: 'OPS_REVIEW',
      status: ranking.candidates.length > 0 ? 'RANKED' : 'NO_MATCH',
      initiatedById: 'customer-review-first',
      initiatedByRole: 'customer',
      consideredCount: ranking.consideredCount,
      eligibleCount: ranking.eligibleCount,
      rankingSummary: rankingSummary as object[],
      filterSummary: ranking.filteredOut as object[],
      explanation: ranking.candidates[0]?.selectionReason ?? 'No eligible providers passed filters.',
    },
  })

  for (const [index, candidate] of ranking.candidates.entries()) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: request.id,
        providerId: candidate.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: index + 1,
        rankedPosition: index + 1,
        stage: 'RANKED',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: candidate.feasibilityNotes,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown as object,
      },
    })
  }

  await db.jobRequest.update({
    where: { id: request.id },
    data: {
      latestDispatchDecisionId: decision.id,
      assignmentMode: 'OPS_REVIEW',
      status: 'PENDING_VALIDATION',
    },
  })

  if (request.customer?.phone) {
    if (ranking.candidates.length === 0) {
      await sendText(
        request.customer.phone,
        `We couldn't find matching providers in your area right now.\n\nYou can try Quick Match, edit your request, or return to the main menu.`,
        {
          templateName: 'interactive:review_first_no_candidates',
          metadata: { requestId: request.id },
        },
      ).catch(() => undefined)
    } else {
      const area = [request.address?.suburb, request.address?.city].filter(Boolean).join(', ')
      await sendText(
        request.customer.phone,
        `Here are providers who may match your request.\n\nView their profiles and shortlist the ones you like.${area ? `\n\nArea: ${area}` : ''}`,
        {
          templateName: 'interactive:review_first_candidates_ready',
          metadata: { requestId: request.id, count: ranking.candidates.length },
        },
      ).catch(() => undefined)
    }
  }

  return decision.id
}

export async function getProviderCandidatesForCustomerReview(params: {
  requestId: string
  customerId: string
  batch?: number
}) {
  const batch = params.batch ?? 1
  if (batch < 1 || batch > MAX_PROVIDER_REVIEW_BATCHES) {
    throw new ReviewFirstError('INVALID_BATCH', 'Invalid provider batch.')
  }

  const ownerCheck = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, customerId: true },
  })
  if (!ownerCheck) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (ownerCheck.customerId !== params.customerId) {
    throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')
  }

  const decisionId = await ensureReviewRankingDecision({ requestId: params.requestId })
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      category: true,
      customer: { select: { phone: true } },
      leads: {
        select: { providerId: true, status: true },
      },
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')

  const ranked = await db.matchAttempt.findMany({
    where: {
      dispatchDecisionId: decisionId,
      stage: 'RANKED',
    },
    orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          bio: true,
          experience: true,
          skills: true,
          serviceAreas: true,
          avatarUrl: true,
          verified: true,
          averageRating: true,
          completedJobsCount: true,
          portfolioUrls: true,
          providerRates: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: {
              callOutFee: true,
              hourlyRate: true,
              rateNegotiable: true,
            },
          },
        },
      },
    },
  })

  const engagedProviderIds = new Set(
    request.leads
      .filter((lead) => lead.status === 'SHORTLISTED' || lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'INTERESTED')
      .map((lead) => lead.providerId),
  )
  const availableCandidates = ranked.filter((attempt) => !engagedProviderIds.has(attempt.providerId))

  const offset = (batch - 1) * PROVIDERS_PER_BATCH
  const selected = availableCandidates.slice(offset, offset + PROVIDERS_PER_BATCH)

  const candidates = selected.map((attempt, index) => {
    const rate = attempt.provider.providerRates[0] ?? null
    return {
      providerId: attempt.provider.id,
      rank: offset + index + 1,
      name: attempt.provider.name,
      bio: attempt.provider.bio,
      experience: attempt.provider.experience,
      skills: attempt.provider.skills,
      serviceAreas: attempt.provider.serviceAreas,
      avatarUrl: attempt.provider.avatarUrl,
      verified: attempt.provider.verified,
      averageRating: attempt.provider.averageRating,
      completedJobsCount: attempt.provider.completedJobsCount,
      portfolioUrls: attempt.provider.portfolioUrls,
      callOutFee: rate?.callOutFee ? Number(rate.callOutFee) : null,
      hourlyRate: rate?.hourlyRate ? Number(rate.hourlyRate) : null,
      negotiable: rate?.rateNegotiable ?? true,
      whyMatched: attempt.feasibilityNotes?.[0] ?? 'Strong match for your service area and request details.',
      profileUrl: getReviewProviderProfileUrl({
        requestId: request.id,
        providerId: attempt.provider.id,
      }),
    }
  })

  return {
    requestId: request.id,
    batch,
    hasMore: offset + PROVIDERS_PER_BATCH < availableCandidates.length && batch < MAX_PROVIDER_REVIEW_BATCHES,
    candidates,
  }
}

export async function shortlistProviderForCustomerReview(params: {
  requestId: string
  customerId: string
  providerId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      latestDispatchDecisionId: true,
      category: true,
      status: true,
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) {
    throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')
  }
  if (!request.latestDispatchDecisionId) {
    throw new ReviewFirstError('REQUEST_NOT_READY', 'Provider options are not ready yet.')
  }

  const rankedCandidate = await db.matchAttempt.findFirst({
    where: {
      dispatchDecisionId: request.latestDispatchDecisionId,
      providerId: params.providerId,
      stage: 'RANKED',
    },
    select: {
      id: true,
      score: true,
      rankedPosition: true,
    },
  })
  if (!rankedCandidate) {
    throw new ReviewFirstError('PROVIDER_NOT_ELIGIBLE', 'Provider is not eligible for this request.')
  }

  const shortlistLeadStatuses: LeadStatus[] = ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED']
  const shortlistCount = await db.lead.count({
    where: {
      jobRequestId: request.id,
      status: { in: shortlistLeadStatuses },
    },
  })

  const existingLead = await db.lead.findUnique({
    where: {
      jobRequestId_providerId: {
        jobRequestId: request.id,
        providerId: params.providerId,
      },
    },
    select: {
      id: true,
      status: true,
    },
  })

  if (!existingLead && shortlistCount >= MAX_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_LIMIT_REACHED', `You can shortlist up to ${MAX_SHORTLISTED_PROVIDERS} providers.`)
  }

  const lead = await db.lead.upsert({
    where: {
      jobRequestId_providerId: {
        jobRequestId: request.id,
        providerId: params.providerId,
      },
    },
    create: {
      jobRequestId: request.id,
      providerId: params.providerId,
      dispatchDecisionId: request.latestDispatchDecisionId,
      matchAttemptId: rankedCandidate.id,
      status: 'SHORTLISTED',
      matchScore: rankedCandidate.score ?? null,
      rankingPosition: rankedCandidate.rankedPosition ?? null,
      expiresAt: null,
    },
    update: {
      status: existingLead?.status === 'SHORTLISTED' || existingLead?.status === 'SENT' || existingLead?.status === 'VIEWED' || existingLead?.status === 'INTERESTED'
        ? existingLead.status
        : 'SHORTLISTED',
      dispatchDecisionId: request.latestDispatchDecisionId,
      matchAttemptId: rankedCandidate.id,
      matchScore: rankedCandidate.score ?? null,
      rankingPosition: rankedCandidate.rankedPosition ?? null,
      expiresAt: null,
    },
  })

  const shortlist = await db.$transaction(async (tx) => {
    // Serialize DRAFT shortlist creation per request to avoid concurrent
    // duplicate draft rows when two shortlist actions race.
    // This lock is transaction-scoped and auto-released on commit/rollback.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`provider_shortlist_draft:${request.id}`}))`

    const existing = await tx.providerShortlist.findFirst({
      where: { requestId: request.id, status: 'DRAFT' },
      select: { id: true },
    })
    if (existing) return existing
    return tx.providerShortlist.create({
      data: { requestId: request.id, status: 'DRAFT' },
      select: { id: true },
    })
  })

  await db.providerShortlistItem.upsert({
    where: {
      shortlistId_leadInviteId: {
        shortlistId: shortlist.id,
        leadInviteId: lead.id,
      },
    },
    create: {
      shortlistId: shortlist.id,
      leadInviteId: lead.id,
      providerId: params.providerId,
      rank: rankedCandidate.rankedPosition ?? 999,
      matchScore: rankedCandidate.score ?? null,
    },
    update: {},
  })

  const provider = await db.provider.findUnique({
    where: { id: params.providerId },
    select: { id: true, name: true },
  })

  return {
    requestId: request.id,
    providerId: params.providerId,
    providerName: provider?.name ?? 'Provider',
    leadId: lead.id,
  }
}

export async function getCustomerReviewShortlist(params: { requestId: string; customerId: string }) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, customerId: true },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')

  const leads = await db.lead.findMany({
    where: {
      jobRequestId: params.requestId,
      status: {
        in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'ACCEPTED'],
      },
    },
    orderBy: [{ rankingPosition: 'asc' }, { sentAt: 'asc' }],
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          verified: true,
        },
      },
      providerResponses: {
        where: { response: 'INTERESTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  return {
    requestId: params.requestId,
    providers: leads.map((lead) => {
      const response = lead.providerResponses[0] ?? null
      return {
        providerId: lead.providerId,
        leadId: lead.id,
        name: lead.provider.name,
        verified: lead.provider.verified,
        status: lead.status,
        callOutFee: response?.callOutFee ? Number(response.callOutFee) : null,
        estimatedArrivalAt: response?.estimatedArrivalAt ?? null,
        providerNote: response?.providerNote ?? null,
      }
    }),
  }
}

export async function sendRequestToShortlistedProviders(params: {
  requestId: string
  customerId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
      subcategory: true,
      urgency: true,
      requestedWindowStart: true,
      requestedArrivalLatest: true,
      providerPreference: true,
      budgetPreference: true,
      requestRef: true,
      address: { select: { suburb: true, city: true, province: true } },
      customer: { select: { phone: true } },
      leads: {
        where: {
          status: { in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED'] },
        },
        include: {
          provider: { select: { id: true, phone: true, name: true } },
        },
        orderBy: [{ rankingPosition: 'asc' }, { sentAt: 'asc' }],
      },
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')

  const shortlisted = request.leads.filter((lead) => lead.status === 'SHORTLISTED')
  const alreadySent = request.leads.filter((lead) => lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'INTERESTED')
  const activeTargets = shortlisted.length > 0 ? shortlisted : alreadySent

  if (activeTargets.length < MIN_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_EMPTY', `Please shortlist at least ${MIN_SHORTLISTED_PROVIDERS} provider first.`)
  }
  if (activeTargets.length > MAX_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_LIMIT_REACHED', `You can shortlist up to ${MAX_SHORTLISTED_PROVIDERS} providers.`)
  }

  const expiresAt = new Date(Date.now() + RFP_PROVIDER_RESPONSE_MINUTES * 60_000)
  const deadlineTime = expiresAt.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
  const preferredTime = request.requestedWindowStart
    ? request.requestedWindowStart.toLocaleString('en-ZA', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Johannesburg',
      })
    : request.requestedArrivalLatest
      ? `Before ${request.requestedArrivalLatest.toLocaleString('en-ZA', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        })}`
      : 'Flexible'

  const area = [request.address?.suburb, request.address?.city].filter(Boolean).join(', ')

  await db.jobRequest.update({
    where: { id: request.id },
    data: {
      status: 'MATCHING',
      assignmentMode: 'OPS_REVIEW',
    },
  })

  for (const lead of activeTargets) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        expiresAt,
        respondedAt: null,
        viewedAt: null,
      },
    })

    const balance = await getProviderWalletBalanceReadOnly(lead.provider.id).catch(() => ({
      totalCreditBalance: 0,
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    }))
    const body = buildProviderLeadPreviewMessage({
      category: request.category,
      area: area || 'your area',
      city: request.address?.city ?? null,
      province: request.address?.province ?? null,
      preferredTime,
      deadlineTime,
      responseWindowMinutes: RFP_PROVIDER_RESPONSE_MINUTES,
      balance,
      title: request.title,
      description: request.description,
      subcategory: request.subcategory,
      urgency: request.urgency,
      matchingPreference: request.providerPreference ?? request.budgetPreference,
    })
    const actionsBody = buildProviderLeadActionsMessage({
      category: request.category,
      area: area || 'your area',
      balance,
    })

    await sendText(
      lead.provider.phone,
      `You've been selected to respond to a customer request.\n\nRef: ${request.requestRef ?? request.id.slice(-8).toUpperCase()}`,
      {
        templateName: 'interactive:rfp_provider_selected',
        metadata: { requestId: request.id, leadId: lead.id },
      },
    ).catch(() => undefined)

    const leadUrl = await getProviderLeadAccessUrl({
      leadId: lead.id,
      providerId: lead.provider.id,
    })

    if (leadUrl) {
      await sendCtaUrl(
        lead.provider.phone,
        body,
        ctaLabelFor('generic_details'),
        leadUrl,
        undefined,
        {
          templateName: 'interactive:rfp_provider_preview_cta',
          metadata: { requestId: request.id, leadId: lead.id, providerId: lead.provider.id },
        },
      ).catch(() => undefined)
    }

    await sendButtons(
      lead.provider.phone,
      actionsBody,
      [
        { id: `interested:${lead.id}`, title: "I'm available" },
        { id: `not_interested:${lead.id}`, title: 'Not available' },
      ],
      undefined,
      {
        templateName: 'interactive:rfp_provider_response_buttons',
        metadata: { requestId: request.id, leadId: lead.id, providerId: lead.provider.id },
      },
    ).catch(() => undefined)
  }

  if (request.customer?.phone) {
    await sendText(
      request.customer.phone,
      `Your request has been sent to ${activeTargets.length} selected provider${activeTargets.length === 1 ? '' : 's'}.\n\nThey have ${RFP_PROVIDER_RESPONSE_MINUTES} minutes to respond. We'll update you as responses come in.`,
      {
        templateName: 'interactive:rfp_sent_to_shortlist',
        metadata: { requestId: request.id, count: activeTargets.length },
      },
    ).catch(() => undefined)
  }

  return {
    requestId: request.id,
    invitedCount: activeTargets.length,
    expiresAt,
  }
}

export async function notifyCustomerRfpResponseSummary(requestId: string) {
  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      customer: { select: { phone: true } },
      leads: {
        where: {
          status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'DECLINED', 'EXPIRED', 'CUSTOMER_SELECTED', 'ACCEPTED'] },
        },
        select: {
          id: true,
          status: true,
          provider: { select: { name: true } },
          providerResponses: {
            where: { response: 'INTERESTED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              callOutFee: true,
              estimatedArrivalAt: true,
              providerNote: true,
            },
          },
        },
      },
    },
  })
  if (!request?.customer?.phone) return

  const total = request.leads.length
  if (total === 0) {
    console.warn('[review-first] notifyCustomerRfpResponseSummary: no active leads found', { requestId })
    return
  }
  const available = request.leads.filter((lead) => lead.providerResponses.length > 0)
  const declined = request.leads.filter((lead) => lead.status === 'DECLINED')
  const respondedIds = new Set([...available.map((l) => l.id), ...declined.map((l) => l.id)])
  const responded = respondedIds.size
  const pending = request.leads.filter(
    (lead) => (lead.status === 'SENT' || lead.status === 'VIEWED') && lead.providerResponses.length === 0,
  )

  if (available.length === 0 && pending.length === 0) {
    await sendText(
      request.customer.phone,
      `None of the selected providers responded in time.\n\nYou can show more providers, try Quick Match, edit the request, or cancel.`,
      {
        templateName: 'interactive:rfp_none_responded',
        metadata: { requestId: request.id, total },
      },
    ).catch(() => undefined)
    return
  }

  let body = `${responded} of ${total} selected provider${total === 1 ? '' : 's'} responded.\n\n`
  if (available.length > 0) {
    body += `Please review their responses and choose who you prefer.\n\n`
    body += available
      .slice(0, 3)
      .map((lead, idx) => {
        const response = lead.providerResponses[0]
        const fee = response?.callOutFee != null ? `R${Number(response.callOutFee).toFixed(0)}` : 'Not provided'
        const eta = response?.estimatedArrivalAt
          ? response.estimatedArrivalAt.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Not provided'
        return `${idx + 1}. ${lead.provider.name}\nCall-out fee: ${fee}\nEstimated arrival: ${eta}${response?.providerNote ? `\nNote: ${response.providerNote}` : ''}`
      })
      .join('\n\n')
  } else {
    body += `You can wait for more responses or show more providers.`
  }

  await sendText(
    request.customer.phone,
    body,
    {
      templateName: 'interactive:rfp_response_summary',
      metadata: { requestId: request.id, responded, total, available: available.length },
    },
  ).catch(() => undefined)
}

export async function expireRfpInvitations() {
  const now = new Date()
  const expired = await db.lead.findMany({
    where: {
      assignmentHoldId: null,
      status: { in: ['SENT', 'VIEWED'] },
      respondedAt: null,
      expiresAt: { lte: now },
      jobRequest: {
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
      },
    },
    select: {
      id: true,
      jobRequestId: true,
      providerId: true,
    },
    take: 100,
  })

  if (expired.length === 0) return { expiredCount: 0 }

  await db.lead.updateMany({
    where: { id: { in: expired.map((lead) => lead.id) } },
    data: {
      status: 'EXPIRED',
      expiredAt: now,
    },
  })

  const requestIds = Array.from(new Set(expired.map((lead) => lead.jobRequestId)))
  for (const requestId of requestIds) {
    await notifyCustomerRfpResponseSummary(requestId).catch(() => undefined)
  }

  return { expiredCount: expired.length }
}
