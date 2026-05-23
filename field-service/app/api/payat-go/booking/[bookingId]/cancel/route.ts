import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkPayAtGoLimit } from '@/lib/rate-limit'
import {
  cancelPayAtGoBookingPaymentRequest,
  mapPayAtGoErrorToHttpStatus,
  mapPayAtGoErrorToUserMessage,
} from '@/lib/payat-go'

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
  _request: NextRequest,
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

  const cancelLimit = await checkPayAtGoLimit({
    operation: 'cancel',
    identifier: `booking:${bookingId}:user:${session.id}`,
  })
  if (!cancelLimit.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(cancelLimit.retryAfterMs / 1000))
    return NextResponse.json(
      {
        error:
          cancelLimit.code === 'limiter_unavailable'
            ? 'Service temporarily unavailable.'
            : 'Too many requests.',
      },
      {
        status: cancelLimit.code === 'limiter_unavailable' ? 503 : 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    )
  }

  try {
    const result = await cancelPayAtGoBookingPaymentRequest(bookingId)

    return NextResponse.json({
      bookingId: result.bookingId,
      paymentId: result.paymentId,
      status: result.status,
      rawProviderStatus: result.rawProviderStatus,
      cancelledAt: result.cancelledAt,
      providerClientAccountNumber: result.providerClientAccountNumber,
      provider: 'PAYAT_GO',
      message: 'This payment request was cancelled.',
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'payat_go.cancel_failed',
      route: '/api/payat-go/booking/[bookingId]/cancel',
      bookingId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
    return NextResponse.json(
      { error: mapPayAtGoErrorToUserMessage(error) },
      { status: mapPayAtGoErrorToHttpStatus(error) },
    )
  }
}
