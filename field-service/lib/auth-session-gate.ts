import { recordAuditLog } from './audit'
import { buildSessionCookieHeader } from './auth-session-cookie'
import { db } from './db'
import {
  buildPendingStepUpCookieHeader,
  encryptPendingStepUpCookie,
  STEP_UP_COOKIE_MAX_AGE_SECONDS,
} from './otp-security-crypto'
import { maskPhone } from './support-diagnostics'

const ACTIVE_CHALLENGE_STATUSES = ['REQUESTED', 'SENT'] as const
const SECURITY_STATE_LOOKUP_TIMEOUT_MS = 1500

export type AuthSessionGateSourceRoute =
  | '/api/auth/session'
  | '/api/auth/provider/verify-code'

export type IssueAuthSessionResult =
  | { ok: true; setCookie: string }
  | { ok: false; reason: 'LOCKED'; metadata?: { code: 'security_gate_unavailable' } }
  | { ok: false; reason: 'STEP_UP_REQUIRED'; pendingStepUpCookie: string }

type AccountSecurityStateRow = {
  lockedUntil: Date | null
  stepUpRequired: boolean
}

type OtpChallengeRow = {
  id: string
}

type AuthSessionGateClient = {
  accountSecurityState: {
    findUnique(args: {
      where: { phoneE164: string }
    }): Promise<AccountSecurityStateRow | null>
  }
  otpChallenge: {
    findFirst(args: {
      where: Record<string, unknown>
      orderBy: { createdAt: 'desc' }
    }): Promise<OtpChallengeRow | null>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
}

function gateDb(): AuthSessionGateClient {
  return db as unknown as AuthSessionGateClient
}

function maskedPhoneEntity(phoneE164: string): string {
  return maskPhone(phoneE164) ?? 'masked-phone'
}

function actorUserId(userId: string | null): string {
  return userId?.trim() || 'system'
}

async function withSecurityStateTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('security_state_lookup_timeout')),
          SECURITY_STATE_LOOKUP_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function auditGateEvent(params: {
  action: string
  phoneE164: string
  userId: string | null
  sourceRoute: AuthSessionGateSourceRoute
  after: Record<string, unknown>
}): Promise<void> {
  try {
    await recordAuditLog({
      actorId: actorUserId(params.userId),
      actorRole: params.userId ? 'user' : 'system',
      action: params.action,
      entityType: 'AccountSecurityState',
      entityId: maskedPhoneEntity(params.phoneE164),
      after: {
        source: 'session_gate',
        sourceRoute: params.sourceRoute,
        userIdPresent: Boolean(params.userId),
        ...params.after,
      },
    })
  } catch {
    console.warn('[auth-session-gate] audit write failed', { action: params.action })
  }
}

async function failClosedUnavailable(params: {
  phoneE164: string
  userId: string | null
  sourceRoute: AuthSessionGateSourceRoute
}): Promise<IssueAuthSessionResult> {
  await auditGateEvent({
    action: 'security.session_gate.unavailable',
    phoneE164: params.phoneE164,
    userId: params.userId,
    sourceRoute: params.sourceRoute,
    after: { code: 'security_gate_unavailable' },
  })

  return {
    ok: false,
    reason: 'LOCKED',
    metadata: { code: 'security_gate_unavailable' },
  }
}

async function markLatestActiveChallengeVerified(params: {
  phoneE164: string
  userId: string | null
  sourceRoute: AuthSessionGateSourceRoute
  now: Date
}): Promise<'verified' | 'not_found'> {
  const where = {
    phoneE164: params.phoneE164,
    ...(params.userId ? { userId: params.userId } : {}),
    status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
    expiresAt: { gt: params.now },
  }

  const challenge = await gateDb().otpChallenge.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  })

  if (!challenge) {
    await auditGateEvent({
      action: 'security.session_gate.challenge_not_found',
      phoneE164: params.phoneE164,
      userId: params.userId,
      sourceRoute: params.sourceRoute,
      after: { challengeVerification: 'not_found' },
    })
    return 'not_found'
  }

  const updated = await gateDb().otpChallenge.updateMany({
    where: {
      id: challenge.id,
      status: { in: [...ACTIVE_CHALLENGE_STATUSES] },
      expiresAt: { gt: params.now },
    },
    data: {
      status: 'VERIFIED',
      verifiedAt: params.now,
    },
  })

  const challengeVerification = updated.count === 1 ? 'verified' : 'not_found'
  await auditGateEvent({
    action:
      challengeVerification === 'verified'
        ? 'security.session_gate.challenge_verified'
        : 'security.session_gate.challenge_not_found',
    phoneE164: params.phoneE164,
    userId: params.userId,
    sourceRoute: params.sourceRoute,
    after: { challengeVerification },
  })

  return challengeVerification
}

export async function issueAuthSessionWithSecurityGate(params: {
  accessToken: string
  phoneE164: string
  userId: string | null
  maxAge: number
  sourceRoute: AuthSessionGateSourceRoute
}): Promise<IssueAuthSessionResult> {
  const now = new Date()

  let state: AccountSecurityStateRow | null
  try {
    state = await withSecurityStateTimeout(
      gateDb().accountSecurityState.findUnique({
        where: { phoneE164: params.phoneE164 },
      }),
    )
  } catch {
    return failClosedUnavailable(params)
  }

  if (state?.lockedUntil && state.lockedUntil > now) {
    return { ok: false, reason: 'LOCKED' }
  }

  if (state?.stepUpRequired) {
    const expiresAt = new Date(
      now.getTime() + STEP_UP_COOKIE_MAX_AGE_SECONDS * 1000,
    ).toISOString()
    const token = encryptPendingStepUpCookie({
      accessToken: params.accessToken,
      userId: params.userId,
      phoneE164: params.phoneE164,
      maxAge: params.maxAge,
      sourceRoute: params.sourceRoute,
      expiresAt,
    })

    return {
      ok: false,
      reason: 'STEP_UP_REQUIRED',
      pendingStepUpCookie: buildPendingStepUpCookieHeader(token),
    }
  }

  try {
    await markLatestActiveChallengeVerified({ ...params, now })
  } catch {
    return failClosedUnavailable(params)
  }

  return {
    ok: true,
    setCookie: buildSessionCookieHeader(params.accessToken, params.maxAge),
  }
}
