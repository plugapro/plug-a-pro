import { recordAuditLog } from './audit'
import { db } from './db'
import {
  hashContext,
  hashOtpCode,
  hashReportToken,
  mintReportToken,
  verifyReportToken,
} from './otp-security-crypto'
import { getOtpSecurityConfig } from './otp-security-config'
import {
  sanitizeChallengeContext,
  sanitizeSecurityEventMetadata,
} from './otp-security-metadata'
import { checkOtpVerifyLimit as checkBaseOtpVerifyLimit } from './rate-limit'
import { maskPhone } from './support-diagnostics'

export type SecuritySourceChannel = 'WHATSAPP_BUTTON' | 'PWA_LINK' | 'ADMIN' | 'SYSTEM'

export type AccountSecurityState = {
  id: string
  phoneE164: string
  userId: string | null
  lockedUntil: Date | null
  lockReason: string | null
  stepUpRequired: boolean
  stepUpSetAt: Date | null
  lastReportedAt: Date | null
  reportCount: number
  createdAt: Date
  updatedAt: Date
}

type OtpPurpose = 'LOGIN' | 'SIGNUP'
type OtpChallengeStatus =
  | 'REQUESTED'
  | 'SENT'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REPORTED_UNREQUESTED'
  | 'FAILED'
type SecurityEventType =
  | 'OTP_REPORTED_UNREQUESTED'
  | 'OTP_RATE_LIMIT_EXCEEDED'
  | 'OTP_VERIFICATION_FAILED_REPEATEDLY'
  | 'OTP_DELIVERY_REFUSED_DURING_LOCK'
  | 'ACCOUNT_LOCKED'
  | 'STEP_UP_COMPLETED'
  | 'LOCK_CLEARED_BY_ADMIN'
type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

type OtpChallengeRow = {
  id: string
  userId: string | null
  phoneE164: string
  status: OtpChallengeStatus
  expiresAt: Date
  createdAt: Date
  requestContext?: unknown
  reportTokenHash?: string | null
  reportTokenUsedAt?: Date | null
  attemptCount?: number
}

type OtpSecurityClient = {
  otpChallenge: {
    create(args: { data: Record<string, unknown> }): Promise<OtpChallengeRow>
    findFirst(args: {
      where: Record<string, unknown>
      orderBy: { createdAt: 'desc' }
    }): Promise<OtpChallengeRow | null>
    findUnique(args: { where: { id: string } }): Promise<OtpChallengeRow | null>
    update(args: {
      where: { id: string }
      data: Record<string, unknown>
    }): Promise<OtpChallengeRow>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>
  }
  securityEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findFirst(args: {
      where: Record<string, unknown>
      orderBy: { createdAt: 'desc' }
    }): Promise<Record<string, unknown> | null>
  }
  accountSecurityState: {
    findUnique(args: { where: { phoneE164: string } }): Promise<AccountSecurityState | null>
    upsert(args: {
      where: { phoneE164: string }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }): Promise<AccountSecurityState>
    update(args: {
      where: { phoneE164: string }
      data: Record<string, unknown>
    }): Promise<AccountSecurityState>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  $transaction<T>(input: (client: OtpSecurityClient) => Promise<T>): Promise<T>
}

export type OtpSecurityTransactionClient = Omit<OtpSecurityClient, '$transaction'>

const ACTIVE_CHALLENGE_STATUSES: OtpChallengeStatus[] = ['REQUESTED', 'SENT']
const TERMINAL_CHALLENGE_STATUSES: OtpChallengeStatus[] = [
  'VERIFIED',
  'EXPIRED',
  'CANCELLED',
  'REPORTED_UNREQUESTED',
  'FAILED',
]

function serviceDb(): OtpSecurityClient {
  return db as unknown as OtpSecurityClient
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function maskedPhoneEntity(phoneE164: string): string {
  return maskPhone(phoneE164) ?? 'masked-phone'
}

function actorUserId(userId?: string | null): string {
  return userId?.trim() || 'system'
}

function logOtpOperationalEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({ event, ...fields }))
}

