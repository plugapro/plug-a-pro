import { getPayatToken } from './token'
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
export async function readPayatSingleRtp(clientAccountNumber: string): Promise<PayatRtpState> {
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
