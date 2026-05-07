import { db } from './db'
import { normalizePhone } from './utils'
import { maskPhone } from './support-diagnostics'

export type WhatsAppIdentityRole =
  | 'customer'
  | 'provider'
  | 'provider_pending'
  | 'provider_inactive'
  | 'unknown'

export type WhatsAppSavedAddress = {
  id: string
  label: string | null
  street: string
  addressLine1: string | null
  suburb: string
  region: string | null
  city: string
  province: string
  postalCode: string | null
  locationNodeId: string | null
  isDefault: boolean
}

export type WhatsAppIdentity = {
  normalizedPhone: string
  phoneVariants: string[]
  role: WhatsAppIdentityRole
  customerId?: string
  providerId?: string
  applicationId?: string
  customerProfile?: {
    id: string
    name: string | null
    phone: string
  }
  providerProfile?: {
    id: string
    name: string | null
    status: string
  }
  displayName?: string
  firstName?: string
  customerDisplayName?: string
  customerFirstName?: string
  providerDisplayName?: string
  providerFirstName?: string
  savedAddresses: WhatsAppSavedAddress[]
  providerStatus?: string
  applicationStatus?: string
  activeJobCount: number
  isPaused: boolean
  conflict: boolean
  traceId: string
}

export function phoneLookupVariants(phone: string) {
  const normalized = normalizePhone(phone)
  const digits = normalized.replace(/\D/g, '')
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : null
  return Array.from(
    new Set([normalized, digits ? `+${digits}` : null, digits || null, local].filter(Boolean) as string[]),
  )
}

function displayFirstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || undefined
}

const ACTIVE_PROVIDER_JOB_STATUSES = [
  'SCHEDULED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PAUSED',
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
] as const