function isActiveChallenge(challenge: OtpChallengeRow, now: Date): boolean {
  return ACTIVE_CHALLENGE_STATUSES.includes(challenge.status) && challenge.expiresAt > now
}

async function safeAudit(
  params: Parameters<typeof recordAuditLog>[0],
  client: unknown = serviceDb(),
): Promise<void> {
  try {
    await recordAuditLog(params, client as Parameters<typeof recordAuditLog>[1])
  } catch {
    console.warn('[otp-security] audit write failed', { action: params.action })
  }
}

async function createSecurityEvent(
  client: OtpSecurityTransactionClient,
  params: {
    phoneE164: string
    userId?: string | null
    eventType: SecurityEventType
    severity: SecuritySeverity
    sourceChannel: SecuritySourceChannel
    relatedOtpChallengeId?: string | null
    metadata?: unknown
    resolvedAt?: Date | null
    resolvedByUserId?: string | null
  },
): Promise<void> {
  await client.securityEvent.create({
    data: {
      phoneE164: params.phoneE164,
      userId: params.userId ?? null,
      eventType: params.eventType,
      severity: params.severity,
      sourceChannel: params.sourceChannel,
      relatedOtpChallengeId: params.relatedOtpChallengeId ?? null,
      metadata: sanitizeSecurityEventMetadata(params.metadata),
      resolvedAt: params.resolvedAt ?? undefined,
      resolvedByUserId: params.resolvedByUserId ?? undefined,
    },
  })
}

// Keep this lookup shape centralized because the auth, telemetry, and report
// paths must agree on which challenge is eligible for mutation.
async function findLatestActiveChallenge(
  client: OtpSecurityClient,
  params: { phoneE164: string; userId?: string | null; now: Date },
): Promise<OtpChallengeRow | null> {
  return client.otpChallenge.findFirst({
    where: {
      phoneE164: params.phoneE164,
      ...(params.userId ? { userId: params.userId } : {}),
      status: { in: ACTIVE_CHALLENGE_STATUSES },
      expiresAt: { gt: params.now },
    },
    orderBy: { createdAt: 'desc' },
  })
}

async function applyLockAndStepUpWithClient(
  client: OtpSecurityClient,
  phoneE164: string,
  userId: string | null | undefined,
  now: Date,
): Promise<void> {
  const lockedUntil = addMinutes(now, getOtpSecurityConfig().lockMinutesAfterReport)

  await client.accountSecurityState.upsert({
    where: { phoneE164 },
    create: {
      phoneE164,
      userId: userId ?? null,
      lockedUntil,
      lockReason: 'unrequested_otp_report',
      stepUpRequired: true,
      stepUpSetAt: now,
      lastReportedAt: now,
      reportCount: 1,
    },
    update: {
      userId: userId ?? null,
      lockedUntil,
      lockReason: 'unrequested_otp_report',
      stepUpRequired: true,
      stepUpSetAt: now,
      lastReportedAt: now,
      reportCount: { increment: 1 },
    },
  })

  await createSecurityEvent(client, {
    phoneE164,
    userId,
    eventType: 'ACCOUNT_LOCKED',
    severity: 'HIGH',
    sourceChannel: 'SYSTEM',
    metadata: {
      reason: 'unrequested_otp_report',
      userIdPresent: Boolean(userId),
    },
  })

  await safeAudit(
    {
      actorId: actorUserId(userId),
      actorRole: userId ? 'user' : 'system',
      action: 'security.account.locked',
      entityType: 'AccountSecurityState',
      entityId: maskedPhoneEntity(phoneE164),
      after: {
        lockedUntil: lockedUntil.toISOString(),
        stepUpRequired: true,
        userIdPresent: Boolean(userId),
      },
    },
    client,
  )

  logOtpOperationalEvent('otp.step_up.required', {
    sourceChannel: 'SYSTEM',
    phoneMasked: maskedPhoneEntity(phoneE164),
    userIdPresent: Boolean(userId),
  })
}

