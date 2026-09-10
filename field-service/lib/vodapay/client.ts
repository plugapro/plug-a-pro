import 'server-only'
import { buildSignaturePayload, parseSignatureHeader, signRequest, verifySignature } from './signing'

export class VodapayApiError extends Error {
  constructor(public resultCode: string, message?: string) {
    super(message ?? `VodaPay API error: ${resultCode}`)
  }
}

type Deps = { fetchImpl?: typeof fetch; now?: () => Date }

export function getVodapayConfig() {
  const names = ['VODAPAY_CLIENT_ID', 'VODAPAY_MERCHANT_ID', 'VODAPAY_API_BASE',
    'VODAPAY_PRIVATE_KEY', 'VODAPAY_PLATFORM_PUBLIC_KEY'] as const
  const missing = names.filter((n) => !process.env[n]?.trim())
  if (missing.length) throw new Error(`VodaPay env missing: ${missing.join(', ')}`)
  return {
    clientId: process.env.VODAPAY_CLIENT_ID!.trim(),
    merchantId: process.env.VODAPAY_MERCHANT_ID!.trim(),
    apiBase: process.env.VODAPAY_API_BASE!.trim().replace(/\/$/, ''),
    privateKey: process.env.VODAPAY_PRIVATE_KEY!,
    platformPublicKey: process.env.VODAPAY_PLATFORM_PUBLIC_KEY!,
  }
}

/**
 * Response signatures are verified by default. TLS alone authenticates the host,
 * not the payload — an intercepted or spoofed applyToken/inquiryUserInfo response
 * otherwise decides who gets a Plug A Pro session (see POST /api/auth/vodapay).
 *
 * VERIFY-IN-SANDBOX: Alipay+ signs responses with the platform key and returns the
 * `Signature` + `Response-Time` headers this verifier expects; VodaPay's
 * mini-program gateway is not publicly documented (research doc §7.1 Q5). Set
 * `VODAPAY_VERIFY_RESPONSES=false` ONLY once the sandbox has *proved* it does not
 * sign responses, and record that as an accepted risk — while the toggle is on an
 * unsigned response is rejected, never silently accepted.
 */
function responseVerificationEnabled(): boolean {
  return process.env.VODAPAY_VERIFY_RESPONSES?.trim().toLowerCase() !== 'false'
}

function verifyPlatformResponse(p: {
  path: string
  clientId: string
  platformPublicKey: string
  headers: Headers
  body: string
}): void {
  const parsed = parseSignatureHeader(p.headers.get('signature'))
  const responseTime = p.headers.get('response-time') ?? p.headers.get('request-time')
  if (!parsed || !responseTime) {
    throw new VodapayApiError('RESPONSE_SIGNATURE_MISSING')
  }
  const payload = buildSignaturePayload({
    method: 'POST',
    path: p.path,
    clientId: p.clientId,
    // Same payload shape as the request signature, with the platform's response
    // timestamp in place of Request-Time.
    requestTime: responseTime,
    body: p.body,
  })
  if (!verifySignature(payload, parsed.signature, p.platformPublicKey)) {
    throw new VodapayApiError('RESPONSE_SIGNATURE_INVALID')
  }
}

