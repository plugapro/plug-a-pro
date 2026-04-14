// ─── POST /api/customer/bookings ─────────────────────────────────────────────
// Creates a JobRequest for the P2P marketplace model.
// No slotId, no serviceId, no businessId — category-based, address-only.
// Requires auth.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createJobRequest } from '@/lib/job-requests/create-job-request'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!session.phone) {
    return NextResponse.json({ error: 'Verified phone required' }, { status: 403 })
  }

  let body: {
    category: string
    title: string
    description: string
    street: string
    suburb: string
    city: string
    province: string
    postalCode?: string
    requestedWindowStart?: string
    requestedWindowEnd?: string
    requestedArrivalLatest?: string
    estimatedDurationMinutes?: number
    requiredSkillTags?: string[]
    requiredCertificationCodes?: string[]
    requiredEquipmentTags?: string[]
    requiredVehicleTypes?: string[]
    preferredProviderId?: string
    assignmentMode?: 'AUTO_ASSIGN' | 'OPS_REVIEW'
    customerAcceptedAmount?: number
    customerAcceptedScope?: string
    locationNodeId?: string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    category,
    title,
    description,
    street,
    suburb,
    city,
    province,
    postalCode,
    requestedWindowStart,
    requestedWindowEnd,
    requestedArrivalLatest,
    estimatedDurationMinutes,
    requiredSkillTags,
    requiredCertificationCodes,
    requiredEquipmentTags,
    requiredVehicleTypes,
    preferredProviderId,
    assignmentMode,
    customerAcceptedAmount,
    customerAcceptedScope,
    locationNodeId,
  } = body

  if (!category || !title || !description || !street || !suburb || !city || !province) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const result = await createJobRequest({
      userId: session.id,
      phone: session.phone!,
      category,
      title,
      description: description ?? '',
      estimatedDurationMinutes: estimatedDurationMinutes ?? undefined,
      requestedWindowStart: requestedWindowStart ? new Date(requestedWindowStart) : null,
      requestedWindowEnd: requestedWindowEnd ? new Date(requestedWindowEnd) : null,
      requestedArrivalLatest: requestedArrivalLatest ? new Date(requestedArrivalLatest) : null,
      assignmentMode: assignmentMode ?? 'AUTO_ASSIGN',
      preferredProviderId: preferredProviderId ?? null,
      customerAcceptedAmount: typeof customerAcceptedAmount === 'number' ? customerAcceptedAmount : null,
      customerAcceptedScope: customerAcceptedScope ?? null,
      requiredSkillTags: requiredSkillTags ?? [],
      requiredCertificationCodes,
      requiredEquipmentTags,
      requiredVehicleTypes,
      street,
      suburb,
      city,
      province,
      postalCode: postalCode ?? null,
      locationNodeId: locationNodeId ?? null,
    })
    return NextResponse.json({ jobRequestId: result.jobRequestId })
  } catch (err) {
    console.error('[bookings] createJobRequest failed', err)
    return NextResponse.json({ error: 'Failed to create job request' }, { status: 500 })
  }
}
