import { normalizePhone } from './utils'

export const ACTIVE_PROVIDER_APPLICATION_STATUSES = ['PENDING', 'APPROVED'] as const

export type ActiveProviderApplicationStatus =
  (typeof ACTIVE_PROVIDER_APPLICATION_STATUSES)[number]

export type ActiveProviderApplicationSummary = {
  id: string
  phone: string
  status: string
  name?: string | null
  providerId?: string | null
  submittedAt?: Date
}

type ProviderApplicationLookupClient = {
  providerApplication: {
    findFirst: (...args: any[]) => Promise<ActiveProviderApplicationSummary | null>
    findMany?: (...args: any[]) => Promise<ActiveProviderApplicationSummary[]>
  }
}

export function normalizeProviderApplicationPhone(phone: string) {
  return normalizePhone(phone)
}

export async function findLatestActiveProviderApplicationByPhone(
  client: ProviderApplicationLookupClient,
  phone: string,
  options?: { excludeId?: string },
) {
  return client.providerApplication.findFirst({
    where: {
      phone: normalizeProviderApplicationPhone(phone),
      status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      ...(options?.excludeId ? { id: { not: options.excludeId } } : {}),
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      phone: true,
      status: true,
      name: true,
      providerId: true,
      submittedAt: true,
    },
  })
}

export async function findConflictingActiveProviderApplications(
  client: ProviderApplicationLookupClient,
  phone: string,
  options?: { excludeId?: string },
) {
  if (!client.providerApplication.findMany) return []

  return client.providerApplication.findMany({
    where: {
      phone: normalizeProviderApplicationPhone(phone),
      status: { in: [...ACTIVE_PROVIDER_APPLICATION_STATUSES] },
      ...(options?.excludeId ? { id: { not: options.excludeId } } : {}),
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      phone: true,
      status: true,
      name: true,
      providerId: true,
      submittedAt: true,
    },
  })
}

type ApplicationLike = {
  id: string
  phone: string
  status: string
}

export function getConflictingActiveProviderApplicationIds(
  applications: ApplicationLike[],
) {
  const grouped = new Map<string, string[]>()

  for (const application of applications) {
    if (!ACTIVE_PROVIDER_APPLICATION_STATUSES.includes(application.status as ActiveProviderApplicationStatus)) {
      continue
    }

    const phone = normalizeProviderApplicationPhone(application.phone)
    const ids = grouped.get(phone) ?? []
    ids.push(application.id)
    grouped.set(phone, ids)
  }

  const conflictingIds = new Set<string>()
  for (const ids of grouped.values()) {
    if (ids.length < 2) continue
    for (const id of ids) conflictingIds.add(id)
  }

  return conflictingIds
}
