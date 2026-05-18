import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { db } from './db'
import { isEnabled } from './flags'
import { normaliseLocationDisplayName } from './location-format'
import { previewNotes } from './provider-lead-detail'
import { validateProviderOnboardingRates } from './provider-onboarding-data'
import { sendText } from './whatsapp-interactive'
import { notifyCustomerRfpResponseSummary } from './review-first'

export type ProviderOpportunityResponseInput = {
  leadId: string
  providerId: string
  response: 'INTERESTED' | 'NOT_INTERESTED'
  callOutFeeText?: string | null
  estimatedArrivalAt?: Date | null
  rateType?: string | null
  rateAmountText?: string | null
  negotiable?: boolean
  providerNote?: string | null
  source?: string | null
  idempotencyKey?: string | null
}

export class ProviderOpportunityResponseError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'EXPIRED'
      | 'ALREADY_ACCEPTED'
      | 'INVALID_RESPONSE'
      | 'INVALID_RATE'
      | 'INVALID_ARRIVAL_TIME',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderOpportunityResponseError'
  }
}

export async function getSafeProviderOpportunityPreview(leadId: string, providerId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      providerId: true,
      status: true,
      expiresAt: true,
      jobRequest: {
        select: {
          id: true,
          category: true,
          subcategory: true,
          title: true,
          description: true,
          urgency: true,
          providerPreference: true,
          budgetPreference: true,
          requestedWindowStart: true,
          requestedWindowEnd: true,
          requestedArrivalLatest: true,
          address: {
            select: {
              suburb: true,
              region: true,
              city: true,
              province: true,
            },
          },
          attachments: {
            where: { safeForPreview: true },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              caption: true,
              label: true,
            },
          },
        },
      },
    },
  })

  if (!lead) return null
  if (lead.providerId !== providerId) {
    throw new ProviderOpportunityResponseError('FORBIDDEN', 'This opportunity belongs to another provider.')
  }

  // This return shape intentionally excludes customer, phone, email, street,
  // unit, complex, access notes, and GPS fields. Do not broaden without a
  // matching privacy test.
  return {
    id: lead.id,
    status: lead.status,
    expiresAt: lead.expiresAt,
    request: {
      id: lead.jobRequest.id,
      category: lead.jobRequest.category,
      subcategory: lead.jobRequest.subcategory,
      title: lead.jobRequest.title,
      description: previewNotes(lead.jobRequest.description),
      urgency: lead.jobRequest.urgency,
      providerPreference: lead.jobRequest.providerPreference,
      budgetPreference: lead.jobRequest.budgetPreference,
      requestedWindowStart: lead.jobRequest.requestedWindowStart,
      requestedWindowEnd: lead.jobRequest.requestedWindowEnd,
      requestedArrivalLatest: lead.jobRequest.requestedArrivalLatest,
      area: lead.jobRequest.address
        ? {
            suburb: normaliseLocationDisplayName(lead.jobRequest.address.suburb),
            region: normaliseLocationDisplayName(lead.jobRequest.address.region),
            city: normaliseLocationDisplayName(lead.jobRequest.address.city),
            province: normaliseLocationDisplayName(lead.jobRequest.address.province),
          }
        : null,
      attachments: lead.jobRequest.attachments,
    },
  }
}