async function call<T extends { result?: { resultCode?: string; resultStatus?: string } }>(
  path: string, body: Record<string, unknown>, deps?: Deps,
): Promise<T> {
  const cfg = getVodapayConfig()
  const fetchImpl = deps?.fetchImpl ?? fetch
  const requestTime = (deps?.now?.() ?? new Date()).toISOString()
  const json = JSON.stringify(body)
  const signature = signRequest(
    buildSignaturePayload({ method: 'POST', path, clientId: cfg.clientId, requestTime, body: json }),
    cfg.privateKey,
  )
  const res = await fetchImpl(`${cfg.apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Client-Id': cfg.clientId,
      'Request-Time': requestTime,
      Signature: `algorithm=RSA256, keyVersion=1, signature=${encodeURIComponent(signature)}`,
    },
    body: json,
  })
  const rawBody = await res.text()
  if (responseVerificationEnabled()) {
    verifyPlatformResponse({
      path,
      clientId: cfg.clientId,
      platformPublicKey: cfg.platformPublicKey,
      headers: res.headers,
      body: rawBody,
    })
  }

  let data: T
  try {
    data = JSON.parse(rawBody) as T
  } catch {
    throw new VodapayApiError(`RESPONSE_MALFORMED_HTTP_${res.status}`)
  }

  if (data.result?.resultStatus !== 'S') {
    throw new VodapayApiError(data.result?.resultCode ?? `HTTP_${res.status}`)
  }
  return data
}

export async function applyToken(authCode: string, deps?: Deps) {
  const data = await call<{ accessToken: string; refreshToken?: string;
    customerId: string; accessTokenExpiryTime?: string; result: { resultStatus: string } }>(
    '/v2/authorizations/applyToken',
    { grantType: 'AUTHORIZATION_CODE', authCode }, deps)
  return { accessToken: data.accessToken, refreshToken: data.refreshToken,
    customerId: data.customerId, expiresAt: data.accessTokenExpiryTime }
}

export async function inquiryUserInfo(accessToken: string, deps?: Deps) {
  const data = await call<{ userInfo?: { userId: string; userName?: { fullName?: string };
    contactInfos?: Array<{ contactType: string; contactNo: string }> };
    result: { resultStatus: string } }>(
    '/v2/customers/user/inquiryUserInfo', { accessToken }, deps)
  const mobile = data.userInfo?.contactInfos?.find((c) => c.contactType === 'MOBILE_PHONE')?.contactNo
  return { userId: data.userInfo?.userId ?? '', userName: data.userInfo?.userName, mobileNumber: mobile }
}

export async function payCashier(p: { paymentRequestId: string; amountCents: number;
  notifyUrl: string; redirectUrl: string; orderDescription: string; expiryIso: string }, deps?: Deps) {
  const cfg = getVodapayConfig()
  const data = await call<{ paymentId: string; redirectActionForm?: { redirectUrl: string };
    result: { resultStatus: string } }>(
    '/v2/payments/pay',
    {
      productCode: 'CASHIER_PAYMENT',
      paymentRequestId: p.paymentRequestId,
      paymentAmount: { currency: 'ZAR', value: String(p.amountCents) },
      paymentNotifyUrl: p.notifyUrl,
      paymentRedirectUrl: p.redirectUrl,
      paymentExpiryTime: p.expiryIso,
      order: { orderDescription: p.orderDescription, referenceOrderId: p.paymentRequestId },
      merchantId: cfg.merchantId,
    }, deps)
  return { paymentId: data.paymentId, redirectUrl: data.redirectActionForm?.redirectUrl ?? '' }
}

// VERIFY-IN-SANDBOX: refund/inquiry shapes follow the Alipay+ spec; VodaPay's
// mini-program refund API is not publicly documented (research doc §7.1 Q5).
export async function refundPayment(p: { paymentId: string; refundRequestId: string;
  amountCents: number }, deps?: Deps) {
  const data = await call<{ refundId: string; result: { resultStatus: string } }>(
    '/v2/payments/refund',
    { paymentId: p.paymentId, refundRequestId: p.refundRequestId,
      refundAmount: { currency: 'ZAR', value: String(p.amountCents) } }, deps)
  return { refundId: data.refundId }
}

export async function inquiryPayment(paymentId: string, deps?: Deps) {
  const data = await call<{ paymentStatus?: string; paymentAmount?: { value?: string };
    result: { resultStatus: string } }>(
    '/v2/payments/inquiryPayment', { paymentId }, deps)
  const status: 'SUCCESS' | 'FAIL' | 'PROCESSING' = data.paymentStatus === 'SUCCESS' ? 'SUCCESS'
    : data.paymentStatus === 'FAIL' ? 'FAIL' : 'PROCESSING'
  return { status, amountCents: data.paymentAmount?.value ? Number(data.paymentAmount.value) : undefined }
}
