import { redirect } from 'next/navigation'
import { getRequestForClient, getShortlistForRequest } from '@/lib/server/client'
import { ProviderProfileScreen } from '@/components/client/provider-profile-screen'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'

export default async function RequestProviderPage({
  params,
}: {
  params: Promise<{ requestId: string; providerId: string }>
}) {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client')
  const { requestId, providerId } = await params
  const request = await getRequestForClient(requestId, auth.customer.id)
  if (!request) redirect('/client')
  if (request.status === 'PROVIDER_CONFIRMATION_PENDING') redirect(`/client/requests/${requestId}/selected`)
  if (request.status === 'MATCHED') {
    const jobId = request.match?.booking?.job?.id
    if (jobId) redirect(`/client/jobs/${jobId}`)
  }
  if (request.match?.quotes.length) redirect(`/client/requests/${requestId}`)

  const shortlist = await getShortlistForRequest(requestId, auth.customer.id).catch(() => null)
  if (!shortlist) redirect(`/client/requests/${requestId}/shortlist`)
  const provider = shortlist.items.find((item) => item.providerId === providerId)
  if (!provider) redirect(`/client/requests/${requestId}/shortlist`)
  return (
    <ProviderProfileScreen
      requestId={requestId}
      providerId={providerId}
      providerName={provider.provider.name ?? 'Provider'}
      profile={{
        bio: provider.provider.bio ?? null,
        experience: provider.provider.experience ?? null,
        skills: provider.provider.skills ?? [],
        serviceAreas: provider.provider.serviceAreas ?? [],
        verified: Boolean(provider.provider.verified),
        averageRating:
          provider.provider.averageRating != null && Number.isFinite(Number(provider.provider.averageRating))
            ? Number(provider.provider.averageRating)
            : null,
        completedJobsCount:
          typeof provider.provider.completedJobsCount === 'number'
            ? provider.provider.completedJobsCount
            : null,
        callOutFee: typeof provider.callOutFee === 'number' ? provider.callOutFee : null,
        estimatedArrivalAt: provider.estimatedArrivalAt ? provider.estimatedArrivalAt.toISOString() : null,
        negotiable: provider.negotiable ?? true,
        providerNote: provider.providerNote ?? null,
      }}
    />
  )
}
