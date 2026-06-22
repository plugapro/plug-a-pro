// ─── Shared domain service: create job request ────────────────────────────────
// Single entry point for both the web API route and the WhatsApp flow.
// Wraps customer resolution + address creation + JobRequest creation in a
// single Prisma transaction so the intake is atomic under retry/failure.
// Can either trigger matching immediately or defer matching until customer
// chooses a post-submit matching mode.

import type { Prisma } from '@prisma/client'
import { db } from '../db'
import type { AttributionSnapshot, AttributionState } from '../attribution'
import { resolveCategoryRequirements } from '../category-config'
import { checkPilotGate, resolveAreaScopeByNodeId } from '../customer-serviceability'
import { PilotGateError } from '../launch/errors'
import { geocodeAddress } from '../geocoding'
import { resolveSuburbNodeId } from '../location-nodes'
import { getJobRequestAccessUrl } from '../job-request-access'
import { normalizePhone } from '../utils'
import { openCase } from '../cases'
import { getUrgencyMatchingPolicy } from '../urgency'
import { createTestCohortContext, testRequestFields } from '../internal-test-cohort'
import { phoneLookupVariants } from '../whatsapp-identity'
import { normaliseLocationDisplayName } from '../location-format'
import { buildRequestRef } from '../client-request-data'
import { normalizeCustomerName } from '../customer-name'
import { canonicalizeServiceCategoryValue } from '../service-category-canonicalization'
import {
  syncReusableCustomerAddressFromSnapshot,
  type ReusableAddressTx,
} from '../customer-address-book'
import { recordWorkflowEvent } from '../workflow-events/record'

export interface CreateJobRequestParams {
  // Customer identity - supply one of the two sets:
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
  deferMatchingModeSelection?: boolean
  preferredProviderId?: string | null
  customerAcceptedAmount?: number | null
  customerAcceptedScope?: string | null

  // Paid campaign attribution (first-touch UTM from web landing; null for WhatsApp path)
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null

  // Rich attribution snapshot — captured + parsed client-side via
  // lib/attribution.ts; carries the full first/last touch state including click
  // IDs, referrer and landing path. The legacy utm* fields above stay populated
  // for back-compat with paths that don't post the rich blob.
  attribution?: AttributionState | null

  // Requirements (merged with category policy defaults inside service)
  requiredSkillTags?: string[]
  requiredCertificationCodes?: string[]
  requiredEquipmentTags?: string[]
  requiredVehicleTypes?: string[]

