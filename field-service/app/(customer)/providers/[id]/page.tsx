export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { isEnabled } from '@/lib/flags'
import { Button } from '@/components/ui/button'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const provider = await db.provider.findUnique({
    where: { id },
    select: { name: true, bio: true },
  })

  if (!provider) {
    return buildMetadata({ title: 'Provider Profile' })
  }

  const summary = provider.bio ?? ''
  const description =
    summary.length > 150 ? `${summary.slice(0, 150)}...` : summary

  return buildMetadata({
    title: provider.name,
    description: description || undefined,
  })
}

export default async function CustomerProviderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  const isCustomerSignedIn = session?.role === 'customer'

  const flagEnabled = await isEnabled('feature.customer.provider_browse')
  if (!flagEnabled) redirect('/')

  const { id } = await params

  const provider = await db.provider.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      bio: true,
      experience: true,
      skills: true,
      serviceAreas: true,
      evidenceNote: true,
      portfolioUrls: true,
      verified: true,
    },
  })

  if (!provider) notFound()

  const jobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: 'COMPLETED',
    },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
    take: 25,
  })

  const reviews = await db.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      jobId: { in: jobs.map((job) => job.id) },
    },
    orderBy: { createdAt: 'desc' },
  })

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length
    : null
  const trustSignals = buildProviderTrustSignals({
    marketplaceApproved: provider.verified,
    skills: provider.skills,
    serviceAreas: provider.serviceAreas,
    experience: provider.experience,
    evidenceNote: provider.evidenceNote,
    completedJobs: jobs.length,
    reviewCount: reviews.length,
    averageRating,
  })

  const bookingCategory = provider.skills[0] ?? 'general'
  const bookingUrl = `/book/${encodeURIComponent(bookingCategory)}?provider=${encodeURIComponent(
    provider.id,
  )}`

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        {isCustomerSignedIn ? (
          <Link
            href="/bookings"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
          ← My bookings
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold mt-1">{provider.name}</h1>
        <p className="text-sm text-muted-foreground">
          {provider.verified ? 'Reviewed marketplace profile' : 'Provider profile'}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request this provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isCustomerSignedIn ? (
            <Button asChild className="w-full">
              <Link href={bookingUrl}>Book</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/sign-in?next=${encodeURIComponent(`/providers/${provider.id}`)}`}>
                Sign in to book
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {provider.bio && <p>{provider.bio}</p>}
          <ProviderTrustSignals signals={trustSignals} />
          {provider.portfolioUrls.length > 0 && (
            <div className="rounded-lg border px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">Portfolio links</p>
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Provider-shared evidence
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {provider.portfolioUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all text-sm text-primary hover:underline"
                  >
                    {url}
                  </a>
                ))}
              </div>
            </div>
          )}
          <ProviderTrustNote marketplaceApproved={provider.verified} className="pt-1" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent reviews
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {reviews.length === 0 ? (
            <p className="text-muted-foreground">
              This provider has completed jobs through Plug A Pro, but no customer reviews are visible yet.
            </p>
          ) : (
            reviews.map((review) => {
              const job = jobs.find((entry) => entry.id === review.jobId)
              return (
                <div key={review.id} className="rounded-lg border px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{'★'.repeat(review.score)}{'☆'.repeat(5 - review.score)}</p>
                    <span className="text-xs text-muted-foreground">
                      {review.createdAt.toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  {review.comment && <p className="mt-2 text-muted-foreground">{review.comment}</p>}
                  {job && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {job.booking.match.jobRequest.category} job for {job.booking.match.jobRequest.customer.name}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
