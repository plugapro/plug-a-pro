// ─── Customer: Booking detail ─────────────────────────────────────────────────
// Shows tracking timeline, provider status, work evidence and rating prompt.

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
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { buildClientPwaJobTrackingSteps } from '@/lib/client-pwa-job-tracking'
import { AutoRefresh } from '@/components/customer/AutoRefresh'
import { ChevronLeft, Wrench, MapPin, Star } from 'lucide-react'
import { getCustomerBookingDetailForViewer } from '@/lib/booking-detail-loaders'

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

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) redirect('/bookings')

  const detail = await getCustomerBookingDetailForViewer({
    route: '/bookings/[id]',
    viewerUserId: session.id,
    viewerCustomerId: customer.id,
    bookingId: id,
  })

  if (!detail.ok) {
    if (detail.error === 'not_found') notFound()
    if (detail.error === 'unauthorized') redirect('/bookings')
    return (
      <div className="min-h-screen px-[18px] pt-[80px] pb-10">
        <div className="rounded-[20px] bg-card p-5 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-sm font-semibold text-[var(--ink)]">Could not load this booking right now.</p>
          <p className="mt-1 text-[13px] text-[var(--ink-mute)]">
            Please return to your bookings list and try again.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/bookings">View my bookings</Link>
          </Button>
        </div>
      </div>
    )
  }

  const { booking, addressDisplay, providerDisplayName, providerInitials } = detail.data

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

  const heroHue =
    currentJobStatus === 'COMPLETED' || booking.status === 'COMPLETED' ? '#0FA28A' :
    booking.status === 'CANCELLED' ? '#E5484D' : '#8B3FE8'

  const rawStatus = currentJobStatus ?? booking.status
  const STATUS_MAP: Record<string, { label: string; tone: string }> = {
    SCHEDULED: { label: 'Scheduled', tone: '#8B3FE8' },
    RESCHEDULED: { label: 'Rescheduled', tone: '#FFC22B' },
    COMPLETED: { label: 'Completed', tone: '#0FA28A' },
    CANCELLED: { label: 'Cancelled', tone: '#E5484D' },
    IN_PROGRESS: { label: 'In progress', tone: '#2A78F0' },
    EN_ROUTE: { label: 'En route', tone: '#0FA28A' },
    ARRIVED: { label: 'Arrived', tone: '#0FA28A' },
    PENDING_COMPLETION_CONFIRMATION: { label: 'Needs confirmation', tone: '#FFC22B' },
    AWAITING_APPROVAL: { label: 'Needs approval', tone: '#FFC22B' },
  }
  const { label: statusLabel, tone: statusTone } =
    STATUS_MAP[rawStatus] ?? { label: rawStatus.replace(/_/g, ' ').toLowerCase(), tone: '#8B3FE8' }

  const formattedDate = booking.scheduledDate
    ? booking.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
    : 'TBC'
  const formattedAmount = booking.quote?.amount
    ? `R${Number(booking.quote.amount).toFixed(0)}`
    : '-'

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
    const reason = [cancelReason || 'Cancelled by customer', cancelNote].filter(Boolean).join(' - ')

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
    <div className="min-h-screen pb-32 screen-enter">
      <AutoRefresh terminalState={booking.status === 'CANCELLED' || booking.status === 'COMPLETED'} />

      {/* Hero band */}
      <div className="relative h-[180px] overflow-hidden"
           style={{ background: `linear-gradient(135deg, ${heroHue}, ${heroHue}bb)` }}>
        <div aria-hidden className="absolute inset-0"
             style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 16px)' }} />
        <div className="absolute top-[60px] left-4">
          <Link href="/bookings"
                className="flex items-center justify-center w-[38px] h-[38px] rounded-[12px] text-white"
                style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)' }}>
            <ChevronLeft size={18} />
          </Link>
        </div>
      </div>

      {/* Floating identity card */}
      <div className="px-[18px] -mt-[64px] relative">
        <div className="rounded-[20px] p-4"
             style={{ background: 'var(--card)', boxShadow: '0 4px 24px rgba(15,15,30,0.10), inset 0 0 0 1px var(--border)' }}>

          {/* Category icon + title + status chip */}
          <div className="flex gap-3 items-start">
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
                 style={{ background: `${heroHue}18`, color: heroHue }}>
              <Wrench size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-bold tracking-[-0.02em] leading-tight capitalize"
                   style={{ color: 'var(--ink)' }}>
                {booking.match.jobRequest.category}
              </div>
              <div className="text-[11px] tracking-[0.04em] mt-0.5"
                   style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--ink-soft)' }}>
                PAP-{booking.id.slice(-4).toUpperCase()}
              </div>
            </div>
            <div className="flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-[11.5px] font-semibold shrink-0"
                 style={{ background: `${statusTone}18`, color: statusTone }}>
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusTone }} />
              {statusLabel}
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 mt-4 rounded-[14px] overflow-hidden gap-px"
               style={{ background: 'var(--border)' }}>
            {[
              { label: 'Date', value: formattedDate },
              { label: 'Quote', value: formattedAmount },
              { label: 'Window', value: booking.scheduledWindow ?? '-' },
            ].map((s) => (
              <div key={s.label} className="py-3 px-2 text-center"
                   style={{ background: 'var(--card)' }}>
                <div className="text-[11px]" style={{ color: 'var(--ink-mute)' }}>{s.label}</div>
                <div className="text-[13px] font-bold tracking-[-0.02em] mt-0.5 truncate"
                     style={{ color: 'var(--ink)' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Provider row */}
          {booking.match.provider && (
            <div className="flex items-center gap-3 mt-4 pt-4"
                 style={{ borderTop: '1px solid var(--border)' }}>
              <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                   style={{ background: `linear-gradient(135deg, ${heroHue}, #8B3FE8)` }}>
                {providerInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
                  {providerDisplayName}
                </div>
                <div className="text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>Service provider</div>
              </div>
              <div className="flex items-center gap-2">
                {booking.status !== 'CANCELLED' && booking.match.provider.phone && (
                  <a
                    href={`https://wa.me/${booking.match.provider.phone.replace(/^\+/, '').replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 px-3 rounded-[10px] text-[12.5px] font-semibold flex items-center gap-1.5"
                    style={{ background: '#1FAD5218', color: '#1FAD52' }}
                    aria-label={`Message ${providerDisplayName.split(' ')[0]} on WhatsApp`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden>
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                    </svg>
                    Chat
                  </a>
                )}
                <Link href={`/providers/${booking.match.provider.id}`}
                      className="h-8 px-3 rounded-[10px] text-[12.5px] font-semibold flex items-center gap-1.5"
                      style={{ background: 'var(--card-alt)', color: 'var(--ink)' }}>
                  Profile
                </Link>
              </div>
            </div>
          )}

          {/* Address */}
          {addressDisplay && (
            <div className="flex items-start gap-2 mt-3 pt-3"
                 style={{ borderTop: '1px solid var(--border)' }}>
              <MapPin size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--ink-mute)' }} />
              <div className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
                {addressDisplay}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reschedule banner */}
      {reschedule === 'requested' && (
        <div className="px-[18px] mt-4">
          <AlertCallout tone="success" title="Reschedule request sent">
            We&apos;ll contact both you and the provider to arrange a new time.
          </AlertCallout>
        </div>
      )}

      {/* Pending approval alert */}
      {currentJobStatus === 'AWAITING_APPROVAL' && booking.job?.extras[0] && (
        <div className="px-[18px] mt-4">
          <AlertCallout
            tone="warning"
            title="Additional work needs your approval"
            action={
              <Button asChild size="sm">
                <a href={`${appUrl}/approve/${booking.job.extras[0].approvalToken}`}>Review</a>
              </Button>
            }
          >
            {booking.job.extras[0].description} -{' '}
            <span className="font-semibold">R {Number(booking.job.extras[0].amount).toFixed(2)}</span>
          </AlertCallout>
        </div>
      )}

      {/* Completion confirmation */}
      {currentJobStatus === 'PENDING_COMPLETION_CONFIRMATION' && booking.job && (
        <div className="px-[18px] mt-4">
          <div className="rounded-[20px] p-4"
               style={{ background: 'rgba(15,162,138,0.06)', boxShadow: 'inset 0 0 0 1px rgba(15,162,138,0.2)' }}>
            <div className="text-[14px] font-bold mb-1" style={{ color: 'var(--ink)' }}>
              Provider marked the work complete
            </div>
            <p className="text-[12.5px] mb-3" style={{ color: 'var(--ink-mute)' }}>
              Review the photos below. If the work is done, confirm here to close the job.
            </p>
            <form action={confirmCompletion}>
              <FormSubmitButton pendingLabel="Confirming…" className="w-full">Confirm completion</FormSubmitButton>
            </form>
          </div>
        </div>
      )}

      {/* Quote history */}
      <div className="px-[18px] mt-6">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
             style={{ color: 'var(--ink-mute)' }}>
          Quote history
        </div>
        <div className="rounded-[20px] overflow-hidden"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="p-4">
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
          </div>
        </div>
      </div>

      {/* Job progress timeline */}
      {booking.job && trackingSteps.length > 0 && (
        <div className="px-[18px] mt-6">
          <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
               style={{ color: 'var(--ink-mute)' }}>
            Job progress
          </div>
          <div className="rounded-[20px] overflow-hidden"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="py-2 px-4">
              {trackingSteps.map((step, index) => (
                <div key={step.key} className="flex gap-3 py-2">
                  <div className="flex flex-col items-center pt-[3px] shrink-0">
                    <div className="w-3 h-3 rounded-full shrink-0"
                         style={{
                           background: step.done || step.current ? '#8B3FE8' : 'var(--border)',
                           boxShadow: step.current ? '0 0 0 3px rgba(139,63,232,0.18)' : 'none',
                         }} />
                    {index < trackingSteps.length - 1 && (
                      <div className="w-px flex-1 mt-1"
                           style={{ background: step.done ? '#8B3FE8' : 'var(--border)', minHeight: 16 }} />
                    )}
                  </div>
                  <div className={`pb-1 flex-1 ${!step.done && !step.current ? 'opacity-30' : step.done && !step.current ? 'opacity-60' : ''}`}>
                    <div className={`text-[13.5px] ${step.current ? 'font-semibold' : ''}`}
                         style={{ color: 'var(--ink)' }}>
                      {step.label}
                    </div>
                    {step.current && (
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                        {step.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Work evidence */}
      {booking.job && (
        <div className="px-[18px] mt-6">
          <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
               style={{ color: 'var(--ink-mute)' }}>
            Work evidence
          </div>
          {booking.job.photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {booking.job.photos.map((photo) => (
                <a key={photo.id} href={`/api/attachments/${photo.id}`}
                   target="_blank" rel="noopener noreferrer"
                   className="block rounded-[16px] overflow-hidden aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/attachments/${photo.id}`}
                       alt={photo.caption ?? photo.label ?? 'Work evidence'}
                       className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] p-6 text-center"
                 style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
              <div className="text-[13px]" style={{ color: 'var(--ink-mute)' }}>
                No work photos have been uploaded yet.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completion actions */}
      {booking.job?.status === 'COMPLETED' && (
        <div className="px-[18px] mt-6">
          <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
               style={{ color: 'var(--ink-mute)' }}>
            Job complete
          </div>
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {!existingRating ? (
                <Button asChild className="w-full">
                  <Link href={`/bookings/${booking.id}/rate`}>
                    <Star size={15} className="mr-1.5" /> Rate provider
                  </Link>
                </Button>
              ) : (
                <div className="flex items-center justify-center rounded-[12px] h-10 text-[12.5px]"
                     style={{ background: 'var(--card-alt)', color: 'var(--ink-mute)' }}>
                  Rated {existingRating.score}/5 ✓
                </div>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link href={`/book/${encodeURIComponent(booking.match.jobRequest.category)}`}>
                  Book again
                </Link>
              </Button>
            </div>
            <Button asChild variant="ghost" className="w-full">
              <a href={`/api/customer/bookings/${booking.id}/invoice`} download>
                View invoice / receipt
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Dispute section */}
      {booking.job && (
        <div className="px-[18px] mt-6">
          <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
               style={{ color: 'var(--ink-mute)' }}>
            Issues &amp; disputes
          </div>
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="text-[13.5px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>
              Need help with this job?
            </div>
            <div className="text-[12.5px] mb-4" style={{ color: 'var(--ink-mute)' }}>
              Raise an issue and our support team will review quotes, photos and job history on record.
            </div>

            {disputes.length > 0 && (
              <div className="space-y-2 mb-4">
                {disputes.map((dispute) => (
                  <div key={dispute.id} className="rounded-[14px] p-3"
                       style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                        Issue #{dispute.id.slice(-6).toUpperCase()}
                      </span>
                      <span className="text-[10.5px] uppercase tracking-wide px-2 py-0.5 rounded-full"
                            style={
                              dispute.status.startsWith('RESOLVED')
                                ? { background: '#dcfce7', color: '#15803d' }
                                : dispute.status === 'CLOSED'
                                ? { background: 'var(--border)', color: 'var(--ink-mute)' }
                                : { background: '#fef9c3', color: '#92400e' }
                            }>
                        {dispute.status.replaceAll('_', ' ').toLowerCase()}
                      </span>
                    </div>
                    <div className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>{dispute.reason}</div>
                    {dispute.resolution && (
                      <div className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
                        Resolution: {dispute.resolution}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!hasOpenDispute && (
              <form action={raiseDispute} className="space-y-2">
                <textarea
                  name="reason"
                  minLength={10}
                  required
                  placeholder="Describe the issue so support can review it."
                  className="w-full min-h-[80px] rounded-[14px] p-3 text-[13.5px] resize-none outline-none"
                  style={{
                    background: 'var(--card-alt)',
                    boxShadow: 'inset 0 0 0 1px var(--border)',
                    color: 'var(--ink)',
                  }}
                />
                <FormSubmitButton variant="outline" className="w-full" pendingLabel="Sending…">
                  Raise an issue with support
                </FormSubmitButton>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Reschedule + Cancel */}
      {(canReschedule || canCancel) && (
        <div className="px-[18px] mt-6 space-y-3">
          {canReschedule && (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/bookings/${id}/reschedule`}>Request reschedule</Link>
            </Button>
          )}

          {canCancel && (
            <form action={cancelBooking} className="space-y-2">
              <select
                name="cancelReason"
                defaultValue=""
                required
                className="w-full h-12 rounded-[14px] px-3 text-[13.5px] outline-none appearance-none"
                style={{
                  background: 'var(--card)',
                  boxShadow: 'inset 0 0 0 1px var(--border)',
                  color: 'var(--ink)',
                }}
              >
                <option value="" disabled>Select a cancellation reason…</option>
                {BOOKING_CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <textarea
                name="cancelNote"
                rows={2}
                placeholder="Additional notes (optional)"
                className="w-full rounded-[14px] p-3 text-[13.5px] resize-none outline-none"
                style={{
                  background: 'var(--card)',
                  boxShadow: 'inset 0 0 0 1px var(--border)',
                  color: 'var(--ink)',
                }}
              />
              <FormSubmitButton variant="destructive" className="w-full" pendingLabel="Cancelling…">
                Cancel booking
              </FormSubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
