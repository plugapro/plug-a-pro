// ─── Quote Service ────────────────────────────────────────────────────────────
// Single source of truth for quote approval / decline.
// Called by both the HTTP approval page and the WhatsApp bot button handler.

import { db } from './db'
import { initializeBookingPayment, type PaymentCollectionMode } from './payments'

export type QuoteDecisionResult =
  | {
      action: 'approved'
      quoteId: string
      matchId: string
      bookingId: string
      scheduledDate: Date
      payment: {
        mode: PaymentCollectionMode
        status: 'PENDING'
        checkoutUrl: string | null
      }
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
      if (quote.status !== 'PENDING') throw new Error('ALREADY_ACTIONED')
      if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

      const provider = quote.match.provider
      const customer = quote.match.jobRequest.customer
      const category = quote.match.jobRequest.category

      if (action === 'decline') {
        const feedback = options?.customerFeedback?.trim() || null
        await tx.quote.update({
          where: { id: quoteId },
          data: { status: 'DECLINED', declinedAt: new Date(), notes: feedback },
        })
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

      // Approve
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      })
      await tx.match.update({
        where: { id: quote.matchId },
        data: { status: 'QUOTE_APPROVED' },
      })

      if (!quote.preferredDate) {
        throw new Error('MISSING_PREFERRED_DATE')
      }

      const scheduledDate = quote.preferredDate

      const booking = await tx.booking.create({
        data: { matchId: quote.matchId, quoteId: quote.id, status: 'SCHEDULED', scheduledDate },
      })

      await tx.job.create({
        data: { bookingId: booking.id, providerId: provider.id, status: 'SCHEDULED' },
      })

      return {
        action: 'approved' as const,
        quoteId,
        matchId: quote.matchId,
        bookingId: booking.id,
        scheduledDate,
        provider,
        customer,
        category,
        paymentAmount: Number(quote.amount),
      }
    })

    if (result.action === 'approved') {
      const payment = await initializeBookingPayment({
        bookingId: result.bookingId,
        amountRand: result.paymentAmount,
        customerEmail: null,
        customerPhone: result.customer.phone,
        description: `${result.category} booking`,
      })

      return {
        action: 'approved',
        quoteId: result.quoteId,
        matchId: result.matchId,
        bookingId: result.bookingId,
        scheduledDate: result.scheduledDate,
        payment,
        provider: result.provider,
        customer: result.customer,
        category: result.category,
      }
    }

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