export async function recordOtpChallenge(params: {
  phoneE164: string
  userId?: string | null
  purpose: OtpPurpose
  code: string
  ip?: string | null
  ua?: string | null
  context?: unknown
}): Promise<{ challengeId: string; reportToken: string }> {
  const now = new Date()
  const expiresAt = addMinutes(now, getOtpSecurityConfig().otpExpiryMinutes)

  const result = await serviceDb().$transaction(async (client) => {
    // Only hashes and allowlisted context are persisted; raw OTP, IP, UA, and
    // token values remain in process memory for this request.
    const challenge = await client.otpChallenge.create({
      data: {
        phoneE164: params.phoneE164,
        userId: params.userId ?? null,
        purpose: params.purpose,
        codeHash: hashOtpCode(params.code),
        status: 'REQUESTED',
        expiresAt,
        provider: 'WHATSAPP',
        requestedIpHash: hashContext(params.ip),
        requestedUserAgentHash: hashContext(params.ua),
        requestContext: sanitizeChallengeContext(params.context),
      },
    })
    const reportToken = mintReportToken(challenge.id, expiresAt)

    await client.otpChallenge.update({
      where: { id: challenge.id },
      data: { reportTokenHash: hashReportToken(reportToken) },
    })

    return { challengeId: challenge.id, reportToken }
  })

  logOtpOperationalEvent('otp.challenge.created', {
    purpose: params.purpose,
    provider: 'WHATSAPP',
    phoneMasked: maskedPhoneEntity(params.phoneE164),
    userIdPresent: Boolean(params.userId),
  })

  return result
}

export async function markChallengeSent(
  challengeId: string,
  providerMessageId: string | null,
): Promise<void> {
  await serviceDb().otpChallenge.updateMany({
    where: {
      id: challengeId,
      status: { in: ACTIVE_CHALLENGE_STATUSES },
    },
    data: {
      status: 'SENT',
      providerMessageId,
    },
  })
}

export async function markChallengeSendFailed(challengeId: string): Promise<void> {
  await serviceDb().otpChallenge.updateMany({
    where: {
      id: challengeId,
      status: { in: ACTIVE_CHALLENGE_STATUSES },
    },
    data: { status: 'FAILED' },
  })
}

export async function markChallengeCancelled(
  challengeId: string,
  reason: 'delivery_refused_during_lock',
): Promise<void> {
  const challenge = await serviceDb().otpChallenge.findUnique({ where: { id: challengeId } })
  const context = sanitizeChallengeContext({
    ...(challenge?.requestContext && typeof challenge.requestContext === 'object'
      ? challenge.requestContext
      : {}),
    deliveryRefusedReason: reason === 'delivery_refused_during_lock' ? 'locked' : undefined,
  })

  await serviceDb().otpChallenge.updateMany({
    where: {
      id: challengeId,
      status: { in: ACTIVE_CHALLENGE_STATUSES },
    },
    data: {
      status: 'CANCELLED',
      requestContext: context,
    },
  })
}

export async function getAccountSecurityState(
  phoneE164: string,
): Promise<AccountSecurityState | null> {
  return serviceDb().accountSecurityState.findUnique({ where: { phoneE164 } })
}

export async function isDeliveryAllowed(
  phoneE164: string,
): Promise<{ allowed: true } | { allowed: false; reason: 'locked'; stateId: string }> {
  const state = await getAccountSecurityState(phoneE164)
  if (state?.lockedUntil && state.lockedUntil > new Date()) {
    return { allowed: false, reason: 'locked', stateId: state.id }
  }

  return { allowed: true }
}

function logRejectedReportToken(reason: string): void {
  console.warn('[otp-security] report token rejected', { reason })
}

