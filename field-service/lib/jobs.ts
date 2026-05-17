// ─── Job lifecycle state machine ─────────────────────────────────────────────
// Enforces valid status transitions for jobs.
// All status changes go through this module to ensure:
// - Immutable audit trail (JobStatusEvent)
// - Side effects (messaging)

import { db } from './db'
import type { JobStatus } from '@prisma/client'
import { recordAuditLog } from './audit'
import { getJobRequestAccessUrl } from './job-request-access'
import { openCase } from './cases'
import { getPublicAppUrl } from './provider-credit-copy'

// ─── Valid transitions ────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  // COMPLETED added to all active states to support the minimal "mark done" flow
  // where providers skip intermediate milestones and go straight to complete.
  SCHEDULED: ['EN_ROUTE', 'CALLBACK_REQUIRED', 'CANCELLED', 'COMPLETED'],
  EN_ROUTE: ['ARRIVED', 'CALLBACK_REQUIRED', 'CANCELLED', 'COMPLETED'],
  ARRIVED: ['STARTED', 'CALLBACK_REQUIRED', 'CANCELLED', 'COMPLETED'],
  STARTED: ['PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION', 'FAILED', 'CANCELLED', 'COMPLETED'],
  PAUSED: ['STARTED', 'AWAITING_APPROVAL', 'FAILED', 'CANCELLED', 'COMPLETED'],
  AWAITING_APPROVAL: ['STARTED', 'PENDING_COMPLETION_CONFIRMATION', 'FAILED', 'CANCELLED', 'COMPLETED'],
  PENDING_COMPLETION_CONFIRMATION: ['COMPLETED', 'STARTED'],
  COMPLETED: [], // terminal
  CANCELLED: [], // terminal
  FAILED: ['CALLBACK_REQUIRED', 'CANCELLED'],
  CALLBACK_REQUIRED: ['SCHEDULED'], // admin can reassign
}

// ─── State machine ────────────────────────────────────────────────────────────

export async function transitionJob(params: {
  jobId: string
  toStatus: JobStatus
  actorId: string
  actorRole: 'provider' | 'customer' | 'admin' | 'system'
  notes?: string
}): Promise<void> {
  const { jobId, toStatus, actorId, actorRole, notes } = params

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: { include: { jobRequest: { include: { customer: true, address: true } } } },
        },
      },
      provider: { select: { name: true } },
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
    if (toStatus === 'CANCELLED') updates.failureReason = notes ?? 'Cancelled'

    const updated = await tx.job.updateMany({ where: { id: jobId, status: job.status }, data: updates })
    if (updated.count === 0) {
      throw new Error(`Concurrent modification: job ${jobId} status changed before transaction committed`)
    }

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

    await recordAuditLog(
      {
        actorId,
        actorRole,
        action: 'job.status_transition',
        entityType: 'job',
        entityId: jobId,
        before: { status: job.status },
        after: { status: toStatus, notes: notes ?? null },
      },
      tx
    )

    // Booking completion is atomic with the customer sign-off. Payments and
    // invoices are intentionally outside the MVP platform flow.
    if (toStatus === 'COMPLETED') {
      await tx.booking.update({
        where: { id: job.bookingId },
        data: { status: 'COMPLETED' },
      })
    }
  })

  // Open FIELD_EXCEPTION case for jobs that enter exception states
  if (toStatus === 'FAILED' || toStatus === 'CALLBACK_REQUIRED') {
    openCase({ queueType: 'FIELD_EXCEPTION', entityType: 'BOOKING', entityId: jobId })
      .catch((err) => console.error(`[jobs] openCase FIELD_EXCEPTION failed for ${jobId}:`, err))
  }

  // Trigger side effects outside the transaction
  await triggerSideEffects({ job, toStatus })
}

// ─── Side effects ─────────────────────────────────────────────────────────────

