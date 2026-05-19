import type { User } from '@supabase/supabase-js'
import { normalizeOtpPhoneNumber } from './phone-normalization'
import { normalizePhone } from './utils'
import { phoneLookupVariants } from './whatsapp-identity'
import { db } from './db'
import { maskPhone, safeErrorMessage, timestamp, type DiagnosticCode } from './support-diagnostics'

type WorkerProviderStatus = {
  id: string
  userId: string | null
  phone: string
  active: boolean
  verified: boolean
  status: string
  name?: string | null
}

type WorkerApplicationStatus = {
  id: string
  status: string
  providerId: string | null
}

type WorkerProviderAuthClient = {
  provider: {
    findMany: (...args: any[]) => Promise<WorkerProviderStatus[]>
    update?: (...args: any[]) => Promise<WorkerProviderStatus>
  }
  providerApplication?: {
    findFirst: (...args: any[]) => Promise<WorkerApplicationStatus | null>
  }
}

export type WorkerPortalAccessCode =
  | 'OK'
  | 'WORKER_NOT_FOUND'
  | 'WORKER_NOT_APPROVED'
  | 'WORKER_INACTIVE'
  | 'DUPLICATE_WORKER_PROFILE'
  | 'WORKER_PROFILE_LINK_MISSING'

type WorkerPortalFailureCode = Exclude<WorkerPortalAccessCode, 'OK'>

export type WorkerPortalAccessDecision = {
  ok: boolean
  code: WorkerPortalAccessCode
}

export type WorkerResolutionResult =
  | {
      ok: true
      provider: WorkerProviderStatus
      application: WorkerApplicationStatus | null
      normalizedPhone: string
      linkedProviderNow: boolean
    }
  | {
      ok: false
      code: DiagnosticCode
      provider: WorkerProviderStatus | null
      application: WorkerApplicationStatus | null
      normalizedPhone: string | null
      linkedProviderNow: false
    }

export function normaliseWorkerOtpPhone(rawPhone: string, countryCode = 'ZA') {
  return normalizeOtpPhoneNumber(rawPhone, countryCode)
}

type OtpProviderRow = {
  id: string
  userId: string | null
  phone: string
  active: boolean
  verified: boolean
  status: string
}

type FindProviderForOtpLoginClient = {
  provider: {
    findUnique: (...args: any[]) => Promise<OtpProviderRow | null>
    findFirst?: (...args: any[]) => Promise<OtpProviderRow | null>
    update?: (...args: any[]) => Promise<unknown>
  }
  providerApplication?: {
    findFirst: (...args: any[]) => Promise<{ id: string; status: string; providerId: string | null } | null>
  }
}

export type FindProviderForOtpLoginResult =
  | { found: true; provider: OtpProviderRow }
  | { found: false; pendingApplicationId?: string; pendingApplicationStatus?: string }

/**
 * Resilient provider lookup for OTP login that handles legacy phone formats.
 *
 * Tries an exact E.164 match first. If not found, falls back to all format
 * variants (27xxxxxxxxx, 0xxxxxxxxx, +27xxxxxxxxx). On a variant hit the
 * stored phone is repaired to E.164 in-place so subsequent lookups are fast.
 *
 * When no provider is found, checks for a pending ProviderApplication so
 * callers can return WORKER_NOT_APPROVED instead of WORKER_NOT_FOUND.
 */
