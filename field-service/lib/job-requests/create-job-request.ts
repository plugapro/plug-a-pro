// ─── Shared domain service: create job request ────────────────────────────────
// Single entry point for both the web API route and the WhatsApp flow.
// Wraps customer resolution + address creation + JobRequest creation in a
// single Prisma transaction so the intake is atomic under retry/failure.
// Triggers lead dispatch fire-and-forget after the transaction commits.

import { after } from 'next/server'
import { db } from '../db'
import { resolveCategoryRequirements } from '../category-config'
import { geocodeAddress } from '../geocoding'
import { resolveSuburbNodeId } from '../location-nodes'
import { getJobRequestAccessUrl } from '../job-request-access'
import { normalizePhone } from '../utils'
import { openCase } from '../cases'
import { MATCHING_CONFIG } from '../matching/config'
import { createTestCohortContext, testRequestFields } from '../internal-test-cohort'
import { phoneLookupVariants } from '../whatsapp-identity'
import { normaliseLocationDisplayName } from '../location-format'
import { buildRequestRef } from '../client-request-data'

export interface CreateJobRequestParams {
  // Customer identity — supply one of the two sets:
  // Web path: userId + phone (from session)
  // WhatsApp path: phone only (userId null / omitted)
  userId?: string | null
  phone: string
  customerName?: string | null

  // Job details
  category: string
  requestRef?: string | null
  source?: string | null
  subcategory?: string | null
  title: string
  description?: string
  urgency?: string | null
  budgetPreference?: string | null
  maxCallOutFee?: number | null
  providerPreference?: string | null
  verifiedOnly?: boolean | null
  estimatedDurationMinutes?: number
  requestedWindowStart?: Date | null
  requestedWindowEnd?: Date | null
  requestedArrivalLatest?: Date | null
  assignmentMode?: 'AUTO_ASSIGN' | 'OPS_REVIEW'
  preferredProviderId?: string | null
  customerAcceptedAmount?: number | null
  customerAcceptedScope?: string | null

  // Requirements (merged with category policy defaults inside service)
  requiredSkillTags?: string[]
  requiredCertificationCodes?: string[]
  requiredEquipmentTags?: string[]
  requiredVehicleTypes?: string[]

  // Address
  // Supply existingAddressId to reuse a saved address (skips address.create).
  // The address must belong to the resolved customer — verified inside the transaction.
  existingAddressId?: string | null
  street: string
  addressLine1?: string | null
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
  // Sensitive structured access details (gate codes, dog warnings, etc).
  // Stored on Address.accessNotes; only revealed to the provider after the
  // selected-provider final acceptance creates a LeadUnlock.
  accessNotes?: string | null
  suburb: string
  region?: string | null
  city: string
  province: string
  postalCode?: string | null
  locationNodeId?: string | null   // SUBURB node ID — null for legacy/WhatsApp paths

  // WhatsApp photos are stored before the JobRequest exists. Link them inside
  // this transaction so request creation and photo ownership stay consistent.
  photoAttachmentIds?: string[]
}

export interface CreateJobRequestResult {
  jobRequestId: string
  requestRef: string
  customerId: string
  ticketUrl: string | null
}

/**
 * Thrown when an active job request for the same phone + category already exists.
 * The caller should surface this as a "you already have a pending request" message
 * rather than showing a generic error.
 */
export class DuplicateActiveRequestError extends Error {
  constructor(
    public readonly existingId: string,
    public readonly customerId: string,
    public readonly existingStatus: string,
    public readonly existingDescription: string,
  ) {
    super('DUPLICATE_ACTIVE_REQUEST')
    this.name = 'DuplicateActiveRequestError'
  }
}

export class JobRequestPhotoLinkError extends Error {
  constructor(
    public readonly expectedCount: number,
    public readonly linkedCount: number,
  ) {
    super('JOB_REQUEST_PHOTO_LINK_FAILED')
    this.name = 'JobRequestPhotoLinkError'
  }
}

function uniqueAttachmentIds(ids: string[] | undefined) {
  return Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)))
}

