import type { BookingStatus, JobStatus, PaymentStatus, Prisma } from '@prisma/client'
import { db } from './db'
import { recordAuditLog } from './audit'

// ─── Booking state machine ────────────────────────────────────────────────────

const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  SCHEDULED:   ['RESCHEDULED', 'CANCELLED', 'COMPLETED'],
  RESCHEDULED: ['SCHEDULED', 'CANCELLED', 'COMPLETED'],
  CANCELLED:   [],
  COMPLETED:   [],
}

export async function transitionBooking(params: {
  bookingId: string
  toStatus: BookingStatus
  actorId: string
  actorRole: 'customer' | 'provider' | 'admin' | 'system'
  notes?: string
}): Promise<void> {
  const { bookingId, toStatus, actorId, actorRole, notes } = params

  const booking = await db.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error(`Booking not found: ${bookingId}`)

  const allowed = VALID_BOOKING_TRANSITIONS[booking.status]
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid booking transition: ${booking.status} → ${toStatus}. Allowed: ${allowed.join(', ')}`
    )
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: { status: toStatus },
    })
    if (updated.count === 0) {
      throw new Error(`Concurrent modification: booking ${bookingId} status changed before transaction committed`)
    }

    await tx.bookingStatusEvent.create({
      data: { bookingId, fromStatus: booking.status, toStatus, actorId, actorRole, notes },
    })

    await recordAuditLog(
      {
        actorId,
        actorRole,
        action: 'booking.status_transition',
        entityType: 'booking',
        entityId: bookingId,
        before: { status: booking.status },
        after: { status: toStatus, notes: notes ?? null },
      },
      tx
    )
  })
}

function isTerminalJobStatus(status: JobStatus) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
}

function isRefundablePaymentStatus(status: PaymentStatus) {
  return status === 'PAID' || status === 'PARTIALLY_REFUNDED'
}

export async function cancelBookingLifecycle(params: {
  bookingId: string
  actorId: string
  actorRole: 'customer' | 'provider' | 'admin' | 'system'
  reason?: string | null
}) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: true,
            },
          },
          provider: true,
        },
      },
      job: true,
      payment: true,
    },
  })

  if (!booking) {
    throw new Error(`Booking not found: ${params.bookingId}`)
  }

  if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
    throw new Error(`Booking cannot be cancelled from status ${booking.status}`)
  }

  const reason = params.reason?.trim() || 'Cancelled by request'
  const before = {
    bookingStatus: booking.status,
    jobStatus: booking.job?.status ?? null,
    paymentStatus: booking.payment?.status ?? null,
  } satisfies Prisma.JsonObject

  await db.$transaction(async (tx) => {
    // CAS guard: prevents a concurrent cancel or completion from racing this
    // transition. Mirrors the pattern used in transitionBooking().
    const bookingUpdate = await tx.booking.updateMany({
      where: { id: booking.id, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      data: { status: 'CANCELLED', cancelReason: reason },
    })
    if (bookingUpdate.count === 0) {
      throw new Error(`Concurrent modification: booking ${booking.id} was already cancelled or completed`)
    }

    await tx.bookingStatusEvent.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: 'CANCELLED',
        actorId: params.actorId,
        actorRole: params.actorRole,
        notes: reason,
      },
    })

    if (booking.job && !isTerminalJobStatus(booking.job.status)) {
      await tx.job.update({
        where: { id: booking.job.id },
        data: { status: 'CANCELLED', failureReason: reason },
      })

      await tx.jobStatusEvent.create({
        data: {
          jobId: booking.job.id,
          fromStatus: booking.job.status,
          toStatus: 'CANCELLED',
          actorId: params.actorId,
          actorRole: params.actorRole,
          notes: reason,
        },
      })
    }

    await tx.technicianScheduleItem.updateMany({
      where: { bookingId: booking.id, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    })

    if (booking.payment) {
      await tx.payment.update({
        where: { bookingId: booking.id },
        data: {
          metadata: {
            ...(((booking.payment.metadata as Prisma.JsonObject | null) ?? {})),
            cancellation: {
              cancelledAt: new Date().toISOString(),
              cancelledBy: params.actorRole,
              reason,
            },
          },
        },
      })
    }

    await recordAuditLog(
      {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'booking.cancel',
        entityType: 'booking',
        entityId: booking.id,
        before,
        after: {
          bookingStatus: 'CANCELLED',
          jobStatus:
            booking.job && !isTerminalJobStatus(booking.job.status)
              ? 'CANCELLED'
              : booking.job?.status ?? null,
          paymentStatus: booking.payment?.status ?? null,
          reason,
        } satisfies Prisma.JsonObject,
      },
      tx
    )
  })

  if (booking.payment && isRefundablePaymentStatus(booking.payment.status) && booking.payment.pspReference) {
    try {
      const { issueRefund } = await import('./payments')
      await issueRefund({
        bookingId: booking.id,
        amountCents: Math.round(Number(booking.payment.amount) * 100),
      })
    } catch (error) {
      console.error('[bookings] Refund attempt failed after cancellation:', error)
    }
  }

  const { sendBookingCancelled } = await import('./whatsapp')
  await sendBookingCancelled({
    bookingId: booking.id,
    customerName: booking.match.jobRequest.customer.name,
    customerPhone: booking.match.jobRequest.customer.phone,
    serviceName: booking.match.jobRequest.category,
    refundNote:
      booking.payment?.collectionMode === 'PLATFORM_CHECKOUT' && booking.payment?.status === 'PAID'
        ? 'We are processing your refund.'
        : 'No online payment was collected for this booking.',
  }).catch((error) => {
    console.error('[bookings] Failed to send booking cancellation message:', error)
  })

  if (booking.match.provider?.phone) {
    const { sendText } = await import('./whatsapp-interactive')
    await sendText(
      booking.match.provider.phone,
      `⚠️ Booking ${booking.id.slice(-8).toUpperCase()} has been cancelled.\n\nService: ${booking.match.jobRequest.category}\nReason: ${reason}`,
      {
        bookingId: booking.id,
        templateName: 'interactive:booking_cancelled_provider',
        metadata: {
          actorRole: params.actorRole,
          reason,
        },
      }
    ).catch((error) => {
      console.error('[bookings] Failed to notify provider of cancellation:', error)
    })
  }
}

export async function requestBookingReschedule(params: {
  bookingId: string
  actorId: string
  actorRole: 'customer' | 'provider' | 'admin' | 'system'
  reason: string
  requestedAvailability: string
}) {
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: true,
            },
          },
          provider: true,
        },
      },
      job: true,
    },
  })

  if (!booking) {
    throw new Error(`Booking not found: ${params.bookingId}`)
  }

  if (booking.status !== 'SCHEDULED' && booking.status !== 'RESCHEDULED') {
    throw new Error(`Booking cannot be rescheduled from status ${booking.status}`)
  }

  await recordAuditLog({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: 'booking.reschedule_request',
    entityType: 'booking',
    entityId: booking.id,
    before: {
      bookingStatus: booking.status,
      scheduledDate: booking.scheduledDate?.toISOString() ?? null,
      scheduledWindow: booking.scheduledWindow,
    },
    after: {
      requestedAvailability: params.requestedAvailability,
      reason: params.reason,
    },
  })

  const { sendText } = await import('./whatsapp')
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (adminPhone) {
    await sendText({
      to: adminPhone,
      text:
        `🔄 Reschedule request received\n\n` +
        `Booking: ${booking.id.slice(-8).toUpperCase()}\n` +
        `Service: ${booking.match.jobRequest.category}\n` +
        `Requested by: ${params.actorRole}\n` +
        `Reason: ${params.reason}\n` +
        `Requested availability: ${params.requestedAvailability}`,
      bookingId: booking.id,
      templateName: 'freeform:booking_reschedule_request',
      metadata: {
        actorRole: params.actorRole,
      },
    }).catch((error) => {
      console.error('[bookings] Failed to notify admin of reschedule request:', error)
    })
  }

  return booking
}
