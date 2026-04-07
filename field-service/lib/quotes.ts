// ─── Quote Service ────────────────────────────────────────────────────────────
// Single source of truth for quote approval / decline.
// Called by both the HTTP approval page and the WhatsApp bot button handler.

import { db } from './db'

export type QuoteDecisionResult =
  | {
      action: 'approved'
      quoteId: string
      matchId: string
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
      provider: { id: string; phone: string; name: string }
      customer: { id: string; phone: string; name: string }
      category: string
    }

export type QuoteDecisionError = 'NOT_FOUND' | 'ALREADY_ACTIONED' | 'EXPIRED' | 'FORBIDDEN'

export async function processQuoteDecision(
  quoteId: string,
  action: 'approve' | 'decline',
  options?: { verifyCustomerPhone?: string }
): Promise<QuoteDecisionResult | { error: QuoteDecisionError }> {
  try {
    return await db.$transaction(async (tx) => {
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
        await tx.quote.update({
          where: { id: quoteId },
          data: { status: 'DECLINED', declinedAt: new Date() },
        })
        await tx.match.update({
          where: { id: quote.matchId },
          data: { status: 'QUOTE_DECLINED' },
        })
        return { action: 'declined' as const, quoteId, matchId: quote.matchId, provider, customer, category }
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

      const scheduledDate = quote.preferredDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000)

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
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    if (msg === 'NOT_FOUND' || msg === 'ALREADY_ACTIONED' || msg === 'EXPIRED' || msg === 'FORBIDDEN') {
      return { error: msg as QuoteDecisionError }
    }
    throw err
  }
}
