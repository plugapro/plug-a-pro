// ─── Customer: Booking detail ─────────────────────────────────────────────────
// Shows tracking timeline, provider status, invoice link, and rating prompt.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Booking Details' })

const JOB_TIMELINE: Array<{ status: string; label: string; description: string }> = [
  { status: 'SCHEDULED',         label: 'Provider assigned',    description: 'A provider has been assigned to your job' },
  { status: 'EN_ROUTE',          label: 'On the way',            description: 'Your provider is travelling to you' },
  { status: 'ARRIVED',           label: 'Arrived',               description: 'Your provider is on site' },
  { status: 'STARTED',           label: 'Work started',          description: 'Work is in progress' },
  { status: 'AWAITING_APPROVAL', label: 'Your approval needed',  description: 'Review additional work request' },
  { status: 'COMPLETED',         label: 'Completed',             description: 'Your job is complete' },
]

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const { id } = await params

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: true,
              address: true,
            },
          },
          provider: { select: { name: true } },
        },
      },
      quote: true,
      payment: true,
      invoice: true,
      job: {
        include: {
          statusHistory: { orderBy: { timestamp: 'asc' } },
          extras: { where: { status: 'PENDING' } },
          photos: true,
        },
      },
    },
  })

  if (!booking) notFound()

  const customer = booking.match.jobRequest.customer
  const address = booking.match.jobRequest.address

  // Verify ownership
  if (customer.userId !== session.id) {
    redirect('/bookings')
  }

  // Check for existing rating
  const existingRating = await db.review.findFirst({
    where: { jobId: booking.job?.id ?? '', reviewerType: 'CUSTOMER' },
  })

  const currentJobStatus = booking.job?.status
  const currentStatusIndex = JOB_TIMELINE.findIndex((s) => s.status === currentJobStatus)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const canCancel =
    booking.status === 'SCHEDULED' || booking.status === 'RESCHEDULED'

  async function cancelBooking() {
    'use server'
    const { getSession: getsess } = await import('@/lib/auth')
    const sess = await getsess()
    if (!sess) redirect('/sign-in')

    const b = await db.booking.findUnique({
      where: { id },
      select: {
        status: true,
        match: {
          select: {
            jobRequest: { select: { customer: { select: { userId: true } } } },
          },
        },
      },
    })
    if (!b) notFound()
    if (b.match.jobRequest.customer?.userId !== sess.id) redirect('/bookings')
    if (b.status !== 'SCHEDULED' && b.status !== 'RESCHEDULED') redirect(`/bookings/${id}`)

    await db.booking.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })

    redirect('/bookings')
  }

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href="/bookings" className="text-xs text-muted-foreground hover:text-foreground">
            ← My Bookings
          </Link>
          <h1 className="text-xl font-semibold mt-1">
            {booking.job?.id ? `Job #${booking.id.slice(-8).toUpperCase()}` : `Booking #${booking.id.slice(-8).toUpperCase()}`}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            {booking.id.slice(-8).toUpperCase()}
          </p>
        </div>
        {booking.job
          ? <StatusBadge status={booking.job.status} type="job" />
          : <StatusBadge status={booking.status} type="booking" />}
      </div>

      {/* Details */}
      <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
        <Row label="Date">
          {booking.scheduledDate
            ? booking.scheduledDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
            : 'TBC'}
          {booking.scheduledWindow ? ` · ${booking.scheduledWindow}` : ''}
        </Row>
        {address && (
          <Row label="Address">
            {address.street}, {address.suburb}, {address.city}
          </Row>
        )}
        {booking.match.provider && (
          <Row label="Provider">{booking.match.provider.name}</Row>
        )}
        <Row label="Total">R {Number(booking.quote.amount).toFixed(2)}</Row>
      </div>

      {/* Pending approval */}
      {currentJobStatus === 'AWAITING_APPROVAL' && booking.job?.extras[0] && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-900/10 p-4 space-y-3">
          <p className="font-medium text-orange-800 dark:text-orange-300">
            Additional work needs your approval
          </p>
          <p className="text-sm">
            {booking.job.extras[0].description} —{' '}
            <span className="font-medium">R {Number(booking.job.extras[0].amount).toFixed(2)}</span>
          </p>
          <Button asChild className="bg-orange-600 hover:bg-orange-700 text-white">
            <a href={`${appUrl}/approve/${booking.job.extras[0].approvalToken}`}>
              Review &amp; approve
            </a>
          </Button>
        </div>
      )}

      {/* Job timeline */}
      {booking.job && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Job progress
          </h2>
          <div className="space-y-0">
            {JOB_TIMELINE.map((step, i) => {
              const isDone    = currentStatusIndex > i
              const isCurrent = currentStatusIndex === i
              return (
                <div key={step.status} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`mt-1 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                      isDone    ? 'border-green-500 bg-green-500'
                      : isCurrent ? 'border-foreground bg-foreground'
                      : 'border-muted-foreground/30 bg-transparent'
                    }`} />
                    {i < JOB_TIMELINE.length - 1 && (
                      <div className={`w-0.5 flex-1 my-0.5 ${isDone ? 'bg-green-500' : 'bg-border'}`} />
                    )}
                  </div>
                  <div className={`pb-4 ${isCurrent ? '' : isDone ? 'opacity-70' : 'opacity-30'}`}>
                    <p className={`text-sm ${isCurrent ? 'font-medium' : ''}`}>{step.label}</p>
                    {isCurrent && (
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Invoice */}
      {booking.invoice && (
        <Card>
          <CardContent className="px-4 py-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Invoice #{booking.invoice.number}</p>
              <p className="text-xs text-muted-foreground">
                R {Number(booking.invoice.totalAmount).toFixed(2)}
              </p>
            </div>
            {booking.invoice.pdfUrl ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={booking.invoice.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download PDF
                </a>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Generating…</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rating prompt */}
      {booking.status === 'COMPLETED' && !existingRating && booking.job && (
        <Link
          href={`/bookings/${booking.id}/rate`}
          className="block w-full rounded-xl border-2 border-dashed p-4 text-center text-sm text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
        >
          Rate your experience →
        </Link>
      )}
      {existingRating && (
        <div className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">
          You rated this {existingRating.score}/5 — thank you!
        </div>
      )}

      {/* Cancel booking */}
      {canCancel && (
        <form action={cancelBooking}>
          <Button variant="destructive" className="w-full" type="submit">
            Cancel booking
          </Button>
        </form>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
      <span>{children}</span>
    </div>
  )
}
