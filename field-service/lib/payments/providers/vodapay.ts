// ─── PSP provider: VodaPay Cashier ────────────────────────────────────────────
// VodaPay super-app checkout, wired through the Alipay+ CASHIER_PAYMENT product
// (lib/vodapay/client.ts#payCashier / #refundPayment). Selected per-booking by
// resolvePspProviderNameFor() in ../../payments.ts when the originating
// JobRequest.source is 'vodapay' and the 'payments.vodapay.v1' flag is on.
import 'server-only'

import { payCashier, refundPayment } from '@/lib/vodapay/client'
import { buildSignaturePayload, parseSignatureHeader, verifySignature } from '@/lib/vodapay/signing'
import type { CheckoutParams, CheckoutSession, PaymentEvent, PspProvider, RefundResult } from '@/lib/payments'

// Path VodaPay POSTs the payment notify webhook to. Exported so Task 17's
// /api/webhooks/vodapay route (and its signature verification) stay pinned to
// exactly the same path this provider signs/verifies against.
export const NOTIFY_PATH = '/api/webhooks/vodapay'

export class VodapayCashierProvider implements PspProvider {
  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.plugapro.co.za').replace(/\/$/, '')
    const expiry = new Date(Date.now() + 30 * 60_000).toISOString()
    const out = await payCashier({
      paymentRequestId: params.bookingId, // stable id → webhook correlation (see parseWebhookEvent below)
      amountCents: params.amount,
      notifyUrl: `${base}${NOTIFY_PATH}`,
      redirectUrl: `${base}/bookings/${params.bookingId}?paid=1`,
      orderDescription: params.description,
      expiryIso: expiry,
    })
    return { id: out.paymentId, url: out.redirectUrl }
  }

  // PspProvider.verifyWebhook(rawBody, signature) has only two params, but
  // verifying a VodaPay notify also needs the Request-Time header (it is part
  // of the signed payload, see buildSignaturePayload). The route (Task 17)
  // packs both into the single `signature` argument as
  // `<Signature header value>|<Request-Time header value>` — this provider
  // splits on the LAST '|' (RSA256 signatures are base64url-encoded and never
  // contain '|', so this is unambiguous) to recover both parts. Any caller
  // producing this packed string MUST match this contract exactly.
  verifyWebhook(rawBody: string, signature: string): boolean {
    const sep = signature.lastIndexOf('|')
    if (sep < 0) return false
    const parsed = parseSignatureHeader(signature.slice(0, sep))
    const requestTime = signature.slice(sep + 1)
    const publicKey = process.env.VODAPAY_PLATFORM_PUBLIC_KEY
    const clientId = process.env.VODAPAY_CLIENT_ID
    if (!parsed || !publicKey || !clientId || !requestTime) return false
    const payload = buildSignaturePayload({
      method: 'POST', path: NOTIFY_PATH, clientId, requestTime, body: rawBody,
    })
    return verifySignature(payload, parsed.signature, publicKey)
  }

  parseWebhookEvent(rawBody: string): PaymentEvent {
    const n = JSON.parse(rawBody) as {
      paymentId?: string
      paymentRequestId?: string
      paymentAmount?: { currency?: string; value?: string }
      result?: { resultStatus?: string }
    }
    const succeeded = n.result?.resultStatus === 'S'
    return {
      type: succeeded ? 'payment.success' : 'payment.failed',
      // paymentRequestId is the value we set to params.bookingId in
      // createCheckout(); it is VodaPay's echo of our correlation id.
      bookingId: n.paymentRequestId ?? '',
      // paymentId is VodaPay's own reference for the payment.
      pspReference: n.paymentId ?? '',
      amount: n.paymentAmount?.value ? Number(n.paymentAmount.value) : 0,
      currency: n.paymentAmount?.currency ?? 'ZAR',
      raw: n,
    }
  }

  async createRefund(pspReference: string, amountCents: number): Promise<RefundResult> {
    // VERIFY-IN-SANDBOX (spec §8)
    const out = await refundPayment({
      paymentId: pspReference,
      refundRequestId: `rf_${pspReference}_${Date.now()}`,
      amountCents,
    })
    return { success: true, refundReference: out.refundId }
  }
}