async function triggerSideEffects(params: {
  job: Awaited<ReturnType<typeof db.job.findUnique>> & {
    booking: {
      match: {
        jobRequest: { id: string; customer: { id: string; phone: string; name: string }; category: string }
      }
    } | null
    provider: { name: string } | null
  }
  toStatus: JobStatus
}): Promise<void> {
  const { job, toStatus } = params
  if (!job?.booking) return

  const providerName = job.provider?.name ?? 'Your provider'

  const customer = job.booking.match.jobRequest.customer
  const appUrl = getPublicAppUrl()
  const ticketUrl = appUrl ? await getJobRequestAccessUrl(job.booking.match.jobRequest.id) : null
  const bookingUrl = appUrl ? `${appUrl}/bookings/${job.bookingId}` : null

  try {
    const { sendProviderOnTheWay, sendJobCompleted, sendText } = await import('./whatsapp')
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    const { ctaLabelFor } = await import('./whatsapp-copy')

    if (toStatus === 'EN_ROUTE') {
      await sendProviderOnTheWay({
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
        providerName,
        eta: 'approximately 20 minutes',
      })
    }

    if (toStatus === 'ARRIVED') {
      const { sendProviderArrived } = await import('./whatsapp')
      await sendProviderArrived({
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
        providerName,
      })
    }

    if (toStatus === 'STARTED') {
      const trackerUrl = ticketUrl ?? bookingUrl
      await sendText({
        to: customer.phone,
        text: `🔧 Work has started on your ${job.booking.match.jobRequest.category} job.\n\n${trackerUrl ? 'Your job tracker is available below.' : 'Check your booking in the Plug A Pro app for details.'}`,
        bookingId: job.bookingId,
        templateName: 'freeform:job_started',
      })
      if (trackerUrl) {
        await sendCtaUrl(
          customer.phone,
          'Your job tracker is available below.',
          ctaLabelFor('generic_details'),
          trackerUrl,
          undefined,
          { bookingId: job.bookingId, templateName: 'interactive:job_started_tracker_cta' },
        )
      }
    }

    if (toStatus === 'PENDING_COMPLETION_CONFIRMATION') {
      const { getJobCompletionUrl } = await import('./job-completion-access')
      const completionUrl = getJobCompletionUrl({
        jobId: job.id,
        customerId: job.booking.match.jobRequest.customer.id,
      })
      const signoffUrl = completionUrl ?? ticketUrl ?? bookingUrl
      await sendText({
        to: customer.phone,
        text: `✅ Your ${job.booking.match.jobRequest.category} job has been marked ready for sign-off.\n\n${signoffUrl ? 'Sign-off is available below.' : 'Check your app for the booking details.'}`,
        bookingId: job.bookingId,
        templateName: 'freeform:completion_confirmation_request',
      })
      if (signoffUrl) {
        await sendCtaUrl(
          customer.phone,
          'Sign-off is available below.',
          ctaLabelFor('generic_details'),
          signoffUrl,
          undefined,
          { bookingId: job.bookingId, templateName: 'interactive:completion_signoff_cta' },
        )
      }
    }

    if (toStatus === 'COMPLETED') {
      await sendJobCompleted({
        bookingId: job.bookingId,
        customerName: customer.name,
        customerPhone: customer.phone,
      invoiceUrl: ticketUrl ?? bookingUrl ?? '',
      })
    }
  } catch (err) {
    // Log but don't fail the status transition on messaging errors
    console.error('[jobs] Side effect error:', err)
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getProviderJobs(providerId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.job.findMany({
    where: {
      providerId,
      status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
      booking: {
        scheduledDate: { gte: today, lt: tomorrow },
      },
    },
    include: {
      booking: {
        include: {
          match: { include: { jobRequest: { include: { customer: true, address: true } } } },
        },
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
          match: { include: { jobRequest: { include: { customer: true, address: true } } } },
          payment: true,
        },
      },
      provider: true,
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
  customerPhone: string
  customerName: string
  bookingId: string
}): Promise<string> {
  // Idempotency guard: return existing token if there is already a PENDING extra-work
  // request for this job (prevents duplicate creation on provider double-tap or message retry)
  const existingPending = await db.extraWork.findFirst({
    where: { jobId: params.jobId, status: 'PENDING' },
    select: { approvalToken: true },
  })
  if (existingPending) return existingPending.approvalToken

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

  const extra = await db.extraWork.create({
    data: {
      jobId: params.jobId,
      description: params.description,
      amount: params.amountRand,
      status: 'PENDING',
      expiresAt,
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
  const appUrl = getPublicAppUrl()
  if (!appUrl) {
    throw new Error('APP_PUBLIC_URL is required to build extra-work approval links')
  }
  const approvalUrl = `${appUrl}/approve/${extra.approvalToken}`

  await sendExtraWorkApproval({
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
  if (extra.expiresAt && extra.expiresAt < new Date()) throw new Error('Approval link expired')

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
