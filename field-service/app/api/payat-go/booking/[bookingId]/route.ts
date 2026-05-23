import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  createPayAtGoBookingPaymentRequest,
  mapPayAtGoErrorToUserMessage,
  type InternalPayAtGoStatus,
} from '@/lib/payat-go'

function toStatusMessage(status: InternalPayAtGoStatus): string {
  if (status === 'PENDING' || status === 'SENT') return 'Payment is still pending.'
  if (status === 'EXPIRED') return 'This payment request has expired. Please create a new one.'
  if (status === 'CANCELLED') return 'This payment request was cancelled.'
  if (status === 'PAID') return 'Payment confirmed.'
  return 'We could not start the payment request. Please try again.'
}

async function canAccessBooking(bookingId: string, userId: string, role: string) {
  if (role === 'admin') return true
  if (role !== 'customer') return false

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      match: {
        select: {
          jobRequest: {
            select: {
              customerId: true,
            },
          },
        },
      },
    },
  })

  if (!booking?.match) return false
  return booking.match.jobRequest.customerId === userId
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ bookingId: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { bookingId } = await context.params
  const allowed = await canAccessBooking(bookingId, session.id, session.role)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    amountCents?: unknown
    customerEmail?: unknown
    customerMobile?: unknown
    description?: unknown
  }

  const amountCents = typeof body.amountCents === 'number' ? Math.round(body.amountCents) : NaN
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail : null
  const customerMobile = typeof body.customerMobile === 'string' ? body.customerMobile : null
  const description = typeof body.description === 'string' && body.description.trim().length > 0
    ? body.description.trim()
    : `Plug A Pro booking ${bookingId.slice(-8).toUpperCase()} payment`

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Amount must be a positive integer in cents.' },
      { status: 400 },
    )
  }

  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        match: {
          select: {
            jobRequest: {
              select: {
                customer: {
                  select: {
                    name: true,
                    phone: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!booking?.match) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    }

    const customer = booking.match.jobRequest.customer

    const result = await createPayAtGoBookingPaymentRequest({
      bookingId,
      amountCents,
      currency: 'ZAR',
      customerName: customer.name,
      customerMobile: customerMobile ?? customer.phone,
      customerEmail: customerEmail ?? customer.email,
      description,
    })

    return NextResponse.json(
      {
        bookingId: result.bookingId,
        paymentId: result.paymentId,
        status: result.status,
        statusMessage: toStatusMessage(result.status),
        amountCents: result.amountCents,
        currency: result.currency,
        provider: 'PAYAT_GO',
        providerPaymentRequestId: result.providerPaymentRequestId,
        providerClientAccountNumber: result.providerClientAccountNumber,
        payAtReference: result.payAtReference,
        paymentLink: result.paymentLink,
        expiresAt: result.expiresAt,
        whatsappMessage: result.whatsappMessage,
        reusedExisting: result.reusedExisting,
      },
      { status: result.reusedExisting ? 200 : 201 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: mapPayAtGoErrorToUserMessage(error) },
      { status: 502 },
    )
  }
}
