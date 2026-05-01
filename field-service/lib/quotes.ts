// ─── Quote Service ────────────────────────────────────────────────────────────
// Single source of truth for quote approval / decline.
// Called by both the HTTP approval page and the WhatsApp bot button handler.

import { db } from './db'
import { addMinutes, format } from 'date-fns'
import { MATCHING_CONFIG } from './matching/config'
import type { Prisma } from '@prisma/client'

export type QuoteDecisionResult =
  | {
      action: 'approved'
      quoteId: string
      matchId: string
      jobRequestId: string
      bookingId: string
      scheduledDate: Date
      provider: { id: string; phone: string; name: string }
      customer: { id: string; phone: string; name: string }
      category: string
    }
  | {
      action: 'declined'
      quoteId: string
      matchId: string
      canRevise: boolean
      feedback: string | null
      provider: { id: string; phone: string; name: string }
      customer: { id: string; phone: string; name: string }
      category: string
    }

export type QuoteDecisionError =
  | 'NOT_FOUND'
  | 'ALREADY_ACTIONED'
  | 'EXPIRED'
  | 'FORBIDDEN'
  | 'MISSING_PREFERRED_DATE'

/**
 * Mark PENDING quotes whose validUntil has passed as EXPIRED.
 * Called by the match-leads cron every 30 min so stale quotes don't
 * accumulate as PENDING in reports and admin views.
 */
export async function expireStaleQuotes(): Promise<number> {
  const { count } = await db.quote.updateMany({
    where: {
      status: 'PENDING',
      validUntil: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  })
  return count
}

export async function createBookingArtifactsForApprovedQuote(
  tx: Prisma.TransactionClient,
  params: {
    quoteId: string
    matchId: string
    providerId: string
    category: string
    jobRequestId: string
    address: {
      suburb?: string | null
      city?: string | null
      lat?: number | null
      lng?: number | null
    } | null
    scheduledDate: Date
    estimatedDurationMinutes?: number | null
    isTestJob?: boolean
    cohortName?: string | null
    source: 'quote_approval' | 'assignment_acceptance'
  }
) {
  const scheduledStartAt = params.scheduledDate
  const estimatedDurationMinutes = Math.max(
    MATCHING_CONFIG.defaultDurationMinutes,
    params.estimatedDurationMinutes ?? MATCHING_CONFIG.defaultDurationMinutes,
  )
  const scheduledEndAt = addMinutes(scheduledStartAt, estimatedDurationMinutes)
  const scheduledWindow = `${format(scheduledStartAt, 'HH:mm')}-${format(scheduledEndAt, 'HH:mm')}`

  const booking = await tx.booking.create({
    data: {
      matchId: params.matchId,
      quoteId: params.quoteId,
      status: 'SCHEDULED',
      scheduledDate: params.scheduledDate,
      scheduledStartAt,
      scheduledEndAt,
      scheduledWindow,
    },
  })

  await tx.job.create({
    data: {
      bookingId: booking.id,
      providerId: params.providerId,
      status: 'SCHEDULED',
      isTestJob: Boolean(params.isTestJob),
      cohortName: params.cohortName ?? null,
    },
  })

  await tx.technicianScheduleItem.updateMany({
    where: {
      providerId: params.providerId,
      jobRequestId: params.jobRequestId,
      itemType: 'ASSIGNMENT_HOLD',
      status: 'ACTIVE',
    },
    data: {
      status: 'RELEASED',
      updatedAt: new Date(),
    },
  })

  await tx.technicianScheduleItem.create({
    data: {
      providerId: params.providerId,
      bookingId: booking.id,
      jobRequestId: params.jobRequestId,
      itemType: 'BOOKING',
      title: `${params.category} booking`,
      startAt: scheduledStartAt,
      endAt: scheduledEndAt,
      source: params.source,
      locationLabel: [params.address?.suburb, params.address?.city].filter(Boolean).join(', '),
      lat: params.address?.lat ?? undefined,
      lng: params.address?.lng ?? undefined,
    },
  })

  return {
    bookingId: booking.id,
    scheduledDate: params.scheduledDate,
    scheduledStartAt,
    scheduledEndAt,
    scheduledWindow,
  }
}

export async function processQuoteDecision(
  quoteId: string,
  action: 'approve' | 'decline',
  options?: { verifyCustomerPhone?: string; customerFeedback?: string | null }
): Promise<QuoteDecisionResult | { error: QuoteDecisionError }> {
  try {
    const result = await db.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: quoteId },
        include: {
          match: {
            include: {
              provider: { select: { id: true, phone: true, name: true } },
              jobRequest: {
                include: {
                  customer: { select: { id: true, phone: true, name: true } },
                  address: true,
                },
              },
            },
          },
        },
      })

      if (!quote) throw new Error('NOT_FOUND')
      if (
        options?.verifyCustomerPhone &&
        quote.match.jobRequest.customer.phone !== options.verifyCustomerPhone
      ) {
        throw new Error('FORBIDDEN')
      }
      if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

      const provider = quote.match.provider
      const customer = quote.match.jobRequest.customer
      const category = quote.match.jobRequest.category

      if (action === 'decline') {
        const feedback = options?.customerFeedback?.trim() || null
        // Atomic claim: updateMany returns count=0 if another request already actioned the quote
        const claimed = await tx.quote.updateMany({
          where: { id: quoteId, status: 'PENDING' },
          data: { status: 'DECLINED', declinedAt: new Date(), notes: feedback },
        })
        if (claimed.count === 0) throw new Error('ALREADY_ACTIONED')
        await tx.match.update({
          where: { id: quote.matchId },
          data: { status: 'QUOTE_DECLINED' },
        })
        return {
          action: 'declined' as const,
          quoteId,
          matchId: quote.matchId,
          canRevise: true,
          feedback,
          provider,
          customer,
          category,
        }
      }

      // Approve — atomic claim prevents concurrent double-approval
      const claimed = await tx.quote.updateMany({
        where: { id: quoteId, status: 'PENDING' },
        data: { status: 'APPROVED', approvedAt: new Date() },
      })
      if (claimed.count === 0) throw new Error('ALREADY_ACTIONED')
      await tx.match.update({
        where: { id: quote.matchId },
        data: { status: 'QUOTE_APPROVED' },
      })

      if (!quote.preferredDate) {
        throw new Error('MISSING_PREFERRED_DATE')
      }

      const scheduledDate = quote.preferredDate
      const booking = await createBookingArtifactsForApprovedQuote(tx, {
        quoteId: quote.id,
        matchId: quote.matchId,
        providerId: provider.id,
        category,
        jobRequestId: quote.match.jobRequest.id,
        address: quote.match.jobRequest.address,
        scheduledDate,
        estimatedDurationMinutes:
          Math.round((quote.estimatedHours ?? 0) * 60) || MATCHING_CONFIG.defaultDurationMinutes,
        isTestJob: quote.match.jobRequest.isTestRequest,
        cohortName: quote.match.jobRequest.cohortName,
        source: 'quote_approval',
      })

      return {
        action: 'approved' as const,
        quoteId,
        matchId: quote.matchId,
        jobRequestId: quote.match.jobRequest.id,
        bookingId: booking.bookingId,
        scheduledDate: booking.scheduledDate,
        provider,
        customer,
        category,
      }
    })

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    if (
      msg === 'NOT_FOUND' ||
      msg === 'ALREADY_ACTIONED' ||
      msg === 'EXPIRED' ||
      msg === 'FORBIDDEN' ||
      msg === 'MISSING_PREFERRED_DATE'
    ) {
      return { error: msg as QuoteDecisionError }
    }
    throw err
  }
}
