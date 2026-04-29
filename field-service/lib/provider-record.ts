import { normalizePhone } from './utils'
import { syncProviderSkills } from './provider-skills'
import { getRegionServiceStatus, getRegionKeyFromSlug } from './service-area-guard'
import { createTestCohortContext } from './internal-test-cohort'

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
  $executeRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>
}

type ProviderApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

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
    }>>
    updateMany: (...args: any[]) => Promise<unknown>
  }
}

type SyncProviderRecordInput = {
  phone: string
  name: string
  userId?: string | null
  skills: string[]
  serviceAreas: string[]
  active: boolean
  availableNow: boolean
  verified: boolean
  locationNodeIds?: string[]   // ADD: SUBURB node IDs for structured service areas
}

async function upsertStructuredServiceAreas(
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
        label: node.label,
        provinceKey: node.provinceKey,
        cityKey: node.cityKey,
        regionKey,
        suburbKey,
        active: isActivePilotArea,
      },
      update: {
        areaType,
        label: node.label,
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
      emergencyAvailable: false,
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
      emergencyAvailable: false,
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
  const cohort = createTestCohortContext(phone)
  const leadEligible = input.active && input.verified
  const existing = await client.provider.findUnique({
    where: { phone },
    select: { id: true },
  })

  if (existing) {
    const data: Record<string, unknown> = {
      name: input.name,
      skills: input.skills,
      serviceAreas: input.serviceAreas,
      active: leadEligible,
      isTestUser: cohort.isTestUser,
      cohortName: cohort.cohortName,
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

    if (input.verified) {
      await ensureDefaultProviderAvailability(client, existing.id)
    }

    return existing.id
  }

  const id = crypto.randomUUID()
  if (client.$executeRawUnsafe) {
    const now = new Date()
    await client.$executeRawUnsafe(
      `
        insert into providers
          ("id", "phone", "name", "email", "bio", "skills", "serviceAreas", "active", "verified", "availableNow", "isTestUser", "cohortName", "status", "avatarUrl", "createdAt", "updatedAt", "userId")
        values
          ($1, $2, $3, null, null, $4, $5, $6, $7, $8, $9, $10, $11, null, $12, $13, $14)
      `,
      id,
      phone,
      input.name,
      input.skills,
      input.serviceAreas,
      leadEligible,
      input.verified,
      leadEligible && input.availableNow,
      cohort.isTestUser,
      cohort.cohortName,
      input.verified ? 'ACTIVE' : 'APPLICATION_PENDING',
      now,
      now,
      input.userId ?? null,
    )
  } else {
    await client.provider.createMany({
      data: {
        id,
        phone,
        name: input.name,
        userId: input.userId ?? null,
        skills: input.skills,
        serviceAreas: input.serviceAreas,
        active: leadEligible,
        isTestUser: cohort.isTestUser,
        cohortName: cohort.cohortName,
        availableNow: leadEligible && input.availableNow,
        verified: input.verified,
        status: input.verified ? 'ACTIVE' : 'APPLICATION_PENDING',
      },
    })
  }

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
    })

    await client.providerApplication.updateMany({
      where: { id: application.id },
      data: { providerId },
    })

    reconciled += 1
  }

  return { reconciled }
}
