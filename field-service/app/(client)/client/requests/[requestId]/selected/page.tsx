import { redirect } from 'next/navigation'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'
import { SelectedScreen } from '@/components/client/selected-screen'
import { getRequestForClient } from '@/lib/server/client'

export const dynamic = 'force-dynamic'

export default async function RequestSelectedPage({ params }: { params: Promise<{ requestId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')
  const { requestId } = await params
  const request = await getRequestForClient(requestId, auth.customer.id)
  if (!request) redirect('/client')
  if (request.status === 'SHORTLIST_READY') redirect(`/client/requests/${requestId}/shortlist`)
  if (request.match?.quotes.length) redirect(`/client/requests/${requestId}`)
  if (request.status === 'MATCHED') {
    const jobId = request.match?.booking?.job?.id
    if (jobId) redirect(`/client/jobs/${jobId}`)
  }
  if (request.status !== 'PROVIDER_CONFIRMATION_PENDING') redirect(`/client/requests/${requestId}`)
  return <SelectedScreen />
}
