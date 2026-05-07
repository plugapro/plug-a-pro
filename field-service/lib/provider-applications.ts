import { normalizePhone } from './utils'

export const ACTIVE_PROVIDER_APPLICATION_STATUSES = ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] as const

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

// TODO: replace any-typed method args with Prisma.TransactionClient once
// ProviderCategory model is fully stable and the type can be imported here.
type ProviderCategoryApprovalClient = {
  providerApplication: {
    findUnique: (...args: any[]) => Promise<{
      id: string
      status: string
      providerId: string | null
    } | null>
  }
  providerCategory: {
    findUnique: (...args: any[]) => Promise<{ id: string } | null>
    create: (...args: any[]) => Promise<unknown>
    updateMany: (...args: any[]) => Promise<{ count: number }>
  }
  auditLog?: {
    create: (...args: any[]) => Promise<unknown>
  }
}

export type ProviderCategoryApprovalStatus = 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW'

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

/**
 * Update or create a ProviderCategory approval row for a reviewed application.
 *
 * The flow requires an application-linked provider record for category
 * administration. Pending applications do not yet have a provider row and must
 * therefore pass through normal approval/reject paths first.
 */
export async function updateProviderApplicationCategoryApproval(
  client: ProviderCategoryApprovalClient,
  params: {
    applicationId: string
    categorySlug: string
    approvalStatus: ProviderCategoryApprovalStatus
    actorId?: string
  },
): Promise<
  | { ok: true; applicationId: string; providerId: string; categorySlug: string; approvalStatus: ProviderCategoryApprovalStatus }
  | { ok: false; reason: 'NOT_FOUND' | 'NO_PROVIDER' | 'INVALID_APPLICATION_STATE' }
> {
  const app = await client.providerApplication.findUnique({
    where: { id: params.applicationId },
    select: { id: true, status: true, providerId: true },
  })

  if (!app) {
    return { ok: false, reason: 'NOT_FOUND' }
  }
  if (!app.providerId) {
    return { ok: false, reason: 'NO_PROVIDER' }
  }
  if (app.status !== 'APPROVED' && app.status !== 'MORE_INFO_REQUIRED') {
    // Category controls are available for approved providers and after they are
    // created. A pending application has no provider row yet in this model.
    return { ok: false, reason: 'INVALID_APPLICATION_STATE' }
  }

  const normalizedCategorySlug = params.categorySlug.trim().toLowerCase()

  const existing = await client.providerCategory.findUnique({
    where: {
      providerId_categorySlug: {
        providerId: app.providerId,
        categorySlug: normalizedCategorySlug,
      },
    },
  })

  if (existing) {
    await client.providerCategory.updateMany({
      where: {
        providerId: app.providerId,
        categorySlug: normalizedCategorySlug,
      },
      data: {
        approvalStatus: params.approvalStatus,
      },
    })
  } else {
    await client.providerCategory.create({
      data: {
        providerId: app.providerId,
        categorySlug: normalizedCategorySlug,
        approvalStatus: params.approvalStatus,
      },
    })
  }

  await client.auditLog?.create?.({
    data: {
      actorId: params.actorId ?? 'admin',
      actorRole: 'admin',
      action: 'provider_category.approval_updated',
      entityType: 'ProviderCategory',
      entityId: `${app.providerId}:${normalizedCategorySlug}`,
      after: {
        applicationId: app.id,
        providerId: app.providerId,
        categorySlug: normalizedCategorySlug,
        approvalStatus: params.approvalStatus,
      } as Record<string, unknown>,
    },
  }).catch(() => undefined)

  return {
    ok: true,
    applicationId: app.id,
    providerId: app.providerId,
    categorySlug: normalizedCategorySlug,
    approvalStatus: params.approvalStatus,
  }
}

type ApplicationLike = {
  id: string
  phone: string
  status: string
}

export type MoreInfoResumeClient = {
  providerApplication: {
    findUnique: (...args: any[]) => Promise<{
      id: string
      status: string
      notes: string | null
    } | null>
    update: (...args: any[]) => Promise<unknown>
  }
  auditLog?: {
    create: (...args: any[]) => Promise<unknown>
  }
}

/**
 * Returns a MORE_INFO_REQUIRED application to PENDING after the provider has
 * supplied the requested information via WhatsApp or the provider portal.
 * Appends the provider's reply to the existing notes so admins can see both
 * the request and the response in one place.
 *
 * Throws when:
 *   - the application does not exist
 *   - the application is not in MORE_INFO_REQUIRED state
 */
export async function resumeMoreInfoApplication(
  client: MoreInfoResumeClient,
  params: { applicationId: string; providerNote: string; actorId?: string },
): Promise<{ ok: true; status: 'PENDING' } | { ok: false; reason: 'NOT_FOUND' | 'INVALID_STATUS' }> {
  const application = await client.providerApplication.findUnique({
    where: { id: params.applicationId },
    select: { id: true, status: true, notes: true },
  })
  if (!application) return { ok: false, reason: 'NOT_FOUND' }
  if (application.status !== 'MORE_INFO_REQUIRED') {
    return { ok: false, reason: 'INVALID_STATUS' }
  }

  const trimmed = params.providerNote.trim()
  const stamp = new Date().toISOString()
  const updatedNotes = [
    application.notes,
    `--- Provider reply (${stamp}) ---\n${trimmed}`,
  ].filter(Boolean).join('\n\n')

  await client.providerApplication.update({
    where: { id: params.applicationId },
    data: { status: 'PENDING', notes: updatedNotes },
  })

  await client.auditLog?.create({
    data: {
      actorId: params.actorId ?? 'provider-self-service',
      actorRole: 'provider',
      action: 'application.more_info_resumed',
      entityType: 'ProviderApplication',
      entityId: params.applicationId,
      after: { providerNote: trimmed },
    },
  }).catch(() => undefined)

  return { ok: true, status: 'PENDING' }
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
