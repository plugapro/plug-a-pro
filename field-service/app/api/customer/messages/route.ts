// GET /api/customer/messages?bookingId=xxx
// Returns MessageEvent rows for a booking, scoped to the authenticated customer.
// Guards: flag customer.messaging.v1 must be enabled; booking must be SCHEDULED or RESCHEDULED.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bookingId = request.nextUrl.searchParams.get('bookingId')
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Feature-flag gate — 404 to avoid leaking flag existence to callers
  const flagEnabled = await isEnabled('customer.messaging.v1', { userId: session.id })
  if (!flagEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Verify ownership + fetch booking status in one query
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true,
      match: { select: { jobRequest: { select: { customerId: true } } } },
    },
  })
  if (!booking || booking.match.jobRequest.customerId !== customer.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Messaging only active for live bookings
  if (booking.status !== 'SCHEDULED' && booking.status !== 'RESCHEDULED') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const messages = await db.messageEvent.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      direction: true,
      body: true,
      status: true,
      createdAt: true,
      templateName: true,
    },
  })

  return NextResponse.json({ messages })
}