export async function reportUnrequestedOtp(params: {
  token?: string
  sourceChannel: SecuritySourceChannel
  ip?: string | null
  ua?: string | null
}): Promise<{ ok: true }> {
  const token = params.token?.trim()
  if (!token) {
    logRejectedReportToken('missing')
    return { ok: true }
  }

  const verified = verifyReportToken(token)
  if (!verified.ok) {
    logRejectedReportToken(verified.reason)
    return { ok: true }
  }

  try {
    const now = new Date()
    const tokenHash = hashReportToken(token)
    let acceptedLogFields: Record<string, unknown> | null = null

    await serviceDb().$transaction(async (client) => {
      const challenge = await client.otpChallenge.findUnique({
        where: { id: verified.payload.challengeId },
      })

      if (!challenge) return
      if (challenge.reportTokenHash !== tokenHash) return
      if (challenge.status === 'REPORTED_UNREQUESTED') return
      if (challenge.reportTokenUsedAt) return
      if (!isActiveChallenge(challenge, now)) return

      const transition = await client.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          reportTokenHash: tokenHash,
          reportTokenUsedAt: null,
          status: { in: ACTIVE_CHALLENGE_STATUSES },
          expiresAt: { gt: now },
        },
        data: {
          status: 'REPORTED_UNREQUESTED',
          reportedAt: now,
          reportTokenUsedAt: now,
        },
      })
      if (transition.count !== 1) return

      await client.otpChallenge.updateMany({
        where: {
          phoneE164: challenge.phoneE164,
          id: { not: challenge.id },
          status: { in: ACTIVE_CHALLENGE_STATUSES },
          expiresAt: { gt: now },
        },
        data: { status: 'CANCELLED' },
      })

      await createSecurityEvent(client, {
        phoneE164: challenge.phoneE164,
        userId: challenge.userId,
        eventType: 'OTP_REPORTED_UNREQUESTED',
        severity: 'HIGH',
        sourceChannel: params.sourceChannel,
        relatedOtpChallengeId: challenge.id,
        metadata: {
          reason: 'unrequested_otp_report',
          source: params.sourceChannel,
          userIdPresent: Boolean(challenge.userId),
        },
      })

      await applyLockAndStepUpWithClient(client, challenge.phoneE164, challenge.userId, now)

      await safeAudit(
        {
          actorId: actorUserId(challenge.userId),
          actorRole: challenge.userId ? 'user' : 'anonymous',
          action: 'security.otp.reported',
          entityType: 'OtpChallenge',
          entityId: challenge.id,
          after: {
            sourceChannel: params.sourceChannel,
            userIdPresent: Boolean(challenge.userId),
          },
        },
        client,
      )

      acceptedLogFields = {
        sourceChannel: params.sourceChannel,
        phoneMasked: maskedPhoneEntity(challenge.phoneE164),
        userIdPresent: Boolean(challenge.userId),
      }
    })

    if (acceptedLogFields) {
      logOtpOperationalEvent('otp.report.accepted', acceptedLogFields)
    }
  } catch {
    console.warn('[otp-security] report handling failed', { reason: 'service_error' })
  }

  return { ok: true }
}

export async function reportUnrequestedOtpFromWhatsApp(params: {
  token: string
  fromPhoneE164: string
}): Promise<{ ok: true }> {
  const verified = verifyReportToken(params.token)
  if (!verified.ok) {
    logRejectedReportToken(verified.reason)
    return { ok: true }
  }

  try {
    const challenge = await serviceDb().otpChallenge.findUnique({
      where: { id: verified.payload.challengeId },
    })
    if (!challenge || challenge.phoneE164 !== params.fromPhoneE164) {
      logRejectedReportToken('whatsapp_phone_mismatch')
      return { ok: true }
    }

    return reportUnrequestedOtp({
      token: params.token,
      sourceChannel: 'WHATSAPP_BUTTON',
    })
  } catch {
    console.warn('[otp-security] whatsapp report handling failed', { reason: 'service_error' })
    return { ok: true }
  }
}

export async function applyLockAndStepUp(
  phoneE164: string,
  userId?: string | null,
): Promise<void> {
  const now = new Date()
  await serviceDb().$transaction(async (client) => {
    await applyLockAndStepUpWithClient(client, phoneE164, userId, now)
  })
}

