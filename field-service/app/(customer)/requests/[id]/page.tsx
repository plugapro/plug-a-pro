export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Request Details', noIndex: true })

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    redirect('/sign-in')
  }

  const { id } = await params

  const jobRequest = await db.jobRequest.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, userId: true } },
      address: true,
      leads: {
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              skills: true,
            },
          },
        },
        orderBy: { sentAt: 'desc' },
      },
      match: {
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              bio: true,
              skills: true,
              serviceAreas: true,
              verified: true,
            },
          },
          quotes: {
            orderBy: { createdAt: 'desc' },
          },
          booking: {
            include: {
              quote: true,
              payment: true,
              job: true,
            },
          },
        },
      },
    },
  })

  if (!jobRequest) notFound()
  if (jobRequest.customer.userId !== session.id) {
    redirect('/bookings')
  }

  const match = jobRequest.match
  const latestQuote = match?.quotes[0] ?? null
  const booking = match?.booking ?? null
  const provider = match?.provider ?? null

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/bookings" className="text-xs text-muted-foreground hover:text-foreground">
            ← My bookings
          </Link>
          <h1 className="text-xl font-semibold mt-1">Request #{jobRequest.id.slice(-8).toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground capitalize">{jobRequest.category}</p>
        </div>
        <StatusBadge status={jobRequest.status} type="jobRequest" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{jobRequest.title}</p>
            <p className="text-muted-foreground mt-1">{jobRequest.description}</p>
          </div>
          {jobRequest.address && (
            <Row label="Address">
              {jobRequest.address.street}, {jobRequest.address.suburb}, {jobRequest.address.city}
            </Row>
          )}
          <Row label="Created">
            {jobRequest.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {jobRequest.expiresAt && (
            <Row label="Match window">
              Until {jobRequest.expiresAt.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
        </CardContent>
      </Card>

      {provider && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Matched provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{provider.name}</p>
                {provider.bio && <p className="text-muted-foreground mt-1">{provider.bio}</p>}
              </div>
              {match && <StatusBadge status={match.status} type="match" />}
            </div>
            {provider.skills.length > 0 && (
              <Row label="Skills">{provider.skills.join(', ')}</Row>
            )}
            {provider.serviceAreas.length > 0 && (
              <Row label="Areas">{provider.serviceAreas.join(', ')}</Row>
            )}
            <Button asChild variant="outline" className="w-full">
              <Link href={`/providers/${provider.id}`}>View provider profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {latestQuote && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Quote history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <QuoteHistoryTimeline
              audience="customer"
              quotes={match?.quotes.map((quote) => ({
                id: quote.id,
                amount: Number(quote.amount),
                labourCost: Number(quote.labourCost),
                materialsCost: Number(quote.materialsCost),
                description: quote.description,
                status: quote.status,
                estimatedHours: quote.estimatedHours,
                preferredDate: quote.preferredDate,
                validUntil: quote.validUntil,
                createdAt: quote.createdAt,
                approvedAt: quote.approvedAt,
                declinedAt: quote.declinedAt,
                notes: quote.notes,
                approvalToken: quote.approvalToken,
              })) ?? []}
            />
          </CardContent>
        </Card>
      )}

      {booking ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Booking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {booking.scheduledDate
                    ? booking.scheduledDate.toLocaleDateString('en-ZA', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })
                    : 'Date to be confirmed'}
                </p>
                {booking.scheduledWindow && (
                  <p className="text-muted-foreground">{booking.scheduledWindow}</p>
                )}
              </div>
              {booking.job ? (
                <StatusBadge status={booking.job.status} type="job" />
              ) : (
                <StatusBadge status={booking.status} type="booking" />
              )}
            </div>
            <Button asChild className="w-full">
              <Link href={`/bookings/${booking.id}`}>Open booking details</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Matching activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {jobRequest.leads.length === 0 ? (
              <p className="text-muted-foreground">
                We&apos;re still validating the request before it is sent to providers.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  {jobRequest.leads.length} provider{jobRequest.leads.length === 1 ? '' : 's'} notified so far.
                </p>
                <div className="space-y-2">
                  {jobRequest.leads.map((lead) => (
                    <div key={lead.id} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{lead.provider.name}</p>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {lead.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Sent {lead.sentAt.toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
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
