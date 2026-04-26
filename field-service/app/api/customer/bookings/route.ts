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
import { uploadJobRequestPhoto } from '@/lib/storage'

const MAX_REQUEST_PHOTOS = 5
const MAX_REQUEST_PHOTO_SIZE = 10 * 1024 * 1024

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
    description?: string
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
  let photos: File[] = []

  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const rawWindowEnd = formData.get('requestedWindowEnd')
      const rawArrivalLatest = formData.get('requestedArrivalLatest')
      body = {
        category: String(formData.get('category') ?? ''),
        title: String(formData.get('title') ?? ''),
        description: String(formData.get('description') ?? ''),
        addressLine1: String(formData.get('addressLine1') ?? ''),
        addressLine2: String(formData.get('addressLine2') ?? ''),
        complexName: String(formData.get('complexName') ?? ''),
        unitNumber: String(formData.get('unitNumber') ?? ''),
        locationNodeId: String(formData.get('locationNodeId') ?? ''),
        ...(rawWindowEnd ? { requestedWindowEnd: String(rawWindowEnd) } : {}),
        ...(rawArrivalLatest ? { requestedArrivalLatest: String(rawArrivalLatest) } : {}),
      }
      photos = formData
        .getAll('photos')
        .filter((value): value is File => value instanceof File && value.size > 0)
    } else {
      body = await req.json()
    }
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

  if (photos.length > MAX_REQUEST_PHOTOS) {
    return NextResponse.json({ error: `Upload up to ${MAX_REQUEST_PHOTOS} photos` }, { status: 400 })
  }

  for (const photo of photos) {
    if (!photo.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files can be uploaded as job photos' }, { status: 400 })
    }
    if (photo.size > MAX_REQUEST_PHOTO_SIZE) {
      return NextResponse.json({ error: 'Each photo must be 10MB or smaller' }, { status: 400 })
    }
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

    let uploadedPhotoCount = 0
    for (const photo of photos) {
      await uploadJobRequestPhoto({
        jobRequestId: result.jobRequestId,
        file: photo,
        label: 'evidence',
        caption: 'Customer job photo',
        uploadedBy: session.id,
      })
      uploadedPhotoCount++
    }

    return NextResponse.json({
      jobRequestId: result.jobRequestId,
      ticketUrl: result.ticketUrl,
      uploadedPhotoCount,
    })
  } catch (err) {
    if (err instanceof InvalidStructuredAddressError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[bookings] createJobRequest failed', err)
    return NextResponse.json({ error: 'Failed to create job request' }, { status: 500 })
  }
}
