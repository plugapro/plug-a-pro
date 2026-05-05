// ─── GET /api/customer/bookings/[id]/invoice ──────────────────────────────────
// Generates (or retrieves) a PDF invoice for a completed booking.
// Auth: customer session; customer must own the booking; job must be COMPLETED.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { generateInvoicePdf } from '@/lib/invoice/generate'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const { id: bookingId } = await params

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      match: {
        select: {
          jobRequest: { select: { customerId: true } },
        },
      },
      job: { select: { status: true } },
    },
  })

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.match.jobRequest.customerId !== customer.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (booking.job?.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'Invoice only available for completed jobs' }, { status: 422 })
  }

  const pdfUrl = await generateInvoicePdf(bookingId)
  const pdfResponse = await fetch(pdfUrl)
  if (!pdfResponse.ok) {
    return NextResponse.json({ error: 'Could not load invoice PDF' }, { status: 502 })
  }
  const pdfPayload = await pdfResponse.arrayBuffer()
  const safeRef = booking.id.slice(-8).toUpperCase()
  const fileName = `invoice-${safeRef}.pdf`

  // Return attachment payload so the booking detail CTA can download/preview reliably.
  return new NextResponse(pdfPayload, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    },
  })
}
