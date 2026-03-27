// ─── Admin: Booking detail ─────────────────────────────────────────────────────
// Full booking view with customer info, job timeline, extras, photos, and admin actions.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { Metadata } from 'next'

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
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireAdmin()
  const { id } = await params

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, phone: true, email: true } },
      service:  { select: { name: true, basePrice: true, category: true } },
      address:  true,
      payment:  true,
      invoice:  true,
      slot:     true,
      job: {
        include: {
          technician:    { select: { name: true, phone: true } },
          statusHistory: { orderBy: { timestamp: 'asc' } },
          extras:        { orderBy: { createdAt: 'asc' } },
          photos:        { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!booking || booking.businessId !== session.businessId) {
    notFound()
  }

  const ref = booking.id.slice(-8).toUpperCase()
  const canCancel =
    booking.status !== 'COMPLETED' && booking.status !== 'CANCELLED'

  // ─── Server actions ──────────────────────────────────────────────────────────

  async function cancelBooking() {
    'use server'
    await db.booking.update({ where: { id }, data: { status: 'CANCELLED' } })
    if (booking!.slotId) {
      const { releaseSlot } = await import('@/lib/slotting')
      await releaseSlot(booking!.slotId)
    }
    redirect('/admin/bookings')
  }

  async function markPaid() {
    'use server'
    await db.payment.upsert({
      where:  { bookingId: id },
      create: {
        bookingId: id,
        amount:    booking!.totalAmount,
        status:    'PAID',
        paidAt:    new Date(),
      },
      update: { status: 'PAID', paidAt: new Date() },
    })
    await db.booking.update({ where: { id }, data: { status: 'CONFIRMED' } })
    redirect(`/admin/bookings/${id}`)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

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
        <p className="text-sm text-muted-foreground">{booking.service.name}</p>
      </div>

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
                  <p className="font-medium">{booking.customer.name}</p>
                  <p className="text-muted-foreground">{booking.customer.phone}</p>
                  {booking.customer.email && (
                    <p className="text-muted-foreground">{booking.customer.email}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Service */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Service</span>
                <div className="col-span-2">
                  <p className="font-medium">{booking.service.name}</p>
                  <p className="text-muted-foreground">{booking.service.category}</p>
                  <p className="font-semibold mt-0.5">R {Number(booking.totalAmount).toFixed(2)}</p>
                </div>
              </div>

              <Separator />

              {/* Address */}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Address</span>
                <div className="col-span-2">
                  <p>{booking.address.street}</p>
                  <p>{booking.address.suburb}, {booking.address.city}</p>
                  <p>{booking.address.province}{booking.address.postalCode ? ` ${booking.address.postalCode}` : ''}</p>
                </div>
              </div>

              <Separator />

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
                    <PaymentStatusBadge status={booking.payment.status} />
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
                          className="text-xs text-blue-600 hover:underline"
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

          {/* Job section */}
          {booking.job && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm">
                {/* Technician + status */}
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Technician</p>
                    <p className="font-medium">{booking.job.technician.name}</p>
                    <p className="text-muted-foreground text-xs">{booking.job.technician.phone}</p>
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
                        {booking.job.statusHistory.map((event) => (
                          <li key={event.id} className="flex items-start gap-3">
                            <span className="mt-0.5 h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0 translate-y-1" />
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
                        {booking.job.extras.map((extra) => (
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
                        {booking.job.photos.map((photo) => (
                          <a
                            key={photo.id}
                            href={photo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative block overflow-hidden rounded-md border aspect-square bg-muted"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.url}
                              alt={photo.label ?? 'Job photo'}
                              className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                            />
                            {photo.label && (
                              <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs px-1.5 py-0.5 text-center capitalize">
                                {photo.label}
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
              {/* Assign technician */}
              {booking.status === 'CONFIRMED' && !booking.job && (
                <Button asChild className="w-full">
                  <Link href={`/admin/dispatch?bookingId=${booking.id}`}>
                    Assign Technician
                  </Link>
                </Button>
              )}

              {/* Mark as paid */}
              {booking.status === 'PENDING_PAYMENT' && (
                <form action={markPaid}>
                  <Button type="submit" className="w-full" variant="default">
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
                  >
                    Cancel Booking
                  </Button>
                </form>
              )}

              {!booking.job && booking.status !== 'CONFIRMED' && !canCancel && (
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
              {booking.depositAmount && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Deposit</span>
                  <span>R {Number(booking.depositAmount).toFixed(2)}</span>
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
            </CardContent>
          </Card>
        </div>
      </div>
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

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    AUTHORISED:         'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    PAID:               'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    FAILED:             'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    REFUNDED:           'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    PARTIALLY_REFUNDED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  }
  const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${map[status] ?? 'bg-zinc-100 text-zinc-600'}`}>
      {label}
    </span>
  )
}

function ApprovalStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    DECLINED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  }
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${map[status] ?? 'bg-zinc-100 text-zinc-600'}`}>
      {label}
    </span>
  )
}
