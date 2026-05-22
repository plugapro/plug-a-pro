// Pure crypto helpers for WhatsApp webhook verification.
// No DB, no HTTP — safe for vi.importActual() in tests.
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify the Meta HMAC-SHA256 payload signature.
 * Returns false when:
 *  - WHATSAPP_APP_SECRET is not set
 *  - The header is missing or malformed
 *  - The computed HMAC does not match
 */
export function verifyMetaSignature(rawBody: string, signature: string): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim()
  if (!appSecret) {
    console.error('[whatsapp] WHATSAPP_APP_SECRET not configured — rejecting webhook')
    return false
  }

  const received = signature.startsWith('sha256=') ? signature.slice(7) : ''
  if (!received) return false

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}

/** Verify the hub.verify_token during webhook setup */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && token && verifyToken) {
    const bufA = Buffer.from(token)
    const bufB = Buffer.from(verifyToken)
    if (bufA.length !== bufB.length) {
      // Lengths differ — fail but avoid early exit to prevent timing oracle
      timingSafeEqual(bufA, Buffer.alloc(bufA.length))
      return null
    }
    if (timingSafeEqual(bufA, bufB)) return challenge
  }
  return null
}
