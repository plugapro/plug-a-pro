import { redirect } from 'next/navigation'
import { getRequestForClient } from '@/lib/server/client'
import { QuoteReviewScreen } from '@/components/client/quote-review-screen'

export default async function ClientRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const request = await getRequestForClient(requestId)
  if (!request) redirect('/client')

  if (request.status === 'SHORTLIST_READY') redirect(`/client/requests/${request.id}/shortlist`)
  if (request.status === 'PROVIDER_CONFIRMATION_PENDING') redirect(`/client/requests/${request.id}/selected`)
  if (request.status === 'MATCHING' || request.status === 'OPEN' || request.status === 'PENDING_VALIDATION') {
    redirect(`/client/requests/${request.id}/matching`)
  }
  const quote = request.match?.quotes[0]
  if (!quote) redirect('/client')
  return (
    <QuoteReviewScreen
      requestId={request.id}
      quote={{ id: quote.id, amount: Number(quote.amount), notes: quote.notes ?? null }}
    />
  )
}

