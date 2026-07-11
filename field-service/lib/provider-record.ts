import { normalizePhone } from './utils'
import { syncProviderSkills } from './provider-skills'
import { getRegionServiceStatus, getRegionKeyFromSlug } from './service-area-guard'
import { INTERNAL_TEST_COHORT_NAME, createTestCohortContext } from './internal-test-cohort'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from './location-format'
import { canonicalizeServiceCategoryValues } from './service-category-canonicalization'
import { isKycRequiredForActivation } from './kyc-policy'
import { isEnabled } from './flags'
import { KYC_GRACE_FLAG } from './matching/kyc-grace'
import { checkCanBeApproved } from './provider-lead-eligibility'
import { resolveServiceAreaLabels } from './provider-record/resolve-service-area-labels'

const MATCHABILITY_AUTOSYNC_FLAG = 'provider.matchability.autosync' as const

type ProviderKycSnapshot = {
  id: string
  kycStatus?: string | null
  createdAt?: Date | null
  kycGraceUntil?: Date | null
  kycOverriddenAt?: Date | null
}

type ProviderRecordSyncClient = {
  provider: {
    // The KYC gate (see below) needs to read the live KYC state to decide
    // whether `verified: true` is allowed; callers may pass a narrower client
    // shape, in which case any extra fields returned by the real Prisma model
    // are still safe to ignore.
    findUnique: (...args: any[]) => Promise<ProviderKycSnapshot | { id: string } | null>
    updateMany: (...args: any[]) => Promise<unknown>
    createMany: (...args: any[]) => Promise<unknown>
  }
  technicianServiceArea?: {
    upsert: (...args: any[]) => Promise<unknown>
    updateMany: (...args: any[]) => Promise<unknown>
  }
  technicianAvailability?: {
    upsert: (...args: any[]) => Promise<unknown>
  }
  technicianSkill?: {
    upsert: (...args: any[]) => Promise<unknown>
    updateMany: (...args: any[]) => Promise<unknown>
  }
  locationNode?: {
    findMany: (...args: any[]) => Promise<Array<{
      id: string
      nodeType: string
      slug: string
      label: string
      provinceKey: string | null
      cityKey: string | null
      regionKey: string | null
    }>>
  }
}

type ProviderApplicationStatus = 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

type ProviderRecordReconcileClient = ProviderRecordSyncClient & {
  providerApplication?: {
    findMany: (...args: any[]) => Promise<Array<{
      id: string
      phone: string
      name: string
      skills: string[]
      serviceAreas: string[]
      status: ProviderApplicationStatus
      providerId: string | null
      isTestUser: boolean
      cohortName: string | null
    }>>
    updateMany: (...args: any[]) => Promise<unknown>
  }
}

type SyncProviderRecordInput = {
  phone: string
  name: string
  email?: string | null
  userId?: string | null
  skills: string[]
  serviceAreas: string[]
  active: boolean
  availableNow: boolean
  verified: boolean
  isTestUser?: boolean
  cohortName?: string | null
  avatarUrl?: string | null
  locationNodeIds?: string[]
  /**
   * When true, enrichment DB errors are surfaced to the caller instead of
   * being absorbed. Keep this false for normal background sync.
   */
  strictEnrichment?: boolean
  /**
   * When true, skip syncProviderSkills and upsertStructuredServiceAreas.
   * Use this when calling inside a db.$transaction - a caught DB error inside those
   * helpers puts the PostgreSQL connection in ABORTED state even if swallowed in JS,
   * causing all subsequent tx queries to fail. Run enrichment after the tx commits instead.
   */
  skipEnrichment?: boolean
}

export async function upsertStructuredServiceAreas(
  client: ProviderRecordSyncClient,
  providerId: string,
  locationNodeIds: string[],
) {
  if (!client.technicianServiceArea || !client.locationNode) return
  if (locationNodeIds.length === 0) return

  const nodes = await client.locationNode.findMany({
    where: { id: { in: locationNodeIds }, active: true },
    select: {
      id: true,
      nodeType: true,
      slug: true,
      label: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
    },
  })

  for (const node of nodes) {
    // SUBURB nodes get a suburbKey (last segment of slug); REGION nodes do not
    const isSuburb = node.nodeType === 'SUBURB'
    const areaType = isSuburb ? 'SUBURB' : 'REGION'
    const suburbKey = isSuburb ? (node.slug.split('__').at(-1) ?? node.slug) : null
    const regionKey = node.regionKey ?? (node.nodeType === 'REGION' ? getRegionKeyFromSlug(node.slug) : null)
    const isActivePilotArea = getRegionServiceStatus({ regionKey, slug: node.slug }) === 'active'
    const label = normaliseLocationDisplayName(node.label)

    await client.technicianServiceArea.upsert({
      where: {
        providerId_locationNodeId: {
          providerId,
          locationNodeId: node.id,
        },
      },
      create: {
        providerId,
        locationNodeId: node.id,
        areaType,
        label,
        provinceKey: node.provinceKey,
        cityKey: node.cityKey,
        regionKey,
        suburbKey,
        active: isActivePilotArea,
      },
      update: {
        areaType,
        label,
        provinceKey: node.provinceKey,
        cityKey: node.cityKey,
        regionKey,
        suburbKey,
        active: isActivePilotArea,
      },
    })
  }
}

