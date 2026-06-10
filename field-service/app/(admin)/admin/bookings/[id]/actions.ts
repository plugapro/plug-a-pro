'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.bookings'

const RescheduleBookingSchema = z.object({
  bookingId: z.string().min(1),
  newDate: z.string().datetime(),
  reason: z.string().min(1).max(500),
})

const CancelBookingSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type RescheduleInput = z.infer<typeof RescheduleBookingSchema>
type CancelInput = z.infer<typeof CancelBookingSchema>

export async function rescheduleBookingAction(input: RescheduleInput) {
  const before = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, scheduledDate: true, scheduledStartAt: true, scheduledEndAt: true, status: true },
  })

  const result = await crudAction<RescheduleInput, { id: string }>({
    entity: AUDIT_ENTITY.BOOKING,
    entityId: input.bookingId,
    action: 'booking.reschedule',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: RescheduleBookingSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: { id: true, status: true },
      })
      if (!booking) throw new CrudActionError('NOT_FOUND', `Booking ${data.bookingId} not found.`)
      if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
        throw new CrudActionError('CONFLICT', `Cannot reschedule a ${booking.status} booking.`)
      }
      const newDate = new Date(data.newDate)
      await tx.booking.update({
        where: { id: data.bookingId },
        data: {
          scheduledDate: newDate,
          scheduledStartAt: newDate,
          rescheduleCount: { increment: 1 },
          notes: data.reason,
        },
      })
      return { id: data.bookingId }
    },
  })
  revalidatePath(`/admin/bookings/${input.bookingId}`)
  return result
}

export async function cancelBookingAction(input: CancelInput) {
  const before = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, status: true },
  })

  const result = await crudAction<CancelInput, { id: string }>({
    entity: AUDIT_ENTITY.BOOKING,
    entityId: input.bookingId,
    action: 'booking.cancel',
    // SECURITY: cancelling a booking carries financial/refund implications.
    // OPS removed so a level-1 OPS admin cannot cancel; requires FINANCE+.
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: CancelBookingSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: { id: true, status: true },
      })
      if (!booking) throw new CrudActionError('NOT_FOUND', `Booking ${data.bookingId} not found.`)
      if (booking.status === 'CANCELLED') {
        throw new CrudActionError('CONFLICT', 'Booking is already cancelled.')
      }
      await tx.booking.update({
        where: { id: data.bookingId },
        data: { status: 'CANCELLED', cancelReason: data.reason },
      })
      return { id: data.bookingId }
    },
  })
  revalidatePath(`/admin/bookings/${input.bookingId}`)
  return result
}

export async function rescheduleBookingFromFormAction(formData: FormData) {
  try {
    return await rescheduleBookingAction({
      bookingId: formData.get('bookingId') as string,
      newDate: (formData.get('newDate') as string ?? '').trim(),
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to reschedule booking' }
  }
}

export async function cancelBookingFromFormAction(formData: FormData) {
  try {
    const { requireAdmin } = await import('@/lib/auth')
    const activeAdmin = await requireAdmin()
    const bookingId = formData.get('bookingId')
    if (typeof bookingId !== 'string' || !bookingId) {
      return { ok: false as const, error: 'Invalid booking ID' }
    }
    const { cancelBookingLifecycle } = await import('@/lib/bookings')
    const result = await crudAction({
      entity: 'Booking',
      entityId: bookingId,
      action: 'booking.cancel',
      // SECURITY: cancelling a booking carries financial/refund implications.
      // OPS removed so a level-1 OPS admin cannot cancel; requires FINANCE+.
      requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
      requiredFlag: FLAG,
      schema: z.object({ bookingId: z.string().min(1) }),
      input: { bookingId },
      run: async () => {
        await cancelBookingLifecycle({
          bookingId,
          actorId: activeAdmin.id,
          actorRole: 'admin',
          reason: 'Cancelled by admin from booking detail',
        })
        return { id: bookingId, status: 'CANCELLED' }
      },
    })
    revalidatePath(`/admin/bookings/${bookingId}`)
    revalidatePath('/admin/bookings')
    return { ok: true as const, data: result.data }
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to cancel booking' }
  }
}

export async function markPaidFromFormAction(formData: FormData) {
  try {
    const bookingId = formData.get('bookingId')
    if (typeof bookingId !== 'string' || !bookingId) {
      return { ok: false as const, error: 'Invalid booking ID' }
    }
    const result = await crudAction({
      entity: 'Booking',
      entityId: bookingId,
      action: 'payment.mark_paid',
      // SECURITY: payment status is a financial action. OPS removed so an OPS
      // admin (hierarchy level 1) cannot mark a booking as paid; requires
      // FINANCE or higher.
      requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
      requiredFlag: FLAG,
      schema: z.object({ bookingId: z.string().min(1) }),
      input: { bookingId },
      run: async (_, tx) => {
        const freshBooking = await tx.booking.findUnique({
          where: { id: bookingId },
          select: {
            status: true,
            quote: { select: { amount: true } },
            payment: { select: { status: true } },
          },
        })
        if (!freshBooking || freshBooking.status !== 'SCHEDULED' || freshBooking.payment?.status === 'PAID') {
          throw new CrudActionError('CONFLICT', 'Payment cannot be marked as paid for this booking.')
        }
        const amount = freshBooking.quote?.amount ?? 0
        const paidAt = new Date()
        await tx.payment.upsert({
          where: { bookingId },
          create: { bookingId, amount, status: 'PAID', paidAt },
          update: { status: 'PAID', paidAt },
        })
        await tx.booking.update({ where: { id: bookingId }, data: { status: 'SCHEDULED' } })
        return { id: bookingId, bookingStatus: 'SCHEDULED', paymentStatus: 'PAID' }
      },
    })
    revalidatePath(`/admin/bookings/${bookingId}`)
    return { ok: true as const, data: result.data }
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to mark payment as paid' }
  }
}
