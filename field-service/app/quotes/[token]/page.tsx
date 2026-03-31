// Client quote approval page — public, no auth required
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
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
