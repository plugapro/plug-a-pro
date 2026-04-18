// ─── POST /api/customer/bookings ─────────────────────────────────────────────
// Creates a JobRequest for the P2P marketplace model.
// No slotId, no serviceId, no businessId — category-based, address-only.
// Requires auth.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createJobRequest } from '@/lib/job-requests/create-job-request'
import {
  InvalidStructuredAddressError,
  resolveStructuredAddressCapture,
} from '@/lib/structured-address'
import { isInActiveServiceArea, addToServiceAreaWaitlist } from '@/lib/service-area-guard'

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
    addressLine1: string
    addressLine2?: string
    complexName?: string
    unitNumber?: string
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
    locationNodeId: string
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
    addressLine1,
    addressLine2,
    complexName,
    unitNumber,
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

  if (!category || !title || !addressLine1 || !locationNodeId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const resolvedAddress = await resolveStructuredAddressCapture({
      addressLine1,
      addressLine2,
      complexName,
      unitNumber,
      locationNodeId,
    })

    // Service area gate — capture out-of-area contacts on the waitlist
    if (!isInActiveServiceArea(resolvedAddress.city)) {
      await addToServiceAreaWaitlist({
        phone: session.phone!,
        city: resolvedAddress.city,
        province: resolvedAddress.province,
        suburb: resolvedAddress.suburb,
        category,
        source: 'pwa',
      }).catch((err) => console.error('[bookings] waitlist upsert failed:', err))

      return NextResponse.json({ waitlisted: true, city: resolvedAddress.city })
    }

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
      street: resolvedAddress.street,
      addressLine1: resolvedAddress.addressLine1,
      addressLine2: resolvedAddress.addressLine2,
      complexName: resolvedAddress.complexName,
      unitNumber: resolvedAddress.unitNumber,
      suburb: resolvedAddress.suburb,
      region: resolvedAddress.region,
      city: resolvedAddress.city,
      province: resolvedAddress.province,
      postalCode: resolvedAddress.postalCode,
      locationNodeId: resolvedAddress.locationNodeId,
    })
    return NextResponse.json({
      jobRequestId: result.jobRequestId,
      ticketUrl: result.ticketUrl,
    })
  } catch (err) {
    if (err instanceof InvalidStructuredAddressError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[bookings] createJobRequest failed', err)
    return NextResponse.json({ error: 'Failed to create job request' }, { status: 500 })
  }
}
