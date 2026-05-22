import { randomBytes } from 'crypto'
import { getPayatToken, invalidatePayatToken } from './token'

export const PAYAT_ALLOWED_AMOUNTS_CENTS = new Set([10_000, 20_000, 50_000])

export type PayatPaymentRequest = {
  topupId: string
  amountCents: number
  description: string
  providerName: string
  providerPhone: string
  providerEmail: string
}

export type PayatPaymentResponse = {
  reference: string
  sourceReference: string
  requestToPayId: number
  paymentLink?: string
}

export class PayatConfigError extends Error {
  constructor(envVarName: string) {
    super(`${envVarName} must be set`)
    this.name = 'PayatConfigError'
  }
}

/**
 * Thrown when the Pay@ RTP endpoint rejects a request or returns a response
 * we cannot parse. The `stage` discriminator lets the action layer give the
 * provider a specific user-facing message without depending on the textual
 * error content (which Pay@ may reword without notice).
 */
export class PayatApiError extends Error {
  constructor(
    public readonly stage: 'rtp_create_failed' | 'rtp_response_invalid',
    public readonly status?: number,
    detail?: string,
  ) {
    super(
      detail ??
        (stage === 'rtp_create_failed'
          ? `Pay@ RTP creation failed: HTTP ${status ?? '?'}`
          : 'Pay@ RTP response did not include sourceReference'),
    )
    this.name = 'PayatApiError'
  }
}

function requirePayatConfig(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new PayatConfigError(name)
  return value
}

function generateClientAccountNumber() {
  // Pay@ requires a unique 14-digit numeric string per RTP.
  // Use crypto random bytes to avoid timestamp collisions under concurrent requests.
  const hex = randomBytes(7).toString('hex')
  const num = BigInt('0x' + hex) % BigInt('100000000000000')
  return num.toString().padStart(14, '0')
}

function mapPayatResponse(
  data: Record<string, unknown>,
  fallbackReference: string,
): PayatPaymentResponse {
  // sourceReference is the retail till reference — required by the merchant endpoint.
  const sourceReference = data.sourceReference ?? data.source_reference
  if (typeof sourceReference !== 'string' || !sourceReference) {
    throw new PayatApiError('rtp_response_invalid')
  }

  // requestToPayId is Pay@'s internal integer RTP identifier.
  const requestToPayId = data.requestToPayId ?? data.request_to_pay_id
  if (typeof requestToPayId !== 'number' || !Number.isFinite(requestToPayId)) {
    throw new PayatApiError('rtp_response_invalid')
  }

  // paymentLink is optional on the merchant endpoint (no redirect checkout).
  const rawLink = data.paymentLink ?? data.payment_link ?? data.url ?? data.checkoutUrl
  const paymentLink = typeof rawLink === 'string' && rawLink ? rawLink : undefined

  return { reference: fallbackReference, sourceReference, requestToPayId, paymentLink }
}

async function sendPayatPaymentRequest(
  params: PayatPaymentRequest,
  retryOnUnauthorized: boolean,
): Promise<PayatPaymentResponse> {
  // Pay@ validates notificationNumber and customerMobileNumber as required fields.
  if (!params.providerPhone) {
    console.warn('[payat-payment] providerPhone is empty — Pay@ will likely reject the RTP request', {
      topupId: params.topupId,
    })
  }

  const token = await getPayatToken()
  const apiBase = requirePayatConfig('PAYAT_API_BASE').replace(/\/$/, '')

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/merchant/rtp/create/single`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientAccountNumber: generateClientAccountNumber(),
          // Pay@ YAPI merchant RTP expects amounts as integers in cents.
          amount: params.amountCents,
          minimumAmount: params.amountCents,
          maximumAmount: params.amountCents,
          description: params.description,
          clientReferenceNumber: params.topupId,
          merchantDisplayName: 'Plug A Pro',
          notificationNumber: params.providerPhone,
          customerNameSurname: params.providerName,
          customerMobileNumber: params.providerPhone,
          customerEmail: params.providerEmail,
          daysValid: 3,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    throw new PayatApiError(
      'rtp_create_failed',
      undefined,
      `Pay@ RTP creation request failed before response (${errorName})`,
    )
  }

  if (response.status === 401 && retryOnUnauthorized) {
    invalidatePayatToken()
    return sendPayatPaymentRequest(params, false)
  }

  if (!response.ok) {
    // Never log the response body — it may contain the provider phone or payment reference.
    if (process.env.NODE_ENV !== 'production') {
      const body = await response.text()
      console.debug('[payat-payment] RTP creation failed body (dev only)', body)
    } else {
      await response.body?.cancel()
    }
    throw new PayatApiError('rtp_create_failed', response.status)
  }

  let responseData: Record<string, unknown>
  try {
    responseData = (await response.json()) as Record<string, unknown>
  } catch {
    throw new PayatApiError('rtp_response_invalid')
  }

  return mapPayatResponse(responseData, params.topupId)
}

export async function createPayatPaymentRequest(
  params: PayatPaymentRequest,
): Promise<PayatPaymentResponse> {
  return sendPayatPaymentRequest(params, true)
}