export async function recordVerificationResult(params: {
  phoneE164: string
  userId?: string | null
  success: boolean
  source: 'server_verify' | 'client_telemetry'
}): Promise<void> {
  const now = new Date()
  const client = serviceDb()
  const challenge = await findLatestActiveChallenge(client, {
    phoneE164: params.phoneE164,
    userId: params.userId,
    now,
  })
  if (!challenge) return

  if (params.success) {
    await client.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        status: { in: ACTIVE_CHALLENGE_STATUSES },
        expiresAt: { gt: now },
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: now,
      },
    })
    return
  }

  const previousAttempts = challenge.attemptCount ?? 0
  const update = await client.otpChallenge.updateMany({
    where: {
      id: challenge.id,
      status: { in: ACTIVE_CHALLENGE_STATUSES },
      expiresAt: { gt: now },
    },
    data: { attemptCount: { increment: 1 } },
  })
  if (update.count !== 1) return

  const currentAttempts = previousAttempts + 1
  const maxAttempts = getOtpSecurityConfig().maxVerifyAttempts

  if (previousAttempts < maxAttempts && currentAttempts >= maxAttempts) {
    await createSecurityEvent(client, {
      phoneE164: challenge.phoneE164,
      userId: challenge.userId,
      eventType: 'OTP_VERIFICATION_FAILED_REPEATEDLY',
      severity: 'MEDIUM',
      sourceChannel: 'SYSTEM',
      relatedOtpChallengeId: challenge.id,
      metadata: {
        source: params.source,
        count: currentAttempts,
        userIdPresent: Boolean(challenge.userId),
      },
    })
  }
}

export async function checkOtpVerifyLimit(params: {
  phoneE164: string
  ip?: string | null
  ua?: string | null
}): Promise<
  | { ok: true; challengeId: string }
  | { ok: false; reason: 'rate_limited' | 'limiter_unavailable' | 'no_active_challenge' }
> {
  let limitResult: Awaited<ReturnType<typeof checkBaseOtpVerifyLimit>>
  try {
    limitResult = await checkBaseOtpVerifyLimit({
      phone: params.phoneE164,
      context: { source: 'otp_security_verify_failed' },
    })
  } catch {
    return { ok: false, reason: 'limiter_unavailable' }
  }

  if (!limitResult.ok) {
    return {
      ok: false,
      reason: limitResult.code === 'limiter_unavailable' ? 'limiter_unavailable' : 'rate_limited',
    }
  }

  const challenge = await findLatestActiveChallenge(serviceDb(), {
    phoneE164: params.phoneE164,
    now: new Date(),
  })

  if (!challenge) return { ok: false, reason: 'no_active_challenge' }

  return { ok: true, challengeId: challenge.id }
}

