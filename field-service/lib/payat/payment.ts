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
  paymentLink: string
  // sourceReference and requestToPayId are returned by the merchant endpoint only.
  // The integrator endpoint (/integrator/rtp/create/single/…) does not include them.
  sourceReference?: string
  requestToPayId?: number
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
  // paymentLink is required on the integrator endpoint - the provider cannot pay without it.
  const rawLink = data.paymentLink ?? data.payment_link ?? data.url ?? data.checkoutUrl
  if (typeof rawLink !== 'string' || !rawLink) {
    throw new PayatApiError('rtp_response_invalid', undefined, 'Pay@ response missing paymentLink')
  }

  // sourceReference (retail till reference) and requestToPayId are merchant-endpoint-only fields.
  // The integrator endpoint may not include them - extract if present, otherwise omit.
  const sourceReferenceRaw = data.sourceReference ?? data.source_reference
  const sourceReference =
    typeof sourceReferenceRaw === 'string' && sourceReferenceRaw ? sourceReferenceRaw : undefined

  const requestToPayIdRaw = data.requestToPayId ?? data.request_to_pay_id
  const requestToPayId =
    typeof requestToPayIdRaw === 'number' && Number.isFinite(requestToPayIdRaw)
      ? requestToPayIdRaw
      : undefined

  return { reference: fallbackReference, paymentLink: rawLink, sourceReference, requestToPayId }
}

function maskPhone(phone: string): string {
  // +27821234567 → +27…4567   (last 4 visible)
  return phone.length > 4 ? `${phone.slice(0, 3)}…${phone.slice(-4)}` : '***'
}

function maskEmail(email: string): string {
  // user@example.com → …@example.com
  const at = email.indexOf('@')
  return at > 0 ? `…${email.slice(at)}` : '***'
}

function maskMerchantIdentifier(identifier: string): string {
  if (identifier.length <= 4) return '***'
  return `${identifier.slice(0, 2)}***${identifier.slice(-2)}`
}

async function readResponseBodySafely(response: Response): Promise<string> {
  const withText = response as Response & { text?: () => Promise<string> }
  if (typeof withText.text === 'function') {
    return withText.text().catch(() => '<unreadable>')
  }

  const withJson = response as Response & { json?: () => Promise<unknown> }
  if (typeof withJson.json === 'function') {
    try {
      const payload = await withJson.json()
      return JSON.stringify(payload)
    } catch {
      return '<unreadable>'
    }
  }

  return '<unreadable>'
}

async function sendPayatPaymentRequest(
  params: PayatPaymentRequest,
  retryOnUnauthorized: boolean,
): Promise<PayatPaymentResponse> {
  if (!params.providerPhone) {
    console.warn(JSON.stringify({
      event: 'payat.rtp_phone_missing',
      topupId: params.topupId,
      msg: 'providerPhone is empty - Pay@ will likely reject the RTP request',
    }))
  }

  const token = await getPayatToken()
  const apiBase = requirePayatConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantIdentifier = requirePayatConfig('PAYAT_MERCHANT_IDENTIFIER')
  const endpoint = `${apiBase}/integrator/rtp/create/single/${merchantIdentifier}`

  // TEMP DIAGNOSTIC (remove after config validation): confirms exact runtime target.
  console.warn(JSON.stringify({
    event: 'payat.runtime_target',
    topupId: params.topupId,
    endpoint,
    merchantIdentifierMasked: maskMerchantIdentifier(merchantIdentifier),
    retry: !retryOnUnauthorized,
  }))

  console.info(JSON.stringify({
    event: 'payat.rtp_request',
    topupId: params.topupId,
    amountCents: params.amountCents,
    description: params.description,
    phone: maskPhone(params.providerPhone),
    hasEmail: Boolean(params.providerEmail),
    email: params.providerEmail ? maskEmail(params.providerEmail) : null,
    merchantIdentifier,
    endpoint,
    retry: !retryOnUnauthorized,
  }))

  let response: Response
  try {
    response = await fetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientAccountNumber: generateClientAccountNumber(),
          // Pay@ YAPI integrator RTP expects amounts as integers in cents.
          amount: params.amountCents,
          minimumAmount: params.amountCents,
          maximumAmount: params.amountCents,
          description: params.description,
          clientReferenceNumber: params.topupId,
          merchantDisplayName: 'Plug A Pro',
          notificationNumber: params.providerPhone,
          customerNameSurname: params.providerName,
          customerMobileNumber: params.providerPhone,
          // Always include customerEmail (even empty string). The integrator endpoint
          // returns non-2xx when customerEmail is absent entirely.
          customerEmail: params.providerEmail,
          daysValid: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({
      event: 'payat.rtp_fetch_threw',
      topupId: params.topupId,
      errorName,
      errorMsg,
    }))
    throw new PayatApiError(
      'rtp_create_failed',
      undefined,
      `Pay@ RTP creation request failed before response (${errorName})`,
    )
  }

  const responseContentType =
    typeof (response as { headers?: { get?: (name: string) => string | null } }).headers?.get ===
      'function'
      ? response.headers.get('content-type')
      : null
  const responseBody = await readResponseBodySafely(response)
  const responseBodyPreview = responseBody.slice(0, 800)

  // TEMP DIAGNOSTIC (remove after production validation): capture the exact
  // HTTP outcome from Pay@ for each RTP create attempt.
  console.warn(JSON.stringify({
    event: 'payat.rtp_fetch_outcome',
    topupId: params.topupId,
    endpoint,
    httpStatus: response.status,
    ok: response.ok,
    contentType: responseContentType,
    bodyPreview: responseBodyPreview,
    retry: !retryOnUnauthorized,
  }))

  if (response.status === 401 && retryOnUnauthorized) {
    console.warn(JSON.stringify({
      event: 'payat.rtp_401_retrying',
      topupId: params.topupId,
    }))
    invalidatePayatToken()
    return sendPayatPaymentRequest(params, false)
  }

  if (!response.ok) {
    console.error(JSON.stringify({
      event: 'payat.rtp_create_failed',
      topupId: params.topupId,
      httpStatus: response.status,
      // Truncate to 500 chars - enough for the error code, not enough to expose large payloads.
      errorBody: responseBody.slice(0, 500),
    }))
    throw new PayatApiError('rtp_create_failed', response.status)
  }

  let responseData: Record<string, unknown>
  try {
    responseData = JSON.parse(responseBody) as Record<string, unknown>
  } catch {
    console.error(JSON.stringify({
      event: 'payat.rtp_response_parse_failed',
      topupId: params.topupId,
      httpStatus: response.status,
      bodyPreview: responseBodyPreview,
    }))
    throw new PayatApiError('rtp_response_invalid')
  }

  const result = mapPayatResponse(responseData, params.topupId)

  console.info(JSON.stringify({
    event: 'payat.rtp_response_ok',
    topupId: params.topupId,
    httpStatus: response.status,
    hasPaymentLink: Boolean(result.paymentLink),
    hasSourceReference: Boolean(result.sourceReference),
    hasRequestToPayId: typeof result.requestToPayId === 'number',
    // Log the response keys present so we can see exactly what Pay@ returned.
    responseKeys: Object.keys(responseData),
  }))

  return result
}

export async function createPayatPaymentRequest(
  params: PayatPaymentRequest,
): Promise<PayatPaymentResponse> {
  return sendPayatPaymentRequest(params, true)
}