// Resolves TSA rows for a provider from either structured locationNodeIds
// (preferred, unconditional) or — when no node ids were supplied — a
// flag-gated fallback that resolves free-text serviceAreas labels to
// location nodes. This closes the matchability gap for approval paths that
// only ever collected free-text service area labels (PJ-01).
async function enrichServiceAreas(
  client: ProviderRecordSyncClient,
  providerId: string,
  input: SyncProviderRecordInput,
) {
  if (input.locationNodeIds && input.locationNodeIds.length > 0) {
    await upsertStructuredServiceAreas(client, providerId, input.locationNodeIds)
    return
  }
  if (!input.serviceAreas || input.serviceAreas.length === 0) return
  if (!client.locationNode) return
  const autosync = await isEnabled(MATCHABILITY_AUTOSYNC_FLAG)
  if (!autosync) return
  const { resolvedNodeIds, unresolved, ambiguous } = await resolveServiceAreaLabels(
    client as { locationNode: { findMany: (...a: any[]) => Promise<any[]> } },
    input.serviceAreas,
    { preferMajorityRegion: true },
  )
  if (unresolved.length || ambiguous.length) {
    console.warn(`[matchability] provider ${providerId}: unresolved=${JSON.stringify(unresolved)} ambiguous=${JSON.stringify(ambiguous)}`)
  }
  if (resolvedNodeIds.length > 0) {
    await upsertStructuredServiceAreas(client, providerId, resolvedNodeIds)
  }
}

async function ensureDefaultProviderAvailability(
  client: ProviderRecordSyncClient,
  providerId: string,
) {
  if (!client.technicianAvailability) return

  await client.technicianAvailability.upsert({
    where: { providerId },
    create: {
      providerId,
      availabilityMode: 'ALWAYS_AVAILABLE',
      availabilityState: 'AVAILABLE',
      emergencyAvailable: true,
      sameDayAvailable: true,
      lastUpdatedBy: 'system',
      lastUpdatedChannel: 'approval',
      notes: 'Default availability after provider approval',
    },
    update: {
      availabilityMode: 'ALWAYS_AVAILABLE',
      availabilityState: 'AVAILABLE',
      nextAvailableAt: null,
      breakUntil: null,
      pausedAt: null,
      pauseReason: null,
      emergencyAvailable: true,
      sameDayAvailable: true,
      lastUpdatedBy: 'system',
      lastUpdatedChannel: 'approval',
      notes: 'Default availability after provider approval',
    },
  })
}

