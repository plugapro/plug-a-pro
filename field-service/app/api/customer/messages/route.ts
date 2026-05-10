// GET /api/customer/messages?bookingId=xxx
// Returns MessageEvent rows for a booking, scoped to the authenticated customer.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bookingId = request.nextUrl.searchParams.get('bookingId')
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Verify ownership
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { match: { select: { jobRequest: { select: { customerId: true } } } } },
  })
  if (!booking || booking.match.jobRequest.customerId !== customer.id) {
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
