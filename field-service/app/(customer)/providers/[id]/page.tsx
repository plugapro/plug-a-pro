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
import { Badge } from '@/components/ui/badge'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

const CATEGORY_LABELS = new Map(SERVICE_CATEGORY_OPTIONS.map((option) => [option.tag, option.label]))

function labelForCategory(tag: string) {
  return CATEGORY_LABELS.get(tag) ?? tag.replaceAll('_', ' ')
}

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
      avatarUrl: true,
      bio: true,
      experience: true,
      skills: true,
      serviceAreas: true,
      evidenceNote: true,
      portfolioUrls: true,
      verified: true,
      providerCategories: {
        where: { approvalStatus: 'APPROVED' },
        select: {
          categorySlug: true,
          subServices: true,
          yearsExperience: true,
        },
        orderBy: { categorySlug: 'asc' },
      },
      providerRates: {
        select: {
          categorySlug: true,
          callOutFee: true,
          hourlyRate: true,
          rateNegotiable: true,
        },
        orderBy: { categorySlug: 'asc' },
      },
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
                select: { category: true },
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

  const bookingCategory = provider.providerCategories[0]?.categorySlug ?? provider.skills[0] ?? 'other'
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
        <CardContent className="pt-5">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-2xl border bg-muted">
              {provider.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={provider.avatarUrl} alt={`${provider.name} profile photo`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No photo
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {provider.providerCategories.length > 0
                  ? labelForCategory(provider.providerCategories[0].categorySlug)
                  : 'General services'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {provider.experience || 'Profile details coming soon'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {provider.verified ? <Badge variant="success">Reviewed</Badge> : null}
                {provider.serviceAreas.length > 0 ? (
                  <Badge variant="outline">{provider.serviceAreas[0]}</Badge>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request service
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isCustomerSignedIn ? (
            <Button asChild className="w-full">
              <Link href={bookingUrl}>Request service from this provider</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/sign-in?next=${encodeURIComponent(bookingUrl)}`}>
                Sign in to request service
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
          {provider.bio ? (
            <p>{provider.bio}</p>
          ) : (
            <p className="text-muted-foreground">Profile details coming soon.</p>
          )}

          {provider.providerCategories.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium">Services and experience</p>
              {provider.providerCategories.map((category) => {
                const rate = provider.providerRates.find((item) => item.categorySlug === category.categorySlug)
                return (
                  <div key={category.categorySlug} className="rounded-lg border px-3 py-3">
                    <p className="font-medium">{labelForCategory(category.categorySlug)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {category.yearsExperience != null
                        ? `${category.yearsExperience} years experience`
                        : provider.experience || 'Experience details coming soon'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rate?.callOutFee != null ? `Call-out fee: R${rate.callOutFee.toNumber()}` : 'Call-out fee on request'}
                      {rate?.hourlyRate != null ? ` · Hourly rate: R${rate.hourlyRate.toNumber()}` : ''}
                      {rate ? ` · ${rate.rateNegotiable ? 'Rate negotiable' : 'Fixed rate'}` : ''}
                    </p>
                    {category.subServices.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {category.subServices.map((service) => (
                          <Badge key={service} variant="neutral">
                            {service}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

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
                      {job.booking.match.jobRequest.category} — Verified customer
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
