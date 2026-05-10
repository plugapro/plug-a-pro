import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { buildMetadata } from '@/lib/metadata'
import { resolveReviewProviderProfileToken } from '@/lib/review-provider-profile-access'
import { getJobRequestAccessUrl } from '@/lib/job-request-access'

export const metadata = buildMetadata({ title: 'Provider Profile', noIndex: true })

export default async function ProviderPublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ shortlisted?: string }>
}) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const resolved = await resolveReviewProviderProfileToken(token)

  if (resolved.status === 'expired') {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Card>
          <CardContent className="space-y-2 px-4 py-5 text-sm">
            <p className="font-medium">This profile link has expired.</p>
            <p className="text-muted-foreground">
              Go back to your request and open the provider profile again.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (resolved.status === 'invalid' || !resolved.request || !resolved.provider) {
    notFound()
  }

  const provider = resolved.provider
  const categoryRates = provider.rates[0] ?? null
  const profileMessage = resolvedSearchParams.shortlisted === '1'
    ? 'Provider added to shortlist.'
    : null
  const requestAccessUrl = await getJobRequestAccessUrl(resolved.request.id, 'request_submitted').catch(() => null)

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{provider.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {provider.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={provider.avatarUrl}
              alt={`${provider.name} profile`}
              className="h-24 w-24 rounded-full object-cover"
            />
          )}
          {provider.bio ? <p className="text-muted-foreground">{provider.bio}</p> : <p className="text-muted-foreground">Profile details coming soon.</p>}
          {provider.experience && <p>Experience: {provider.experience}</p>}
          {provider.serviceAreas.length > 0 && <p>Service areas: {provider.serviceAreas.slice(0, 5).join(', ')}</p>}
          {provider.skills.length > 0 && <p>Services: {provider.skills.slice(0, 8).join(', ')}</p>}
          {categoryRates?.callOutFee != null && <p>Call-out fee: R{Math.round(Number(categoryRates.callOutFee))}</p>}
          {categoryRates?.hourlyRate != null && <p>Labour rate: R{Math.round(Number(categoryRates.hourlyRate))}/hour</p>}
          {provider.averageRating > 0 && <p>Rating: {provider.averageRating.toFixed(1)} / 5</p>}
          {provider.completedJobsCount > 0 && <p>Completed jobs: {provider.completedJobsCount}</p>}
          <p>Verified: {provider.verified ? 'Yes' : 'No'}</p>
          <p className="text-muted-foreground">Why matched: {resolved.matchReason}</p>
          {provider.portfolioUrls.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">Work examples</p>
              {provider.portfolioUrls.slice(0, 4).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-primary underline"
                >
                  View portfolio item
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {profileMessage && (
        <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
          <CardContent className="px-4 py-3 text-sm text-[var(--tone-success-fg)]">{profileMessage}</CardContent>
        </Card>
      )}

      <form method="post" action="/api/review-first/provider-profile/shortlist" className="space-y-2">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" className="w-full">Shortlist this provider</Button>
      </form>
      <Button asChild variant="outline" className="w-full">
        <Link href={requestAccessUrl ?? `/requests/${resolved.request.id}`}>Back to request</Link>
      </Button>
    </div>
  )
}
