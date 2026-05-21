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
          : 'Pay@ RTP response did not include paymentLink'),
    )
    this.name = 'PayatApiError'
  }
}

function requirePayatConfig(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new PayatConfigError(name)
  return value
}

function resolveMerchantIdentifier() {
  const explicitIdentifier = process.env.PAYAT_MERCHANT_IDENTIFIER?.trim()
  if (explicitIdentifier) return explicitIdentifier
  // Backward-compatible fallback for environments that only configured
  // PAYAT_MERCHANT_ID. Keeps checkout creation working while still allowing
  // a dedicated identifier when provided.
  return requirePayatConfig('PAYAT_MERCHANT_ID')
}

function getReturnUrls() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl) throw new PayatConfigError('NEXT_PUBLIC_APP_URL')
  const base = appUrl.replace(/\/$/, '')
  return {
    successReturnUrl: `${base}/provider/credits?topup=success`,
    failureReturnUrl: `${base}/provider/credits?topup=failed`,
    cancelReturnUrl: `${base}/provider/credits?topup=cancelled`,
  }
}

function generateClientAccountNumber() {
  // Pay@ requires a unique 14-digit numeric string per RTP.
  // Use crypto random bytes to avoid timestamp collisions under concurrent requests.
  const hex = randomBytes(7).toString('hex')
  const num = BigInt('0x' + hex) % BigInt('100000000000000')
  return num.toString().padStart(14, '0')
}

// Cache the merchant registration result per instance to avoid a serial
// HTTP round-trip before every RTP creation. Cold starts pay once; warm
// instances skip the call entirely.
let merchantRegisteredAt: number | null = null
const MERCHANT_REGISTERED_TTL_MS = 60 * 60 * 1000 // 1 hour

// In-flight coalescing — parallel cold-start requests share one registration
// call instead of each independently calling generatecredentials.
let merchantRegistrationInflight: Promise<void> | null = null

async function doRegisterMerchant(token: string, apiBase: string): Promise<void> {
  const merchantId = requirePayatConfig('PAYAT_MERCHANT_ID')
  const merchantIdentifier = resolveMerchantIdentifier()

  // generatecredentials is idempotent (409 = already registered).
  let res: Response
  try {
    res = await fetch(`${apiBase}/integrator/ecommerce/generatecredentials`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ merchantIdentifier, merchantId }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    throw new PayatApiError(
      'rtp_create_failed',
      undefined,
      `Pay@ merchant registration request failed before response (${errorName})`,
    )
  }

  if (!res.ok && res.status !== 409) {
    console.warn(`[payat] generatecredentials returned ${res.status} — proceeding anyway`)
  }

  merchantRegisteredAt = Date.now()
}

async function ensureMerchantIdentifier(token: string, apiBase: string) {
  if (merchantRegisteredAt && Date.now() - merchantRegisteredAt < MERCHANT_REGISTERED_TTL_MS) {
    return
  }

  if (merchantRegistrationInflight) return merchantRegistrationInflight

  merchantRegistrationInflight = doRegisterMerchant(token, apiBase).finally(() => {
    merchantRegistrationInflight = null
  })

  return merchantRegistrationInflight
}

function mapPayatResponse(
  data: Record<string, unknown>,
  fallbackReference: string,
): PayatPaymentResponse {
  const paymentLink =
    data.paymentLink ?? data.payment_link ?? data.url ?? data.checkoutUrl

  if (typeof paymentLink !== 'string') {
    throw new PayatApiError('rtp_response_invalid')
  }

  return { reference: fallbackReference, paymentLink }
}

async function sendPayatPaymentRequest(
  params: PayatPaymentRequest,
  retryOnUnauthorized: boolean,
): Promise<PayatPaymentResponse> {
  // Amount validation lives in the intent layer (createPayatTopUpIntent) which
  // validates the credit amount before adding any service fee. The payment layer
  // must not re-validate because the final amount includes the fee.

  // Pay@ validates notificationNumber and customerMobileNumber as required fields.
  // An empty phone bypasses the intent-layer guard only in direct API callers that
  // skip createPayatTopUpIntent. Log a warning so production logs surface this
  // before the gateway rejects the request.
  if (!params.providerPhone) {
    console.warn('[payat-payment] providerPhone is empty — Pay@ will likely reject the RTP request', {
      topupId: params.topupId,
    })
  }

  const token = await getPayatToken()
  const apiBase = requirePayatConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantIdentifier = resolveMerchantIdentifier()

  await ensureMerchantIdentifier(token, apiBase)

  const { successReturnUrl, failureReturnUrl, cancelReturnUrl } = getReturnUrls()

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/integrator/ecommerce/rtp/create/single/${merchantIdentifier}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientAccountNumber: generateClientAccountNumber(),
          // Pay@ YAPI RTP create expects amounts in CENTS (confirmed via sandbox
          // test receipts). The webhook normalisePayload converts differently
          // because ITN amounts vary by gateway variant — do not align these.
          amount: String(params.amountCents),
          minimumAmount: String(params.amountCents),
          maximumAmount: String(params.amountCents),
          description: params.description,
          clientReferenceNumber: params.topupId,
          merchantDisplayName: 'Plug A Pro',
          notificationNumber: params.providerPhone,
          customerNameSurname: params.providerName,
          customerMobileNumber: params.providerPhone,
          customerEmail: params.providerEmail,
          daysValid: '3',
          merchantEcommerceStoreName: 'PLUGAPRO',
          successReturnUrl,
          failureReturnUrl,
          cancelReturnUrl,
          lineItems: [{ description: params.description, amount: String(params.amountCents) }],
          multiPremium: 1,
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
