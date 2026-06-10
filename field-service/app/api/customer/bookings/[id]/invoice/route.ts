// ─── GET /api/customer/bookings/[id]/invoice ──────────────────────────────────
// Generates (or retrieves) a PDF invoice for a completed booking.
// Auth: customer session; customer must own the booking; job must be COMPLETED.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { head } from '@vercel/blob'
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

  // Invoices are financial records. BOOKER-level operator members may browse bookings
  // but must not pull account-level financial documents - only the account OWNER (or a
  // direct account holder, which resolves to OWNER) may download an invoice.
  if (customer.memberRole !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  // Never hand the stored blob URL to the client. Resolve a short-lived signed download
  // URL server-side (head() returns a time-limited downloadUrl) and stream the bytes back
  // through this authenticated route, so the underlying blob location stays opaque.
  let fetchUrl = pdfUrl
  try {
    const meta = await head(pdfUrl)
    const downloadUrl = (meta as { downloadUrl?: string | null }).downloadUrl
    if (downloadUrl) fetchUrl = downloadUrl
  } catch (err) {
    console.warn('[invoice] head() lookup failed, falling back to stored URL', err)
  }

  const pdfResponse = await fetch(fetchUrl)
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
