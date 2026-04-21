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
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
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
