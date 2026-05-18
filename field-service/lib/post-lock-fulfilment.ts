// Materialises the Match + stub Quote rows that the provider portal needs to
// surface a locked lead under "Awaiting your quote". Called from
// lockAcceptedLeadAfterCreditInTransaction inside the same Prisma transaction
// so the Match exists by the time the lock returns.
//
// Sub-path A (jobRequest.customerAcceptedAmount != null) — where the customer
// pre-agreed a price and Booking + Job should materialise immediately — is NOT
// handled here yet. Phase 1b will extend this helper or call out to
// createBookingArtifactsForApprovedQuote from quotes.ts.

import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export type PostLockArtifactsResult = {
  matchId: string
  quoteId: string
  alreadyMaterialised: boolean
}

type PostLockTx = Pick<Prisma.TransactionClient, 'match' | 'quote'>

export async function materializeFulfilmentArtifacts(
  tx: PostLockTx,
  params: {
    jobRequestId: string
    providerId: string
  },
): Promise<PostLockArtifactsResult> {
  // Match.jobRequestId is @unique; this is the idempotency anchor.
  const existing = await tx.match.findUnique({
    where: { jobRequestId: params.jobRequestId },
    include: { quotes: { take: 1, orderBy: { createdAt: 'desc' } } },
  })

  if (existing) {
    if (existing.quotes.length > 0) {
      return {
        matchId: existing.id,
        quoteId: existing.quotes[0].id,
        alreadyMaterialised: true,
      }
    }
    // Match exists but no Quote yet — fill the gap. Shouldn't happen under
    // normal flow, but covers a partial-failure recovery scenario.
    const quote = await tx.quote.create({
      data: {
        matchId: existing.id,
        amount: new Prisma.Decimal(0),
        description: 'Awaiting provider quote',
        approvalToken: randomUUID(),
        status: 'PENDING',
      },
    })
    return { matchId: existing.id, quoteId: quote.id, alreadyMaterialised: false }
  }

  const match = await tx.match.create({
    data: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      status: 'MATCHED',
    },
  })
  // Stub Quote with amount=0. The customer-facing approval page must guard
  // against rendering this until the provider has submitted a real quote
  // (see app/quotes/[token]/page.tsx — Phase 1b).
  const quote = await tx.quote.create({
    data: {
      matchId: match.id,
      amount: new Prisma.Decimal(0),
      description: 'Awaiting provider quote',
      approvalToken: randomUUID(),
      status: 'PENDING',
    },
  })
  return { matchId: match.id, quoteId: quote.id, alreadyMaterialised: false }
}
