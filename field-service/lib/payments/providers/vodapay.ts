// ─── PSP provider: VodaPay Cashier ────────────────────────────────────────────
// VodaPay super-app checkout, wired through the Alipay+ CASHIER_PAYMENT product
// (lib/vodapay/client.ts#payCashier / #refundPayment). Selected per-booking by
// resolvePspProviderNameFor() in ../../payments.ts when the originating
// JobRequest.source is 'vodapay' and the 'payments.vodapay.v1' flag is on.
import 'server-only'

import { db } from '@/lib/db'
import { payCashier, refundPayment } from '@/lib/vodapay/client'
import { buildSignaturePayload, parseSignatureHeader, verifySignature } from '@/lib/vodapay/signing'
import type { CheckoutParams, CheckoutSession, PaymentEvent, PspProvider, RefundResult } from '@/lib/payments'

// Path VodaPay POSTs the payment notify webhook to. Exported so Task 17's
// /api/webhooks/vodapay route (and its signature verification) stay pinned to
// exactly the same path this provider signs/verifies against.
export const NOTIFY_PATH = '/api/webhooks/vodapay'

// I-4: paymentRequestId retry scheme. VodaPay's paymentExpiryTime is ~30 min;
// a checkout re-initiated (failed/expired) with the SAME paymentRequestId as
// a prior attempt can never mint a payable session again ("dead payment" at
// VodaPay). We mint `${bookingId}.${n}`:
//   - n = 0 the very first time this booking gets a VodaPay checkout (no
//     pspCheckoutId recorded on Payment yet)
//   - otherwise n = 1 + the last attempt number persisted at
//     Payment.metadata.vodapayAttempt, so every re-initiated checkout gets a
//     fresh, never-before-used id
// bookingIds are cuids (never contain '.'), so parseWebhookEvent recovers the
// bookingId as the substring before the FIRST '.' — safe for both the legacy
// (dot-less) and current (dotted) id shapes.
const VODAPAY_ATTEMPT_METADATA_KEY = 'vodapayAttempt'

function readVodapayAttempt(metadata: unknown): number {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const raw = (metadata as Record<string, unknown>)[VODAPAY_ATTEMPT_METADATA_KEY]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  }
  return 0
}

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

export class VodapayCashierProvider implements PspProvider {
  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.plugapro.co.za').replace(/\/$/, '')
    const expiry = new Date(Date.now() + 30 * 60_000).toISOString()

    // See the I-4 note above `VODAPAY_ATTEMPT_METADATA_KEY`. The caller
    // (lib/payments.ts#createCheckout) always upserts the Payment row BEFORE
    // invoking this provider (SRE-04), so `existing` reflects state from any
    // PRIOR checkout attempt for this booking, not this one.
    const existing = await db.payment.findUnique({
      where: { bookingId: params.bookingId },
      select: { pspCheckoutId: true, metadata: true },
    })
    const attempt = existing?.pspCheckoutId ? readVodapayAttempt(existing.metadata) + 1 : 0
    const paymentRequestId = `${params.bookingId}.${attempt}`

    // Persist the new attempt counter before contacting VodaPay: if payCashier
    // throws (network error, VodapayApiError, etc.) the counter has already
    // advanced, so it can never regress even though pspCheckoutId itself
    // never got set for this attempt. Best-effort - SRE-04 already guarantees
    // the row exists, so this should never fail in practice.
    await db.payment
      .update({
        where: { bookingId: params.bookingId },
        data: {
          metadata: {
            ...metadataObject(existing?.metadata),
            [VODAPAY_ATTEMPT_METADATA_KEY]: attempt,
          },
        },
      })
      .catch(() => undefined)

    const out = await payCashier({
      paymentRequestId,
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
    // paymentRequestId is `${bookingId}.${attempt}` (see createCheckout / the
    // I-4 note above) - VodaPay's echo of our correlation id. Recover the
    // bookingId as the substring before the FIRST '.'; cuids never contain
    // '.', so this is unambiguous. Falls back to the raw value unchanged when
    // there is no '.' (defensive - all current checkouts mint a dotted id).
    const rawRequestId = n.paymentRequestId ?? ''
    const dotIndex = rawRequestId.indexOf('.')
    const bookingId = dotIndex >= 0 ? rawRequestId.slice(0, dotIndex) : rawRequestId
    return {
      type: succeeded ? 'payment.success' : 'payment.failed',
      bookingId,
      // paymentId is VodaPay's own reference for the payment.
      pspReference: n.paymentId ?? '',
      amount: n.paymentAmount?.value ? Number(n.paymentAmount.value) : 0,
      currency: n.paymentAmount?.currency ?? 'ZAR',
      raw: n,
    }
  }

  async createRefund(pspReference: string, amountCents: number): Promise<RefundResult> {
    // VERIFY-IN-SANDBOX (spec §8).
    // I-2: refundRequestId is VodaPay's merchant idempotency key. It MUST be
    // derived deterministically from the stable pspReference alone (no
    // Date.now()/random suffix) - issueRefund has no REFUNDED pre-check, so a
    // retried call (timeout, ops re-click, cron re-drive) must resolve to the
    // SAME refund request at VodaPay and be a no-op there, not mint a second,
    // real refund.
    const out = await refundPayment({
      paymentId: pspReference,
      refundRequestId: `rf_${pspReference}`,
      amountCents,
    })
    return { success: true, refundReference: out.refundId }
  }
}
