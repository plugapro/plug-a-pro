/**
 * Payfast adapter — self-contained module for all Payfast-specific logic.
 *
 * Responsibilities:
 *   - Checkout payload construction (fields + MD5 signature)
 *   - ITN signature verification (source IP + signature re-computation)
 *   - Sandbox vs live environment switching
 *
 * This module has no knowledge of the provider wallet, ledger, or any other
 * internal domain. Call it as a black box from the top-up service and ITN
 * handler.
 *
 * Environment variables required:
 *   PAYFAST_MERCHANT_ID   — from Payfast merchant account dashboard
 *   PAYFAST_MERCHANT_KEY  — from Payfast merchant account dashboard
 *   PAYFAST_PASSPHRASE    — set in Payfast dashboard; empty string if not set
 *   PAYFAST_SANDBOX       — "true" for sandbox, omit or "false" for live
 *   PAYFAST_NOTIFY_URL    — absolute URL of the ITN handler endpoint
 *   PAYFAST_RETURN_URL    — redirect URL shown to provider after checkout
 *   PAYFAST_CANCEL_URL    — redirect URL shown to provider on cancel
 *
 * IMPORTANT — return URL is not payment proof:
 *   Payfast redirects the provider's browser to PAYFAST_RETURN_URL after
 *   checkout regardless of payment outcome. Never trigger any wallet credit
 *   or intent status change from the return URL handler. The ITN handler is
 *   the only source of payment truth.
 */

import { createHash, timingSafeEqual } from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

// Payfast payment method codes — confirmed from developer docs 2026-04-29.
// Note: EFT code is "ef", NOT "eft". Using "eft" silently breaks checkout.
export type PayfastPaymentMethod = 'cc' | 'ef' | 'sc'

/**
 * All fields sent in the Payfast checkout form POST.
 * The `action` field carries the Payfast URL (sandbox or live).
 */
export type PayfastCheckoutPayload = {
  action: string
  fields: Record<string, string>
}

/**
 * Raw ITN payload received from Payfast via POST application/x-www-form-urlencoded.
 * Contains all fields Payfast sends; unknown/extra fields are preserved.
 */
export type PayfastItnPayload = {
  m_payment_id: string
  pf_payment_id?: string
  payment_status: string
  item_name?: string
  amount_gross?: string
  amount_fee?: string
  amount_net?: string
  signature?: string
  [key: string]: string | undefined
}

export type PayfastVerificationResult =
  | { valid: true }
  | { valid: false; reason: string }

export type PayfastConfig = {
  merchantId: string
  merchantKey: string
  passphrase: string
  sandbox: boolean
  notifyUrl: string
  returnUrl: string
  cancelUrl: string
}

// ─── Payfast URL constants ─────────────────────────────────────────────────────

const PAYFAST_LIVE_URL = 'https://www.payfast.co.za/eng/process'
const PAYFAST_SANDBOX_URL = 'https://sandbox.payfast.co.za/eng/process'

// ─── Payfast IP allowlist ──────────────────────────────────────────────────────
//
// These are the known Payfast notification server IP addresses.
// Source: https://developers.payfast.co.za/docs (Notify IP section).
// Last verified: 2026-04-29. Update this list when Payfast changes ranges.
//
// Ranges included:
//   197.97.145.144/28  (197.97.145.144 – 197.97.145.159)
//   41.74.179.192/27   (41.74.179.192  – 41.74.179.223)
//   102.216.36.0/28    (102.216.36.0   – 102.216.36.15)
//   102.216.36.128/28  (102.216.36.128 – 102.216.36.143)
//   144.126.193.139    (single host)
// Sandbox: IP validation is skipped when PAYFAST_SANDBOX=true.

function expandCidr(base: string, start: number, end: number): string[] {
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const parts = base.split('.')
    parts[3] = String(start + i)
    return parts.join('.')
  })
}

