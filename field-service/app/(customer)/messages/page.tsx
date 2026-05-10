export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Messages' })

export default async function MessagesPage() {
  const session = await getSession()
  if (!session) redirect('/sign-in?next=/messages')

  const flagEnabled = await isEnabled('customer.messaging.v1', { userId: session.id })
  if (!flagEnabled) redirect('/bookings')

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) redirect('/sign-in?next=/messages')

  const bookings = await db.booking.findMany({
    where: {
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      match: { jobRequest: { customerId: customer.id } },
    },
    include: {
      match: {
        include: {
          jobRequest: { select: { category: true } },
          provider: { select: { name: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">Send a message to your provider for active bookings.</p>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No active bookings. Messages are available for scheduled jobs.
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              href={`/messages/${booking.id}`}
              className="block rounded-xl border bg-card p-4 hover:bg-accent/5 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm capitalize">{booking.match.jobRequest.category}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {booking.match.provider?.name ?? 'Provider'} · #{booking.id.slice(-8).toUpperCase()}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {booking.status.toLowerCase()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
