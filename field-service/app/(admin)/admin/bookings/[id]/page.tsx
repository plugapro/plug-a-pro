// ─── Admin: Booking detail ─────────────────────────────────────────────────────
// Full booking view with customer info, job timeline, extras, photos, and admin actions.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { cancelBookingLifecycle } from '@/lib/bookings'
import { getBookingAdminMessage } from '@/lib/admin-action-messages'
import { CrudActionError, crudAction } from '@/lib/crud-action'
import { isEnabled } from '@/lib/flags'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { buildMetadata } from '@/lib/metadata'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { Metadata } from 'next'
import { CaseActivityTimeline } from '../../_components/case-activity-timeline'
import { CaseNotes } from '../../_components/case-notes'
import { ResolveCaseDialog } from '../../_components/resolve-case-dialog'

const FLAG = 'admin.crud.bookings'
const CASES_FLAG = 'ops.v2.cases'
const CANCEL_ROLES = ['ADMIN', 'OWNER'] as const
const PAYMENT_ROLES = ['FINANCE', 'ADMIN', 'OWNER'] as const
const BookingActionSchema = z.object({
  bookingId: z.string().min(1),
})

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return buildMetadata({ title: `Booking ${id.slice(-8).toUpperCase()}`, noIndex: true })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  const { message } = await searchParams
  const banner = getBookingAdminMessage(message)
  const crudEnabled = await isEnabled(FLAG, admin.id)
  const casesEnabled = await isEnabled(CASES_FLAG, admin.id)

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: true,
              address:  true,
            },
          },
          provider: true,
          quotes: { orderBy: { createdAt: 'desc' } },
        },
      },
      quote:   true,
      payment: true,
      invoice: true,
      job: {
        include: {
          photos:        { orderBy: { createdAt: 'asc' } },
          extras:        { orderBy: { createdAt: 'asc' } },
          statusHistory: { orderBy: { timestamp: 'asc' } },
        },
      },
    },
  })

  if (!booking) {
    notFound()
  }

  const ref = booking.id.slice(-8).toUpperCase()
  const canCancel =
    booking.status !== 'COMPLETED' && booking.status !== 'CANCELLED'
  const bookingStatusBefore = booking.status
  const bookingCancelReasonBefore = booking.cancelReason ?? null
  const paymentStatusBefore = booking.payment?.status ?? null

  // ─── Server actions ──────────────────────────────────────────────────────────

  async function cancelBooking() {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      await crudAction({
        entity: 'Booking',
        entityId: id,
        action: 'booking.cancel',
        requiredRole: [...CANCEL_ROLES],
        requiredFlag: FLAG,
        schema: BookingActionSchema,
        input: { bookingId: id },
        before: { status: bookingStatusBefore, cancelReason: bookingCancelReasonBefore },
        run: async () => {
          await cancelBookingLifecycle({
            bookingId: id,
            actorId: activeAdmin.id,
            actorRole: 'admin',
            reason: 'Cancelled by admin from booking detail',
          })
          return {
            id,
            status: 'CANCELLED',
            cancelReason: 'Cancelled by admin from booking detail',
          }
        },
      })
      redirect('/admin/bookings')
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      redirect(`/admin/bookings/${id}?message=booking_cancel_failed`)
    }
  }

  async function markPaid() {
    'use server'
    try {
      const result = await crudAction({
        entity: 'Booking',
        entityId: id,
        action: 'payment.mark_paid',
        requiredRole: [...PAYMENT_ROLES],
        requiredFlag: FLAG,
        schema: BookingActionSchema,
        input: { bookingId: id },
        before: {
          bookingStatus: bookingStatusBefore,
          paymentStatus: paymentStatusBefore,
        },
        run: async (_, tx) => {
          const freshBooking = await tx.booking.findUnique({
            where: { id },
            select: {
              status: true,
              quote: { select: { amount: true } },
              payment: { select: { status: true } },
            },
          })
          if (
            !freshBooking ||
            freshBooking.status !== 'SCHEDULED' ||
            freshBooking.payment?.status === 'PAID'
          ) {
            throw new CrudActionError('CONFLICT', 'Payment cannot be marked as paid for this booking.')
          }
          const amount = freshBooking.quote?.amount ?? 0
          const paidAt = new Date()
          await tx.payment.upsert({
            where: { bookingId: id },
            create: {
              bookingId: id,
              amount,
              status: 'PAID',
              paidAt,
            },
            update: { status: 'PAID', paidAt },
          })
          await tx.booking.update({ where: { id }, data: { status: 'SCHEDULED' } })
          return {
            id,
            bookingStatus: 'SCHEDULED',
            paymentStatus: 'PAID',
          }
        },
      })
      redirect(`/admin/bookings/${result.data.id}?message=payment_marked`)
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      redirect(`/admin/bookings/${id}?message=payment_unavailable`)
    }
  }

  // ─── Case (ops.v2.cases flag) ─────────────────────────────────────────────────

  const activeCase = casesEnabled
    ? await db.case.findFirst({
        where: { entityType: 'BOOKING', entityId: id, state: { in: ['OPEN', 'IN_PROGRESS'] } },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => null)
    : null

  // ─── Render ──────────────────────────────────────────────────────────────────

  const customer        = booking.match?.jobRequest?.customer
  const address         = booking.match?.jobRequest?.address
  const jobRequestTitle = booking.match?.jobRequest?.title ?? '—'
  const jobRequestCategory = booking.match?.jobRequest?.category ?? '—'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/admin/bookings"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Bookings
          </Link>
          <span className="font-mono text-sm font-semibold">{ref}</span>
          <StatusBadge status={booking.status} type="booking" />
        </div>
        <p className="text-sm text-muted-foreground">{jobRequestTitle}</p>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {banner.text}
        </div>
      ) : null}
      {!crudEnabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Booking mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      ) : null}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left column: Details ─────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Booking details card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Booking Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Customer */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Customer</span>
                <div className="col-span-2">
                  <p className="font-medium">{customer?.name ?? '—'}</p>
                  <p className="text-muted-foreground">{customer?.phone ?? ''}</p>
                  {customer?.email && (
                    <p className="text-muted-foreground">{customer.email}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Job Request */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Job Request</span>
                <div className="col-span-2">
                  <p className="font-medium">{jobRequestTitle}</p>
                  <p className="text-muted-foreground">{jobRequestCategory}</p>
                  <p className="font-semibold mt-0.5">R {Number(booking.quote?.amount ?? 0).toFixed(2)}</p>
                </div>
              </div>

              <Separator />

              {/* Provider */}
              {booking.match?.provider && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-muted-foreground font-medium">Provider</span>
                    <div className="col-span-2">
                      <p className="font-medium">{booking.match.provider.name}</p>
                      <p className="text-muted-foreground">{booking.match.provider.phone}</p>
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Address */}
              {address && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-muted-foreground font-medium">Address</span>
                    <div className="col-span-2">
                      <p>{address.street}</p>
                      <p>{address.suburb}, {address.city}</p>
                      <p>{address.province}{address.postalCode ? ` ${address.postalCode}` : ''}</p>
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Scheduled */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Scheduled</span>
                <div className="col-span-2">
                  {booking.scheduledDate ? (
                    <>
                      <p>
                        {booking.scheduledDate.toLocaleDateString('en-ZA', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </p>
                      {booking.scheduledWindow && (
                        <p className="text-muted-foreground">{booking.scheduledWindow}</p>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not scheduled</span>
                  )}
                </div>
              </div>

              {/* Notes */}
              {booking.notes && (
                <>
                  <Separator />
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-muted-foreground font-medium">Notes</span>
                    <p className="col-span-2 whitespace-pre-wrap">{booking.notes}</p>
                  </div>
                </>
              )}

              <Separator />

              {/* Payment status */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Payment</span>
                <div className="col-span-2 flex items-center gap-2">
                  {booking.payment ? (
                    <PaymentStatusBadge
                      status={booking.payment.status}
                      pspProvider={booking.payment.pspProvider}
                      collectionMode={booking.payment.collectionMode}
                    />
                  ) : (
                    <span className="text-muted-foreground">No payment record</span>
                  )}
                  {booking.payment?.paidAt && (
                    <span className="text-xs text-muted-foreground">
                      {booking.payment.paidAt.toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              </div>

              {/* Invoice */}
              {booking.invoice && (
                <>
                  <Separator />
                  <div className="grid grid-cols-3 gap-2">
                    <span className="text-muted-foreground font-medium">Invoice</span>
                    <div className="col-span-2 flex items-center gap-2">
                      <span className="font-mono text-xs">{booking.invoice.number}</span>
                      {booking.invoice.pdfUrl && (
                        <a
                          href={booking.invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View PDF
                        </a>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quote History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Full revision trail for this job, including customer feedback and the accepted quote record.
              </p>
              {booking.match != null ? (
                <QuoteHistoryTimeline
                  audience="provider"
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
                  }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No match record — quote history unavailable.</p>
              )}
            </CardContent>
          </Card>

          {/* Job section */}
          {booking.job && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm">
                {/* Provider + status */}
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Provider</p>
                    <p className="font-medium">{booking.match?.provider?.name}</p>
                    <p className="text-muted-foreground text-xs">{booking.match?.provider?.phone}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Job status</p>
                    <StatusBadge status={booking.job.status} type="job" />
                  </div>
                  {booking.job.completionNote && (
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground text-xs mb-0.5">Completion note</p>
                      <p className="text-sm">{booking.job.completionNote}</p>
                    </div>
                  )}
                </div>

                {/* Status history timeline */}
                {booking.job.statusHistory.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="font-medium mb-3">Status History</p>
                      <ol className="space-y-2">
                        {booking.job.statusHistory.map((event: { id: string; fromStatus: string | null; toStatus: string; timestamp: Date; actorRole: string; notes?: string | null }) => (
                          <li key={event.id} className="flex items-start gap-3">
                            <span className="mt-0.5 h-2 w-2 rounded-full bg-primary/35 shrink-0 translate-y-1" />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-medium">
                                  {event.fromStatus
                                    ? `${formatJobStatus(event.fromStatus)} → ${formatJobStatus(event.toStatus)}`
                                    : formatJobStatus(event.toStatus)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {event.timestamp.toLocaleString('en-ZA', {
                                    day: 'numeric',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <span className="text-xs text-muted-foreground capitalize">
                                  by {event.actorRole}
                                </span>
                              </div>
                              {event.notes && (
                                <p className="text-xs text-muted-foreground mt-0.5">{event.notes}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                {/* Extra work requests */}
                {booking.job.extras.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="font-medium mb-3">Extra Work Requests</p>
                      <ul className="space-y-2">
                        {booking.job.extras.map((extra: { id: string; description: string; amount: number | { toFixed: (n: number) => string }; status: string }) => (
                          <li
                            key={extra.id}
                            className="flex items-start justify-between gap-4 rounded-md border px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <p>{extra.description}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                R {Number(extra.amount).toFixed(2)}
                              </p>
                            </div>
                            <ApprovalStatusBadge status={extra.status} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {/* Photos */}
                {booking.job.photos.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="font-medium mb-3">Photos</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                        {booking.job.photos.map((photo: { id: string; url: string; label?: string | null; caption?: string | null }) => (
                          <a
                            key={photo.id}
                            href={`/api/attachments/${photo.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative block overflow-hidden rounded-md border aspect-square bg-muted"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/attachments/${photo.id}`}
                              alt={photo.caption ?? photo.label ?? 'Job photo'}
                              className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                            />
                            {(photo.caption || photo.label) && (
                              <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs px-1.5 py-0.5 text-center capitalize">
                                {photo.caption ?? photo.label}
                              </span>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right column: Actions ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Mark as paid */}
              {booking.status === 'SCHEDULED' && (
                <form action={markPaid}>
                  <Button type="submit" className="w-full" variant="default" disabled={!crudEnabled}>
                    Mark as Paid
                  </Button>
                </form>
              )}

              {/* Cancel booking */}
              {canCancel && (
                <form action={cancelBooking}>
                  <Button
                    type="submit"
                    className="w-full"
                    variant="destructive"
                    disabled={!crudEnabled}
                  >
                    Cancel Booking
                  </Button>
                </form>
              )}

              {!booking.job && !canCancel && (
                <p className="text-xs text-muted-foreground text-center">No actions available</p>
              )}
            </CardContent>
          </Card>

          {/* Booking meta */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Created</span>
                <span>
                  {booking.createdAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
              {booking.rescheduleCount > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Rescheduled</span>
                  <span>{booking.rescheduleCount}×</span>
                </div>
              )}
              {booking.cancelReason && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Cancel reason</span>
                  <span className="text-xs">{booking.cancelReason}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Booking ID</span>
                <span className="font-mono text-xs">{ref}</span>
              </div>
              {booking.matchId && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Match ID</span>
                  <span className="font-mono text-xs">{booking.matchId.slice(-8).toUpperCase()}</span>
                </div>
              )}
              {booking.quoteId && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Quote ID</span>
                  <span className="font-mono text-xs">{booking.quoteId.slice(-8).toUpperCase()}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {casesEnabled && activeCase && (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Case</h3>
            <ResolveCaseDialog caseId={activeCase.id} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Timeline</p>
            <CaseActivityTimeline events={activeCase.events} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
            <CaseNotes caseId={activeCase.id} notes={activeCase.notes} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatJobStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function PaymentStatusBadge({
  status,
  pspProvider,
  collectionMode,
}: {
  status: string
  pspProvider?: string | null
  collectionMode?: string | null
}) {
  const map: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
    PENDING:            'warning',
    AUTHORISED:         'info',
    PAID:               'success',
    FAILED:             'danger',
    REFUNDED:           'neutral',
    PARTIALLY_REFUNDED: 'neutral',
  }
  const label =
    status === 'PENDING' && collectionMode === 'OFFLINE_RECORDED'
      ? 'Offline follow-through'
      : status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')
  return (
    <Badge variant={map[status] ?? 'neutral'}>
      {label}
    </Badge>
  )
}

function ApprovalStatusBadge({ status }: { status: string }) {
  const map: Record<string, 'warning' | 'success' | 'danger'> = {
    PENDING:  'warning',
    APPROVED: 'success',
    DECLINED: 'danger',
  }
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <Badge variant={map[status] ?? 'neutral'}>
      {label}
    </Badge>
  )
}
