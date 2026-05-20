// ─── Customer: Request booking reschedule ─────────────────────────────────────

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { Button } from '@/components/ui/button'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Request Reschedule' })

export default async function BookingReschedulePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}/reschedule`)}`)

  const booking = await db.booking.findUnique({
    where: { id },
    select: {
      status: true,
      id: true,
      match: {
        select: {
          jobRequest: {
            select: {
              customer: { select: { id: true } },
              category: true,
            },
          },
        },
      },
    },
  })

  if (!booking) notFound()

  const customer = await resolveCustomerForSession(db, session)
  if (!customer || booking.match.jobRequest.customer.id !== customer.id) redirect('/bookings')
  if (booking.status !== 'SCHEDULED' && booking.status !== 'RESCHEDULED') redirect(`/bookings/${id}`)

  async function submitReschedule(formData: FormData) {
    'use server'
    const { getSession: getSess } = await import('@/lib/auth')
    const sess = await getSess()
    if (!sess) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}/reschedule`)}`)

    // Re-verify ownership - render-time session cannot be trusted in a server action.
    const { resolveCustomerForSession: resolveCust } = await import('@/lib/customer-session')
    const { db: database } = await import('@/lib/db')
    const cust = await resolveCust(database, sess)
    const freshBooking = await database.booking.findUnique({
      where: { id },
      select: { match: { select: { jobRequest: { select: { customerId: true } } } } },
    })
    if (!cust || !freshBooking || freshBooking.match.jobRequest.customerId !== cust.id) {
      redirect('/bookings')
    }

    const reason = String(formData.get('reason') ?? '').trim()
    const availability = String(formData.get('availability') ?? '').trim()
    if (!reason || !availability) redirect(`/bookings/${id}/reschedule`)

    const { requestBookingReschedule } = await import('@/lib/bookings')
    await requestBookingReschedule({
      bookingId: id,
      actorId: sess.id,
      actorRole: 'customer',
      reason,
      requestedAvailability: availability,
    })

    redirect(`/bookings/${id}?reschedule=requested`)
  }

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      {/* Header */}
      <div>
        <Link href={`/bookings/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
          ← Booking details
        </Link>
        <h1 className="text-xl font-semibold mt-1">Request a reschedule</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We&apos;ll pass your request to the provider and Plug A Pro ops. You&apos;ll be notified on WhatsApp once a new time is confirmed.
        </p>
      </div>

      {/* Form */}
      <form action={submitReschedule} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="reason" className="text-sm text-muted-foreground">
            Why do you need to reschedule?
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            placeholder="e.g. I have an urgent commitment that day"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="availability" className="text-sm text-muted-foreground">
            When are you available? (e.g. weekday mornings, after 3pm)
          </label>
          <textarea
            id="availability"
            name="availability"
            rows={3}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            placeholder="e.g. Any weekday morning, or Saturday after 9am"
          />
        </div>

        <FormSubmitButton className="w-full" pendingLabel="Sending…">
          Send reschedule request
        </FormSubmitButton>

        <Link
          href={`/bookings/${id}`}
          className="block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Never mind
        </Link>
      </form>
    </div>
  )
}
