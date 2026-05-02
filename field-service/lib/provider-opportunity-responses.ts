import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { db } from './db'
import { isEnabled } from './flags'
import { previewNotes } from './provider-lead-detail'
import { validateProviderOnboardingRates } from './provider-onboarding-data'

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
      budgetPreference: lead.jobRequest.budgetPreference,
      requestedWindowStart: lead.jobRequest.requestedWindowStart,
      requestedWindowEnd: lead.jobRequest.requestedWindowEnd,
      requestedArrivalLatest: lead.jobRequest.requestedArrivalLatest,
      area: lead.jobRequest.address
        ? {
            suburb: lead.jobRequest.address.suburb,
            region: lead.jobRequest.address.region,
            city: lead.jobRequest.address.city,
            province: lead.jobRequest.address.province,
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
      status: true,
      expiresAt: true,
      unlock: { select: { id: true } },
    },
  })

  if (!lead) throw new ProviderOpportunityResponseError('NOT_FOUND', 'Opportunity not found.')
  if (lead.providerId !== input.providerId) {
    throw new ProviderOpportunityResponseError('FORBIDDEN', 'This opportunity belongs to another provider.')
  }
  if (lead.status === 'ACCEPTED' || lead.unlock) {
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
  const response = await db.$transaction(async (tx) => {
    const response = await tx.providerLeadResponse.create({
      data: {
        id: randomUUID(),
        leadInviteId: input.leadId,
        providerId: input.providerId,
        response: input.response,
        callOutFee: rates.callOutFee,
        estimatedArrivalAt: input.estimatedArrivalAt ?? null,
        rateType: input.rateType ?? null,
        rateAmount: rates.hourlyRate,
        negotiable: input.negotiable ?? true,
        providerNote: input.providerNote?.trim() || null,
        source: input.source ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    })

    const updatedLead = await tx.lead.update({
      where: { id: input.leadId },
      data: input.response === 'NOT_INTERESTED'
        ? { status: 'DECLINED', respondedAt: now }
        : { status: 'VIEWED', viewedAt: now, respondedAt: now },
      select: { jobRequestId: true },
    })
    jobRequestIdForTrigger = updatedLead.jobRequestId

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

  return { response, creditsDeducted: 0 }
}

const DEFAULT_AUTO_TRIGGER_THRESHOLD = 2

async function maybeAutoTriggerShortlist(requestId: string) {
  const enabled = await isEnabled('qualified_shortlist.auto_trigger').catch(() => false)
  if (!enabled) return

  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  })
  // Only promote requests that are still actively matching. Once a shortlist
  // exists or a provider has been selected, do not regenerate.
  if (!request) return
  if (request.status !== 'OPEN' && request.status !== 'MATCHING') return

  const threshold = Math.max(
    1,
    Number(process.env.SHORTLIST_AUTO_TRIGGER_THRESHOLD) || DEFAULT_AUTO_TRIGGER_THRESHOLD,
  )
  const interestedCount = await db.providerLeadResponse.count({
    where: {
      response: 'INTERESTED',
      callOutFee: { not: null },
      estimatedArrivalAt: { not: null },
      leadInvite: {
        jobRequestId: requestId,
        status: { in: ['SENT', 'VIEWED'] },
        expiresAt: { gt: new Date() },
      },
      provider: { active: true, status: 'ACTIVE', verified: true },
    },
  })

  if (interestedCount < threshold) return

  const { generateCustomerShortlistForRequest } = await import('./customer-shortlists')
  await generateCustomerShortlistForRequest(requestId)
}
