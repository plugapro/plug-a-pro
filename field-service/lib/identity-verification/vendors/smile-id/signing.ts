import { createHmac, timingSafeEqual } from 'crypto'

// Smile ID signing — legacy /v1/* convention.
// HMAC-SHA256 over: timestamp + partner_id + "sid_request", base64-encoded.
// One shared key (SMILE_ID_API_KEY) signs outbound requests AND verifies
// inbound webhooks; no separate webhook secret.
//
// Reference: smile-identity-core-js/src/signature.ts

const SIGNING_SUFFIX = 'sid_request'

function getCredentials(): { partnerId: string; apiKey: string } | null {
  const partnerId = process.env.SMILE_ID_PARTNER_ID
  const apiKey = process.env.SMILE_ID_API_KEY
  if (!partnerId || !apiKey) return null
  return { partnerId, apiKey }
}

export function computeSmileSignature(timestamp: string): string {
  const creds = getCredentials()
  if (!creds) {
    throw new Error('SMILE_ID_PARTNER_ID and SMILE_ID_API_KEY must be set')
  }
  const hmac = createHmac('sha256', creds.apiKey)
  hmac.update(timestamp, 'utf8')
  hmac.update(creds.partnerId, 'utf8')
  hmac.update(SIGNING_SUFFIX, 'utf8')
  return hmac.digest().toString('base64')
}

export function verifySmileSignature(timestamp: string, signature: string): boolean {
  if (!timestamp || !signature) return false
  const creds = getCredentials()
  if (!creds) return false
  let expected: string
  try {
    const hmac = createHmac('sha256', creds.apiKey)
    hmac.update(timestamp, 'utf8')
    hmac.update(creds.partnerId, 'utf8')
    hmac.update(SIGNING_SUFFIX, 'utf8')
    expected = hmac.digest().toString('base64')
  } catch {
    return false
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString()
}

const DEFAULT_MAX_AGE_SECONDS = 300  // 5 minutes

export function isTimestampFresh(timestamp: string, maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS): boolean {
  if (!timestamp) return false
  const t = Date.parse(timestamp)
  if (isNaN(t)) return false
  const ageMs = Date.now() - t
  if (ageMs < -60_000) return false  // future timestamps > 1 min skew → reject
  return ageMs <= maxAgeSeconds * 1000
}
