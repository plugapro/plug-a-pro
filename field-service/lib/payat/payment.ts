import { getPayatToken, invalidatePayatToken } from './token'

export const PAYAT_ALLOWED_AMOUNTS_CENTS = new Set([10_000, 20_000, 50_000])

export type PayatPaymentRequest = {
  topupId: string
  amountCents: number
  description: string
}

export type PayatPaymentResponse = {
  reference: string
  qrCodeUrl: string
  paymentLink: string
}

function requirePayatConfig(name: string) {
  // Fail before creating a gateway request if required Pay@ config is absent.
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be set`)
  return value
}

function getNotifyUrl() {
  // Pay@ calls this route after retail cash, QR, or hosted-page payments settle.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL must be set')
  return `${appUrl.replace(/\/$/, '')}/api/payat/webhook`
}

function mapPayatResponse(data: Record<string, unknown>, fallbackReference: string): PayatPaymentResponse {
  // Pay@ field names are normalized here so route/UI code stays stable.
  const qrCodeUrl = data.qrCodeUrl ?? data.qr_code_url ?? data.qrUrl ?? data.qr_url
  const paymentLink = data.paymentLink ?? data.payment_link ?? data.url ?? data.checkoutUrl

  if (typeof qrCodeUrl !== 'string' || typeof paymentLink !== 'string') {
    throw new Error('Pay@ payment response did not include QR code and payment link URLs')
  }

  return {
    reference: fallbackReference,
    qrCodeUrl,
    paymentLink,
  }
}

async function sendPayatPaymentRequest(
  params: PayatPaymentRequest,
  retryOnUnauthorized: boolean,
): Promise<PayatPaymentResponse> {
  // Validate product packages before calling the gateway.
  if (!PAYAT_ALLOWED_AMOUNTS_CENTS.has(params.amountCents)) {
    throw new Error(`Invalid top-up amount: ${params.amountCents} cents`)
  }

  const token = await getPayatToken()
  const apiBase = requirePayatConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantId = requirePayatConfig('PAYAT_MERCHANT_ID')

  const response = await fetch(`${apiBase}/payment-request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      merchantId,
      amount: params.amountCents,
      reference: params.topupId,
      description: params.description,
      notifyUrl: getNotifyUrl(),
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 401 && retryOnUnauthorized) {
    // Pay@ tokens can be revoked server-side; refresh once then surface errors.
    invalidatePayatToken()
    return sendPayatPaymentRequest(params, false)
  }

  if (!response.ok) {
    throw new Error(`Pay@ payment request failed: ${response.status} ${await response.text()}`)
  }

  return mapPayatResponse(await response.json() as Record<string, unknown>, params.topupId)
}

export async function createPayatPaymentRequest(
  params: PayatPaymentRequest,
): Promise<PayatPaymentResponse> {
  // A small wrapper keeps retry state private to this module.
  return sendPayatPaymentRequest(params, true)
}
