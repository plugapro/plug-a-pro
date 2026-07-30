import { getPayatToken, invalidatePayatToken } from './token'
import { PayatApiError, PayatConfigError } from './payment'
import {
  mapPayAtGoAccountStateToInternalStatus,
  type InternalPayAtGoStatus,
} from '@/lib/payat-go/status'

export type PayatRtpState = {
  clientAccountNumber: string
  accountState: string
  internalStatus: InternalPayAtGoStatus
  amountCents: number | null
  amountPaidCents: number | null
  paidAt: Date | null
  expiresAt: Date | null
}

function requireConfig(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new PayatConfigError(name)
  return value
}

function parseOptionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return null
}

function parseSafeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Read the authoritative state of a single RTP from Pay@.
 *
 * This is the source of truth for whether money arrived — for BOTH settlement
 * channels. A card payment and a till payment resolve the same RTP object; only
 * the timing differs. Requires the `rtp:read` scope on PAYAT_CLIENT_ID.
 */
export async function readPayatSingleRtp(
  clientAccountNumber: string,
  retryOnUnauthorized = true,
): Promise<PayatRtpState> {
  // The lookup key is interpolated straight into the URL path and now comes
  // from the DB rather than the generator, so validate it exactly as the
  // sibling client does (lib/payat-go/client.ts). Throwing here is the safe
  // direction: the sweep treats a throw as "unknown" and defers.
  if (!/^\d{1,14}$/.test(clientAccountNumber)) {
    throw new PayatApiError(
      'rtp_read_failed',
      undefined,
      'Pay@ clientAccountNumber must be 1-14 numeric digits',
    )
  }

  const token = await getPayatToken()
  const apiBase = requireConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantIdentifier = requireConfig('PAYAT_MERCHANT_IDENTIFIER')

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/integrator/rtp/read/${merchantIdentifier}/${clientAccountNumber}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    throw new PayatApiError('rtp_read_failed', undefined, `Pay@ RTP read failed before response (${errorName})`)
  }

  if (response.status === 401 && retryOnUnauthorized) {
    // Mirror the create path (lib/payat/payment.ts): a revoked or rotated token
    // otherwise makes every read fail for the rest of the cache lifetime, which
    // during the sweep means every intent defers until the 7-day bound. Drop
    // the cached token and retry once. Log the event name only - never the
    // response body, the merchant identifier, or the lookup key.
    console.warn(JSON.stringify({ event: 'payat.rtp_read_401_retrying' }))
    await response.body?.cancel().catch(() => {})
    invalidatePayatToken()
    return readPayatSingleRtp(clientAccountNumber, false)
  }

  const rawBody = await response.text().catch(() => '')

  if (!response.ok) {
    // Never echo the body in production — it can contain provider PII.
    throw new PayatApiError('rtp_read_failed', response.status, `Pay@ RTP read failed with HTTP ${response.status}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new PayatApiError('rtp_read_failed', response.status, 'Pay@ RTP read returned unparseable JSON')
  }

  const accountState = typeof parsed.accountState === 'string' ? parsed.accountState : 'UNKNOWN'

  return {
    clientAccountNumber,
    accountState,
    internalStatus: mapPayAtGoAccountStateToInternalStatus(accountState),
    amountCents: parseOptionalInt(parsed.amount),
    amountPaidCents: parseOptionalInt(parsed.amountPaid),
    paidAt: parseSafeDate(parsed.dateTimePaid),
    expiresAt: parseSafeDate(parsed.dateTimeExpire),
  }
}