  // Address
  // Supply existingAddressId to reuse a saved address (skips address.create).
  // The address must belong to the resolved customer - verified inside the transaction.
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
  locationNodeId?: string | null   // SUBURB node ID - null for legacy/WhatsApp paths

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

/**
 * Thrown when the resolved customer is blocked, deactivated or suspended.
 * Blocked/inactive customers must not be able to create new job requests (which
 * would reserve providers and disclose their job details to matched providers).
 */
export class CustomerBlockedError extends Error {
  constructor(public readonly customerId: string, public readonly reason: 'BLOCKED' | 'INACTIVE' | 'SUSPENDED') {
    super('CUSTOMER_BLOCKED')
    this.name = 'CustomerBlockedError'
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

function maskPhone(phone?: string | null) {
  if (!phone) return 'unknown'
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '***'
  return `***${digits.slice(-4)}`
}

function safeIsoToDate(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

// First-touch wins for attribution credit; last-touch fills any field
// first-touch lacks (e.g. user arrives organic then clicks a tagged email link).
function buildJobRequestAttributionFields(state: AttributionState | null | undefined) {
  if (!state) return {}
  const first = state.first_touch
  const last = state.last_touch
  const pick = (key: keyof AttributionSnapshot): string | undefined => {
    const fv = first?.[key]
    if (typeof fv === 'string' && fv) return fv
    const lv = last?.[key]
    if (typeof lv === 'string' && lv) return lv
    return undefined
  }
  return {
    utmTerm: pick('utm_term'),
    gclid: pick('gclid'),
    gbraid: pick('gbraid'),
    wbraid: pick('wbraid'),
    fbclid: pick('fbclid'),
    msclkid: pick('msclkid'),
    referrer: pick('referrer'),
    landingPath: pick('landing_path'),
    firstTouchAt: safeIsoToDate(first?.captured_at),
    lastTouchAt: safeIsoToDate(last?.captured_at),
    attribution: state as unknown as Prisma.InputJsonValue,
  }
}

function buildCustomerFirstTouchStamp(first: AttributionSnapshot | null | undefined) {
  if (!first) return null
  const stamp: Record<string, string | Date> = {}
  if (first.utm_source) stamp.firstTouchSource = first.utm_source
  if (first.utm_medium) stamp.firstTouchMedium = first.utm_medium
  if (first.utm_campaign) stamp.firstTouchCampaign = first.utm_campaign
  if (first.gclid) stamp.firstTouchGclid = first.gclid
  if (first.fbclid) stamp.firstTouchFbclid = first.fbclid
  if (first.referrer) stamp.firstTouchReferrer = first.referrer
  if (first.landing_path) stamp.firstTouchLandingPath = first.landing_path
  // Only stamp when there's real attribution to record.
  if (Object.keys(stamp).length === 0) return null
  // Always set firstTouchAt whenever we write a stamp: it is the idempotency
  // marker the updateMany guard below keys on. Falling back to "now" when the
  // snapshot has no capture time (e.g. legacy-migrated first-touch, or a
  // click-id-only touch with no utm_source) is what stops every later booking
  // from re-stamping — and from overwriting the original first-touch values.
  stamp.firstTouchAt = safeIsoToDate(first.captured_at) ?? new Date()
  return stamp
}

function getExplicitRequestDeadline(params: CreateJobRequestParams) {
  const dates = [
    params.requestedWindowEnd,
    params.requestedArrivalLatest,
    params.requestedWindowStart,
  ].filter((value): value is Date => value instanceof Date)

  if (dates.length === 0) return null
  return new Date(Math.max(...dates.map((value) => value.getTime())))
}

export async function createJobRequest(
  params: CreateJobRequestParams,
): Promise<CreateJobRequestResult> {
  // Normalise phone to E.164 once at the boundary - WhatsApp delivers numbers
  // without the + prefix (e.g. 27821234567) while the PWA session always has
  // +27…. A mismatch causes linkCustomerAccount to miss existing records.
  const phone = normalizePhone(params.phone)
  const category = canonicalizeServiceCategoryValue(params.category).canonical ?? params.category.trim()
  params = { ...params, phone, category }
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

  // Geocode before the transaction - non-blocking, failure is safe to ignore
  const geo = await geocodeAddress({
    street:   params.street,
    suburb:   locality.suburb,
    city:     locality.city,
    province: locality.province,
  })
  // Resolve the SUBURB node up-front. Legacy / WhatsApp paths pass
  // locationNodeId: null, so fall back to resolving by suburb + city label. The
  // resolved node is what we gate on below so those paths can't bypass the pilot
  // suburb restriction (finding 892271a9).
  const resolvedLocationNodeId =
    params.locationNodeId ?? (await resolveSuburbNodeId(locality.suburb, locality.city))

  // West Rand pilot gate (defence-in-depth). When master flag is OFF this is
  // a no-op. When ON, rejects non-pilot suburbs / categories before any DB
  // write so internal callers (WhatsApp flow, rebook, admin tools) cannot
  // bypass the customer-facing API gate.
  //
  // ALWAYS run the full gate against the RESOLVED node id (not just when the
  // caller supplied a structured locationNodeId). Previously the suburb gate was
  // skipped whenever params.locationNodeId was null, which let legacy /
  // createDraftRequest / WhatsApp callers create requests in any suburb as long
  // as the category was allow-listed (finding 892271a9).
  {
    const areaScope = resolvedLocationNodeId
      ? await resolveAreaScopeByNodeId(resolvedLocationNodeId).catch(() => null)
      : null
    const pilotGate = await checkPilotGate({
      suburbSlug: areaScope?.node.slug ?? null,
      rawCategory: params.category,
    })
    if (!pilotGate.ok) {
      throw new PilotGateError(pilotGate.code)
    }
  }

  const requestRef = params.requestRef?.trim() || buildRequestRef()
  const initialAssignmentMode =
    params.assignmentMode ?? (params.deferMatchingModeSelection ? 'OPS_REVIEW' : 'AUTO_ASSIGN')

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

    // Resolve or create customer - support both userId-keyed (web) and
    // phone-keyed (WhatsApp) lookups so duplicate records never appear.
    const incomingCustomerName = normalizeCustomerName(params.customerName)
    const existingCustomerForPhone = await tx.customer.findUnique({
      where: { phone: params.phone },
      select: { id: true, userId: true, name: true, isTestUser: true, cohortName: true },
    })
    const existingCustomerName = normalizeCustomerName(existingCustomerForPhone?.name)
    const resolvedCustomerName = incomingCustomerName ?? existingCustomerName
    const resolvedCustomerNameSource = incomingCustomerName
      ? 'incoming'
      : existingCustomerName
        ? 'existing'
        : 'fallback'

    console.info('[create-job-request] customer name resolution', {
      category: params.category,
      phone: maskPhone(params.phone),
      customerNameSource: resolvedCustomerNameSource,
      hasIncomingName: Boolean(incomingCustomerName),
      hasExistingName: Boolean(existingCustomerName),
    })

    let customer: { id: string; isTestUser: boolean; cohortName: string | null }

    if (params.userId) {
      const existingByUserId = await tx.customer.findUnique({
        where: { userId: params.userId },
        select: { id: true, isTestUser: true, cohortName: true },
      })

      if (existingByUserId) {
        customer = existingByUserId
      } else {
        const existingByPhone = existingCustomerForPhone

        if (existingByPhone) {
          const shouldPatchName = incomingCustomerName && !normalizeCustomerName(existingByPhone.name)
          customer = await tx.customer.update({
            where: { id: existingByPhone.id },
            data: {
              userId: params.userId,
              ...(shouldPatchName ? { name: incomingCustomerName } : {}),
            },
            select: { id: true, isTestUser: true, cohortName: true },
          })
        } else {
          customer = await tx.customer.create({
            data: {
              userId: params.userId,
              phone: params.phone,
              name: incomingCustomerName ?? 'Customer',
              isTestUser: cohort.isTestUser,
              cohortName: cohort.cohortName,
            },
            select: { id: true, isTestUser: true, cohortName: true },
          })
        }
      }
    } else {
      console.info('[create-job-request] applying phone-only customer upsert with resolved name', {
        phone: maskPhone(params.phone),
        customerNameSource: resolvedCustomerNameSource,
      })
      customer = await tx.customer.upsert({
        where: { phone: params.phone },
        create: {
          phone: params.phone,
          name: resolvedCustomerName ?? 'WhatsApp Customer',
          isTestUser: cohort.isTestUser,
          cohortName: cohort.cohortName,
        },
        update: {
          ...(cohort.isTestUser ? { isTestUser: true, cohortName: cohort.cohortName } : {}),
          ...(incomingCustomerName && !normalizeCustomerName(existingCustomerForPhone?.name)
            ? { name: incomingCustomerName }
            : {}),
        },
        select: { id: true, isTestUser: true, cohortName: true },
      })
    }

    // Block guard (defence-in-depth): reject blocked / deactivated / suspended
    // customers before any address or job-request row is written. A blocked
    // customer creating a request would otherwise reserve a provider and disclose
    // their job details to the matched provider.
    const customerGuard = await tx.customer.findUnique({
      where: { id: customer.id },
      select: { isBlocked: true, active: true, suspendedUntil: true },
    })
    if (customerGuard) {
      if (customerGuard.isBlocked) {
        throw new CustomerBlockedError(customer.id, 'BLOCKED')
      }
      if (customerGuard.active === false) {
        throw new CustomerBlockedError(customer.id, 'INACTIVE')
      }
      if (customerGuard.suspendedUntil && customerGuard.suspendedUntil > new Date()) {
        throw new CustomerBlockedError(customer.id, 'SUSPENDED')
      }
    }

    // Stamp first-touch acquisition attribution on the Customer record. Race-
    // safe and write-once: the `firstTouchAt: null` guard means a concurrent or
    // later request that also stamps the same customer is a silent no-op. We
    // guard on firstTouchAt (always populated when a stamp is written) rather
    // than firstTouchSource, which can legitimately be null for a click-id-only
    // first touch and would otherwise let later touches overwrite it.
    const customerFirstTouchStamp = buildCustomerFirstTouchStamp(params.attribution?.first_touch ?? null)
    if (customerFirstTouchStamp) {
      await tx.customer.updateMany({
        where: { id: customer.id, firstTouchAt: null },
        data: customerFirstTouchStamp,
      })
    }

    // Reuse a saved address if the caller supplies an existingAddressId that
    // belongs to this customer.  Fall back to creating a new address row when
    // the ID is absent, cannot be found or belongs to a different customer.
    let address: { id: string }
    if (params.existingAddressId) {
      const existing = await tx.address.findFirst({
        where: { id: params.existingAddressId, customerId: customer.id },
        select: { id: true },
      })
      if (existing) {
        address = existing
      } else {
        // ID not found or ownership mismatch - create fresh to stay consistent
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

    await syncReusableCustomerAddressFromSnapshot(tx as unknown as ReusableAddressTx, {
      customerId: customer.id,
      authUserId: params.userId ?? null,
      customerPhone: params.phone,
      source: params.source === 'whatsapp' ? 'whatsapp' : params.source === 'pwa' ? 'pwa' : 'merged',
      snapshot: {
        label: params.addressLine1?.trim() || params.street,
        street: params.street,
        suburb: locality.suburb,
        city: locality.city,
        province: locality.province,
        postalCode: params.postalCode ?? null,
        locationNodeId: resolvedLocationNodeId ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        addressLine2: params.addressLine2?.trim() || null,
        complexName: params.complexName?.trim() || null,
        unitNumber: params.unitNumber?.trim() || null,
      },
    })

    const autoCreateBookingOnAssignment =
      categoryRequirements.policy.bookingOnAssignment &&
      typeof params.customerAcceptedAmount === 'number'

    // Compute expiry from the normalized urgency policy. The stored deadline is
    // the tighter of the urgency hard give-up and any explicit requested window.
    const urgencyPolicy = getUrgencyMatchingPolicy(params.urgency)
    const hardGiveUpExpiresAt = new Date(Date.now() + urgencyPolicy.hardGiveUpMinutes * 60 * 1000)
    const explicitDeadline = getExplicitRequestDeadline(params)
    const expiresAt =
      explicitDeadline && explicitDeadline < hardGiveUpExpiresAt
        ? explicitDeadline
        : hardGiveUpExpiresAt

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
        status: params.deferMatchingModeSelection ? 'PENDING_VALIDATION' : 'OPEN',
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
        assignmentMode: initialAssignmentMode,
        customerAcceptedAmount:
          typeof params.customerAcceptedAmount === 'number'
            ? params.customerAcceptedAmount
            : undefined,
        customerAcceptedScope: params.customerAcceptedScope?.trim() || undefined,
        utmSource: params.utmSource?.trim() || undefined,
        utmMedium: params.utmMedium?.trim() || undefined,
        utmCampaign: params.utmCampaign?.trim() || undefined,
        utmContent: params.utmContent?.trim() || undefined,
        ...buildJobRequestAttributionFields(params.attribution),
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

  // Tier 1 funnel observability — REQUEST_SUBMITTED emit. Post-tx + best-effort
  // so a recorder failure cannot roll back the submission. The actor is the
  // customer (internal id), entity is the JobRequest (real id).
  // Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
  recordWorkflowEvent({
    eventType: 'REQUEST_SUBMITTED',
    actorType: 'customer',
    actorId: result.customerId,
    entityType: 'JOB_REQUEST',
    entityId: result.jobRequestId,
    source: params.source === 'whatsapp' ? 'whatsapp' : params.source === 'pwa' ? 'pwa' : 'system',
    metadata: {
      category: params.category,
      assignmentMode: initialAssignmentMode,
      deferMatchingModeSelection: Boolean(params.deferMatchingModeSelection),
      requestRef: result.requestRef,
    },
  }).catch((err) => {
    console.warn('[create-job-request] REQUEST_SUBMITTED event write failed (non-fatal)', {
      jobRequestId: result.jobRequestId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  // Open a DISPATCH case for the new job request (fire and forget - cron can backfill on failure).
  openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: result.jobRequestId })
    .catch((err) => console.error('[create-job-request] openCase failed:', err))

  console.info('[create-job-request] request submitted', {
    jobRequestId: result.jobRequestId,
    requestRef: result.requestRef,
    source: params.source ?? null,
    category: params.category,
    status: params.deferMatchingModeSelection ? 'PENDING_VALIDATION' : 'OPEN',
    assignmentMode: initialAssignmentMode,
    matchingDeferred: Boolean(params.deferMatchingModeSelection),
  })

  // Trigger matching via after() so Vercel keeps the function alive until matching completes.
  // after() runs post-response, preventing the Vercel cold-start timeout from killing the match.
  // If after() is unavailable (e.g. called from inside another after() callback such as the
  // WhatsApp webhook handler), fall back to a plain fire-and-forget promise - the 5-min cron
  // will catch anything that doesn't complete.
  const runMatching = async () => {
    try {
      const { orchestrateMatch } = await import('../matching/orchestrator')
      const matchResult = await orchestrateMatch(result.jobRequestId, { triggeredBy: 'job_creation' })

      if (matchResult.status === 'NO_MATCH') {
        if (matchResult.failureClass === 'EMPTY_POOL' || matchResult.failureClass === 'STRUCTURAL') {
          console.log('[create-job-request] no providers found - final no-match notification handled by expiry', {
            jobRequestId: result.jobRequestId,
            consideredCount: matchResult.consideredCount,
            failureClass: matchResult.failureClass,
            primaryReason: matchResult.primaryReason,
          })
          return
        }

        console.log('[create-job-request] no providers found - cron will retry', {
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

  if (!params.deferMatchingModeSelection && initialAssignmentMode === 'AUTO_ASSIGN') {
    try {
      const { after } = await import('next/server')
      after(runMatching)
    } catch {
      // after() is not available in this execution context (e.g. nested inside another after()
      // callback from the WhatsApp webhook handler). Await directly so matching completes
      // within the outer after() lifetime rather than being abandoned fire-and-forget.
      await runMatching()
    }
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