const PAYFAST_LIVE_NOTIFY_IPS = new Set([
  // 197.97.145.144/28
  ...expandCidr('197.97.145.0', 144, 159),
  // 41.74.179.192/27
  ...expandCidr('41.74.179.0', 192, 223),
  // 102.216.36.0/28
  ...expandCidr('102.216.36.0', 0, 15),
  // 102.216.36.128/28
  ...expandCidr('102.216.36.0', 128, 143),
  // Single host
  '144.126.193.139',
])

// ─── Configuration ─────────────────────────────────────────────────────────────

export function getPayfastConfig(): PayfastConfig {
  const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim()
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim()
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim() ?? ''
  const sandbox = process.env.PAYFAST_SANDBOX?.trim() === 'true'
  const notifyUrl = process.env.PAYFAST_NOTIFY_URL?.trim()
  const returnUrl = process.env.PAYFAST_RETURN_URL?.trim()
  const cancelUrl = process.env.PAYFAST_CANCEL_URL?.trim()

  if (!merchantId) throw new Error('Missing required env var: PAYFAST_MERCHANT_ID')
  if (!merchantKey) throw new Error('Missing required env var: PAYFAST_MERCHANT_KEY')
  if (!notifyUrl) throw new Error('Missing required env var: PAYFAST_NOTIFY_URL')
  if (!returnUrl) throw new Error('Missing required env var: PAYFAST_RETURN_URL')
  if (!cancelUrl) throw new Error('Missing required env var: PAYFAST_CANCEL_URL')

  return { merchantId, merchantKey, passphrase, sandbox, notifyUrl, returnUrl, cancelUrl }
}

// ─── Signature algorithm ───────────────────────────────────────────────────────
//
// Payfast signature algorithm (https://developers.payfast.co.za/docs):
//   1. Collect all non-empty parameters in the order they appear in the payload.
//   2. URL-encode values using percent-encoding (spaces as %20, NOT +).
//   3. Concatenate as a URL query string: key=value&key=value
//   4. If a passphrase is configured, append: &passphrase=<url_encoded_passphrase>
//   5. MD5-hash the resulting string and return as lowercase hex.
//
// Note: the `signature` field itself is excluded from the hash input.

