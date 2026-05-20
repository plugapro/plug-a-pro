import { redirect } from 'next/navigation'
import { getShortlistForRequest } from '@/lib/server/client'
import { ProviderProfileScreen } from '@/components/client/provider-profile-screen'

export default async function RequestProviderPage({
  params,
}: {
  params: Promise<{ requestId: string; providerId: string }>
}) {
  const { requestId, providerId } = await params
  const shortlist = await getShortlistForRequest(requestId).catch(() => null)
  if (!shortlist) redirect(`/client/requests/${requestId}/shortlist`)
  const provider = shortlist.items.find((item) => item.providerId === providerId)
  if (!provider) redirect(`/client/requests/${requestId}/shortlist`)
  return <ProviderProfileScreen requestId={requestId} providerId={providerId} providerName={provider.provider.name ?? 'Provider'} />
}

