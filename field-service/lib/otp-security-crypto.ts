import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'
import { getOtpSecurityConfig } from './otp-security-config'

export const STEP_UP_COOKIE_NAME = 'pap-step-up-token'
export const STEP_UP_COOKIE_MAX_AGE_SECONDS = 600

const STEP_UP_COOKIE_HKDF_SALT = 'pap-step-up-token:v1'
const STEP_UP_COOKIE_HKDF_INFO = 'plug-a-pro/security-step-up'
const REPLAY_MARKER_KEYS = new Set([
  'consumedAt',
  'usedAt',
  'acknowledgedAt',
  'completedAt',
  'reportTokenUsedAt',
])

export type ReportTokenPayload = {
  challengeId: string
  expEpoch: number
}

export type PendingStepUpPayload = {
  accessToken: string
  userId: string | null
  phoneE164: string
  maxAge: number
  sourceRoute: string
  expiresAt: string
}

const PendingStepUpPayloadSchema = z
  .object({
    accessToken: z.string().min(1),
    userId: z.string().min(1).nullable(),
    phoneE164: z.string().regex(/^\+\d{7,15}$/),
    maxAge: z.number().int().positive(),
    sourceRoute: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict()

function otpPepper(): string {
  return getOtpSecurityConfig().otpHashPepper
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function normalizeOtpCode(code: string): string {
  return code.replace(/\s+/g, '')
}

function hmacHex(value: string): string {
  return createHmac('sha256', otpPepper()).update(value).digest('hex')
}

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  try {
    const expected = Buffer.from(expectedHex, 'hex')
    const received = Buffer.from(receivedHex, 'hex')
    return expected.length === received.length && timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function assertNoReplayMarkers(value: unknown): void {
  const payload = parseObject(value)
  for (const key of REPLAY_MARKER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error('replay marker payloads cannot be encrypted')
    }
  }
}

function decodeConfiguredStepUpKey(encoded: string): Buffer {
  for (const encoding of ['base64url', 'base64'] as const) {
    try {
      const decoded = Buffer.from(encoded, encoding)
      if (decoded.length === 32) return decoded
    } catch {
      // Try the next supported key encoding.
    }
  }

  throw new Error('STEP_UP_COOKIE_KEY must decode to 32 bytes')
}

function stepUpCookieKey(): Buffer {
  const { otpHashPepper, stepUpCookieKey } = getOtpSecurityConfig()

  if (stepUpCookieKey) {
    return decodeConfiguredStepUpKey(stepUpCookieKey)
  }

  return Buffer.from(
    hkdfSync(
      'sha256',
      otpHashPepper,
      STEP_UP_COOKIE_HKDF_SALT,
      STEP_UP_COOKIE_HKDF_INFO,
      32,
    ),
  )
}

export function hashOtpCode(code: string): string {
  return hmacHex(normalizeOtpCode(code))
}

export function hashContext(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null

  return createHash('sha256').update(otpPepper()).update(normalized).digest('hex')
}

export function mintReportToken(challengeId: string, expiresAt: Date): string {
  const expEpoch = Math.floor(expiresAt.getTime() / 1000)
  const payload = `${challengeId}.${expEpoch}`
  const signature = hmacHex(`${challengeId}|${expEpoch}`)

  return `${base64url(payload)}.${signature}`
}

export function verifyReportToken(
  token: string,
): { ok: true; payload: ReportTokenPayload } | { ok: false; reason: string } {
  const [encodedPayload, signature, extra] = token.split('.')
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, reason: 'malformed' }
  }

  let decoded: string
  try {
    decoded = decodeBase64url(encodedPayload).toString('utf8')
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const separatorIndex = decoded.lastIndexOf('.')
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    return { ok: false, reason: 'malformed' }
  }

  const challengeId = decoded.slice(0, separatorIndex)
  const expEpoch = Number.parseInt(decoded.slice(separatorIndex + 1), 10)
  if (!challengeId || !Number.isFinite(expEpoch)) {
    return { ok: false, reason: 'malformed' }
  }

  const expectedSignature = hmacHex(`${challengeId}|${expEpoch}`)
  if (!timingSafeHexEqual(expectedSignature, signature)) {
    return { ok: false, reason: 'tampered' }
  }

  if (expEpoch <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, payload: { challengeId, expEpoch } }
}

export function hashReportToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function encryptPendingStepUpCookie(payload: PendingStepUpPayload): string {
  assertNoReplayMarkers(payload)

  const parsed = PendingStepUpPayloadSchema.parse(payload)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', stepUpCookieKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `${base64url(iv)}.${base64url(ciphertext)}.${base64url(authTag)}`
}

export function decryptPendingStepUpCookie(
  token: string,
): { ok: true; payload: PendingStepUpPayload } | { ok: false; reason: string } {
  const [encodedIv, encodedCiphertext, encodedAuthTag, extra] = token.split('.')
  if (!encodedIv || !encodedCiphertext || !encodedAuthTag || extra !== undefined) {
    return { ok: false, reason: 'malformed' }
  }

  try {
    const iv = decodeBase64url(encodedIv)
    const ciphertext = decodeBase64url(encodedCiphertext)
    const authTag = decodeBase64url(encodedAuthTag)
    if (iv.length !== 12 || authTag.length !== 16) {
      return { ok: false, reason: 'malformed' }
    }

    const decipher = createDecipheriv('aes-256-gcm', stepUpCookieKey(), iv)
    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const decoded = JSON.parse(plaintext.toString('utf8')) as unknown

    assertNoReplayMarkers(decoded)
    const payload = PendingStepUpPayloadSchema.parse(decoded)
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      return { ok: false, reason: 'expired' }
    }

    return { ok: true, payload }
  } catch (error) {
    if (error instanceof Error && /replay marker/i.test(error.message)) {
      return { ok: false, reason: 'replayed' }
    }

    return { ok: false, reason: 'invalid' }
  }
}

export function buildPendingStepUpCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${STEP_UP_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STEP_UP_COOKIE_MAX_AGE_SECONDS}${secure}`
}

export function clearPendingStepUpCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${STEP_UP_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
}
