// ─── Booking status check flow ────────────────────────────────────────────────
// Customer replies "status" or taps "My Booking" → sees their latest booking

import { sendText, sendButtons, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import type { FlowContext, FlowResult } from './types'

const JOB_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: '📋 Technician assigned',
  EN_ROUTE: '🚗 Technician on the way',
  ARRIVED: '🏠 Technician arrived',
  STARTED: '🔧 Work in progress',
  PAUSED: '⏸ Job paused',
  AWAITING_APPROVAL: '⚠️ Needs your approval',
  COMPLETED: '✅ Job completed',
  FAILED: '❌ Job could not be completed',
  CALLBACK_REQUIRED: '📞 Callback required',
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: '💳 Awaiting payment',
  CONFIRMED: '✅ Confirmed',
  SCHEDULED: '🗓 Scheduled',
  RESCHEDULED: '🔄 Rescheduled',
  CANCELLED: '❌ Cancelled',
  COMPLETED: '✅ Completed',
}

export async function handleStatusFlow(ctx: FlowContext): Promise<FlowResult> {
  const customer = await db.customer.findUnique({
    where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
  })

  if (!customer) {
    await sendButtons(
      ctx.phone,
      "📋 I couldn't find any bookings for your number.\n\nWould you like to make a booking?",
      [
        { id: 'book', title: '🔧 Book a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'welcome' }
  }

  const bookings = await db.booking.findMany({
    where: { customerId: customer.id },
    include: { service: true, job: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })

  if (bookings.length === 0) {
    await sendButtons(
      ctx.phone,
      "📋 You don't have any bookings yet. Would you like to make one?",
      [
        { id: 'book', title: '🔧 Book a Service' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'welcome' }
  }

  const latest = bookings[0]
  const jobStatus = latest.job?.status
  const bookingStatus = latest.status

  const statusLabel = jobStatus
    ? JOB_STATUS_LABELS[jobStatus]
    : BOOKING_STATUS_LABELS[bookingStatus]

  const dateLabel = latest.scheduledDate
    ? latest.scheduledDate.toLocaleDateString('en-ZA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : 'Date TBC'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const trackingUrl = `${appUrl}/bookings/${latest.id}`

  // Extra work pending? Send approval reminder
  if (jobStatus === 'AWAITING_APPROVAL') {
    const extra = await db.extraWork.findFirst({
      where: { jobId: latest.job?.id, status: 'PENDING' },
    })
    if (extra) {
      const approvalUrl = `${appUrl}/approve/${extra.approvalToken}`
      await sendCtaUrl(
        ctx.phone,
        `⚠️ *Action needed on your booking*\n\n🔧 ${latest.service.name}\n🗓 ${dateLabel}\n\nYour technician needs approval for additional work:\n_${extra.description}_ — R${Number(extra.amount).toFixed(0)}\n\nTap below to approve or decline:`,
        'Review & Approve',
        approvalUrl
      )
      return { nextStep: 'done' }
    }
  }

  // Default: show status with tracking link
  await sendCtaUrl(
    ctx.phone,
    `📋 *Your latest booking*\n\n🔧 ${latest.service.name}\n🗓 ${dateLabel}${latest.scheduledWindow ? ` · ${latest.scheduledWindow}` : ''}\n${statusLabel}`,
    'Track Booking',
    trackingUrl,
    { footer: 'Tap to view full details' }
  )

  return { nextStep: 'done' }
}
