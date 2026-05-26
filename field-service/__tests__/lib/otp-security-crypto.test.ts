import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPendingStepUpCookieHeader,
  clearPendingStepUpCookieHeader,
  decryptPendingStepUpCookie,
  encryptPendingStepUpCookie,
  hashContext,
  hashOtpCode,
  hashReportToken,
  mintReportToken,
  verifyReportToken,
  type PendingStepUpPayload,
} from '@/lib/otp-security-crypto'
import { getOtpSecurityConfig } from '@/lib/otp-security-config'
import {
  sanitizeChallengeContext,
  sanitizeSecurityEventMetadata,
} from '@/lib/otp-security-metadata'

const ORIGINAL_ENV = { ...process.env }

function fixedStepUpKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64url')
}

function alterEncodedByte(value: string): string {
  return `${value.startsWith('A') ? 'B' : 'A'}${value.slice(1)}`
}

function basePayload(overrides: Partial<PendingStepUpPayload> = {}): PendingStepUpPayload {
  return {
    accessToken: 'supabase-session-token',
    userId: 'user_123',
    phoneE164: '+27821234567',
    maxAge: 3600,
    sourceRoute: '/api/auth/session',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

describe('otp security config and crypto helpers', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      OTP_HASH_PEPPER: 'test-pepper-for-otp-security',
      STEP_UP_COOKIE_KEY: fixedStepUpKey(1),
    }
  })

  it('uses configured integer values with fallbacks and requires pepper in production', () => {
    process.env.OTP_EXPIRY_MINUTES = '17'
    process.env.OTP_MAX_VERIFY_ATTEMPTS = '0'
    process.env.OTP_LOCK_MINUTES_AFTER_UNREQUESTED_REPORT = 'not-a-number'
    process.env.SECURITY_EVENTS_ADMIN_ALERT_THRESHOLD = '4'

    expect(getOtpSecurityConfig()).toMatchObject({
      otpExpiryMinutes: 17,
      maxVerifyAttempts: 5,
      lockMinutesAfterReport: 60,
      adminAlertThreshold: 4,
      otpHashPepper: 'test-pepper-for-otp-security',
    })

    vi.stubEnv('OTP_HASH_PEPPER', '')
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => getOtpSecurityConfig()).toThrow(
      'OTP_HASH_PEPPER is required for OTP security in production',
    )
  })

  it('hashes normalized OTP codes without returning the raw code', async () => {
    const compact = hashOtpCode('123456')
    const spaced = hashOtpCode(' 123 456 ')

    expect(compact).toMatch(/^[a-f0-9]{64}$/)
    expect(spaced).toBe(compact)
    expect(compact).not.toContain('123456')
    expect(hashContext('198.51.100.10')).toMatch(/^[a-f0-9]{64}$/)
    expect(hashContext(null)).toBeNull()
  })

  it('signs and verifies report tokens with challenge id and expiry', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const token = mintReportToken('challenge_123', expiresAt)
    const verified = verifyReportToken(token)

    expect(token).not.toContain('27821234567')
    expect(verified).toEqual({
      ok: true,
      payload: {
        challengeId: 'challenge_123',
        expEpoch: Math.floor(expiresAt.getTime() / 1000),
      },
    })
    expect(hashReportToken(token)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects tampered and expired report tokens', async () => {
    const validToken = mintReportToken('challenge_123', new Date(Date.now() + 10 * 60 * 1000))
    const parts = validToken.split('.')
    const tamperedPayload = `${alterEncodedByte(parts[0])}.${parts[1]}`
    const expiredToken = mintReportToken('challenge_123', new Date(Date.now() - 1000))

    expect(verifyReportToken(tamperedPayload)).toMatchObject({ ok: false })
    expect(verifyReportToken(expiredToken)).toEqual({ ok: false, reason: 'expired' })
  })

  it('encrypts and decrypts pap-step-up-token payloads', async () => {
    const payload = basePayload()
    const token = encryptPendingStepUpCookie(payload)
    const decrypted = decryptPendingStepUpCookie(token)

    expect(token.split('.')).toHaveLength(3)
    expect(decrypted).toEqual({ ok: true, payload })

    const header = buildPendingStepUpCookieHeader(token)
    expect(header).toContain(`pap-step-up-token=${token}`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=600')
    expect(header).not.toContain('Secure')

    vi.stubEnv('NODE_ENV', 'production')
    expect(buildPendingStepUpCookieHeader(token)).toContain('Secure')
    expect(clearPendingStepUpCookieHeader()).toContain('Max-Age=0')
  })

  it('rejects wrong key, tampered ciphertext, tampered auth tag, expired payload, and replay marker inputs', async () => {
    const token = encryptPendingStepUpCookie(basePayload())
    const [iv, ciphertext, authTag] = token.split('.')

    process.env.STEP_UP_COOKIE_KEY = fixedStepUpKey(2)
    expect(decryptPendingStepUpCookie(token)).toMatchObject({ ok: false })

    process.env.STEP_UP_COOKIE_KEY = fixedStepUpKey(1)
    expect(decryptPendingStepUpCookie(`${iv}.${alterEncodedByte(ciphertext)}.${authTag}`)).toMatchObject({
      ok: false,
    })
    expect(decryptPendingStepUpCookie(`${iv}.${ciphertext}.${alterEncodedByte(authTag)}`)).toMatchObject({
      ok: false,
    })

    const expired = encryptPendingStepUpCookie(
      basePayload({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    )
    expect(decryptPendingStepUpCookie(expired)).toEqual({ ok: false, reason: 'expired' })

    expect(() =>
      encryptPendingStepUpCookie({
        ...basePayload(),
        consumedAt: new Date().toISOString(),
      } as PendingStepUpPayload & { consumedAt: string }),
    ).toThrow(/replay/i)
  })

  it('strips unknown metadata fields and rejects raw PII/token-shaped values', async () => {
    expect(
      sanitizeChallengeContext({
        traceId: 'trace-123',
        source: 'send_sms_hook',
        ignored: 'strip-me',
      }),
    ).toEqual({ traceId: 'trace-123', source: 'send_sms_hook' })

    expect(
      sanitizeSecurityEventMetadata({
        traceId: 'trace-123',
        reason: 'lock window exceeded',
        count: 2,
        userIdPresent: true,
        providerResponseBody: { token: 'raw-provider-response' },
      }),
    ).toEqual({
      traceId: 'trace-123',
      reason: 'lock window exceeded',
      count: 2,
      userIdPresent: true,
    })

    for (const rawValue of [
      'Your OTP is 123456',
      'person@example.com',
      '+27821234567',
      'Bearer abc.def.ghi',
      'access_token=secret',
    ]) {
      expect(() => sanitizeChallengeContext({ traceId: rawValue })).toThrow(
        /disallowed raw value/,
      )
    }
  })
})
