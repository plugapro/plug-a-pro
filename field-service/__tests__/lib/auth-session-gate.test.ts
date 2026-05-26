import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptPendingStepUpCookie } from '@/lib/otp-security-crypto'
import { issueAuthSessionWithSecurityGate } from '@/lib/auth-session-gate'

const mocks = vi.hoisted(() => ({
  db: {
    accountSecurityState: {
      findUnique: vi.fn(),
    },
    otpChallenge: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mocks.recordAuditLog }))

const NOW = new Date('2026-05-26T10:00:00.000Z')
const PHONE = '+27821234567'
const USER_ID = 'user_123'
const SOURCE_ROUTE = '/api/auth/session' as const
const ORIGINAL_ENV = { ...process.env }

function stepUpKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64url')
}

function issue(overrides: Partial<Parameters<typeof issueAuthSessionWithSecurityGate>[0]> = {}) {
  return issueAuthSessionWithSecurityGate({
    accessToken: 'supabase-access-token',
    phoneE164: PHONE,
    userId: USER_ID,
    maxAge: 3600,
    sourceRoute: SOURCE_ROUTE,
    ...overrides,
  })
}

function cookieValue(header: string, name: string): string {
  const prefix = `${name}=`
  const firstPart = header.split(';')[0] ?? ''
  expect(firstPart.startsWith(prefix)).toBe(true)
  return firstPart.slice(prefix.length)
}

describe('issueAuthSessionWithSecurityGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      OTP_HASH_PEPPER: 'auth-session-gate-test-pepper',
      STEP_UP_COOKIE_KEY: stepUpKey(7),
    }
    mocks.db.accountSecurityState.findUnique.mockResolvedValue(null)
    mocks.db.otpChallenge.findFirst.mockResolvedValue(null)
    mocks.db.otpChallenge.updateMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns LOCKED and no Set-Cookie when lockedUntil is in the future', async () => {
    mocks.db.accountSecurityState.findUnique.mockResolvedValueOnce({
      id: 'state_1',
      phoneE164: PHONE,
      userId: USER_ID,
      lockedUntil: new Date('2026-05-26T10:10:00.000Z'),
      lockReason: 'unrequested_otp_report',
      stepUpRequired: true,
      stepUpSetAt: NOW,
      lastReportedAt: NOW,
      reportCount: 1,
      createdAt: NOW,
      updatedAt: NOW,
    })

    const result = await issue()

    expect(result).toEqual({ ok: false, reason: 'LOCKED' })
    expect('setCookie' in result).toBe(false)
    expect('pendingStepUpCookie' in result).toBe(false)
    expect(mocks.db.otpChallenge.findFirst).not.toHaveBeenCalled()
    expect(mocks.db.otpChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('returns STEP_UP_REQUIRED and pap-step-up-token when stepUpRequired is true', async () => {
    mocks.db.accountSecurityState.findUnique.mockResolvedValueOnce({
      id: 'state_1',
      phoneE164: PHONE,
      userId: USER_ID,
      lockedUntil: null,
      lockReason: 'unrequested_otp_report',
      stepUpRequired: true,
      stepUpSetAt: NOW,
      lastReportedAt: NOW,
      reportCount: 1,
      createdAt: NOW,
      updatedAt: NOW,
    })

    const result = await issue()

    expect(result.ok).toBe(false)
    if (result.ok || result.reason !== 'STEP_UP_REQUIRED') {
      throw new Error('expected STEP_UP_REQUIRED')
    }
    expect(result.pendingStepUpCookie).toContain('pap-step-up-token=')
    expect(result.pendingStepUpCookie).toContain('HttpOnly')
    expect(result.pendingStepUpCookie).toContain('Max-Age=600')
    expect(result.pendingStepUpCookie).not.toContain('sb-access-token=')

    const decrypted = decryptPendingStepUpCookie(
      cookieValue(result.pendingStepUpCookie, 'pap-step-up-token'),
    )
    expect(decrypted).toEqual({
      ok: true,
      payload: {
        accessToken: 'supabase-access-token',
        userId: USER_ID,
        phoneE164: PHONE,
        maxAge: 3600,
        sourceRoute: SOURCE_ROUTE,
        expiresAt: '2026-05-26T10:10:00.000Z',
      },
    })
    expect(mocks.db.otpChallenge.findFirst).not.toHaveBeenCalled()
  })

  it('marks the latest active matching challenge VERIFIED before issuing sb-access-token', async () => {
    mocks.db.otpChallenge.findFirst.mockResolvedValueOnce({
      id: 'otp_newest',
      phoneE164: PHONE,
      userId: USER_ID,
      status: 'SENT',
      expiresAt: new Date('2026-05-26T10:10:00.000Z'),
      createdAt: NOW,
    })

    const result = await issue()

    expect(result).toEqual({
      ok: true,
      setCookie: expect.stringContaining('sb-access-token=supabase-access-token'),
    })
    expect(result.ok && result.setCookie).toContain('HttpOnly')
    expect(mocks.db.otpChallenge.findFirst).toHaveBeenCalledWith({
      where: {
        phoneE164: PHONE,
        userId: USER_ID,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(mocks.db.otpChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'otp_newest',
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: NOW,
      },
    })
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.session_gate.challenge_verified',
        after: expect.objectContaining({
          challengeVerification: 'verified',
          sourceRoute: SOURCE_ROUTE,
          userIdPresent: true,
        }),
      }),
    )
  })

  it('allows session issuance when no challenge exists but account state is clear', async () => {
    const result = await issue({ userId: null })

    expect(result).toEqual({
      ok: true,
      setCookie: expect.stringContaining('sb-access-token=supabase-access-token'),
    })
    expect(mocks.db.otpChallenge.findFirst).toHaveBeenCalledWith({
      where: {
        phoneE164: PHONE,
        status: { in: ['REQUESTED', 'SENT'] },
        expiresAt: { gt: NOW },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(mocks.db.otpChallenge.updateMany).not.toHaveBeenCalled()
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.session_gate.challenge_not_found',
        after: expect.objectContaining({
          challengeVerification: 'not_found',
          sourceRoute: SOURCE_ROUTE,
          userIdPresent: false,
        }),
      }),
    )
  })

  it('fails closed when account state lookup throws', async () => {
    mocks.db.accountSecurityState.findUnique.mockRejectedValueOnce(new Error('db unavailable'))

    const result = await issue()

    expect(result).toEqual({
      ok: false,
      reason: 'LOCKED',
      metadata: { code: 'security_gate_unavailable' },
    })
    expect(mocks.db.otpChallenge.findFirst).not.toHaveBeenCalled()
    expect(mocks.db.otpChallenge.updateMany).not.toHaveBeenCalled()
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.session_gate.unavailable',
        after: expect.objectContaining({
          code: 'security_gate_unavailable',
          sourceRoute: SOURCE_ROUTE,
          userIdPresent: true,
        }),
      }),
    )
  })

  it('fails closed when account state lookup times out', async () => {
    mocks.db.accountSecurityState.findUnique.mockImplementationOnce(
      () => new Promise(() => undefined),
    )

    const result = issue()
    await vi.advanceTimersByTimeAsync(1501)

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'LOCKED',
      metadata: { code: 'security_gate_unavailable' },
    })
    expect(mocks.db.otpChallenge.findFirst).not.toHaveBeenCalled()
    expect(mocks.db.otpChallenge.updateMany).not.toHaveBeenCalled()
  })
})