export async function createJobRequest(
  params: CreateJobRequestParams,
): Promise<CreateJobRequestResult> {
  // Normalise phone to E.164 once at the boundary — WhatsApp delivers numbers
  // without the + prefix (e.g. 27821234567) while the PWA session always has
  // +27…. A mismatch causes linkCustomerAccount to miss existing records.
  const phone = normalizePhone(params.phone)
  params = { ...params, phone }
  const cohort = createTestCohortContext(phone)
  const photoAttachmentIds = uniqueAttachmentIds(params.photoAttachmentIds)
  const locality = {
    suburb: normaliseLocationDisplayName(params.suburb),
    region: normaliseLocationDisplayName(params.region),
    city: normaliseLocationDisplayName(params.city),
    province: normaliseLocationDisplayName(params.province),
  }

  const providerForPhone = await (db as any).provider?.findFirst?.({
    where: { phone: { in: phoneLookupVariants(phone) } },
    select: { id: true, status: true },
  }) ?? null
  if (providerForPhone) {
    throw new Error('PHONE_ROLE_CONFLICT_PROVIDER')
  }

  const categoryRequirements = await resolveCategoryRequirements({
    category: params.category,
    requiredCertificationCodes: params.requiredCertificationCodes,
    requiredEquipmentTags: params.requiredEquipmentTags,
    requiredVehicleTypes: params.requiredVehicleTypes,
  })

  // Geocode before the transaction — non-blocking, failure is safe to ignore
  const geo = await geocodeAddress({
    street:   params.street,
    suburb:   locality.suburb,
    city:     locality.city,
    province: locality.province,
  })
  const resolvedLocationNodeId =
    params.locationNodeId ?? (await resolveSuburbNodeId(locality.suburb, locality.city))
  const requestRef = params.requestRef?.trim() || buildRequestRef()

  // Atomic: customer upsert + address + jobRequest in one transaction
  const result = await db.$transaction(async (tx) => {
    // ── Idempotency guard: reject duplicate active requests within the transaction ──
    // Running this check inside the transaction (rather than outside as a
    // pre-flight query) closes the race window where two concurrent submits both
    // pass a pre-check and then both create a JobRequest row.
    const existingActive = await tx.jobRequest.findFirst({
      where: {
        customer: { phone: params.phone },
        category: params.category,
        status: { in: ['PENDING_VALIDATION', 'OPEN', 'MATCHING'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, description: true, status: true, customerId: true },
    })
    if (existingActive) {
      throw new DuplicateActiveRequestError(
        existingActive.id,
        existingActive.customerId,
        existingActive.status,
        existingActive.description ?? '',
      )
    }

    // Resolve or create customer — support both userId-keyed (web) and
    // phone-keyed (WhatsApp) lookups so duplicate records never appear.
    let customer: { id: string; isTestUser: boolean; cohortName: string | null }

    if (params.userId) {
      const existingByUserId = await tx.customer.findUnique({
        where: { userId: params.userId },
        select: { id: true, isTestUser: true, cohortName: true },
      })

      if (existingByUserId) {
        customer = existingByUserId
      } else {
        const existingByPhone = await tx.customer.findUnique({
          where: { phone: params.phone },
          select: { id: true, userId: true, name: true, isTestUser: true, cohortName: true },
        })

        if (existingByPhone) {
          customer = await tx.customer.update({
            where: { id: existingByPhone.id },
            data: {
              userId: params.userId,
              ...(params.customerName && existingByPhone.name === 'WhatsApp Customer'
                ? { name: params.customerName }
                : {}),
            },
            select: { id: true, isTestUser: true, cohortName: true },
          })
        } else {
          customer = await tx.customer.create({
            data: {
              userId: params.userId,
              phone: params.phone,
              name: params.customerName ?? 'Customer',
              isTestUser: cohort.isTestUser,
              cohortName: cohort.cohortName,
            },
            select: { id: true, isTestUser: true, cohortName: true },
          })
        }
      }
    } else {
      customer = await tx.customer.upsert({
        where: { phone: params.phone },
        create: {
          phone: params.phone,
          name: params.customerName ?? 'WhatsApp Customer',
          isTestUser: cohort.isTestUser,
          cohortName: cohort.cohortName,
        },
        update: cohort.isTestUser ? { isTestUser: true, cohortName: cohort.cohortName } : {},
        select: { id: true, isTestUser: true, cohortName: true },
      })
    }

    // Reuse a saved address if the caller supplies an existingAddressId that
    // belongs to this customer.  Fall back to creating a new address row when
    // the ID is absent, cannot be found, or belongs to a different customer.
    let address: { id: string }
    if (params.existingAddressId) {
      const existing = await tx.address.findFirst({
        where: { id: params.existingAddressId, customerId: customer.id },
        select: { id: true },
      })
      if (existing) {
        address = existing
      } else {
        // ID not found or ownership mismatch — create fresh to stay consistent
        address = await tx.address.create({
          data: {
            customerId: customer.id,
            street:     params.street,
            addressLine1: params.addressLine1?.trim() || null,
            addressLine2: params.addressLine2?.trim() || null,
            complexName: params.complexName?.trim() || null,
            unitNumber: params.unitNumber?.trim() || null,
            accessNotes: params.accessNotes?.trim() || null,
            suburb:     locality.suburb,
            region:     locality.region || null,
            city:       locality.city,
            province:   locality.province,
            postalCode: params.postalCode ?? null,
            lat:        geo?.lat ?? null,
            lng:        geo?.lng ?? null,
            locationNodeId: resolvedLocationNodeId ?? null,
          },
          select: { id: true },
        })
      }
    } else {
      address = await tx.address.create({
        data: {
          customerId: customer.id,
          street:     params.street,
          addressLine1: params.addressLine1?.trim() || null,
          addressLine2: params.addressLine2?.trim() || null,
          complexName: params.complexName?.trim() || null,
          unitNumber: params.unitNumber?.trim() || null,
          suburb:     locality.suburb,
          region:     locality.region || null,
          city:       locality.city,
          province:   locality.province,
          postalCode: params.postalCode ?? null,
          lat:        geo?.lat ?? null,
          lng:        geo?.lng ?? null,
          locationNodeId: resolvedLocationNodeId ?? null,
        },
        select: { id: true },
      })
    }

    const autoCreateBookingOnAssignment =
      categoryRequirements.policy.bookingOnAssignment &&
      typeof params.customerAcceptedAmount === 'number'

    // Compute expiry: default is jobRequestMaxAgeDays from now.
    // If the client specified an urgency window (requestedArrivalLatest) that is
    // earlier, use that + 24 h buffer so we don't expire before the window closes.
    const defaultExpiresAt = new Date(
      Date.now() + MATCHING_CONFIG.jobRequestMaxAgeDays * 24 * 60 * 60 * 1000,
    )
    const urgencyExpiresAt =
      params.requestedArrivalLatest
        ? new Date(params.requestedArrivalLatest.getTime() + 24 * 60 * 60 * 1000)
        : null
    const expiresAt =
      urgencyExpiresAt && urgencyExpiresAt < defaultExpiresAt
        ? urgencyExpiresAt
        : defaultExpiresAt

    const jobRequest = await tx.jobRequest.create({
      data: {
        customerId: customer.id,
        addressId: address.id,
        category: params.category,
        requestRef,
        source: params.source?.trim() || 'unknown',
        subcategory: params.subcategory?.trim() || undefined,
        title: params.title,
        description: params.description ?? '',
        urgency: params.urgency?.trim() || undefined,
        budgetPreference: params.budgetPreference?.trim() || undefined,
        maxCallOutFee:
          typeof params.maxCallOutFee === 'number'
            ? params.maxCallOutFee
            : undefined,
        providerPreference: params.providerPreference?.trim() || undefined,
        verifiedOnly: params.verifiedOnly === true,
        submittedAt: new Date(),
        status: 'OPEN',
        expiresAt,
        requestedWindowStart: params.requestedWindowStart ?? undefined,
        requestedWindowEnd: params.requestedWindowEnd ?? undefined,
        requestedArrivalLatest: params.requestedArrivalLatest ?? undefined,
        estimatedDurationMinutes: params.estimatedDurationMinutes ?? 120,
        requiredSkillTags: params.requiredSkillTags ?? [],
        requiredCertificationCodes: categoryRequirements.requiredCertificationCodes,
        requiredEquipmentTags: categoryRequirements.requiredEquipmentTags,
        requiredVehicleTypes: categoryRequirements.requiredVehicleTypes,
        preferredProviderId: params.preferredProviderId ?? undefined,
        assignmentMode: params.assignmentMode ?? 'AUTO_ASSIGN',
        customerAcceptedAmount:
          typeof params.customerAcceptedAmount === 'number'
            ? params.customerAcceptedAmount
            : undefined,
        customerAcceptedScope: params.customerAcceptedScope?.trim() || undefined,
        autoCreateBookingOnAssignment,
        // Read from the resolved Customer row (DB is authoritative). The
        // phone-based `cohort` is only used to seed brand-new customer rows above.
        ...testRequestFields(customer.isTestUser),
      },
      select: { id: true },
    })

    if (photoAttachmentIds.length > 0) {
      const linkResult = await tx.attachment.updateMany({
        where: {
          id: { in: photoAttachmentIds },
          jobRequestId: null,
          jobId: null,
          providerApplicationId: null,
          label: 'customer_photo',
        },
        data: { jobRequestId: jobRequest.id },
      })

      if (linkResult.count !== photoAttachmentIds.length) {
        console.error('[create-job-request] photo attachment link mismatch', {
          jobRequestId: jobRequest.id,
          expected: photoAttachmentIds.length,
          linked: linkResult.count,
        })
        throw new JobRequestPhotoLinkError(photoAttachmentIds.length, linkResult.count)
      }

      console.info('[create-job-request] customer photos linked', {
        jobRequestId: jobRequest.id,
        linked: linkResult.count,
      })
    }

    return { jobRequestId: jobRequest.id, requestRef, customerId: customer.id }
  })

  // Open a DISPATCH case for the new job request (fire and forget — cron can backfill on failure).
  openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: result.jobRequestId })
    .catch((err) => console.error('[create-job-request] openCase failed:', err))

  // Trigger matching via after() so Vercel keeps the function alive until matching completes.
  // after() runs post-response, preventing the Vercel cold-start timeout from killing the match.
  // If after() is unavailable (e.g. called from inside another after() callback such as the
  // WhatsApp webhook handler), fall back to a plain fire-and-forget promise — the 5-min cron
  // will catch anything that doesn't complete.
  const runMatching = async () => {
    try {
      const { orchestrateMatch } = await import('../matching/orchestrator')
      const matchResult = await orchestrateMatch(result.jobRequestId, { triggeredBy: 'job_creation' })

      if (matchResult.status === 'NO_MATCH') {
        console.log('[create-job-request] no providers found — cron will retry', {
          jobRequestId: result.jobRequestId,
          consideredCount: matchResult.consideredCount,
        })
        // Notify customer so they know their request is received, even if not yet matched
        const customer = await db.customer.findUnique({
          where: { id: result.customerId },
          select: { phone: true, name: true, isTestUser: true },
        })
        if (customer?.phone) {
          const { sendText } = await import('../whatsapp-interactive')
          await sendText(
            customer.phone,
            `✅ *Request received!*\n\nHi *${(customer.name ?? 'there').split(' ')[0]}*, your service request has been submitted. We're searching for a suitable provider in your area and will notify you as soon as one accepts.\n\nReply *Hi* anytime to check the status.`,
            {
              templateName: 'interactive:request_received_no_match',
              metadata: {
                jobRequestId: result.jobRequestId,
                isTestRequest: customer.isTestUser,
              },
            }
          ).catch(() => {})
        }
      }
    } catch (err) {
      console.error('[create-job-request] matching trigger failed:', err)
    }
  }

  try {
    after(runMatching)
  } catch {
    // after() is not available in this execution context (e.g. nested inside another after()
    // callback from the WhatsApp webhook handler). Await directly so matching completes
    // within the outer after() lifetime rather than being abandoned fire-and-forget.
    await runMatching()
  }

  let ticketUrl: string | null = null
  try {
    ticketUrl = await getJobRequestAccessUrl(result.jobRequestId, 'matching_status')
  } catch (err) {
    console.error('[create-job-request] ticket URL generation failed:', err)
  }

  return {
    ...result,
    ticketUrl,
  }
}
