// ─── Job completion confirmation tokens ──────────────────────────────────────
// HMAC-SHA256 signed tokens (no DB storage) that let a customer confirm job
// completion via a WhatsApp link — no login required.
//
// Token format:  base64url(payload).base64url(hmac)
// Payload:       { v: 1, jobId, customerId, exp }
// TTL:           48 hours (shorter than the 72h provider lead token)

import { createHmac, timingSafeEqual } from 'crypto'
import { getPublicAppUrl } from './provider-credit-copy'

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000

type CompletionTokenPayload = {
  v: 1
  jobId: string
  customerId: string
  exp: number
}

function getSigningSecret() {
  const secret =
    process.env.COMPLETION_TOKEN_SECRET ||
    process.env.PROVIDER_LEAD_ACCESS_SECRET

  if (!secret) {
    throw new Error('COMPLETION_TOKEN_SECRET must be set')
  }

  return secret
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url')
}

export function createJobCompletionToken(params: {
  jobId: string
  customerId: string
  expiresAt?: Date
}) {
  const exp = Math.floor(
    (params.expiresAt?.getTime() ?? Date.now() + TOKEN_TTL_MS) / 1000,
  )
  const payload: CompletionTokenPayload = {
    v: 1,
    jobId: params.jobId,
    customerId: params.customerId,
    exp,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

export function verifyJobCompletionToken(token: string):
  | { status: 'active'; payload: CompletionTokenPayload }
  | { status: 'expired'; payload: CompletionTokenPayload }
  | { status: 'invalid'; payload: null } {
  const [encoded, sig] = token.split('.')
  if (!encoded || !sig) return { status: 'invalid', payload: null }

  const expected = signPayload(encoded)
  const actualBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { status: 'invalid', payload: null }
  }

  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<CompletionTokenPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.customerId !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return { status: 'invalid', payload: null }
    }

    const payload = parsed as CompletionTokenPayload
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return { status: 'expired', payload }
    }

    return { status: 'active', payload }
  } catch {
    return { status: 'invalid', payload: null }
  }
}

export function getJobCompletionUrl(params: {
  jobId: string
  customerId: string
}): string | null {
  const appUrl = getPublicAppUrl()
  if (!appUrl) return null
  const token = createJobCompletionToken(params)
  return `${appUrl}/confirm-completion/${encodeURIComponent(token)}`
}