export function generateSignature(
  params: Record<string, string>,
  passphrase: string,
): string {
  // Build query string over all non-empty values, in insertion order.
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value != null) {
      parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`)
    }
  }

  if (passphrase !== '') {
    parts.push(`passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`)
  }

  const queryString = parts.join('&')
  return createHash('md5').update(queryString).digest('hex')
}

// ─── Payfast payment method mapping ───────────────────────────────────────────

const PAYMENT_METHOD_MAP: Record<string, PayfastPaymentMethod> = {
  PAYFAST_CARD: 'cc',
  PAYFAST_EFT: 'ef',   // "ef" confirmed — NOT "eft"
  PAYFAST_SCODE: 'sc',
}

// ─── Checkout payload builder ──────────────────────────────────────────────────

export type CheckoutIntentInput = {
  /** PaymentIntent.id — used as m_payment_id sent to Payfast */
  id: string
  amountCents: number
  creditsToIssue: number
  paymentMethod: string
}

export type CheckoutProviderInput = {
  name?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * Build a complete Payfast checkout form payload.
 *
 * The caller should POST these fields to `payload.action` using an HTML form
 * or a JavaScript form submission. Do NOT redirect via GET — Payfast requires
 * a form POST for the checkout initiation.
 *
 * IMPORTANT: the return URL is UI-only. Never trigger wallet crediting there.
 */
export function buildCheckoutPayload(
  intent: CheckoutIntentInput,
  provider: CheckoutProviderInput,
  config: PayfastConfig,
): PayfastCheckoutPayload {
  const amountStr = (intent.amountCents / 100).toFixed(2)
  const itemName = `Plug-A-Pro Credits — ${intent.creditsToIssue} credits`
  const itemDescription = `R${Math.round(intent.amountCents / 100)} top-up · ${intent.creditsToIssue} Plug-A-Pro Credits`
  const payfastMethod = PAYMENT_METHOD_MAP[intent.paymentMethod] ?? 'cc'

  const [nameFirst = '', ...nameParts] = (provider.name ?? '').split(' ')
  const nameLast = nameParts.join(' ')

  // Field order matches Payfast's expected signature input order.
  const fields: Record<string, string> = {}

  fields.merchant_id = config.merchantId
  fields.merchant_key = config.merchantKey
  fields.return_url = config.returnUrl
  fields.cancel_url = config.cancelUrl
  fields.notify_url = config.notifyUrl

  if (nameFirst) fields.name_first = nameFirst
  if (nameLast) fields.name_last = nameLast
  if (provider.email) fields.email_address = provider.email

  fields.m_payment_id = intent.id
  fields.amount = amountStr
  fields.item_name = itemName
  fields.item_description = itemDescription
  fields.payment_method = payfastMethod

  // Compute signature over all fields built so far (merchant_key is included
  // in the signature but not sent to the browser — only the signature goes).
  const signatureFields = { ...fields }
  delete signatureFields.merchant_key
  fields.signature = generateSignature(signatureFields, config.passphrase)

  // merchant_key must NOT be sent to the browser (it stays server-side in
  // the signature only). Remove it from the form fields.
  const { merchant_key: _key, ...formFields } = fields

  const action = config.sandbox ? PAYFAST_SANDBOX_URL : PAYFAST_LIVE_URL

  return { action, fields: formFields }
}

// ─── ITN verification ─────────────────────────────────────────────────────────

/**
 * Verify a Payfast Instant Transaction Notification.
 *
 * Validation sequence:
 *   1. Source IP must be in the known Payfast notify IP allowlist.
 *      (In sandbox mode, IP validation is skipped.)
 *   2. Signature must match a freshly computed MD5 over the received parameters.
 *   3. payment_status must equal "COMPLETE" for a successful payment.
 *
 * Returns { valid: true } only if all three checks pass.
 * Returns { valid: false, reason } on any failure — callers should log the
 * reason internally but always return HTTP 200 to Payfast.
 */
export function verifyItn(
  payload: PayfastItnPayload,
  remoteIp: string | null | undefined,
  config: PayfastConfig,
): PayfastVerificationResult {
  // 1. IP validation — fail closed if IP cannot be determined.
  if (!config.sandbox) {
    if (!remoteIp?.trim()) {
      return { valid: false, reason: 'remote IP could not be determined' }
    }
    if (!PAYFAST_LIVE_NOTIFY_IPS.has(remoteIp.trim())) {
      return { valid: false, reason: `IP not in Payfast allowlist: ${remoteIp}` }
    }
  }

  // 2. Signature verification.
  const { signature: receivedSignature, ...rest } = payload
  if (!receivedSignature) {
    return { valid: false, reason: 'signature field missing from ITN payload' }
  }

  // Re-build the hash input from the received fields in their original order.
  const hashParams: Record<string, string> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (value !== '' && value != null) {
      hashParams[key] = value
    }
  }

  const computedSignature = generateSignature(hashParams, config.passphrase)

  const receivedBuf = Buffer.from(receivedSignature, 'utf8')
  const computedBuf = Buffer.from(computedSignature, 'utf8')

  if (
    receivedBuf.length !== computedBuf.length ||
    !timingSafeEqual(receivedBuf, computedBuf)
  ) {
    return { valid: false, reason: 'signature mismatch' }
  }

  // 3. Payment status check.
  if (payload.payment_status !== 'COMPLETE') {
    return { valid: false, reason: `payment_status is not COMPLETE: ${payload.payment_status}` }
  }

  return { valid: true }
}

/**
 * Parse a Payfast amount_gross string ("200.00") to integer cents.
 * Returns NaN if the string cannot be parsed.
 */
export function parseItnAmountCents(amountGross: string | undefined): number {
  if (!amountGross) return Number.NaN
  const parsed = parseFloat(amountGross)
  if (!Number.isFinite(parsed)) return Number.NaN
  return Math.round(parsed * 100)
}
