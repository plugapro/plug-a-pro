// ─── Job lifecycle state machine ─────────────────────────────────────────────
// Enforces valid status transitions for jobs.
// All status changes go through this module to ensure:
// - Immutable audit trail (JobStatusEvent)
// - Side effects (messaging, invoice, slot release)

import { db } from './db'
import type { JobStatus } from '@prisma/client'

// ─── Valid transitions ────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  ASSIGNED: ['EN_ROUTE', 'CALLBACK_REQUIRED'],
  EN_ROUTE: ['ARRIVED', 'CALLBACK_REQUIRED'],
  ARRIVED: ['STARTED', 'CALLBACK_REQUIRED'],
  STARTED: ['PAUSED', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED'],
  PAUSED: ['STARTED', 'AWAITING_APPROVAL', 'FAILED'],
  AWAITING_APPROVAL: ['STARTED', 'COMPLETED', 'FAILED'],
  COMPLETED: [], // terminal
  FAILED: ['CALLBACK_REQUIRED'],
  CALLBACK_REQUIRED: ['ASSIGNED'], // admin can reassign
}

// ─── State machine ────────────────────────────────────────────────────────────

export async function transitionJob(params: {
  jobId: string
  toStatus: JobStatus
  actorId: string
  actorRole: 'technician' | 'admin' | 'system'
  notes?: string
}): Promise<void> {
  const { jobId, toStatus, actorId, actorRole, notes } = params

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: { customer: true, service: true, address: true },
      },
      technician: { select: { name: true } },
    },
  })


  if (!job) throw new Error(`Job not found: ${jobId}`)

  const allowed = VALID_TRANSITIONS[job.status]
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid job transition: ${job.status} → ${toStatus}. Allowed: ${allowed.join(', ')}`
    )
  }

  await db.$transaction(async (tx) => {
    // Update job status and timestamp fields
    const updates: Record<string, unknown> = { status: toStatus }
    if (toStatus === 'ARRIVED') updates.arrivedAt = new Date()
    if (toStatus === 'STARTED') updates.startedAt = new Date()
    if (toStatus === 'COMPLETED') updates.completedAt = new Date()

    await tx.job.update({ where: { id: jobId }, data: updates })

    // Record status event
    await tx.jobStatusEvent.create({
      data: {
        jobId,
        fromStatus: job.status,
        toStatus,
        actorId,
        actorRole,
        notes,
      },
    })
  })

  // Trigger side effects outside the transaction
  await triggerSideEffects({ job, toStatus })
}

// ─── Side effects ─────────────────────────────────────────────────────────────

async function triggerSideEffects(params: {
  job: Awaited<ReturnType<typeof db.job.findUnique>> & {
    booking: { businessId: string; customer: { phone: string; name: string }; service: { name: string } } | null
    technician: { name: string } | null
  }
  toStatus: JobStatus
}): Promise<void> {
  const { job, toStatus } = params
  if (!job?.booking) return

  const technicianName = job.technician?.name ?? 'Your technician'

  const { customer, service } = job.booking
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  try {
    const { sendTechnicianOnTheWay, sendJobCompleted } = await import('./whatsapp')

    if (toStatus === 'EN_ROUTE') {
      await sendTechnicianOnTheWay({
        businessId: job.booking.businessId,
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
        technicianName,
        eta: 'approximately 20 minutes',
      })
    }

    if (toStatus === 'ARRIVED') {
      const { sendTechnicianArrived } = await import('./whatsapp')
      await sendTechnicianArrived({
        businessId: job.booking.businessId,
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
        technicianName,
      })
    }

    if (toStatus === 'COMPLETED') {
      // Update parent booking status
      await db.booking.update({
        where: { id: job.bookingId },
        data: { status: 'COMPLETED' },
      })

      const invoiceUrl = `${appUrl}/bookings/${job.bookingId}/invoice`
      await sendJobCompleted({
        businessId: job.booking.businessId,
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
        invoiceUrl,
      })

      // Create invoice record (PDF generation is out of scope — pdfUrl set later)
      try {
        const bookingRecord = await db.booking.findUnique({
          where: { id: job.bookingId },
          select: { totalAmount: true },
        })
        await db.invoice.create({
          data: {
            bookingId:   job.bookingId,
            number:      `INV-${Date.now()}`,
            totalAmount: bookingRecord?.totalAmount ?? 0,
            pdfUrl:      null,
            createdAt:   new Date(),
          },
        })
      } catch (invoiceErr) {
        console.error('[jobs] Invoice creation failed:', invoiceErr)
      }
    }
  } catch (err) {
    // Log but don't fail the status transition on messaging errors
    console.error('[jobs] Side effect error:', err)
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getTodaysJobs(technicianId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.job.findMany({
    where: {
      technicianId,
      status: { notIn: ['COMPLETED', 'FAILED'] },
      booking: {
        scheduledDate: { gte: today, lt: tomorrow },
      },
    },
    include: {
      booking: {
        include: { customer: true, service: true, address: true },
      },
    },
    orderBy: { booking: { scheduledDate: 'asc' } },
  })
}

export async function getJobWithFullContext(jobId: string) {
  return db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          customer: true,
          service: true,
          address: true,
          payment: true,
        },
      },
      technician: true,
      photos: true,
      extras: true,
      statusHistory: { orderBy: { timestamp: 'asc' } },
    },
  })
}

// ─── Extra work ───────────────────────────────────────────────────────────────

export async function createExtraWork(params: {
  jobId: string
  description: string
  amountRand: number
  businessId: string
  customerPhone: string
  customerName: string
  bookingId: string
}): Promise<string> {
  const extra = await db.extraWork.create({
    data: {
      jobId: params.jobId,
      description: params.description,
      amount: params.amountRand,
      status: 'PENDING',
    },
  })

  // Transition job to AWAITING_APPROVAL
  await transitionJob({
    jobId: params.jobId,
    toStatus: 'AWAITING_APPROVAL',
    actorId: 'system',
    actorRole: 'system',
    notes: `Extra work raised: ${params.description} (R${params.amountRand})`,
  })

  // Send approval request via WhatsApp
  const { sendExtraWorkApproval } = await import('./whatsapp')
  const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approve/${extra.approvalToken}`

  await sendExtraWorkApproval({
    businessId: params.businessId,
    bookingId: params.bookingId,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    description: params.description,
    amount: `R ${params.amountRand.toFixed(2)}`,
    approvalUrl,
  })

  return extra.approvalToken
}

export async function resolveExtraWork(params: {
  approvalToken: string
  approved: boolean
  approvedByName?: string
}): Promise<void> {
  const extra = await db.extraWork.findUnique({
    where: { approvalToken: params.approvalToken },
  })

  if (!extra) throw new Error('Invalid approval token')
  if (extra.status !== 'PENDING') throw new Error('Extra work already resolved')

  await db.extraWork.update({
    where: { id: extra.id },
    data: {
      status: params.approved ? 'APPROVED' : 'DECLINED',
      approvedAt: params.approved ? new Date() : undefined,
      declinedAt: !params.approved ? new Date() : undefined,
      approvedByName: params.approvedByName,
    },
  })

  // Resume job if approved
  if (params.approved) {
    await transitionJob({
      jobId: extra.jobId,
      toStatus: 'STARTED',
      actorId: 'customer',
      actorRole: 'system',
      notes: `Extra work approved by customer`,
    })
  }
}
