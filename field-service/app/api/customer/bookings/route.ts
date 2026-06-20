// ─── POST /api/customer/bookings ─────────────────────────────────────────────
// Creates a JobRequest for the P2P marketplace model.
// No slotId, no serviceId, no businessId - category-based, address-only.
// Requires auth.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import {
  createJobRequest,
  CustomerBlockedError,
  DuplicateActiveRequestError,
} from '@/lib/job-requests/create-job-request'
import {
  InvalidStructuredAddressError,
  resolveStructuredAddressCapture,
} from '@/lib/structured-address'
import { isEnabled } from '@/lib/flags'
import { isInActiveServiceArea, isActiveRegion, addToServiceAreaWaitlist } from '@/lib/service-area-guard'
import { uploadJobRequestPhoto } from '@/lib/storage'
import { notifyCustomerPwaRequestSubmitted } from '@/lib/client-pwa-submission-notifications'
import { canonicalizeServiceCategoryValue } from '@/lib/service-category-canonicalization'
import {
  checkPilotGate,
  countActiveProvidersFor,
  resolveAreaScopeByNodeId,
} from '@/lib/customer-serviceability'
import { apiError } from '@/lib/api-response'
import { PILOT_SKILL_TAGS } from '@/lib/service-categories'
import { buildProviderKycVisibilityWhere, KYC_GRACE_FLAG } from '@/lib/matching/kyc-grace'

const MAX_REQUEST_PHOTOS = 5
const MAX_REQUEST_PHOTO_SIZE = 10 * 1024 * 1024
const MAX_CONCURRENT_ACTIVE_REQUESTS = 5

type PhotoSafeForPreviewList = boolean[]

