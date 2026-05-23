// POST /api/technician/jobs/[id]/status
// Body: { toStatus: JobStatus; notes?: string }
// Called from the provider job detail page status controls.
// Enforces that the caller is the assigned provider for this job.
// Optional notes are stored in JobStatusEvent for that transition.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { transitionJob } from '@/lib/jobs'
import { db } from '@/lib/db'
import { getProviderStatusRouteErrorMessage } from '@/lib/provider-action-errors'
import type { JobStatus } from '@prisma/client'

const VALID_STATUSES: JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PAUSED',
  'PENDING_COMPLETION_CONFIRMATION',
  'FAILED',
  'CALLBACK_REQUIRED',
]

const PAYMENT_REQUIRED_STATUSES = new Set<JobStatus>([
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PENDING_COMPLETION_CONFIRMATION',
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: jobId } = await params
  const body = await request.json().catch(() => ({}))
  const { toStatus, notes } = body as { toStatus?: JobStatus; notes?: unknown }

  if (!toStatus || !VALID_STATUSES.includes(toStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const safeNotes =
    typeof notes === 'string' && notes.trim().length > 0
      ? notes.trim().slice(0, 1000)
      : undefined

  // Verify this provider owns the job
  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          payment: {
            select: {
              status: true,
              collectionMode: true,
              pspProvider: true,
            },
          },
        },
      },
    },
  })
  if (!job || job.providerId !== provider.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const payment = job.booking?.payment
  if (
    PAYMENT_REQUIRED_STATUSES.has(toStatus) &&
    payment?.collectionMode === 'PLATFORM_CHECKOUT' &&
    payment?.pspProvider === 'payat_go' &&
    payment.status !== 'PAID'
  ) {
    return NextResponse.json(
      { error: 'Payment is still pending.' },
      { status: 409 },
    )
  }

  try {
    await transitionJob({
      jobId,
      toStatus,
      actorId: session.id,
      actorRole: 'provider',
      notes: safeNotes,
    })
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return NextResponse.json(
      { error: getProviderStatusRouteErrorMessage(err) },
      { status: 422 },
    )
  }
}
