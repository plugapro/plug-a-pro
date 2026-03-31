// ─── Customer: My bookings ────────────────────────────────────────────────────
// Lists all bookings for the authenticated customer.
// Unauthenticated users are redirected to /sign-in via proxy.ts.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'My Bookings' })

export default async function CustomerBookingsPage() {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  // Resolve customer record by userId
  const customer = await db.customer.findUnique({
    where: { userId: session.id },
  })

  if (!customer) {
    // Authenticated but no Customer record yet — fresh PWA signup
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-4">
        <p className="text-lg font-medium">No bookings yet</p>
        <p className="text-sm text-muted-foreground">
          Book your first service to get started.
        </p>
        <Button asChild>
          <Link href="/services">Browse services</Link>
        </Button>
      </div>
    )
  }

  // Bookings are reached via jobRequests → match → booking
  const bookings = await db.booking.findMany({
    where: {
      match: {
        jobRequest: { customerId: customer.id },
      },
    },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              address: { select: { suburb: true, city: true } },
            },
          },
        },
      },
      quote: { select: { amount: true } },
      job:   { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">My Bookings</h1>

      {bookings.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center space-y-3">
          <p className="text-muted-foreground">You have no bookings yet.</p>
          <Button asChild>
            <Link href="/services">Book a service</Link>
          </Button>
        </div>
      )}

      {bookings.map((b) => {
        const jobRequest = b.match.jobRequest
        const address    = jobRequest.address
        return (
          <Link
            key={b.id}
            href={`/bookings/${b.id}`}
            className="block rounded-xl border bg-card p-4 space-y-2 hover:bg-accent transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium capitalize">{jobRequest.category}</p>
              {b.job
                ? <StatusBadge status={b.job.status} type="job" />
                : <StatusBadge status={b.status} type="booking" />}
            </div>

            {address && (
              <p className="text-sm text-muted-foreground">
                {address.suburb}, {address.city}
              </p>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {b.scheduledDate
                  ? b.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                  : 'Date TBC'}
                {b.scheduledWindow ? ` · ${b.scheduledWindow}` : ''}
              </span>
              <span className="font-medium">R {Number(b.quote.amount).toFixed(0)}</span>
            </div>

            <p className="text-xs text-muted-foreground">
              Ref: {b.id.slice(-8).toUpperCase()}
            </p>
          </Link>
        )
      })}
    </div>
  )
}