export async function recordDeliveryRefusedDuringLock(params: {
  phoneE164: string
  userId?: string | null
  challengeId?: string | null
  ip?: string | null
  ua?: string | null
}): Promise<void> {
  const now = new Date()
  const windowStart = addMinutes(
    now,
    -getOtpSecurityConfig().lockRefusalEventWindowMinutes,
  )

  const existing = await serviceDb().securityEvent.findFirst({
    where: {
      phoneE164: params.phoneE164,
      eventType: 'OTP_DELIVERY_REFUSED_DURING_LOCK',
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!existing) {
    await createSecurityEvent(serviceDb(), {
      phoneE164: params.phoneE164,
      userId: params.userId,
      eventType: 'OTP_DELIVERY_REFUSED_DURING_LOCK',
      severity: 'LOW',
      sourceChannel: 'SYSTEM',
      relatedOtpChallengeId: params.challengeId ?? null,
      metadata: {
        reason: 'locked',
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        userIdPresent: Boolean(params.userId),
      },
    })
  }

  await safeAudit({
    actorId: actorUserId(params.userId),
    actorRole: params.userId ? 'user' : 'anonymous',
    action: 'security.otp.delivery_refused_during_lock',
    entityType: 'OtpChallenge',
    entityId: params.challengeId ?? maskedPhoneEntity(params.phoneE164),
    after: {
      userIdPresent: Boolean(params.userId),
      deduped: Boolean(existing),
    },
  })

  logOtpOperationalEvent('otp.delivery.refused_during_lock', {
    sourceChannel: 'SYSTEM',
    phoneMasked: maskedPhoneEntity(params.phoneE164),
    userIdPresent: Boolean(params.userId),
    deduped: Boolean(existing),
  })
}

export async function clearLock(
  phoneE164: string,
  params: { byAdminId: string; client?: OtpSecurityTransactionClient },
): Promise<void> {
  const now = new Date()

  const clearWithClient = async (client: OtpSecurityTransactionClient) => {
    await client.accountSecurityState.upsert({
      where: { phoneE164 },
      create: {
        phoneE164,
        userId: null,
        lockedUntil: null,
        lockReason: null,
        stepUpRequired: false,
        stepUpSetAt: null,
        lastReportedAt: null,
        reportCount: 0,
      },
      update: {
        lockedUntil: null,
        lockReason: null,
        stepUpRequired: false,
        stepUpSetAt: null,
      },
    })

    await createSecurityEvent(client, {
      phoneE164,
      eventType: 'LOCK_CLEARED_BY_ADMIN',
      severity: 'MEDIUM',
      sourceChannel: 'ADMIN',
      metadata: { source: 'admin_clear_lock' },
      resolvedAt: now,
      resolvedByUserId: params.byAdminId,
    })

    await safeAudit(
      {
        actorId: params.byAdminId,
        actorRole: 'admin',
        action: 'security.account.lock_cleared',
        entityType: 'AccountSecurityState',
        entityId: maskedPhoneEntity(phoneE164),
        after: {
          lockedUntil: null,
          stepUpRequired: false,
        },
      },
      client,
    )
  }

  if (params.client) {
    await clearWithClient(params.client)
    return
  }

  await serviceDb().$transaction(clearWithClient)
}

export type CompleteStepUpResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'not_required' }

export async function completeStepUp(
  phoneE164: string,
  userId?: string | null,
): Promise<CompleteStepUpResult> {
  const now = new Date()

  const result: CompleteStepUpResult = await serviceDb().$transaction(
    async (client): Promise<CompleteStepUpResult> => {
      const stateBeforeAttempt = await client.accountSecurityState.findUnique({
        where: { phoneE164 },
      })
      const completion = await client.accountSecurityState.updateMany({
        where: {
          phoneE164,
          stepUpRequired: true,
          OR: [
            { lockedUntil: null },
            { lockedUntil: { lte: now } },
          ],
        },
        data: {
          userId: userId ?? null,
          lockedUntil: null,
          lockReason: null,
          stepUpRequired: false,
          stepUpSetAt: null,
        },
      })

      if (completion.count !== 1) {
        const stateAfterAttempt = await client.accountSecurityState.findUnique({
          where: { phoneE164 },
        })
        const stateForReason = stateAfterAttempt ?? stateBeforeAttempt
        if (stateForReason?.lockedUntil && stateForReason.lockedUntil > now) {
          return { ok: false, reason: 'locked' }
        }
        return { ok: false, reason: 'not_required' }
      }

      await createSecurityEvent(client, {
        phoneE164,
        userId,
        eventType: 'STEP_UP_COMPLETED',
        severity: 'LOW',
        sourceChannel: 'SYSTEM',
        metadata: {
          source: 'step_up_ack',
          userIdPresent: Boolean(userId),
        },
      })

      await safeAudit(
        {
          actorId: actorUserId(userId),
          actorRole: userId ? 'user' : 'system',
          action: 'security.step_up.completed',
          entityType: 'AccountSecurityState',
          entityId: maskedPhoneEntity(phoneE164),
          after: {
            lockedUntil: null,
            stepUpRequired: false,
            userIdPresent: Boolean(userId),
          },
        },
        client,
      )

      return { ok: true }
    },
  )

  if (result.ok) {
    logOtpOperationalEvent('otp.step_up.completed', {
      sourceChannel: 'SYSTEM',
      phoneMasked: maskedPhoneEntity(phoneE164),
      userIdPresent: Boolean(userId),
    })
  }

  return result
}

export async function pruneTerminalOtpChallenges(
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const cutoff = addDays(now, -getOtpSecurityConfig().challengeRetentionDays)
  const result = await serviceDb().otpChallenge.deleteMany({
    where: {
      status: { in: TERMINAL_CHALLENGE_STATUSES },
      updatedAt: { lt: cutoff },
    },
  })

  return { deleted: result.count }
}