export async function syncProviderRecord(
  client: ProviderRecordSyncClient,
  input: SyncProviderRecordInput,
) {
  const throwOnEnrichmentFailure = (step: string, err: unknown, providerId: string) => {
    console.error(`[provider-record] ${step} failed for provider`, providerId, err)
    if (input.strictEnrichment) {
      throw err
    }
  }

  const phone = normalizePhone(input.phone)
  const phoneCohort = createTestCohortContext(phone)
  const isTestUser = input.isTestUser ?? phoneCohort.isTestUser
  const cohortName = input.cohortName ?? (isTestUser ? phoneCohort.cohortName ?? INTERNAL_TEST_COHORT_NAME : null)
  const skills = canonicalizeServiceCategoryValues(input.skills)
  const serviceAreas = normaliseLocationDisplayNames(input.serviceAreas)
  // Fetch the KYC context alongside the id so the gate can run without a
  // second query. Older callers may pass a client whose findUnique only
  // returns { id } — that still works (the guard treats unknown values as
  // NOT_STARTED and the per-provider grace/override fields default to null).
  const existing = await client.provider.findUnique({
    where: { phone },
    select: {
      id: true,
      kycStatus: true,
      createdAt: true,
      kycGraceUntil: true,
      kycOverriddenAt: true,
    },
  })

  // KYC approval gate. When provider.kyc.required_for_activation is OFF this
  // resolves to verified=true unchanged (backwards compatible). When ON, a
  // requested verified=true is downgraded to verified=false / status=
  // APPLICATION_PENDING unless the provider passes the gate (VERIFIED, admin
  // override, per-provider grace window, or legacy cohort grace). This is the
  // single most important gate in this PR — every approval path eventually
  // flows through syncProviderRecord, so closing it here closes the whole
  // approval-without-KYC class of bypass.
  const kycRequired = await isKycRequiredForActivation()
  const kycGraceEnabled = kycRequired ? await isEnabled(KYC_GRACE_FLAG) : false
  let allowVerified = input.verified
  if (input.verified && kycRequired) {
    const snapshot = (existing as ProviderKycSnapshot | null) ?? null
    const gateResult = checkCanBeApproved(
      {
        kycStatus: snapshot?.kycStatus ?? 'NOT_STARTED',
        createdAt: snapshot?.createdAt ?? null,
        kycGraceUntil: snapshot?.kycGraceUntil ?? null,
        kycOverriddenAt: snapshot?.kycOverriddenAt ?? null,
      },
      { kycRequired, kycGraceEnabled },
    )
    if (!gateResult.ok) {
      allowVerified = false
      console.warn('[provider-record] verified=true downgraded by KYC gate', {
        phone: phone.slice(-4),
        existingId: snapshot?.id,
        kycStatus: snapshot?.kycStatus ?? 'NOT_STARTED',
        reason: gateResult.code,
      })
    }
  }
  const effectiveVerified = allowVerified
  const leadEligible = input.active && effectiveVerified

  if (existing) {
    const data: Record<string, unknown> = {
      name: input.name,
      email: input.email ?? null,
      skills,
      serviceAreas,
      active: leadEligible,
      isTestUser,
      cohortName,
      availableNow: leadEligible && input.availableNow,
      verified: effectiveVerified,
      status: effectiveVerified ? 'ACTIVE' : 'APPLICATION_PENDING',
    }

    if (input.avatarUrl) {
      data.avatarUrl = input.avatarUrl
    }

    if (input.userId) {
      data.userId = input.userId
    }

    await client.provider.updateMany({
      where: { id: existing.id },
      data,
    })

    if (!input.skipEnrichment) {
      try {
        await syncProviderSkills(client, existing.id, skills)
      } catch (err) {
        throwOnEnrichmentFailure('syncProviderSkills', err, existing.id)
      }

      try {
        await enrichServiceAreas(client, existing.id, input)
      } catch (err) {
        throwOnEnrichmentFailure('upsertStructuredServiceAreas', err, existing.id)
      }
    }

    if (effectiveVerified) {
      await ensureDefaultProviderAvailability(client, existing.id)
    }

    return existing.id
  }

  const id = crypto.randomUUID()
  await client.provider.createMany({
    data: {
      id,
      phone,
      name: input.name,
      email: input.email ?? null,
      userId: input.userId ?? null,
      skills,
      serviceAreas,
      active: leadEligible,
      isTestUser,
      cohortName,
      availableNow: leadEligible && input.availableNow,
      verified: effectiveVerified,
      status: effectiveVerified ? 'ACTIVE' : 'APPLICATION_PENDING',
      ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
    },
  })

  if (!input.skipEnrichment) {
    try {
      await syncProviderSkills(client, id, skills)
    } catch (err) {
      throwOnEnrichmentFailure('syncProviderSkills', err, id)
    }

    try {
      await enrichServiceAreas(client, id, input)
    } catch (err) {
      throwOnEnrichmentFailure('upsertStructuredServiceAreas', err, id)
    }
  }

  if (effectiveVerified) {
    await ensureDefaultProviderAvailability(client, id)
  }

  return id
}

export async function reconcileProviderRecordsFromApplications(
  client: ProviderRecordReconcileClient,
) {
  if (!client.providerApplication) {
    return { reconciled: 0 }
  }

  const applications = await client.providerApplication.findMany({
    where: {
      OR: [
        {
          status: { in: ['PENDING', 'APPROVED'] },
          providerId: null,
        },
        {
          status: 'APPROVED',
          provider: { is: { verified: false } },
        },
        {
          status: 'APPROVED',
          isTestUser: true,
          provider: { is: { isTestUser: false } },
        },
        {
          status: 'APPROVED',
          cohortName: { not: null },
          provider: { is: { cohortName: null } },
        },
      ],
    },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      status: true,
      providerId: true,
      isTestUser: true,
      cohortName: true,
    },
    orderBy: { submittedAt: 'asc' },
    take: 100,
  })

  let reconciled = 0

  for (const application of applications) {
    const providerId = await syncProviderRecord(client, {
      phone: application.phone,
      name: application.name,
      skills: application.skills,
      serviceAreas: application.serviceAreas,
      active: true,
      availableNow: true,
      verified: application.status === 'APPROVED',
      isTestUser: application.isTestUser,
      cohortName: application.cohortName,
    })

    await client.providerApplication.updateMany({
      where: { id: application.id },
      data: { providerId },
    })

    reconciled += 1
  }

  return { reconciled }
}
