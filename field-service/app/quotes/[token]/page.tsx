// Client quote approval page — public, no auth required
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { QuoteApproval } from '@/components/quotes/QuoteApproval'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Review Quote', noIndex: true })

interface QuoteData {
  id: string
  status: string
  providerName: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: string | null
  preferredDate: string | null
  category: string
  area: string | null
  expired: boolean
}

export default async function QuoteApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const res = await fetch(`${appUrl}/api/quotes/${token}`, { cache: 'no-store' })
  if (!res.ok) notFound()

  const quote = await res.json() as QuoteData

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Quote from {quote.providerName}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {quote.category}{quote.area ? ` · ${quote.area}` : ''}
          </p>
        </div>

        <QuoteApproval quote={quote} token={token} />
      </div>
    </div>
  )
}
