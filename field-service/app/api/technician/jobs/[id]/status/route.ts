// POST /api/technician/jobs/[id]/status
// Body: { toStatus: JobStatus }
// Called from the provider job detail page status controls.
// Enforces that the caller is the assigned provider for this job.

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
  const { toStatus } = body as { toStatus?: JobStatus }

  if (!toStatus || !VALID_STATUSES.includes(toStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Verify this provider owns the job
  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job || job.providerId !== provider.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (toStatus === 'PENDING_COMPLETION_CONFIRMATION') {
    const photoCount = await db.attachment.count({
      where: {
        jobId,
        mimeType: { startsWith: 'image/' },
      },
    })

    if (photoCount === 0) {
      return NextResponse.json(
        { error: 'Add at least one work photo before marking the job complete.' },
        { status: 422 },
      )
    }
  }

  try {
    await transitionJob({
      jobId,
      toStatus,
      actorId: session.id,
      actorRole: 'provider',
    })
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return NextResponse.json(
      { error: getProviderStatusRouteErrorMessage(err) },
      { status: 422 },
    )
  }
}
