import { redirect } from 'next/navigation'
import { getShortlistForRequest } from '@/lib/server/client'
import { ShortlistScreen } from '@/components/client/shortlist-screen'

export default async function RequestShortlistPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const shortlist = await getShortlistForRequest(requestId).catch(() => null)
  if (!shortlist) redirect(`/client/requests/${requestId}/matching`)
  return <ShortlistScreen requestId={requestId} items={shortlist.items} />
}

