import type { JobStatus, PaymentStatus, Prisma } from '@prisma/client'
import { db } from './db'
import { recordAuditLog } from './audit'

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
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelReason: reason,
      },
    })

    if (booking.job && !isTerminalJobStatus(booking.job.status)) {
      await tx.job.update({
        where: { id: booking.job.id },
        data: {
          status: 'CANCELLED',
          failureReason: reason,
        },
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
      scheduledDate: booking.scheduledDate.toISOString(),
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