export async function findProviderForOtpLogin(
  e164Phone: string,
  rawPhone: string,
  client: FindProviderForOtpLoginClient = db as unknown as FindProviderForOtpLoginClient,
): Promise<FindProviderForOtpLoginResult> {
  const select = {
    id: true as const,
    userId: true as const,
    phone: true as const,
    active: true as const,
    verified: true as const,
    status: true as const,
  }

  // Fast path — exact E.164 match
  const exact = await client.provider.findUnique({ where: { phone: e164Phone }, select })
  if (exact) return { found: true, provider: exact }

  // Fallback — try all format variants to handle legacy non-E.164 storage
  if (client.provider.findFirst) {
    const variants = phoneLookupVariants(rawPhone)
    const byVariant = await client.provider.findFirst({
      where: { phone: { in: variants } },
      select,
    })

    if (byVariant) {
      // Auto-repair: normalize stored phone to E.164 for future fast-path hits
      if (byVariant.phone !== e164Phone && client.provider.update) {
        try {
          await client.provider.update({ where: { id: byVariant.id }, data: { phone: e164Phone } })
          console.info('[worker-provider-auth] repaired non-E164 phone on OTP login', {
            providerId: byVariant.id,
            oldPhoneMasked: maskPhone(byVariant.phone),
            newPhoneMasked: maskPhone(e164Phone),
            timestamp: timestamp(),
          })
          byVariant.phone = e164Phone
        } catch (repairErr) {
          // Non-fatal: unique conflict (another record already has E.164) or DB error
          console.warn('[worker-provider-auth] phone repair skipped', {
            providerId: byVariant.id,
            safeErrorMessage: safeErrorMessage(repairErr),
            timestamp: timestamp(),
          })
        }
      }
      return { found: true, provider: byVariant }
    }
  }

  // No Provider row found — check for a pending application so callers can
  // return WORKER_NOT_APPROVED instead of the less helpful WORKER_NOT_FOUND
  if (client.providerApplication) {
    const variants = phoneLookupVariants(rawPhone)
    const pendingApp = await client.providerApplication.findFirst({
      where: {
        phone: { in: variants },
        status: { in: ['PENDING', 'MORE_INFO_REQUIRED'] },
      },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, status: true, providerId: true },
    })
    if (pendingApp) {
      return {
        found: false,
        pendingApplicationId: pendingApp.id,
        pendingApplicationStatus: pendingApp.status,
      }
    }
  }

  return { found: false }
}

export function checkWorkerPortalAccess(
  provider: WorkerProviderStatus | null,
  application?: WorkerApplicationStatus | null,
): WorkerPortalAccessDecision {
  if (!provider) {
    if (application?.status === 'PENDING' || application?.status === 'MORE_INFO_REQUIRED') {
      return { ok: false, code: 'WORKER_NOT_APPROVED' }
    }
    return { ok: false, code: 'WORKER_NOT_FOUND' }
  }

  if (provider.status === 'APPLICATION_PENDING' || provider.status === 'UNDER_REVIEW') {
    return { ok: false, code: 'WORKER_NOT_APPROVED' }
  }

  if (!provider.active || !provider.verified || provider.status !== 'ACTIVE') {
    return { ok: false, code: 'WORKER_INACTIVE' }
  }

  return { ok: true, code: 'OK' }
}

export function workerVerifyMessageForCode(code: DiagnosticCode | WorkerPortalAccessCode) {
  switch (code) {
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
    case 'OTP_PROVIDER_REJECTED':
      return 'That code is incorrect or expired. Please try again.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes and try again.'
    case 'OTP_PROVIDER_UNAVAILABLE':
      return "We couldn't verify the code right now. Please try again shortly."
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved."
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'This provider account is not active. Please contact support.'
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return "We couldn't find a provider account for this number. Please apply first or contact support."
    case 'WORKER_PROFILE_LINK_MISSING':
    case 'WORKER_AUTH_IDENTITY_MISSING':
    case 'WORKER_ROLE_MISSING':
    case 'AUTH_SESSION_MISSING':
      return 'Your provider login could not be linked automatically. Please contact support.'
    case 'DUPLICATE_WORKER_PROFILE':
      return 'We found more than one provider account for this login. Please contact support.'
    default:
      return 'Something went wrong. Please try again or contact support.'
  }
}

export function statusForWorkerVerifyCode(code: DiagnosticCode | WorkerPortalAccessCode) {
  switch (code) {
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
    case 'OTP_PROVIDER_REJECTED':
      return 401
    case 'RATE_LIMITED':
      return 429
    case 'OTP_PROVIDER_UNAVAILABLE':
      return 503
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 404
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
    case 'WORKER_PROFILE_LINK_MISSING':
    case 'WORKER_ROLE_MISSING':
      return 403
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 423
    case 'DUPLICATE_WORKER_PROFILE':
      return 409
    case 'AUTH_SESSION_MISSING':
    case 'WORKER_AUTH_IDENTITY_MISSING':
      return 401
    default:
      return 500
  }
}

export function classifyWorkerOtpVerifyError(error: unknown): DiagnosticCode {
  const lower = safeErrorMessage(error).toLowerCase()
  if (lower.includes('expired')) return 'OTP_EXPIRED'
  if (
    lower.includes('invalid') ||
    lower.includes('incorrect') ||
    lower.includes('token') ||
    lower.includes('otp')
  ) {
    return 'INVALID_OTP'
  }
  return 'OTP_PROVIDER_REJECTED'
}

export function getUserPhoneE164(user: Pick<User, 'phone'>): string | null {
  if (!user.phone) return null
  const normalized = normaliseWorkerOtpPhone(user.phone)
  return normalized.ok ? normalized.e164 : null
}

