import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  refreshPayAtGoBookingPaymentStatus,
  mapPayAtGoErrorToUserMessage,
  type InternalPayAtGoStatus,
} from '@/lib/payat-go'

function parseMockStatus(value: string | null): InternalPayAtGoStatus | undefined {
  if (!value) return undefined
  const candidate = value.trim().toUpperCase()
  const allowed: InternalPayAtGoStatus[] = [
    'PENDING',
    'SENT',
    'PAID',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
    'UNKNOWN',
  ]
  if ((allowed as string[]).includes(candidate)) {
    return candidate as InternalPayAtGoStatus
  }
  return undefined
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

export async function GET(
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

  const mockStatus = parseMockStatus(request.nextUrl.searchParams.get('mockStatus'))
  const mockModeEnabled = process.env.PAYAT_GO_MOCK_MODE?.trim().toLowerCase() === 'true'
  if (mockStatus && !mockModeEnabled) {
    return NextResponse.json({ error: 'mockStatus is available only in mock mode.' }, { status: 400 })
  }

  try {
    const result = await refreshPayAtGoBookingPaymentStatus(bookingId, { mockStatus })
    return NextResponse.json({
      bookingId: result.bookingId,
      paymentId: result.paymentId,
      status: result.status,
      rawProviderStatus: result.rawProviderStatus,
      paidAt: result.paidAt,
      expiresAt: result.expiresAt,
      amountPaidCents: result.amountPaidCents,
      providerClientAccountNumber: result.providerClientAccountNumber,
      provider: 'PAYAT_GO',
      polled: true,
    })
  } catch (error) {
    return NextResponse.json(
      { error: mapPayAtGoErrorToUserMessage(error) },
      { status: 502 },
    )
  }
}
