// ─── Shared domain service: create job request ────────────────────────────────
// Single entry point for both the web API route and the WhatsApp flow.
// Wraps customer resolution + address creation + JobRequest creation in a
// single Prisma transaction so the intake is atomic under retry/failure.
// Triggers lead dispatch fire-and-forget after the transaction commits.

import { db } from '../db'
import { mergeCategoryRequirements } from '../service-category-policy'

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
  suburb: string
  city: string
  province: string
  postalCode?: string | null
}

export interface CreateJobRequestResult {
  jobRequestId: string
  customerId: string
}

export async function createJobRequest(
  params: CreateJobRequestParams,
): Promise<CreateJobRequestResult> {
  const categoryRequirements = mergeCategoryRequirements({
    category: params.category,
    requiredCertificationCodes: params.requiredCertificationCodes,
    requiredEquipmentTags: params.requiredEquipmentTags,
    requiredVehicleTypes: params.requiredVehicleTypes,
  })

  // Atomic: customer upsert + address + jobRequest in one transaction
  const result = await db.$transaction(async (tx) => {
    // Resolve or create customer — support both userId-keyed (web) and
    // phone-keyed (WhatsApp) lookups so duplicate records never appear.
    let customer: { id: string }

    if (params.userId) {
      customer = await tx.customer.upsert({
        where: { userId: params.userId },
        create: {
          userId: params.userId,
          phone: params.phone,
          name: params.customerName ?? 'Customer',
        },
        update: {},
        select: { id: true },
      })
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
        street: params.street,
        suburb: params.suburb,
        city: params.city,
        province: params.province,
        postalCode: params.postalCode ?? null,
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

  // Trigger matching outside the transaction — fire and forget.
  // The cron job will retry on the next cycle if this fails.
  import('../matching-engine')
    .then(({ dispatchLeads }) => dispatchLeads(result.jobRequestId))
    .then((matchResult) => {
      if (matchResult.noMatch) {
        console.log(
          `[create-job-request] No providers found for ${result.jobRequestId} — cron will retry`,
        )
      }
    })
    .catch((err) => console.error('[create-job-request] Matching error:', err))

  return result
}