export async function resolveCurrentWorkerFromVerifiedOtpSession(params: {
  client: WorkerProviderAuthClient
  user: Pick<User, 'id' | 'phone'>
  submittedPhone: string
  traceId: string
  countryCode?: string
}): Promise<WorkerResolutionResult> {
  const normalized = normaliseWorkerOtpPhone(params.submittedPhone, params.countryCode)
  const authPhone = getUserPhoneE164(params.user)
  const phone = normalized.ok ? normalized.e164 : authPhone

  if (!phone) {
    return {
      ok: false,
      code: 'WORKER_AUTH_IDENTITY_MISSING',
      provider: null,
      application: null,
      normalizedPhone: null,
      linkedProviderNow: false,
    }
  }

  const application = params.client.providerApplication
    ? await params.client.providerApplication.findFirst({
        // Keep MORE_INFO_REQUIRED applications in this session path so the user
        // stays in the onboarding hold state instead of falling through to
        // WORKER_NOT_FOUND.
        where: { phone, status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] } },
        orderBy: { submittedAt: 'desc' },
        select: { id: true, status: true, providerId: true },
      })
    : null

  const candidates = await params.client.provider.findMany({
    where: {
      OR: [
        { phone },
        { userId: params.user.id },
      ],
    },
    orderBy: [
      { status: 'asc' },
      { updatedAt: 'desc' },
    ],
    select: {
      id: true,
      userId: true,
      phone: true,
      active: true,
      verified: true,
      status: true,
      name: true,
    },
  })

  const exactPhone = candidates.filter((provider) => provider.phone === phone)
  const linkedToAuthUser = candidates.filter((provider) => provider.userId === params.user.id)
  const activeExactPhone = exactPhone.filter((provider) => checkWorkerPortalAccess(provider).ok)

  let provider = activeExactPhone[0] ?? linkedToAuthUser[0] ?? exactPhone[0] ?? null
  const conflictingLinkedProvider = linkedToAuthUser.find((candidate) => candidate.phone !== phone)

  if (conflictingLinkedProvider && provider && conflictingLinkedProvider.id !== provider.id) {
    return {
      ok: false,
      code: 'DUPLICATE_WORKER_PROFILE',
      provider,
      application,
      normalizedPhone: phone,
      linkedProviderNow: false,
    }
  }

  if (!provider) {
    const access = checkWorkerPortalAccess(null, application)
    return {
      ok: false,
      code: access.code as WorkerPortalFailureCode,
      provider: null,
      application,
      normalizedPhone: phone,
      linkedProviderNow: false,
    }
  }

  const access = checkWorkerPortalAccess(provider, application)
  if (!access.ok) {
    return {
      ok: false,
      code: access.code as WorkerPortalFailureCode,
      provider,
      application,
      normalizedPhone: phone,
      linkedProviderNow: false,
    }
  }

  let linkedProviderNow = false
  if (!provider.userId && params.client.provider.update) {
    provider = await params.client.provider.update({
      where: { id: provider.id },
      data: { userId: params.user.id },
      select: {
        id: true,
        userId: true,
        phone: true,
        active: true,
        verified: true,
        status: true,
        name: true,
      },
    })
    linkedProviderNow = true
  }

  if (provider.userId !== params.user.id) {
    return {
      ok: false,
      code: 'WORKER_PROFILE_LINK_MISSING',
      provider,
      application,
      normalizedPhone: phone,
      linkedProviderNow: false,
    }
  }

  return { ok: true, provider, application, normalizedPhone: phone, linkedProviderNow }
}

export function logWorkerPortalDecision(params: {
  event: 'verify' | 'middleware' | 'session'
  traceId: string
  normalizedPhone?: string | null
  authUserId?: string | null
  provider?: WorkerProviderStatus | null
  application?: WorkerApplicationStatus | null
  roleCheckResult?: string
  code: string
}) {
  console.info('[worker-provider-auth] decision', {
    event: params.event,
    trace_id: params.traceId,
    normalizedPhoneMasked: maskPhone(params.normalizedPhone),
    authUserId: params.authUserId ?? null,
    providerId: params.provider?.id ?? null,
    applicationId: params.application?.id ?? null,
    providerStatus: params.provider?.status ?? null,
    providerActive: params.provider?.active ?? null,
    providerVerified: params.provider?.verified ?? null,
    applicationStatus: params.application?.status ?? null,
    roleCheckResult: params.roleCheckResult,
    finalDecision: params.code,
    timestamp: timestamp(),
  })
}
