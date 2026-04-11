// ─── POST /api/customer/bookings ─────────────────────────────────────────────
// Creates a JobRequest for the P2P marketplace model.
// No slotId, no serviceId, no businessId — category-based, address-only.
// Requires auth.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { mergeCategoryRequirements } from '@/lib/service-category-policy'

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
  } = body

  if (!category || !title || !description || !street || !suburb || !city || !province) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const categoryRequirements = mergeCategoryRequirements({
    category,
    requiredCertificationCodes,
    requiredEquipmentTags,
    requiredVehicleTypes,
  })

  // 1. Resolve or create Customer
  const customer = await db.customer.upsert({
    where: { userId: session.id },
    create: {
      userId: session.id,
      phone: session.phone,
      name: 'Customer',
    },
    update: {},
  })

  // 2. Create Address
  const address = await db.address.create({
    data: {
      customerId: customer.id,
      street,
      suburb,
      city,
      province,
      postalCode: postalCode ?? null,
    },
  })

  // 3. Create JobRequest
  let jobRequest: { id: string }
  try {
    jobRequest = await db.jobRequest.create({
      data: {
        customerId: customer.id,
        addressId: address.id,
        category,
        title,
        description: description ?? '',
        status: 'OPEN',
        requestedWindowStart: requestedWindowStart ? new Date(requestedWindowStart) : undefined,
        requestedWindowEnd: requestedWindowEnd ? new Date(requestedWindowEnd) : undefined,
        requestedArrivalLatest: requestedArrivalLatest ? new Date(requestedArrivalLatest) : undefined,
        estimatedDurationMinutes: estimatedDurationMinutes ?? undefined,
        requiredSkillTags: requiredSkillTags ?? [],
        requiredCertificationCodes: categoryRequirements.requiredCertificationCodes,
        requiredEquipmentTags: categoryRequirements.requiredEquipmentTags,
        requiredVehicleTypes: categoryRequirements.requiredVehicleTypes,
        preferredProviderId: preferredProviderId ?? undefined,
        assignmentMode: assignmentMode ?? 'AUTO_ASSIGN',
        customerAcceptedAmount:
          typeof customerAcceptedAmount === 'number' ? customerAcceptedAmount : undefined,
        customerAcceptedScope: customerAcceptedScope?.trim() || undefined,
        autoCreateBookingOnAssignment:
          categoryRequirements.policy.bookingOnAssignment &&
          typeof customerAcceptedAmount === 'number',
      },
      select: { id: true },
    })
  } catch (err) {
    console.error('[bookings] jobRequest.create failed', err)
    return NextResponse.json({ error: 'Failed to create job request' }, { status: 500 })
  }

  return NextResponse.json({ jobRequestId: jobRequest.id })
}
