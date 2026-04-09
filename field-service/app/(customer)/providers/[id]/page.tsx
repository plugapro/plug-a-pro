export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Provider Profile', noIndex: true })

export default async function CustomerProviderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    redirect('/sign-in')
  }

  const customer = await db.customer.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })

  if (!customer) redirect('/bookings')

  const { id } = await params

  const hasRelationship = await db.jobRequest.findFirst({
    where: {
      customerId: customer.id,
      match: { providerId: id },
    },
    select: { id: true },
  })

  if (!hasRelationship) {
    redirect('/bookings')
  }

  const provider = await db.provider.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      bio: true,
      skills: true,
      serviceAreas: true,
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

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        <Link href="/bookings" className="text-xs text-muted-foreground hover:text-foreground">
          ← My bookings
        </Link>
        <h1 className="text-xl font-semibold mt-1">{provider.name}</h1>
        <p className="text-sm text-muted-foreground">
          {provider.verified ? 'Verified provider' : 'Provider profile'}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {provider.bio && <p>{provider.bio}</p>}
          {provider.skills.length > 0 && <Row label="Skills">{provider.skills.join(', ')}</Row>}
          {provider.serviceAreas.length > 0 && (
            <Row label="Service areas">{provider.serviceAreas.join(', ')}</Row>
          )}
          <Row label="Completed jobs">{jobs.length}</Row>
          <Row label="Average rating">
            {averageRating ? `${averageRating.toFixed(1)} / 5` : 'No ratings yet'}
          </Row>
          <Row label="Reviews">{reviews.length}</Row>
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
              This provider has completed jobs through Plug-A-Pro, but no customer reviews are visible yet.
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}