export async function resolveWhatsAppIdentity(phone: string): Promise<WhatsAppIdentity> {
  const normalizedPhone = normalizePhone(phone)
  const phoneVariants = phoneLookupVariants(phone)
  const traceId = crypto.randomUUID().slice(0, 8)

  const [customer, providerRows] = await Promise.all([
    // TODO(prisma-gen): remove `as any` once the generated Prisma client exposes Customer/Provider/Job models
    (db as any).customer?.findFirst?.({
      where: { phone: { in: phoneVariants } },
      select: {
        id: true,
        phone: true,
        name: true,
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: {
            id: true,
            label: true,
            street: true,
            addressLine1: true,
            suburb: true,
            region: true,
            city: true,
            province: true,
            postalCode: true,
            locationNodeId: true,
            isDefault: true,
          },
        },
      },
    }) ?? null,
    // Duplicate-record trap fix (Phase 4 follow-up — Task 4):
    // We previously called findFirst with no orderBy, so if a phone had
    // multiple Provider rows (rare but possible after migrations or test
    // data), Prisma returned an arbitrary first match — sometimes a stale
    // APPLICATION_PENDING row instead of the active one. Pull all matches,
    // order by recency, and post-filter so an ACTIVE+verified row always
    // wins over a pending/suspended one.
    // TODO(prisma-gen): remove `as any` once the generated Prisma client exposes Customer/Provider/Job models
    (db as any).provider?.findMany?.({
      where: { phone: { in: phoneVariants } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        phone: true,
        name: true,
        status: true,
        active: true,
        verified: true,
        availableNow: true,
        suspendedUntil: true,
        suspendedReason: true,
        technicianAvailability: {
          select: {
            availabilityMode: true,
            availabilityState: true,
            breakUntil: true,
            emergencyAvailable: true,
          },
        },
      },
    }) ?? [],
  ])

  // ── Provider candidate selection (active+verified+ACTIVE wins) ────────────
  // After the duplicate-trap fix above, `providerRows` is an Array<Row> sorted
  // by updatedAt desc. Pick the first ACTIVE+verified+active row so a stale
  // APPLICATION_PENDING / SUSPENDED row never wins over a usable one.
  // Falls back to the most recent row of any status if none is ACTIVE — that
  // way the role detection (provider_pending / provider_inactive) still works
  // for callers in those states.
  const providerCandidates: Array<{
    id: string
    phone: string
    name: string | null
    status: string
    active: boolean
    verified: boolean
    availableNow: boolean
    suspendedUntil: Date | null
    suspendedReason: string | null
    technicianAvailability: {
      availabilityMode: string | null
      availabilityState: string | null
      breakUntil: Date | null
      emergencyAvailable: boolean | null
    } | null
  }> = Array.isArray(providerRows) ? providerRows : []
  const provider =
    providerCandidates.find(
      (row) => row.active && row.verified && row.status === 'ACTIVE',
    ) ?? providerCandidates[0] ?? null

  const application = provider
    ? null
    // TODO(prisma-gen): remove `as any` once the generated Prisma client exposes Customer/Provider/Job models
    : await (db as any).providerApplication?.findFirst?.({
        where: {
          phone: { in: phoneVariants },
          // Include MORE_INFO_REQUIRED so onboarding follow-up messages can be
          // routed as pending work while admin review resumes.
          status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] },
        },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          phone: true,
          name: true,
          status: true,
          providerId: true,
          submittedAt: true,
        },
      }) ?? null

  const conflict = Boolean(customer && (provider || application))
  const isInactiveProvider = Boolean(provider) && (
    !provider.active ||
    ['SUSPENDED', 'ARCHIVED', 'BANNED'].includes(provider.status) ||
    (provider.suspendedUntil != null && provider.suspendedUntil > new Date())
  )
  const isPendingProvider = Boolean(provider) && ['APPLICATION_PENDING', 'UNDER_REVIEW'].includes(provider.status)
  const isActiveProvider = Boolean(provider) && !isInactiveProvider && !isPendingProvider && provider.status === 'ACTIVE'

  let activeJobCount = 0
  // TODO(prisma-gen): remove `as any` once the generated Prisma client exposes Customer/Provider/Job models
  if (isActiveProvider && typeof (db as any).job?.count === 'function') {
    activeJobCount = await (db as any).job.count({
      where: {
        providerId: provider.id,
        status: { in: [...ACTIVE_PROVIDER_JOB_STATUSES] },
      },
    }).catch(() => 0)
  }

  const providerRole: WhatsAppIdentityRole =
    isInactiveProvider ? 'provider_inactive' :
    isPendingProvider ? 'provider_pending' :
    isActiveProvider || application?.status === 'APPROVED' ? 'provider' :
    application?.status === 'PENDING' || application?.status === 'MORE_INFO_REQUIRED'
      ? 'provider_pending' :
    'unknown'

  const role: WhatsAppIdentityRole =
    providerRole !== 'unknown' ? providerRole :
    customer ? 'customer' :
    'unknown'

  const name = provider?.name ?? application?.name ?? customer?.name ?? undefined
  const isPaused =
    Boolean(provider) &&
    (!provider.availableNow ||
      provider.technicianAvailability?.availabilityMode === 'PAUSED' ||
      provider.technicianAvailability?.availabilityState === 'PAUSED' ||
      provider.technicianAvailability?.availabilityState === 'OFFLINE')

  console.info('[whatsapp-identity] resolved sender', {
    traceId,
    rawPhone: maskPhone(phone),
    normalizedPhone: maskPhone(normalizedPhone),
    resolvedRole: role,
    customerFound: Boolean(customer),
    providerFound: Boolean(provider),
    customerId: customer?.id ?? null,
    providerId: provider?.id ?? null,
    applicationId: application?.id ?? null,
    providerStatus: provider?.status ?? null,
    applicationStatus: application?.status ?? null,
    savedAddressCount: customer?.addresses?.length ?? 0,
    blockedRoleConflict: conflict,
  })

  return {
    normalizedPhone,
    phoneVariants,
    role,
    customerId: customer?.id,
    providerId: provider?.id,
    applicationId: application?.id,
    customerProfile: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : undefined,
    providerProfile: provider ? { id: provider.id, name: provider.name, status: provider.status } : undefined,
    displayName: name,
    firstName: displayFirstName(name),
    customerDisplayName: customer?.name ?? undefined,
    customerFirstName: displayFirstName(customer?.name),
    providerDisplayName: provider?.name ?? application?.name ?? undefined,
    providerFirstName: displayFirstName(provider?.name ?? application?.name),
    savedAddresses: customer?.addresses ?? [],
    providerStatus: provider?.status,
    applicationStatus: application?.status,
    activeJobCount,
    isPaused,
    conflict,
    traceId,
  }
}

export async function resolveWhatsAppUserContext(phone: string): Promise<WhatsAppIdentity> {
  // Reusable WhatsApp context resolver for all journeys. It deliberately
  // returns customer and provider candidates independently so a multi-role
  // number can be handled with role-aware options instead of losing the known
  // customer name/address when the provider role wins primary routing.
  // All external call sites should use this rather than resolveWhatsAppIdentity directly.
  return resolveWhatsAppIdentity(phone)
}

export async function assertPhoneCanCreateCustomer(phone: string): Promise<void> {
  const identity = await resolveWhatsAppIdentity(phone)
  if (identity.role === 'provider' || identity.role === 'provider_pending' || identity.role === 'provider_inactive') {
    throw new Error('PHONE_ROLE_CONFLICT_PROVIDER')
  }
}

export async function assertPhoneCanCreateProvider(phone: string): Promise<void> {
  const identity = await resolveWhatsAppIdentity(phone)
  if (identity.role === 'customer') {
    throw new Error('PHONE_ROLE_CONFLICT_CUSTOMER')
  }
}
