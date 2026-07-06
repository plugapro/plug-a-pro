// ─── WhatsApp cancel-flow routing (CJ-05) ─────────────────────────────────────
//
// Decides WHAT a customer's "cancel" should act on:
//   1. An active Booking (SCHEDULED / RESCHEDULED with a non-terminal job) —
//      must be cancelled through cancelBookingLifecycle so the refund is
//      issued and BOTH parties are notified.
//   2. Otherwise, the latest active JobRequest (pre-booking states) — the
//      legacy jobRequest.status = CANCELLED path.
//   3. Nothing cancellable.
//
// Customer lookup uses phoneLookupVariants (CJ-15 pattern) so legacy-format
// phone rows still resolve.

import type { BookingStatus, JobStatus } from '@prisma/client'
import { db } from '../db'
import { phoneLookupVariants } from '../whatsapp-identity'

export const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = ['SCHEDULED', 'RESCHEDULED']
export const TERMINAL_JOB_STATUSES: JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED']
export const CANCELLABLE_JOB_REQUEST_STATUSES = ['PENDING_VALIDATION', 'OPEN', 'MATCHING', 'MATCHED'] as const

export type CancelTarget =
  | { kind: 'no_customer' }
  | { kind: 'none'; customerId: string }
  | {
      kind: 'booking'
      customerId: string
      bookingId: string
      category: string
      scheduledDate: Date | null
    }
  | {
      kind: 'job_request'
      customerId: string
      jobRequestId: string
      category: string
    }

export async function resolveCustomerCancelTarget(phone: string): Promise<CancelTarget> {
  const customer = await db.customer.findFirst({
    where: { phone: { in: phoneLookupVariants(phone) } },
    select: { id: true },
  })
  if (!customer) return { kind: 'no_customer' }

  // Confirmed bookings take precedence: cancelling one has money + provider
  // schedule consequences that only cancelBookingLifecycle handles correctly.
  const booking = await db.booking.findFirst({
    where: {
      status: { in: CANCELLABLE_BOOKING_STATUSES },
      match: { jobRequest: { customerId: customer.id } },
    },
    include: {
      match: { include: { jobRequest: true } },
      job: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (booking && !(booking.job && TERMINAL_JOB_STATUSES.includes(booking.job.status))) {
    return {
      kind: 'booking',
      customerId: customer.id,
      bookingId: booking.id,
      category: booking.match.jobRequest.category,
      scheduledDate: booking.scheduledDate ?? null,
    }
  }

  const jobRequest = await db.jobRequest.findFirst({
    where: {
      customerId: customer.id,
      status: { in: [...CANCELLABLE_JOB_REQUEST_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (jobRequest) {
    return {
      kind: 'job_request',
      customerId: customer.id,
      jobRequestId: jobRequest.id,
      category: jobRequest.category,
    }
  }

  return { kind: 'none', customerId: customer.id }
}
