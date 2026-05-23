import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  cancelPayAtGoBookingPaymentRequest,
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
    return NextResponse.json(
      { error: mapPayAtGoErrorToUserMessage(error) },
      { status: 502 },
    )
  }
}
