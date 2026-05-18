import { createHmac, timingSafeEqual } from 'crypto'

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

export type VerifyStandardWebhookSignatureResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'SECRET_NOT_CONFIGURED'
        | 'MISSING_HEADERS'
        | 'BAD_SECRET_FORMAT'
        | 'STALE_TIMESTAMP'
        | 'SIGNATURE_MISMATCH'
    }

export function verifyStandardWebhookSignature(params: {
  body: string
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  nowSeconds?: number
}): VerifyStandardWebhookSignatureResult {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET
  if (!secret) return { ok: false, reason: 'SECRET_NOT_CONFIGURED' }

  if (!params.id || !params.timestamp || !params.signatureHeader) {
    return { ok: false, reason: 'MISSING_HEADERS' }
  }

  const rawSecret = parseHookSecret(secret)
  if (!rawSecret) return { ok: false, reason: 'BAD_SECRET_FORMAT' }

  const tsSeconds = Number.parseInt(params.timestamp, 10)
  if (!Number.isFinite(tsSeconds)) {
    return { ok: false, reason: 'STALE_TIMESTAMP' }
  }
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'STALE_TIMESTAMP' }
  }

  const signedPayload = `${params.id}.${params.timestamp}.${params.body}`
  const expected = createHmac('sha256', rawSecret).update(signedPayload).digest('base64')

  for (const candidate of params.signatureHeader.split(' ')) {
    const trimmed = candidate.trim()
    if (!trimmed.startsWith('v1,')) continue
    const provided = trimmed.slice(3)
    const bufA = Buffer.from(expected)
    const bufB = Buffer.from(provided)
    if (bufA.length !== bufB.length) {
      // Lengths differ — fail but avoid early exit to prevent timing oracle
      timingSafeEqual(bufA, Buffer.alloc(bufA.length))
      continue
    }
    if (timingSafeEqual(bufA, bufB)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'SIGNATURE_MISMATCH' }
}

function parseHookSecret(env: string): Buffer | null {
  // Standard Webhooks format: "v1,whsec_<base64>"
  const trimmed = env.trim()
  const marker = 'v1,whsec_'
  if (!trimmed.startsWith(marker)) return null
  const b64 = trimmed.slice(marker.length)
  if (!b64) return null
  try {
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}
