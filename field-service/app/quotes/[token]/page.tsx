// Client quote approval page - public, no auth required
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { isStubQuote } from '@/lib/quotes'
import { QuoteApproval } from '@/components/quotes/QuoteApproval'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Review Quote', noIndex: true })

export default async function QuoteApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const quote = await db.quote.findUnique({
    where: { approvalToken: token },
    include: {
      match: {
        include: {
          provider: { select: { name: true } },
          jobRequest: { include: { address: true } },
        },
      },
    },
  })

  if (!quote) notFound()

  const addr = quote.match.jobRequest.address
  const area = addr?.suburb ?? null
  const expired = quote.validUntil ? new Date() > quote.validUntil : false

  // CJ-07: stub quotes (amount=0, minted by post-lock fulfilment so the
  // provider portal can show the locked lead) are placeholders, not offers.
  // Render a waiting state with NO action buttons - a customer must never see
  // an acceptable R0 quote. processQuoteDecision enforces the same guard
  // server-side (AWAITING_PROVIDER_QUOTE) for any stale link or bot button.
  if (quote.status === 'PENDING' && isStubQuote(quote)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Quote from {quote.match.provider.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {quote.match.jobRequest.category}{area ? ` · ${area}` : ''}
            </p>
          </div>
          <div className="tone-warning rounded-2xl border p-6 text-center space-y-2">
            <p className="text-2xl">⏳</p>
            <p className="font-semibold">Quote on its way</p>
            <p className="text-sm text-muted-foreground">
              {quote.match.provider.name} has accepted your request and is preparing a detailed
              quote. We&apos;ll send it to you on WhatsApp as soon as it&apos;s ready — no action
              is needed from you yet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const quoteData = {
    id: quote.id,
    status: quote.status as string,
    providerName: quote.match.provider.name,
    labourCost: Number(quote.labourCost),
    materialsCost: Number(quote.materialsCost),
    totalAmount: Number(quote.amount),
    description: quote.description,
    estimatedHours: quote.estimatedHours,
    validUntil: quote.validUntil?.toISOString() ?? null,
    preferredDate: quote.preferredDate?.toISOString() ?? null,
    category: quote.match.jobRequest.category,
    area,
    expired,
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Quote from {quote.match.provider.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {quote.match.jobRequest.category}{area ? ` · ${area}` : ''}
          </p>
        </div>

        <QuoteApproval quote={quoteData} token={token} />
      </div>
    </div>
  )
}
