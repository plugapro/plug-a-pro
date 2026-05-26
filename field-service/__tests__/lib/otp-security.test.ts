import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>

const mocks = vi.hoisted(() => {
  const state = {
    otpChallenges: [] as Row[],
    securityEvents: [] as Row[],
    accountSecurityStates: [] as Row[],
    id: 0,
  }

  function nextId(prefix: string) {
    state.id += 1
    return `${prefix}_${state.id}`
  }

  function applyData(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'increment' in value
      ) {
        row[key] = (row[key] ?? 0) + Number(value.increment)
        continue
      }

      row[key] = value
    }
    row.updatedAt = data.updatedAt ?? new Date()
    return row
  }

  function matchesValue(value: any, condition: any): boolean {
    if (
      condition &&
      typeof condition === 'object' &&
      !Array.isArray(condition) &&
      !(condition instanceof Date)
    ) {
      if ('in' in condition && !condition.in.includes(value)) return false
      if ('not' in condition && value === condition.not) return false
      if ('gt' in condition && !(value > condition.gt)) return false
      if ('gte' in condition && !(value >= condition.gte)) return false
      if ('lt' in condition && !(value < condition.lt)) return false
      if ('lte' in condition && !(value <= condition.lte)) return false
      return true
    }

    if (condition === null) return value == null

    return value === condition
  }

  function matchesWhere(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'AND') return condition.every((item: Row) => matchesWhere(row, item))
      if (key === 'OR') return condition.some((item: Row) => matchesWhere(row, item))
      return matchesValue(row[key], condition)
    })
  }

  function sortRows(rows: Row[], orderBy?: Row) {
    if (!orderBy) return rows
    const [key, direction] = Object.entries(orderBy)[0] ?? []
    if (!key) return rows

    return [...rows].sort((a, b) => {
      const left = a[key] instanceof Date ? a[key].getTime() : a[key]
      const right = b[key] instanceof Date ? b[key].getTime() : b[key]
      if (left === right) return 0
      return direction === 'desc' ? (left < right ? 1 : -1) : left > right ? 1 : -1
    })
  }

  const db: Row = {
    otpChallenge: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: data.id ?? nextId('otp'),
          attemptCount: 0,
          provider: 'WHATSAPP',
          createdAt: data.createdAt ?? new Date(),
          updatedAt: data.updatedAt ?? new Date(),
          ...data,
        }
        state.otpChallenges.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where?: Row; orderBy?: Row }) => {
        return sortRows(state.otpChallenges.filter((row) => matchesWhere(row, where)), orderBy)[0] ?? null
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        if ('id' in where) return state.otpChallenges.find((row) => row.id === where.id) ?? null
        return null
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.otpChallenges.find((item) => item.id === where.id)
        if (!row) throw new Error(`OtpChallenge not found: ${where.id}`)
        return applyData(row, data)
      }),
      updateMany: vi.fn(async ({ where, data }: { where?: Row; data: Row }) => {
        const rows = state.otpChallenges.filter((row) => matchesWhere(row, where))
        rows.forEach((row) => applyData(row, data))
        return { count: rows.length }
      }),
      deleteMany: vi.fn(async ({ where }: { where?: Row }) => {
        const before = state.otpChallenges.length
        state.otpChallenges = state.otpChallenges.filter((row) => !matchesWhere(row, where))
        return { count: before - state.otpChallenges.length }
      }),
    },
    securityEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: data.id ?? nextId('event'),
          status: 'NEW',
          createdAt: data.createdAt ?? new Date(),
          updatedAt: data.updatedAt ?? new Date(),
          ...data,
        }
        state.securityEvents.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where?: Row; orderBy?: Row }) => {
        return sortRows(state.securityEvents.filter((row) => matchesWhere(row, where)), orderBy)[0] ?? null
      }),
    },
    accountSecurityState: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return state.accountSecurityStates.find((row) => row.phoneE164 === where.phoneE164) ?? null
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const existing = state.accountSecurityStates.find((row) => row.phoneE164 === where.phoneE164)
        if (existing) return applyData(existing, update)
        const row = {
          id: create.id ?? nextId('state'),
          reportCount: 0,
          stepUpRequired: false,
          createdAt: create.createdAt ?? new Date(),
          updatedAt: create.updatedAt ?? new Date(),
          ...create,
        }
        state.accountSecurityStates.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.accountSecurityStates.find((item) => item.phoneE164 === where.phoneE164)
        if (!row) throw new Error(`AccountSecurityState not found: ${where.phoneE164}`)
        return applyData(row, data)
      }),
    },
    $transaction: vi.fn(async (input: any) => {
      if (typeof input === 'function') return input(db)
      return Promise.all(input)
    }),
  }

  return {
    db,
    state,
    audit: vi.fn().mockResolvedValue(undefined),
    rateLimit: vi.fn().mockResolvedValue({ ok: true }),
    reset() {
      state.otpChallenges = []
      state.securityEvents = []
      state.accountSecurityStates = []
      state.id = 0
    },
  }
})

vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mocks.audit }))
vi.mock('@/lib/rate-limit', () => ({ checkOtpVerifyLimit: mocks.rateLimit }))

import { recordAuditLog } from '@/lib/audit'
import {
  applyLockAndStepUp,
  checkOtpVerifyLimit,
  clearLock,
  completeStepUp,
  getAccountSecurityState,
  isDeliveryAllowed,
  markChallengeCancelled,
  markChallengeSendFailed,
  markChallengeSent,
  pruneTerminalOtpChallenges,
  recordDeliveryRefusedDuringLock,
  recordOtpChallenge,
  recordVerificationResult,
  reportUnrequestedOtp,
  reportUnrequestedOtpFromWhatsApp,
} from '@/lib/otp-security'

const NOW = new Date('2026-05-26T10:00:00.000Z')
const PHONE = '+27821234567'
const OTHER_PHONE = '+27825550123'
const USER_ID = 'user_123'
const TEST_OTP = '987654'
const ORIGINAL_ENV = { ...process.env }

function latestChallenge() {
  return mocks.state.otpChallenges.at(-1)!
}

function securityEvents(type: string) {
  return mocks.state.securityEvents.filter((event) => event.eventType === type)
}

describe('otp security service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    mocks.reset()
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      OTP_HASH_PEPPER: 'service-test-pepper',
      OTP_EXPIRY_MINUTES: '10',
      OTP_MAX_VERIFY_ATTEMPTS: '2',
      OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT: '60',
      OTP_LOCK_REFUSAL_EVENT_WINDOW_MINUTES: '15',
      OTP_CHALLENGE_RETENTION_DAYS: '30',
      RATE_LIMIT_ALLOW_MEMORY_FALLBACK: 'true',
    }
    mocks.rateLimit.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
  })

  it('records a requested challenge with a report token and no raw OTP persistence', async () => {
    const result = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
      ip: '198.51.100.10',
      ua: 'PlugAProTest/1.0',
      context: { traceId: 'trace-123', source: 'send_sms_hook', rawIgnored: TEST_OTP },
    })

    expect(result).toEqual({
      challengeId: expect.stringMatching(/^otp_/),
      reportToken: expect.any(String),
    })

    const challenge = latestChallenge()
    expect(challenge).toMatchObject({
      id: result.challengeId,
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      status: 'REQUESTED',
      provider: 'WHATSAPP',
      requestedIpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestedUserAgentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(challenge.expiresAt).toEqual(new Date('2026-05-26T10:10:00.000Z'))
    expect(challenge.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(challenge.codeHash).not.toBe(TEST_OTP)
    expect(challenge.reportTokenHash).not.toBe(result.reportToken)
    expect(JSON.stringify(mocks.state.otpChallenges)).not.toContain(TEST_OTP)
  })

  it('marks challenges sent and failed without requiring provider message id', async () => {
    const first = await recordOtpChallenge({
      phoneE164: PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    const second = await recordOtpChallenge({
      phoneE164: OTHER_PHONE,
      purpose: 'SIGNUP',
      code: TEST_OTP,
    })
    const third = await recordOtpChallenge({
      phoneE164: '+27825550124',
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    await markChallengeSent(first.challengeId, null)
    await markChallengeSendFailed(second.challengeId)
    await markChallengeCancelled(third.challengeId, 'delivery_refused_during_lock')

    expect(mocks.state.otpChallenges.find((row) => row.id === first.challengeId)).toMatchObject({
      status: 'SENT',
      providerMessageId: null,
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === second.challengeId)).toMatchObject({
      status: 'FAILED',
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === third.challengeId)).toMatchObject({
      status: 'CANCELLED',
      requestContext: { deliveryRefusedReason: 'locked' },
    })
  })

  it('does not let late sent, failed, or cancelled updates overwrite reported challenges', async () => {
    const sentRace = await recordOtpChallenge({
      phoneE164: PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    const failedRace = await recordOtpChallenge({
      phoneE164: OTHER_PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    const cancelledRace = await recordOtpChallenge({
      phoneE164: '+27825550124',
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    mocks.state.otpChallenges.find((row) => row.id === sentRace.challengeId)!.status =
      'REPORTED_UNREQUESTED'
    mocks.state.otpChallenges.find((row) => row.id === failedRace.challengeId)!.status =
      'REPORTED_UNREQUESTED'
    mocks.state.otpChallenges.find((row) => row.id === cancelledRace.challengeId)!.status =
      'REPORTED_UNREQUESTED'

    await markChallengeSent(sentRace.challengeId, 'wamid.late')
    await markChallengeSendFailed(failedRace.challengeId)
    await markChallengeCancelled(cancelledRace.challengeId, 'delivery_refused_during_lock')

    const sentRaceRow = mocks.state.otpChallenges.find((row) => row.id === sentRace.challengeId)!
    expect(sentRaceRow.status).toBe('REPORTED_UNREQUESTED')
    expect(sentRaceRow.providerMessageId).toBeUndefined()
    expect(mocks.state.otpChallenges.find((row) => row.id === failedRace.challengeId)).toMatchObject({
      status: 'REPORTED_UNREQUESTED',
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === cancelledRace.challengeId)).toMatchObject({
      status: 'REPORTED_UNREQUESTED',
      requestContext: {},
    })
  })

  it('reports an unrequested OTP idempotently, cancels siblings, locks the phone, and creates high severity event', async () => {
    const older = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    vi.setSystemTime(new Date(NOW.getTime() + 1000))
    const newer = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    await expect(isDeliveryAllowed(PHONE)).resolves.toEqual({ allowed: true })

    await expect(
      reportUnrequestedOtp({
        token: newer.reportToken,
        sourceChannel: 'PWA_LINK',
        ip: '198.51.100.20',
        ua: 'PlugAProTest/1.0',
      }),
    ).resolves.toEqual({ ok: true })
    await expect(reportUnrequestedOtp({ token: newer.reportToken, sourceChannel: 'PWA_LINK' })).resolves.toEqual({
      ok: true,
    })

    expect(mocks.state.otpChallenges.find((row) => row.id === newer.challengeId)).toMatchObject({
      status: 'REPORTED_UNREQUESTED',
      reportedAt: new Date('2026-05-26T10:00:01.000Z'),
      reportTokenUsedAt: new Date('2026-05-26T10:00:01.000Z'),
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === older.challengeId)).toMatchObject({
      status: 'CANCELLED',
    })
    expect(securityEvents('OTP_REPORTED_UNREQUESTED')).toHaveLength(1)
    expect(securityEvents('OTP_REPORTED_UNREQUESTED')[0]).toMatchObject({
      phoneE164: PHONE,
      userId: USER_ID,
      severity: 'HIGH',
      sourceChannel: 'PWA_LINK',
      relatedOtpChallengeId: newer.challengeId,
    })
    await expect(getAccountSecurityState(PHONE)).resolves.toMatchObject({
      phoneE164: PHONE,
      userId: USER_ID,
      lockedUntil: new Date('2026-05-26T11:00:01.000Z'),
      lockReason: 'unrequested_otp_report',
      stepUpRequired: true,
      reportCount: 1,
      lastReportedAt: new Date('2026-05-26T10:00:01.000Z'),
    })
    await expect(isDeliveryAllowed(PHONE)).resolves.toMatchObject({
      allowed: false,
      reason: 'locked',
      stateId: expect.stringMatching(/^state_/),
    })
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.otp.reported',
        entityType: 'OtpChallenge',
        entityId: newer.challengeId,
      }),
      expect.anything(),
    )
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.account.locked',
        entityType: 'AccountSecurityState',
        entityId: '082****567',
      }),
      expect.anything(),
    )
  })

  it('does not fail generic report success for expired, reused, tampered, or unsigned report tokens', async () => {
    const expired = await recordOtpChallenge({
      phoneE164: PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    vi.setSystemTime(new Date('2026-05-26T10:11:00.000Z'))

    await expect(reportUnrequestedOtp({ token: expired.reportToken, sourceChannel: 'PWA_LINK' })).resolves.toEqual({
      ok: true,
    })
    const expiredRow = mocks.state.otpChallenges.find((row) => row.id === expired.challengeId)!
    expect(expiredRow.status).toBe('REQUESTED')
    expect(expiredRow.reportedAt).toBeUndefined()

    vi.setSystemTime(NOW)
    const reused = await recordOtpChallenge({
      phoneE164: OTHER_PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    await reportUnrequestedOtp({ token: reused.reportToken, sourceChannel: 'PWA_LINK' })
    await expect(reportUnrequestedOtp({ token: reused.reportToken, sourceChannel: 'PWA_LINK' })).resolves.toEqual({
      ok: true,
    })
    await expect(reportUnrequestedOtp({ token: `${reused.reportToken}tampered`, sourceChannel: 'PWA_LINK' })).resolves.toEqual({
      ok: true,
    })
    await expect(reportUnrequestedOtp({ token: reused.challengeId, sourceChannel: 'PWA_LINK' })).resolves.toEqual({
      ok: true,
    })

    expect(securityEvents('OTP_REPORTED_UNREQUESTED')).toHaveLength(1)
    expect(mocks.state.otpChallenges.find((row) => row.id === reused.challengeId)).toMatchObject({
      status: 'REPORTED_UNREQUESTED',
    })
  })

  it('does not create report side effects when the guarded report transition loses a concurrent race', async () => {
    const challenge = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    const reportTokenHash = latestChallenge().reportTokenHash

    mocks.db.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      reportUnrequestedOtp({
        token: challenge.reportToken,
        sourceChannel: 'PWA_LINK',
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.db.otpChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        id: challenge.challengeId,
        reportTokenHash,
        reportTokenUsedAt: null,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      data: {
        status: 'REPORTED_UNREQUESTED',
        reportedAt: NOW,
        reportTokenUsedAt: NOW,
      },
    })
    const unchangedChallenge = mocks.state.otpChallenges.find((row) => row.id === challenge.challengeId)!
    expect(unchangedChallenge.status).toBe('REQUESTED')
    expect(unchangedChallenge.reportTokenUsedAt).toBeUndefined()
    expect(mocks.state.securityEvents).toHaveLength(0)
    await expect(getAccountSecurityState(PHONE)).resolves.toBeNull()
    expect(recordAuditLog).not.toHaveBeenCalled()
  })

  it('requires matching WhatsApp sender before reporting a signed token', async () => {
    const challenge = await recordOtpChallenge({
      phoneE164: PHONE,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    await expect(
      reportUnrequestedOtpFromWhatsApp({
        token: challenge.reportToken,
        fromPhoneE164: OTHER_PHONE,
      }),
    ).resolves.toEqual({ ok: true })
    expect(mocks.state.otpChallenges.find((row) => row.id === challenge.challengeId)).toMatchObject({
      status: 'REQUESTED',
    })

    await expect(
      reportUnrequestedOtpFromWhatsApp({
        token: challenge.reportToken,
        fromPhoneE164: PHONE,
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.state.otpChallenges.find((row) => row.id === challenge.challengeId)).toMatchObject({
      status: 'REPORTED_UNREQUESTED',
    })
    expect(securityEvents('OTP_REPORTED_UNREQUESTED')).toHaveLength(1)
  })

  it('records verify failures only for recent active challenges and caps client telemetry severity below HIGH', async () => {
    const older = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    vi.setSystemTime(new Date(NOW.getTime() + 1000))
    const newer = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    await expect(checkOtpVerifyLimit({ phoneE164: PHONE })).resolves.toEqual({
      ok: true,
      challengeId: newer.challengeId,
    })
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      phone: PHONE,
      context: { source: 'otp_security_verify_failed' },
    })
    expect(mocks.db.otpChallenge.findFirst).toHaveBeenLastCalledWith({
      where: {
        phoneE164: PHONE,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: new Date('2026-05-26T10:00:01.000Z') },
      },
      orderBy: { createdAt: 'desc' },
    })

    mocks.rateLimit.mockResolvedValueOnce({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkOtpVerifyLimit({ phoneE164: PHONE })).resolves.toEqual({
      ok: false,
      reason: 'limiter_unavailable',
    })

    await recordVerificationResult({
      phoneE164: PHONE,
      userId: USER_ID,
      success: false,
      source: 'client_telemetry',
    })
    await recordVerificationResult({
      phoneE164: PHONE,
      userId: USER_ID,
      success: false,
      source: 'client_telemetry',
    })

    expect(mocks.state.otpChallenges.find((row) => row.id === newer.challengeId)).toMatchObject({
      attemptCount: 2,
      status: 'REQUESTED',
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === older.challengeId)).toMatchObject({
      attemptCount: 0,
    })
    expect(securityEvents('OTP_VERIFICATION_FAILED_REPEATEDLY')).toHaveLength(1)
    expect(securityEvents('OTP_VERIFICATION_FAILED_REPEATEDLY')[0]).toMatchObject({
      severity: 'MEDIUM',
      sourceChannel: 'SYSTEM',
      relatedOtpChallengeId: newer.challengeId,
    })
    expect(mocks.state.securityEvents.map((event) => event.severity)).not.toContain('HIGH')

    vi.setSystemTime(new Date('2026-05-26T10:12:00.000Z'))
    await recordVerificationResult({
      phoneE164: PHONE,
      userId: USER_ID,
      success: false,
      source: 'server_verify',
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === newer.challengeId)).toMatchObject({
      attemptCount: 2,
    })
    await expect(checkOtpVerifyLimit({ phoneE164: PHONE })).resolves.toEqual({
      ok: false,
      reason: 'no_active_challenge',
    })
  })

  it('does not mutate verification success or failure when guarded updates lose a concurrent race', async () => {
    const successRace = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    mocks.db.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 })

    await recordVerificationResult({
      phoneE164: PHONE,
      userId: USER_ID,
      success: true,
      source: 'server_verify',
    })

    expect(mocks.db.otpChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        id: successRace.challengeId,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: NOW,
      },
    })
    const successRaceRow = mocks.state.otpChallenges.find((row) => row.id === successRace.challengeId)!
    expect(successRaceRow.status).toBe('REQUESTED')
    expect(successRaceRow.verifiedAt).toBeUndefined()

    const failureRace = await recordOtpChallenge({
      phoneE164: OTHER_PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })
    mocks.db.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 })

    await recordVerificationResult({
      phoneE164: OTHER_PHONE,
      userId: USER_ID,
      success: false,
      source: 'client_telemetry',
    })

    expect(mocks.db.otpChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        id: failureRace.challengeId,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      data: { attemptCount: { increment: 1 } },
    })
    expect(mocks.state.otpChallenges.find((row) => row.id === failureRace.challengeId)).toMatchObject({
      attemptCount: 0,
      status: 'REQUESTED',
    })
    expect(securityEvents('OTP_VERIFICATION_FAILED_REPEATEDLY')).toHaveLength(0)
  })

  it('dedupes OTP_DELIVERY_REFUSED_DURING_LOCK within the configured window', async () => {
    const challenge = await recordOtpChallenge({
      phoneE164: PHONE,
      userId: USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
    })

    await recordDeliveryRefusedDuringLock({
      phoneE164: PHONE,
      userId: USER_ID,
      challengeId: challenge.challengeId,
      ip: '198.51.100.30',
      ua: 'PlugAProTest/1.0',
    })
    await recordDeliveryRefusedDuringLock({
      phoneE164: PHONE,
      userId: USER_ID,
      challengeId: challenge.challengeId,
      ip: '198.51.100.31',
      ua: 'PlugAProTest/1.0',
    })

    expect(securityEvents('OTP_DELIVERY_REFUSED_DURING_LOCK')).toHaveLength(1)
    expect(securityEvents('OTP_DELIVERY_REFUSED_DURING_LOCK')[0]).toMatchObject({
      severity: 'LOW',
      sourceChannel: 'SYSTEM',
      phoneE164: PHONE,
    })

    vi.setSystemTime(new Date('2026-05-26T10:16:00.000Z'))
    await recordDeliveryRefusedDuringLock({
      phoneE164: PHONE,
      userId: USER_ID,
      challengeId: challenge.challengeId,
    })

    expect(securityEvents('OTP_DELIVERY_REFUSED_DURING_LOCK')).toHaveLength(2)
  })

  it('clears lock and step-up with admin audit event source data', async () => {
    await applyLockAndStepUp(PHONE, USER_ID)
    await clearLock(PHONE, { byAdminId: 'admin_1' })

    await expect(getAccountSecurityState(PHONE)).resolves.toMatchObject({
      lockedUntil: null,
      lockReason: null,
      stepUpRequired: false,
      stepUpSetAt: null,
    })
    expect(securityEvents('LOCK_CLEARED_BY_ADMIN')).toHaveLength(1)
    expect(securityEvents('LOCK_CLEARED_BY_ADMIN')[0]).toMatchObject({
      sourceChannel: 'ADMIN',
      resolvedByUserId: 'admin_1',
      metadata: { source: 'admin_clear_lock' },
    })

    await applyLockAndStepUp(PHONE, USER_ID)
    const stepUpState = mocks.state.accountSecurityStates.find((row) => row.phoneE164 === PHONE)!
    stepUpState.lockedUntil = new Date('2026-05-26T09:59:00.000Z')

    await expect(completeStepUp(PHONE, USER_ID)).resolves.toEqual({ ok: true })

    await expect(getAccountSecurityState(PHONE)).resolves.toMatchObject({
      lockedUntil: null,
      lockReason: null,
      stepUpRequired: false,
      stepUpSetAt: null,
    })
    expect(securityEvents('STEP_UP_COMPLETED')).toHaveLength(1)
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.account.lock_cleared',
        actorId: 'admin_1',
      }),
      expect.anything(),
    )
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.step_up.completed',
        entityId: '082****567',
      }),
      expect.anything(),
    )
  })

  it('does not complete step-up or clear state when a stale pending cookie meets an active re-lock', async () => {
    await applyLockAndStepUp(PHONE, USER_ID)
    const lockedState = mocks.state.accountSecurityStates.find((row) => row.phoneE164 === PHONE)!
    lockedState.lockedUntil = new Date('2026-05-26T10:30:00.000Z')
    lockedState.lockReason = 'admin_relock'
    lockedState.stepUpRequired = true
    lockedState.stepUpSetAt = new Date('2026-05-26T09:59:00.000Z')
    mocks.state.securityEvents = []
    vi.mocked(recordAuditLog).mockClear()

    await expect(completeStepUp(PHONE, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'locked',
    })

    await expect(getAccountSecurityState(PHONE)).resolves.toMatchObject({
      lockedUntil: new Date('2026-05-26T10:30:00.000Z'),
      lockReason: 'admin_relock',
      stepUpRequired: true,
      stepUpSetAt: new Date('2026-05-26T09:59:00.000Z'),
    })
    expect(securityEvents('STEP_UP_COMPLETED')).toHaveLength(0)
    expect(recordAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'security.step_up.completed' }),
      expect.anything(),
    )
  })

  it('prunes terminal challenges older than the retention window without deleting security events', async () => {
    await recordOtpChallenge({ phoneE164: PHONE, purpose: 'LOGIN', code: TEST_OTP })
    const oldTerminal = latestChallenge()
    await markChallengeSendFailed(oldTerminal.id)
    oldTerminal.updatedAt = new Date('2026-04-20T10:00:00.000Z')
    await mocks.db.securityEvent.create({
      data: {
        phoneE164: PHONE,
        eventType: 'OTP_REPORTED_UNREQUESTED',
        severity: 'HIGH',
        sourceChannel: 'SYSTEM',
        relatedOtpChallengeId: oldTerminal.id,
        metadata: {},
      },
    })

    await recordOtpChallenge({ phoneE164: OTHER_PHONE, purpose: 'LOGIN', code: TEST_OTP })
    const recentTerminal = latestChallenge()
    await markChallengeSendFailed(recentTerminal.id)

    await recordOtpChallenge({ phoneE164: '+27825550124', purpose: 'LOGIN', code: TEST_OTP })
    const oldActive = latestChallenge()
    oldActive.updatedAt = new Date('2026-04-20T10:00:00.000Z')

    await expect(pruneTerminalOtpChallenges(NOW)).resolves.toEqual({ deleted: 1 })

    expect(mocks.state.otpChallenges.map((row) => row.id)).toEqual([
      recentTerminal.id,
      oldActive.id,
    ])
    expect(mocks.state.securityEvents).toHaveLength(1)
    expect(mocks.state.securityEvents[0].relatedOtpChallengeId).toBe(oldTerminal.id)
  })
})