export async function respondToProviderOpportunity(input: ProviderOpportunityResponseInput) {
  if (input.response !== 'INTERESTED' && input.response !== 'NOT_INTERESTED') {
    throw new ProviderOpportunityResponseError('INVALID_RESPONSE', 'Unsupported provider opportunity response.')
  }

  if (input.idempotencyKey) {
    const existingResponse = await db.providerLeadResponse.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existingResponse) {
      return { response: existingResponse, creditsDeducted: 0 }
    }
  }

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      status: true,
      expiresAt: true,
      unlock: { select: { id: true } },
    },
  })

  if (!lead) throw new ProviderOpportunityResponseError('NOT_FOUND', 'Opportunity not found.')
  if (lead.providerId !== input.providerId) {
    throw new ProviderOpportunityResponseError('FORBIDDEN', 'This opportunity belongs to another provider.')
  }
  if (lead.status === 'ACCEPTED' || lead.status === 'ACCEPTED_LOCKED' || lead.unlock) {
    throw new ProviderOpportunityResponseError('ALREADY_ACCEPTED', 'This lead has already been accepted.')
  }
  const now = new Date()
  if (lead.status === 'EXPIRED' || (lead.expiresAt && lead.expiresAt <= now)) {
    await db.lead.updateMany({
      where: { id: input.leadId, status: { in: ['SENT', 'VIEWED'] } },
      data: { status: 'EXPIRED', expiredAt: now },
    })
    throw new ProviderOpportunityResponseError('EXPIRED', 'This opportunity has expired.')
  }
  if (lead.status !== 'SENT' && lead.status !== 'VIEWED') {
    throw new ProviderOpportunityResponseError('INVALID_RESPONSE', 'This opportunity can no longer receive a response.')
  }

  const rates = (() => {
    try {
      return validateProviderOnboardingRates({
        callOutFeeText: input.callOutFeeText,
        hourlyRateText: input.rateAmountText,
      })
    } catch {
      throw new ProviderOpportunityResponseError('INVALID_RATE', 'Provider response contains an invalid rate.')
    }
  })()

  if (input.response === 'INTERESTED' && rates.callOutFee == null) {
    throw new ProviderOpportunityResponseError('INVALID_RATE', 'Interested responses require a call-out fee.')
  }
  if (input.response === 'INTERESTED' && !input.estimatedArrivalAt) {
    throw new ProviderOpportunityResponseError('INVALID_ARRIVAL_TIME', 'Interested responses require an estimated arrival time.')
  }
  if (input.estimatedArrivalAt && Number.isNaN(input.estimatedArrivalAt.getTime())) {
    throw new ProviderOpportunityResponseError('INVALID_ARRIVAL_TIME', 'Estimated arrival time is invalid.')
  }

  let jobRequestIdForTrigger: string | null = null
  const responsePayload = {
    response: input.response,
    callOutFee: input.response === 'NOT_INTERESTED' ? null : rates.callOutFee,
    estimatedArrivalAt: input.response === 'NOT_INTERESTED' ? null : input.estimatedArrivalAt ?? null,
    rateType: input.rateType ?? null,
    rateAmount: rates.hourlyRate,
    negotiable: input.negotiable ?? true,
    providerNote: input.providerNote?.trim() || null,
    source: input.source ?? null,
  }

  const response = await db.$transaction(async (tx) => {
    const existingResponse = await tx.providerLeadResponse.findFirst({
      where: {
        leadInviteId: input.leadId,
        providerId: input.providerId,
      },
      select: { id: true, idempotencyKey: true },
    })

    const response = existingResponse
      ? await tx.providerLeadResponse.update({
          where: { id: existingResponse.id },
          data: {
            ...responsePayload,
            idempotencyKey: input.idempotencyKey ?? existingResponse.idempotencyKey,
          },
        })
      : await tx.providerLeadResponse.create({
          data: {
            id: randomUUID(),
            leadInviteId: input.leadId,
            providerId: input.providerId,
            ...responsePayload,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        })

    const updatedLead = await tx.lead.updateMany({
      where: {
        id: input.leadId,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: input.response === 'NOT_INTERESTED'
        ? { status: 'DECLINED', respondedAt: now, declinedAt: now }
        : { status: 'INTERESTED', viewedAt: now, respondedAt: now },
    })
    if (updatedLead.count !== 1) {
      throw new ProviderOpportunityResponseError('INVALID_RESPONSE', 'Lead status changed concurrently.')
    }
    jobRequestIdForTrigger = lead.jobRequestId

    await tx.auditLog.create({
      data: {
        actorId: input.providerId,
        actorRole: 'provider',
        action: 'lead.opportunity_response',
        entityType: 'Lead',
        entityId: input.leadId,
        after: {
          response: input.response,
          callOutFee: rates.callOutFee,
          estimatedArrivalAt: input.estimatedArrivalAt?.toISOString() ?? null,
          source: input.source ?? null,
        } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)

    return response
  })

  // Auto-trigger shortlist generation once enough providers are interested.
  // The trigger is best-effort: a failure here does not roll back the response.
  if (input.response === 'INTERESTED' && jobRequestIdForTrigger) {
    await maybeAutoTriggerShortlist(jobRequestIdForTrigger).catch((error) => {
      console.warn('[provider-opportunity-responses] auto-trigger failed', {
        leadId: input.leadId,
        jobRequestId: jobRequestIdForTrigger,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  if (input.response === 'NOT_INTERESTED') {
    const { rejectAssignmentOffer } = await import('./matching/service')
    const declined = await rejectAssignmentOffer({
      leadId: input.leadId,
      providerId: input.providerId,
      reasonCode: 'PROVIDER_NOT_AVAILABLE',
    }).catch(() => null)

    if (jobRequestIdForTrigger) {
      // RFP (review-first) leads have a shortlist item with customerPreferenceRank.
      // For those, cascade to the next preferred provider instead of the generic message.
      const shortlistItem = await db.providerShortlistItem.findFirst({
        where: { leadInviteId: input.leadId },
        select: { customerPreferenceRank: true },
      })

      if (shortlistItem?.customerPreferenceRank != null) {
        const { cascadeToNextShortlistedProvider } = await import('./review-first')
        await cascadeToNextShortlistedProvider({
          requestId: jobRequestIdForTrigger,
          declinedLeadId: input.leadId,
        }).catch((error) => {
          console.warn('[provider-opportunity-responses] rfp_cascade_failed', {
            requestId: jobRequestIdForTrigger,
            leadId: input.leadId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      } else {
        const request = await db.jobRequest.findUnique({
          where: { id: jobRequestIdForTrigger },
          select: { customer: { select: { phone: true } } },
        })
        const customerPhone = request?.customer?.phone
        if (customerPhone) {
          const body = declined?.ok
            ? declined.nextOfferedProviderId
              ? `That provider is not available. We're checking with the next suitable provider.`
              : `That provider is not available. We're continuing to check suitable providers for your request.`
            : `That provider is not available. We're checking other suitable providers now.`
          await sendText(
            customerPhone,
            body,
            {
              templateName: 'interactive:quick_match_provider_declined',
              metadata: {
                requestId: jobRequestIdForTrigger,
                leadId: input.leadId,
              },
            },
          ).catch(() => undefined)
        }
        await notifyCustomerRfpResponseSummary(jobRequestIdForTrigger).catch(() => undefined)
      }
    }
  }

  if (input.response === 'INTERESTED' && jobRequestIdForTrigger) {
    await notifyCustomerRfpResponseSummary(jobRequestIdForTrigger).catch(() => undefined)
  }

  return { response, creditsDeducted: 0 }
}

async function maybeAutoTriggerShortlist(requestId: string) {
  const enabled = await isEnabled('qualified_shortlist.auto_trigger').catch(() => false)
  if (!enabled) return

  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, assignmentMode: true },
  })
  // Only promote requests that are still actively matching. Once a shortlist
  // exists or a provider has been selected, do not regenerate.
  if (!request) return
  if (request.status !== 'OPEN' && request.status !== 'MATCHING') return

  const threshold = request.assignmentMode === 'AUTO_ASSIGN'
    ? 1
    : Math.max(
        1,
        Number(process.env.SHORTLIST_AUTO_TRIGGER_THRESHOLD) || 2,
      )
  const interestedCount = await db.providerLeadResponse.count({
    where: {
      response: 'INTERESTED',
      callOutFee: { not: null },
      estimatedArrivalAt: { not: null },
      leadInvite: {
        jobRequestId: requestId,
        status: { in: ['SENT', 'VIEWED', 'INTERESTED'] },
        expiresAt: { gt: new Date() },
      },
      provider: { active: true, status: 'ACTIVE', verified: true },
    },
  })

  if (interestedCount < threshold) return

  const { generateCustomerShortlistForRequest } = await import('./customer-shortlists')
  if (request.assignmentMode === 'AUTO_ASSIGN') {
    await generateCustomerShortlistForRequest(requestId, 1, { quickMatch: true })
  } else {
    await generateCustomerShortlistForRequest(requestId)
  }
}
