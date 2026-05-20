import { redirect } from 'next/navigation'
import { getRequestForClient } from '@/lib/server/client'
import { MatchingScreen } from '@/components/client/matching-screen'

export const dynamic = 'force-dynamic'

export default async function RequestMatchingPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const request = await getRequestForClient(requestId)
  if (!request) redirect('/client')
  if (request.status === 'SHORTLIST_READY') redirect(`/client/requests/${request.id}/shortlist`)
  if (request.status === 'PROVIDER_CONFIRMATION_PENDING') redirect(`/client/requests/${request.id}/selected`)
  if (request.match?.quotes.length) redirect(`/client/requests/${request.id}`)
  return <MatchingScreen requestId={request.id} />
}

