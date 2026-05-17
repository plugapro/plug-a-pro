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

function requirePayatConfig(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be set`)
  return value
}

function getReturnUrls() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL must be set')
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

async function ensureMerchantIdentifier(token: string, apiBase: string) {
  if (merchantRegisteredAt && Date.now() - merchantRegisteredAt < MERCHANT_REGISTERED_TTL_MS) {
    return
  }

  const merchantId = requirePayatConfig('PAYAT_MERCHANT_ID')
  const merchantIdentifier = requirePayatConfig('PAYAT_MERCHANT_IDENTIFIER')

  // generatecredentials is idempotent (409 = already registered).
  const res = await fetch(`${apiBase}/integrator/ecommerce/generatecredentials`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ merchantIdentifier, merchantId }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok && res.status !== 409) {
    console.warn(`[payat] generatecredentials returned ${res.status} — proceeding anyway`)
  }

  merchantRegisteredAt = Date.now()
}

function mapPayatResponse(
  data: Record<string, unknown>,
  fallbackReference: string,
): PayatPaymentResponse {
  const paymentLink =
    data.paymentLink ?? data.payment_link ?? data.url ?? data.checkoutUrl

  if (typeof paymentLink !== 'string') {
    throw new Error('Pay@ RTP response did not include paymentLink')
  }

  return { reference: fallbackReference, paymentLink }
}

async function sendPayatPaymentRequest(
  params: PayatPaymentRequest,
  retryOnUnauthorized: boolean,
): Promise<PayatPaymentResponse> {
  if (!PAYAT_ALLOWED_AMOUNTS_CENTS.has(params.amountCents)) {
    throw new Error(`Invalid top-up amount: ${params.amountCents} cents`)
  }

  const token = await getPayatToken()
  const apiBase = requirePayatConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantIdentifier = requirePayatConfig('PAYAT_MERCHANT_IDENTIFIER')

  await ensureMerchantIdentifier(token, apiBase)

  const { successReturnUrl, failureReturnUrl, cancelReturnUrl } = getReturnUrls()

  const response = await fetch(
    `${apiBase}/integrator/ecommerce/rtp/create/single/${merchantIdentifier}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientAccountNumber: generateClientAccountNumber(),
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
    throw new Error(`Pay@ RTP creation failed: HTTP ${response.status}`)
  }

  return mapPayatResponse(
    (await response.json()) as Record<string, unknown>,
    params.topupId,
  )
}

export async function createPayatPaymentRequest(
  params: PayatPaymentRequest,
): Promise<PayatPaymentResponse> {
  return sendPayatPaymentRequest(params, true)
}
