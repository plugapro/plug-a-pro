// ─── Shared domain service: create job request ────────────────────────────────
// Single entry point for both the web API route and the WhatsApp flow.
// Wraps customer resolution + address creation + JobRequest creation in a
// single Prisma transaction so the intake is atomic under retry/failure.
// Triggers lead dispatch fire-and-forget after the transaction commits.

import { db } from '../db'
import { resolveCategoryRequirements } from '../category-config'
import { geocodeAddress } from '../geocoding'
import { resolveSuburbNodeId } from '../location-nodes'
import { getJobRequestAccessUrl } from '../job-request-access'
import { normalizePhone } from '../utils'
import { openCase } from '../cases'

export interface CreateJobRequestParams {
  // Customer identity — supply one of the two sets:
  // Web path: userId + phone (from session)
  // WhatsApp path: phone only (userId null / omitted)
  userId?: string | null
  phone: string
  customerName?: string | null

  // Job details
  category: string
  title: string
  description?: string
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
  street: string
  addressLine1?: string | null
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
  suburb: string
  region?: string | null
  city: string
  province: string
  postalCode?: string | null
  locationNodeId?: string | null   // SUBURB node ID — null for legacy/WhatsApp paths
}

export interface CreateJobRequestResult {
  jobRequestId: string
  customerId: string
  ticketUrl: string | null
}

export async function createJobRequest(
  params: CreateJobRequestParams,
): Promise<CreateJobRequestResult> {
  // Normalise phone to E.164 once at the boundary — WhatsApp delivers numbers
  // without the + prefix (e.g. 27821234567) while the PWA session always has
  // +27…. A mismatch causes linkCustomerAccount to miss existing records.
  const phone = normalizePhone(params.phone)
  params = { ...params, phone }

  const categoryRequirements = await resolveCategoryRequirements({
    category: params.category,
    requiredCertificationCodes: params.requiredCertificationCodes,
    requiredEquipmentTags: params.requiredEquipmentTags,
    requiredVehicleTypes: params.requiredVehicleTypes,
  })

  // Geocode before the transaction — non-blocking, failure is safe to ignore
  const geo = await geocodeAddress({
    street:   params.street,
    suburb:   params.suburb,
    city:     params.city,
    province: params.province,
  })
  const resolvedLocationNodeId =
    params.locationNodeId ?? (await resolveSuburbNodeId(params.suburb, params.city))

  // Atomic: customer upsert + address + jobRequest in one transaction
  const result = await db.$transaction(async (tx) => {
    // Resolve or create customer — support both userId-keyed (web) and
    // phone-keyed (WhatsApp) lookups so duplicate records never appear.
    let customer: { id: string }

    if (params.userId) {
      const existingByUserId = await tx.customer.findUnique({
        where: { userId: params.userId },
        select: { id: true },
      })

      if (existingByUserId) {
        customer = existingByUserId
      } else {
        const existingByPhone = await tx.customer.findUnique({
          where: { phone: params.phone },
          select: { id: true, userId: true, name: true },
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
            select: { id: true },
          })
        } else {
          customer = await tx.customer.create({
            data: {
              userId: params.userId,
              phone: params.phone,
              name: params.customerName ?? 'Customer',
            },
            select: { id: true },
          })
        }
      }
    } else {
      customer = await tx.customer.upsert({
        where: { phone: params.phone },
        create: {
          phone: params.phone,
          name: params.customerName ?? 'WhatsApp Customer',
        },
        update: {},
        select: { id: true },
      })
    }

    const address = await tx.address.create({
      data: {
        customerId: customer.id,
        street:     params.street,
        addressLine1: params.addressLine1?.trim() || null,
        addressLine2: params.addressLine2?.trim() || null,
        complexName: params.complexName?.trim() || null,
        unitNumber: params.unitNumber?.trim() || null,
        suburb:     params.suburb,
        region:     params.region?.trim() || null,
        city:       params.city,
        province:   params.province,
        postalCode: params.postalCode ?? null,
        lat:        geo?.lat ?? null,
        lng:        geo?.lng ?? null,
        locationNodeId: resolvedLocationNodeId ?? null,
      },
      select: { id: true },
    })

    const autoCreateBookingOnAssignment =
      categoryRequirements.policy.bookingOnAssignment &&
      typeof params.customerAcceptedAmount === 'number'

    const jobRequest = await tx.jobRequest.create({
      data: {
        customerId: customer.id,
        addressId: address.id,
        category: params.category,
        title: params.title,
        description: params.description ?? '',
        status: 'OPEN',
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
      },
      select: { id: true },
    })

    return { jobRequestId: jobRequest.id, customerId: customer.id }
  })

  // Open a DISPATCH case for the new job request (fire and forget — cron can backfill on failure).
  openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: result.jobRequestId })
    .catch((err) => console.error('[create-job-request] openCase failed:', err))

  // Trigger matching outside the transaction — fire and forget.
  // Under matching.v2.sync_trigger the orchestrator runs synchronously on this
  // server instance. Falls back to the legacy dispatchLeads path otherwise.
  // The 30-min cron will retry on the next cycle if either path fails.
  import('@/lib/flags')
    .then(({ isEnabled }) => isEnabled('matching.v2.sync_trigger'))
    .then((useSyncTrigger) => {
      if (useSyncTrigger) {
        return import('../matching/orchestrator')
          .then(({ orchestrateMatch }) =>
            orchestrateMatch(result.jobRequestId, { triggeredBy: 'job_creation' })
          )
          .then((matchResult) => {
            if (matchResult.status === 'NO_MATCH') {
              console.log('[create-job-request] v2: no providers found — cron will retry', {
                jobRequestId: result.jobRequestId,
              })
            }
          })
      }
      return import('../matching-engine')
        .then(({ dispatchLeads }) => dispatchLeads(result.jobRequestId))
        .then((matchResult) => {
          if (matchResult.noMatch) {
            console.log(
              `[create-job-request] No providers found for ${result.jobRequestId} — cron will retry`,
            )
          }
        })
    })
    .catch((err) => console.error('[create-job-request] Matching error:', err))

  const ticketUrl = await getJobRequestAccessUrl(result.jobRequestId)

  return {
    ...result,
    ticketUrl,
  }
}