function parsePhotoSafeForPreview(raw: string | null, photoCount: number): PhotoSafeForPreviewList {
  if (photoCount === 0) return []
  if (!raw) return Array.from({ length: photoCount }, () => true)

  if (raw === 'true' || raw === 'false') {
    return Array.from({ length: photoCount }, () => raw === 'true')
  }

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .slice(0, photoCount)
        .map((value) => value === true)
        .concat(Array.from({ length: Math.max(0, photoCount - parsed.length) }, () => true))
    }
  } catch {
    // fallback to default true when parsing fails
  }

  return Array.from({ length: photoCount }, () => true)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!session.phone) {
    return NextResponse.json({ error: 'Verified phone required' }, { status: 403 })
  }

  // Rate limit: check for too many active requests. JobRequest.customerId stores
  // the internal Customer.id, NOT the Supabase Auth user id on session.id, so we
  // must resolve the Customer row first or the count is always ~0 and the cap is
  // bypassable (finding 92a26b92). When no Customer row exists yet the user has
  // no active requests, so the cap is trivially satisfied.
  const sessionCustomer = await resolveCustomerForSession(db, session)
  if (sessionCustomer) {
    const activeRequestCount = await db.jobRequest.count({
      where: {
        customerId: sessionCustomer.id,
        status: { in: ['PENDING_VALIDATION', 'OPEN', 'MATCHING'] },
      },
    })
    if (activeRequestCount >= MAX_CONCURRENT_ACTIVE_REQUESTS) {
      return NextResponse.json(
        {
          error: 'TOO_MANY_ACTIVE_REQUESTS',
          message: 'You have too many active service requests. Please wait for one to be resolved before submitting a new one.',
        },
        { status: 429 },
      )
    }
  }

  let body: {
    category: string
    subcategory?: string
    title: string
    description?: string
    addressLine1: string
    addressLine2?: string
    complexName?: string
    unitNumber?: string
    accessNotes?: string
    requestedWindowStart?: string
    requestedWindowEnd?: string
    requestedArrivalLatest?: string
    estimatedDurationMinutes?: number
    requiredSkillTags?: string[]
    requiredCertificationCodes?: string[]
    requiredEquipmentTags?: string[]
    requiredVehicleTypes?: string[]
    preferredProviderId?: string
    customerAcceptedAmount?: number
    customerAcceptedScope?: string
    locationNodeId: string
    urgency?: string
    providerPreference?: string
    budgetPreference?: string
    maxCallOutFee?: number
    verifiedOnly?: boolean
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    utmContent?: string
  }
  let photos: File[] = []
  let photoSafeForPreview: PhotoSafeForPreviewList = []

  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const rawWindowStart = formData.get('requestedWindowStart')
      const rawWindowEnd = formData.get('requestedWindowEnd')
      const rawArrivalLatest = formData.get('requestedArrivalLatest')
      const rawMaxCallOutFee = formData.get('maxCallOutFee')
      const rawPhotoSafeForPreview = formData.get('photoSafeForPreview')
      body = {
        category: String(formData.get('category') ?? ''),
        subcategory: formData.get('subcategory') ? String(formData.get('subcategory')) : undefined,
        title: String(formData.get('title') ?? ''),
        description: String(formData.get('description') ?? ''),
        addressLine1: String(formData.get('addressLine1') ?? ''),
        addressLine2: String(formData.get('addressLine2') ?? ''),
        complexName: String(formData.get('complexName') ?? ''),
        unitNumber: String(formData.get('unitNumber') ?? ''),
        accessNotes: formData.get('accessNotes') ? String(formData.get('accessNotes')) : undefined,
        locationNodeId: String(formData.get('locationNodeId') ?? ''),
        urgency: formData.get('urgency') ? String(formData.get('urgency')) : undefined,
        providerPreference: formData.get('providerPreference') ? String(formData.get('providerPreference')) : undefined,
        budgetPreference: formData.get('budgetPreference') ? String(formData.get('budgetPreference')) : undefined,
        maxCallOutFee: rawMaxCallOutFee ? Number(rawMaxCallOutFee) : undefined,
        preferredProviderId: formData.get('preferredProviderId') ? String(formData.get('preferredProviderId')) : undefined,
        verifiedOnly: formData.get('verifiedOnly') === 'true',
        utmSource: formData.get('utmSource') ? String(formData.get('utmSource')).slice(0, 200) : undefined,
        utmMedium: formData.get('utmMedium') ? String(formData.get('utmMedium')).slice(0, 200) : undefined,
        utmCampaign: formData.get('utmCampaign') ? String(formData.get('utmCampaign')).slice(0, 200) : undefined,
        utmContent: formData.get('utmContent') ? String(formData.get('utmContent')).slice(0, 200) : undefined,
        ...(rawWindowStart ? { requestedWindowStart: String(rawWindowStart) } : {}),
        ...(rawWindowEnd ? { requestedWindowEnd: String(rawWindowEnd) } : {}),
        ...(rawArrivalLatest ? { requestedArrivalLatest: String(rawArrivalLatest) } : {}),
      }
      photos = formData
        .getAll('photos')
        .filter((value): value is File => value instanceof File && value.size > 0)
      photoSafeForPreview = parsePhotoSafeForPreview(
        typeof rawPhotoSafeForPreview === 'string' ? rawPhotoSafeForPreview : null,
        photos.length,
      )
    } else {
      body = await req.json()
      photoSafeForPreview = []
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    category,
    subcategory,
    title,
    description,
    addressLine1,
    addressLine2,
    complexName,
    unitNumber,
    accessNotes,
    requestedWindowStart,
    requestedWindowEnd,
    requestedArrivalLatest,
    estimatedDurationMinutes,
    requiredSkillTags,
    requiredCertificationCodes,
    requiredEquipmentTags,
    requiredVehicleTypes,
    preferredProviderId,
    customerAcceptedAmount,
    customerAcceptedScope,
    locationNodeId,
    urgency,
    providerPreference,
    budgetPreference,
    maxCallOutFee,
    verifiedOnly,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
  } = body
  const rawCategory = typeof category === 'string' ? category : ''
  const canonicalCategory = canonicalizeServiceCategoryValue(rawCategory).canonical ?? rawCategory.trim()

  if (!canonicalCategory || !title || !addressLine1 || !locationNodeId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (maxCallOutFee != null && (!Number.isFinite(maxCallOutFee) || maxCallOutFee < 0)) {
    return NextResponse.json({ error: 'Max call-out fee must be a positive number' }, { status: 400 })
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

    // Service area gate - capture out-of-area contacts on the waitlist
    if (!isInActiveServiceArea(resolvedAddress.city)) {
      await addToServiceAreaWaitlist({
        phone: session.phone!,
        city: resolvedAddress.city,
        province: resolvedAddress.province,
        suburb: resolvedAddress.suburb,
        category: canonicalCategory,
        source: 'pwa',
      }).catch((err) => console.error('[bookings] waitlist upsert failed:', err))

      return NextResponse.json({ waitlisted: true, city: resolvedAddress.city })
    }

    // Resolve the area scope once; used by both the serviceability_v2 guard and
    // the West Rand pilot gate below. Cheap indexed lookup; null when the
    // locationNodeId doesn't resolve.
    const areaScope = await resolveAreaScopeByNodeId(resolvedAddress.locationNodeId).catch(() => null)

    // Server-side region gate (finding 95726512): the city-label check above
    // passes every Johannesburg suburb, but the active service area is restricted
    // to specific regionKeys (e.g. jhb_west). Re-derive the region from the
    // RESOLVED node and enforce isActiveRegion() so out-of-area JHB suburbs are
    // waitlisted instead of creating a job request. This runs independently of the
    // pilot flag so it cannot be bypassed by submitting a stale/crafted node id.
    const resolvedRegionKey = areaScope?.node.regionKey ?? ''
    if (!isActiveRegion(resolvedRegionKey)) {
      await addToServiceAreaWaitlist({
        phone: session.phone!,
        city: resolvedAddress.city,
        province: resolvedAddress.province,
        suburb: resolvedAddress.suburb,
        category: canonicalCategory,
        source: 'pwa',
      }).catch((err) => console.error('[bookings] waitlist upsert failed:', err))

      return NextResponse.json({ waitlisted: true, city: resolvedAddress.city })
    }

    // West Rand pilot gate (launch.west_rand_pilot.enabled):
    // Layered defence on top of the legacy serviceability check below — when the
    // master flag is OFF, checkPilotGate is a no-op. When ON, rejects non-pilot
    // suburbs and non-pilot categories with the standard API error envelope.
    const pilotGate = await checkPilotGate({
      suburbSlug: areaScope?.node.slug ?? null,
      rawCategory: canonicalCategory,
    })
    if (!pilotGate.ok) {
      return apiError(
        pilotGate.code,
        pilotGate.code === 'pilot.suburb_not_supported'
          ? 'We are not active in this area yet.'
          : pilotGate.code === 'pilot.category_not_supported'
            ? 'We do not have this service active in the West Rand pilot.'
            : 'Electrical is not yet available in the West Rand pilot.',
        422,
        undefined,
        {
          category: 'validation',
          retryable: false,
          suggestedActions:
            pilotGate.code === 'pilot.suburb_not_supported'
              ? ['join_waitlist', 'contact_support']
              : ['choose_supported_category', 'join_waitlist'],
          context: { category: canonicalCategory, areaSlug: areaScope?.node.slug ?? null },
        },
      )
    }

    // Serviceability v2 backend guard (customer.home.serviceability_v2):
    // Reject unsupported (area, category) tuples here so a client bypassing the
    // home-page constrained input still cannot create a request for a service
    // we cannot fulfil. The PILOT_SKILL_TAGS check covers regulated categories;
    // the provider-count check covers cases where the category is allowed
    // platform-wide but has zero active providers serving the customer's area.
    const serviceabilityV2Enabled = await isEnabled('customer.home.serviceability_v2', {
      userId: session.id,
    })
    if (serviceabilityV2Enabled) {
      if (!PILOT_SKILL_TAGS.has(canonicalCategory)) {
        return NextResponse.json(
          {
            error: 'CATEGORY_UNAVAILABLE',
            message: 'We do not have this service active yet.',
            category: canonicalCategory,
          },
          { status: 422 },
        )
      }
      if (!areaScope) {
        return NextResponse.json(
          {
            error: 'AREA_UNAVAILABLE',
            message: 'We are not active in this area yet.',
            locationNodeId: resolvedAddress.locationNodeId,
          },
          { status: 422 },
        )
      }
      const activeCount = await countActiveProvidersFor({
        area: areaScope,
        categoryTag: canonicalCategory,
      })
      if (activeCount <= 0) {
        return NextResponse.json(
          {
            error: 'CATEGORY_UNAVAILABLE_IN_AREA',
            message: 'We do not have this service active in your selected area yet.',
            category: canonicalCategory,
            areaLabel: areaScope.node.label,
          },
          { status: 422 },
        )
      }
    }

    let sanitizedPreferredProviderId: string | null = null
    if (preferredProviderId?.trim()) {
      // Defense-in-depth: today's transitive safety (verified=true requires
      // VERIFIED KYC via the approval pipeline — PR #114) is preserved AND
      // we pin an explicit kycStatus filter so a non-verified provider can
      // never be persisted as preferredProviderId regardless of any future
      // change to the approval pipeline or the kyc-required flag.
      const kycGraceOn = await isEnabled(KYC_GRACE_FLAG)
      const kycVisibilityWhere = buildProviderKycVisibilityWhere(kycGraceOn)
      const preferredProvider = await db.provider.findFirst({
        where: {
          id: preferredProviderId.trim(),
          active: true,
          verified: true,
          status: 'ACTIVE',
          AND: [
            { OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }] },
            kycVisibilityWhere,
            {
              OR: [
                {
                  providerCategories: {
                    some: {
                      categorySlug: canonicalCategory,
                      approvalStatus: 'APPROVED',
                    },
                  },
                },
                {
                  AND: [
                    { providerCategories: { none: {} } },
                    { skills: { has: canonicalCategory } },
                  ],
                },
              ],
            },
          ],
        },
        select: { id: true },
      })
      sanitizedPreferredProviderId = preferredProvider?.id ?? null
    }

        // Determine assignment mode based on feature flag
    const autoAssign = await isEnabled('feature.customer.auto_assign_on_submit')

    const result = await createJobRequest({

      userId: session.id,
      phone: session.phone!,
      category: canonicalCategory,
      subcategory: subcategory ?? null,
      title,
      description: description ?? '',
      estimatedDurationMinutes: estimatedDurationMinutes ?? undefined,
      requestedWindowStart: requestedWindowStart ? new Date(requestedWindowStart) : null,
      requestedWindowEnd: requestedWindowEnd ? new Date(requestedWindowEnd) : null,
      requestedArrivalLatest: requestedArrivalLatest ? new Date(requestedArrivalLatest) : null,
            assignmentMode: autoAssign ? 'AUTO_ASSIGN' : 'OPS_REVIEW',
      deferMatchingModeSelection: !autoAssign,
      preferredProviderId: sanitizedPreferredProviderId,
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
      accessNotes: accessNotes ?? null,
      suburb: resolvedAddress.suburb,
      region: resolvedAddress.region,
      city: resolvedAddress.city,
      province: resolvedAddress.province,
      postalCode: resolvedAddress.postalCode,
      locationNodeId: resolvedAddress.locationNodeId,
      source: 'pwa',
      urgency: urgency ?? null,
      providerPreference: providerPreference ?? null,
      budgetPreference: budgetPreference ?? null,
      maxCallOutFee: typeof maxCallOutFee === 'number' ? maxCallOutFee : null,
      verifiedOnly: typeof verifiedOnly === 'boolean' ? verifiedOnly : null,
      utmSource: utmSource ?? null,
      utmMedium: utmMedium ?? null,
      utmCampaign: utmCampaign ?? null,
      utmContent: utmContent ?? null,
    })

    let uploadedPhotoCount = 0
    for (const [index, photo] of photos.entries()) {
      await uploadJobRequestPhoto({
        jobRequestId: result.jobRequestId,
        file: photo,
        label: 'customer_photo',
        caption: 'Customer job photo',
        safeForPreview: photoSafeForPreview[index] ?? true,
        uploadedBy: session.id,
      })
      uploadedPhotoCount++
    }

    await notifyCustomerPwaRequestSubmitted({
      customerPhone: session.phone,
      category: canonicalCategory,
      suburb: resolvedAddress.suburb,
      city: resolvedAddress.city,
      ticketUrl: result.ticketUrl,
      requestId: result.jobRequestId,
    }).catch((error) => {
      console.warn('[bookings] request submitted notification failed', {
        requestId: result.jobRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return NextResponse.json({
      jobRequestId: result.jobRequestId,
      ticketUrl: result.ticketUrl,
      uploadedPhotoCount,
    })
  } catch (err) {
    if (err instanceof InvalidStructuredAddressError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof DuplicateActiveRequestError) {
      return NextResponse.json(
        {
          error: 'DUPLICATE_ACTIVE_REQUEST',
          existingRequestId: err.existingId,
          existingStatus: err.existingStatus,
        },
        { status: 409 },
      )
    }
    // Blocked / deactivated / suspended customers (finding 776df3b1): surface a
    // user-friendly 403 rather than a generic 500 so abusive accounts cannot keep
    // generating operational load and provider notifications.
    if (err instanceof CustomerBlockedError) {
      return NextResponse.json(
        {
          error: 'ACCOUNT_RESTRICTED',
          message:
            'Your account is currently restricted and cannot submit new requests. Please contact support if you believe this is a mistake.',
        },
        { status: 403 },
      )
    }
    console.error('[bookings] createJobRequest failed', err)
    return NextResponse.json({ error: 'Failed to create job request' }, { status: 500 })
  }
}
