// POST /api/technician/jobs/[id]/status
// Body: { toStatus: JobStatus }
// Called from the technician job detail page status controls.
// Enforces that the caller is the assigned technician for this job.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { transitionJob } from '@/lib/jobs'
import { db } from '@/lib/db'
import type { JobStatus } from '@prisma/client'

const VALID_STATUSES: JobStatus[] = [
  'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'COMPLETED', 'FAILED', 'CALLBACK_REQUIRED',
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || session.role !== 'technician') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: jobId } = await params
  const body = await request.json().catch(() => ({}))
  const { toStatus } = body as { toStatus?: JobStatus }

  if (!toStatus || !VALID_STATUSES.includes(toStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Verify this technician owns the job
  const technician = await db.technician.findUnique({ where: { userId: session.id } })
  if (!technician) {
    return NextResponse.json({ error: 'Technician not found' }, { status: 403 })
  }

  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job || job.technicianId !== technician.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  try {
    await transitionJob({
      jobId,
      toStatus,
      actorId: session.id,
      actorRole: 'technician',
    })
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transition failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
