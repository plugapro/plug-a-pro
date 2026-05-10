// ─── Customer: Booking detail ─────────────────────────────────────────────────
// Shows tracking timeline, provider status, work evidence, and rating prompt.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { cancelBookingLifecycle } from '@/lib/bookings'
import { BOOKING_CANCEL_REASONS } from '@/lib/booking-cancel-reasons'
import { transitionJob } from '@/lib/jobs'
import { recordAuditLog } from '@/lib/audit'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { buildClientPwaJobTrackingSteps } from '@/lib/client-pwa-job-tracking'
import { AutoRefresh } from '@/components/customer/AutoRefresh'

export const metadata = buildMetadata({ title: 'Booking Details' })

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ reschedule?: string }>
}) {
  const { id } = await params
  const { reschedule } = await searchParams
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}`)}`)

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { id: true } },
              address: true,
            },
          },
          provider: { select: { id: true, name: true } },
          quotes: { orderBy: { createdAt: 'desc' } },
        },
      },
      quote: true,
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

  const bookingCustomer = booking.match.jobRequest.customer
  const customer = await resolveCustomerForSession(db, session)
  const address = booking.match.jobRequest.address

  // Verify ownership
  if (!customer || bookingCustomer.id !== customer.id) {
    redirect('/bookings')
  }

  // Check for existing rating
  const existingRating = await db.review.findFirst({
    where: { jobId: booking.job?.id ?? '', reviewerType: 'CUSTOMER' },
  })

  const currentJobStatus = booking.job?.status
  const trackingSteps = booking.job
    ? buildClientPwaJobTrackingSteps({
        status: currentJobStatus ?? null,
        arrivalTimeConfirmedAt: booking.job.arrivalTimeConfirmedAt,
      })
    : []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const disputes = booking.job
    ? await db.dispute.findMany({
        where: { jobId: booking.job.id },
        orderBy: { createdAt: 'desc' },
      })
    : []
  const hasOpenDispute = disputes.some((dispute) => ['OPEN', 'UNDER_REVIEW'].includes(dispute.status))

  const canCancel =
    booking.status === 'SCHEDULED' || booking.status === 'RESCHEDULED'

  const canReschedule =
    booking.status === 'SCHEDULED' || booking.status === 'RESCHEDULED'

  async function cancelBooking(formData: FormData) {
    'use server'
    const { getSession: getsess } = await import('@/lib/auth')
    const sess = await getsess()
    if (!sess) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}`)}`)

    const b = await db.booking.findUnique({
      where: { id },
      select: {
        status: true,
        match: {
          select: {
            jobRequest: { select: { customer: { select: { id: true } } } },
          },
        },
      },
    })
    if (!b) notFound()
    const currentCustomer = await resolveCustomerForSession(db, sess)
    if (!currentCustomer || b.match.jobRequest.customer?.id !== currentCustomer.id) redirect('/bookings')
    if (b.status !== 'SCHEDULED' && b.status !== 'RESCHEDULED') redirect(`/bookings/${id}`)

    // Build a human-readable reason from the form fields.
    const cancelReason = String(formData.get('cancelReason') ?? '').trim()
    const cancelNote = String(formData.get('cancelNote') ?? '').trim()
    const reason = [cancelReason || 'Cancelled by customer', cancelNote].filter(Boolean).join(' — ')

    await cancelBookingLifecycle({
      bookingId: id,
      actorId: sess.id,
      actorRole: 'customer',
      reason,
    })

    redirect('/bookings')
  }

  async function confirmCompletion() {
    'use server'
    const { getSession: getActiveSession } = await import('@/lib/auth')
    const activeSession = await getActiveSession()
    if (!activeSession || activeSession.role !== 'customer') redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}`)}`)

    const freshBooking = await db.booking.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            jobRequest: { include: { customer: { select: { id: true } } } },
          },
        },
        job: { select: { id: true, status: true } },
      },
    })

    if (!freshBooking || !freshBooking.job) redirect('/bookings')
    const currentCustomer = await resolveCustomerForSession(db, activeSession)
    if (!currentCustomer || freshBooking.match.jobRequest.customer.id !== currentCustomer.id) redirect('/bookings')
    if (freshBooking.job.status !== 'PENDING_COMPLETION_CONFIRMATION') redirect(`/bookings/${id}`)

    await transitionJob({
      jobId: freshBooking.job.id,
      toStatus: 'COMPLETED',
      actorId: activeSession.id,
      actorRole: 'customer',
      notes: 'Customer confirmed job completion from booking page',
    })

    redirect(`/bookings/${id}`)
  }

  async function raiseDispute(formData: FormData) {
    'use server'
    const { getSession: getActiveSession } = await import('@/lib/auth')
    const activeSession = await getActiveSession()
    if (!activeSession || activeSession.role !== 'customer') redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}`)}`)

    const freshBooking = await db.booking.findUnique({
      where: { id },
      include: {
        match: {
          include: {
            jobRequest: { include: { customer: { select: { id: true } } } },
          },
        },
        job: { select: { id: true } },
      },
    })

    if (!freshBooking || !freshBooking.job) redirect('/bookings')
    const currentCustomer = await resolveCustomerForSession(db, activeSession)
    if (!currentCustomer || freshBooking.match.jobRequest.customer.id !== currentCustomer.id) redirect('/bookings')

    const reason = String(formData.get('reason') ?? '').trim()
    if (reason.length < 10) redirect(`/bookings/${id}`)

    const existing = await db.dispute.findFirst({
      where: {
        jobId: freshBooking.job.id,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
      select: { id: true },
    })

    if (!existing) {
      await db.dispute.create({
        data: {
          jobId: freshBooking.job.id,
          raisedById: activeSession.id,
          raisedByRole: 'customer',
          reason,
          status: 'OPEN',
        },
      })

      await recordAuditLog({
        actorId: activeSession.id,
        actorRole: 'customer',
        action: 'dispute.raise',
        entityType: 'job',
        entityId: freshBooking.job.id,
        after: {
          disputeRaised: true,
          raisedByRole: 'customer',
          reason,
        },
      })
    }

    redirect(`/bookings/${id}`)
  }

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <AutoRefresh terminalState={booking.status === 'CANCELLED' || booking.status === 'COMPLETED'} />
      {/* Reschedule requested banner */}
      {reschedule === 'requested' && (
        <AlertCallout
          tone="success"
          title="Reschedule request sent"
        >
          We&apos;ll contact both you and the provider to arrange a new time.
        </AlertCallout>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href="/bookings" className="text-xs text-muted-foreground hover:text-foreground">
            ← My Requests & Bookings
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
          <Row label="Provider">
            <Link href={`/providers/${booking.match.provider.id}`} className="text-primary hover:underline">
              {booking.match.provider.name}
            </Link>
          </Row>
        )}
        <Row label="Total">R {Number(booking.quote.amount).toFixed(2)}</Row>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Quote history</p>
            <p className="text-sm text-muted-foreground">
              Review each quote version, customer feedback, and the accepted pricing record.
            </p>
          </div>
          <QuoteHistoryTimeline
            audience="customer"
            quotes={booking.match.quotes.map((quote) => ({
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
            }))}
          />
        </CardContent>
      </Card>

      {/* Pending approval */}
      {currentJobStatus === 'AWAITING_APPROVAL' && booking.job?.extras[0] && (
        <AlertCallout
          tone="warning"
          title="Additional work needs your approval"
          action={
            <Button asChild size="sm">
              <a href={`${appUrl}/approve/${booking.job.extras[0].approvalToken}`}>
                Review
              </a>
            </Button>
          }
        >
          {booking.job.extras[0].description} —{' '}
          <span className="font-semibold">
            R {Number(booking.job.extras[0].amount).toFixed(2)}
          </span>
        </AlertCallout>
      )}

      {currentJobStatus === 'PENDING_COMPLETION_CONFIRMATION' && booking.job && (
        <AlertCallout
          tone="success"
          title="Your provider has marked the work as complete"
        >
          <p>
            Review the job photos and details above. If the work is complete, confirm it here so we can close the job and ask for your review.
          </p>
          <form action={confirmCompletion} className="mt-3">
            <Button type="submit" className="w-full">
              Confirm completion
            </Button>
          </form>
        </AlertCallout>
      )}

      {/* Job timeline — 9-step blueprint timeline driven by buildClientPwaJobTrackingSteps */}
      {booking.job && trackingSteps.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-0">
            <p className="text-sm font-medium mb-3 uppercase tracking-wide text-muted-foreground">Job progress</p>
            {trackingSteps.map((step, index) => (
              <div key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`mt-1 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                    step.done    ? 'border-primary bg-primary'
                    : step.current ? 'border-foreground bg-foreground'
                    : 'border-muted-foreground/30 bg-transparent'
                  }`} />
                  {index < trackingSteps.length - 1 && (
                    <div className={`w-0.5 flex-1 my-0.5 ${step.done ? 'bg-primary' : 'bg-border'}`} />
                  )}
                </div>
                <div className={`pb-4 ${step.current ? '' : step.done ? 'opacity-70' : 'opacity-30'}`}>
                  <p className={`text-sm ${step.current ? 'font-medium' : ''}`}>{step.label}</p>
                  {step.current && (
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {booking.job && (
        <Card>
          <CardContent className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-medium">Work evidence</p>
              <p className="text-sm text-muted-foreground">
                Photos uploaded from site help confirm what was done.
              </p>
            </div>

            {booking.job.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {booking.job.photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <a href={`/api/attachments/${photo.id}`} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/attachments/${photo.id}`}
                        alt={photo.caption ?? photo.label ?? 'Work evidence'}
                        className="h-40 w-full rounded-lg object-cover"
                      />
                    </a>
                    {(photo.caption || photo.label) && (
                      <p className="text-xs text-muted-foreground">
                        {photo.caption ?? photo.label}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No work photos have been uploaded yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completion card — blueprint: "Job completed / Please confirm everything is in order." */}
      {booking.job?.status === 'COMPLETED' && (
        <Card>
          <CardContent className="space-y-3 px-4 py-4 text-sm">
            <p className="font-medium">Job completed</p>
            <p className="text-muted-foreground">Please confirm everything is in order.</p>
            <div className="grid grid-cols-2 gap-2">
              {!existingRating ? (
                <Button asChild className="w-full">
                  <Link href={`/bookings/${booking.id}/rate`}>Rate provider</Link>
                </Button>
              ) : (
                <div className="flex items-center justify-center rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  Rated {existingRating.score}/5 — thank you!
                </div>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link href={`/book/${encodeURIComponent(booking.match.jobRequest.category)}`}>Book again</Link>
              </Button>
            </div>
            <Button asChild variant="ghost" className="w-full">
              <a href={`/api/customer/bookings/${booking.id}/invoice`} download>
                View invoice / receipt
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {booking.job && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-medium text-sm">Need help with this job?</p>
              <p className="text-sm text-muted-foreground">
                Raise an issue with Plug A Pro support and we&apos;ll review the quote, photos, and job history on record.
              </p>
            </div>

            {disputes.length > 0 && (
              <div className="space-y-2">
                {disputes.map((dispute) => (
                  <div key={dispute.id} className="rounded-lg border px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">Issue #{dispute.id.slice(-8).toUpperCase()}</p>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {dispute.status.replaceAll('_', ' ').toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-2 text-muted-foreground">{dispute.reason}</p>
                    {dispute.resolution && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Resolution: {dispute.resolution}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!hasOpenDispute && (
              <form action={raiseDispute} className="space-y-3">
                <textarea
                  name="reason"
                  minLength={10}
                  required
                  placeholder="Describe the issue so support can review it."
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button type="submit" variant="outline" className="w-full">
                  Raise an issue with support
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reschedule booking */}
      {canReschedule && (
        <Button asChild variant="outline" className="w-full">
          <Link href={`/bookings/${id}/reschedule`}>Request reschedule</Link>
        </Button>
      )}

      {/* Cancel booking */}
      {canCancel && (
        <form action={cancelBooking} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="cancelReason" className="text-sm text-muted-foreground">
              Reason for cancelling
            </label>
            <select
              id="cancelReason"
              name="cancelReason"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
              required
            >
              <option value="" disabled>Select a reason…</option>
              {BOOKING_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="cancelNote" className="text-sm text-muted-foreground">
              Additional notes <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              id="cancelNote"
              name="cancelNote"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="Any extra details…"
            />
          </div>
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
