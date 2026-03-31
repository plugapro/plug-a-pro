// Provider: Submit quote for a matched job
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { QuoteForm } from '@/components/technician/QuoteForm'

export const metadata = buildMetadata({ title: 'Submit Quote', noIndex: true })

export default async function QuotePage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const session = await requireProvider()
  const { matchId } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: { include: { address: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  if (!match) notFound()
  if (match.providerId !== provider.id) redirect('/technician')

  if (match.quotes.length > 0 && match.status === 'QUOTED') {
    redirect('/technician?quote=already-sent')
  }

  const jobRequest = match.jobRequest
  const addr = jobRequest.address
  const area = addr ? `${addr.suburb ?? ''}${addr.city ? `, ${addr.city}` : ''}`.trim() : 'Location in app'

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div>
        <h1 className="text-xl font-semibold">Submit Quote</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This quote will be sent to the customer for approval.
        </p>
      </div>

      <QuoteForm
        matchId={matchId}
        postInspection={match.inspectionNeeded}
        category={jobRequest.category}
        area={area}
        description={jobRequest.description}
      />
    </div>
  )
}
