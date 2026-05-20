import { redirect } from 'next/navigation'
import { getRequestForClient, getShortlistForRequest } from '@/lib/server/client'
import { ShortlistScreen } from '@/components/client/shortlist-screen'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'

export default async function RequestShortlistPage({ params }: { params: Promise<{ requestId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')
  const { requestId } = await params

  const request = await getRequestForClient(requestId, auth.customer.id)
  if (!request) redirect('/client')
  if (request.status === 'PROVIDER_CONFIRMATION_PENDING') redirect(`/client/requests/${requestId}/selected`)
  if (request.status === 'MATCHED') {
    const jobId = request.match?.booking?.job?.id
    if (jobId) redirect(`/client/jobs/${jobId}`)
  }
  if (request.match?.quotes.length) redirect(`/client/requests/${requestId}`)

  const shortlist = await getShortlistForRequest(requestId, auth.customer.id).catch(() => null)
  if (!shortlist) redirect(`/client/requests/${requestId}/matching`)
  return <ShortlistScreen requestId={requestId} items={shortlist.items} />
}
