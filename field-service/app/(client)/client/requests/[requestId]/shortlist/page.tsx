import { redirect } from 'next/navigation'
import { getShortlistForRequest } from '@/lib/server/client'
import { ShortlistScreen } from '@/components/client/shortlist-screen'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'

export default async function RequestShortlistPage({ params }: { params: Promise<{ requestId: string }> }) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')
  const { requestId } = await params
  const shortlist = await getShortlistForRequest(requestId, auth.customer.id).catch(() => null)
  if (!shortlist) redirect(`/client/requests/${requestId}/matching`)
  return <ShortlistScreen requestId={requestId} items={shortlist.items} />
}
