// POST /api/technician/jobs/[id]/extras
// Body JSON: { description: string, amountRand: number }
// Creates an ExtraWork request and sends approval message to customer.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { createExtraWork } from '@/lib/jobs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || session.role !== 'technician') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: jobId } = await params

  // Verify technician owns this job
  const technician = await db.technician.findUnique({ where: { userId: session.id } })
  if (!technician) {
    return NextResponse.json({ error: 'Technician not found' }, { status: 403 })
  }

  // Load full job context needed for createExtraWork
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          customer: { select: { name: true, phone: true } },
        },
      },
    },
  })

  if (!job || job.technicianId !== technician.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const { description, amountRand } = body as {
    description?: string
    amountRand?: number
  }

  if (!description || typeof description !== 'string' || description.trim() === '') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }

  if (typeof amountRand !== 'number' || amountRand <= 0) {
    return NextResponse.json(
      { error: 'amountRand must be a positive number' },
      { status: 400 }
    )
  }

  const booking = job.booking
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  try {
    const approvalToken = await createExtraWork({
      jobId,
      description: description.trim(),
      amountRand,
      businessId: booking.businessId,
      customerPhone: booking.customer.phone,
      customerName: booking.customer.name,
      bookingId: job.bookingId,
    })

    return NextResponse.json({ approvalToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create extra work'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
