import { normalizePhone } from './utils'
import { syncProviderSkills } from './provider-skills'
import { getRegionServiceStatus, getRegionKeyFromSlug } from './service-area-guard'
import { INTERNAL_TEST_COHORT_NAME, createTestCohortContext } from './internal-test-cohort'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from './location-format'

type ProviderRecordSyncClient = {
  provider: {
    findUnique: (...args: any[]) => Promise<{ id: string } | null>
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
  locationNodeIds?: string[]
  /**
   * When true, skip syncProviderSkills and upsertStructuredServiceAreas.
   * Use this when calling inside a db.$transaction — a caught DB error inside those
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
  const phone = normalizePhone(input.phone)
  const phoneCohort = createTestCohortContext(phone)
  const isTestUser = input.isTestUser ?? phoneCohort.isTestUser
  const cohortName = input.cohortName ?? (isTestUser ? phoneCohort.cohortName ?? INTERNAL_TEST_COHORT_NAME : null)
  const leadEligible = input.active && input.verified
  const serviceAreas = normaliseLocationDisplayNames(input.serviceAreas)
  const existing = await client.provider.findUnique({
    where: { phone },
    select: { id: true },
  })

  if (existing) {
    const data: Record<string, unknown> = {
      name: input.name,
      email: input.email ?? null,
      skills: input.skills,
      serviceAreas,
      active: leadEligible,
      isTestUser,
      cohortName,
      availableNow: leadEligible && input.availableNow,
      verified: input.verified,
      status: input.verified ? 'ACTIVE' : 'APPLICATION_PENDING',
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
        await syncProviderSkills(client, existing.id, input.skills)
      } catch (err) {
        console.error('[provider-record] syncProviderSkills failed for provider', existing.id, err)
      }

      if (input.locationNodeIds && input.locationNodeIds.length > 0) {
        try {
          await upsertStructuredServiceAreas(client, existing.id, input.locationNodeIds)
        } catch (err) {
          console.error('[provider-record] upsertStructuredServiceAreas failed for provider', existing.id, err)
        }
      }
    }

    if (input.verified) {
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
      skills: input.skills,
      serviceAreas,
      active: leadEligible,
      isTestUser,
      cohortName,
      availableNow: leadEligible && input.availableNow,
      verified: input.verified,
      status: input.verified ? 'ACTIVE' : 'APPLICATION_PENDING',
    },
  })

  if (!input.skipEnrichment) {
    try {
      await syncProviderSkills(client, id, input.skills)
    } catch (err) {
      console.error('[provider-record] syncProviderSkills failed for provider', id, err)
    }

    if (input.locationNodeIds && input.locationNodeIds.length > 0) {
      try {
        await upsertStructuredServiceAreas(client, id, input.locationNodeIds)
      } catch (err) {
        console.error('[provider-record] upsertStructuredServiceAreas failed for provider', id, err)
      }
    }
  }

  if (input.verified) {
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
