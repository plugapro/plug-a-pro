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
// VodaPay). We mint `${bookingId}.${n}` where n is the 0-based attempt index.
//
// I-4 residual 1+2 (Task 16 round 2): n is now derived from an ATOMIC
// `Payment.vodapayAttempt` counter (additive migration
// 20260908223229_add_payment_vodapay_attempt), incremented via a single
// `{ increment: 1 }` UPDATE per mint:
//   - residual 1 (throw-retry ignored): the old scheme gated on
//     `pspCheckoutId` presence, which is only set AFTER payCashier returns -
//     a throw between "read counter" and "payCashier returns" left the
//     counter looking unused, so the next retry recomputed the SAME id. The
//     column increments unconditionally on every mint attempt, independent
//     of whether payCashier itself later succeeds or throws.
//   - residual 2 (non-atomic race): the old scheme was a plain JS
//     read-then-write against Payment.metadata - two concurrent initiations
//     could both read the same prior value and mint the same "advanced" id.
//     `{ increment: 1 }` compiles to a single atomic `UPDATE ... SET x = x+1`
//     in Postgres, so concurrent callers each get a distinct, correctly
//     advanced value with no read-modify-write window.
// vodapayAttempt is the POST-increment total mint count (1-based); the
// embedded, 0-based attempt id used in paymentRequestId is one less.
//
// bookingIds are cuids (never contain '.'), so parseWebhookEvent recovers the
// bookingId as the substring before the FIRST '.' — safe for both the legacy
// (dot-less) and current (dotted) id shapes.
export const VODAPAY_ATTEMPT_RAW_KEY = 'vodapayAttempt'

/**
 * NEW-3: reads the 0-based attempt index a VodaPay webhook event was minted
 * for, as exposed on `PaymentEvent.raw` by parseWebhookEvent below. Returns
 * null for non-VodaPay events (Peach/Pay@Go raw payloads never carry this
 * key) or a malformed/missing value.
 */
export function extractVodapayAttempt(raw: unknown): number | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)[VODAPAY_ATTEMPT_RAW_KEY]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export class VodapayCashierProvider implements PspProvider {
  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.plugapro.co.za').replace(/\/$/, '')
    const expiry = new Date(Date.now() + 30 * 60_000).toISOString()

    // NEW-2a: don't mint a second live session on top of one that's already
    // payable - two live sessions for the same booking means a second real
    // charge can land on a session our own Payment row no longer tracks as
    // "the" checkout, and the shared duplicate-webhook guard would then only
    // be able to flag it after the fact (see NEW-2b in webhook-guards.ts),
    // not prevent it. The caller (lib/payments.ts#createCheckout) always
    // upserts the Payment row to status:'PENDING' BEFORE invoking this
    // provider (SRE-04), so status alone can't distinguish "fresh
    // quote-approval call" from "failure-driven retry" here -
    // `forceNewSession` is the explicit signal the failure-retry path
    // (refreshCheckoutUrlForFailedPayment) sets when it KNOWS the previous
    // session is dead (a payment.failed notify was just received for it).
    // Any other caller (quote approval, races/duplicate calls) reuses an
    // existing PENDING session with a checkoutUrl instead of minting a
    // second payable one.
    if (!params.forceNewSession) {
      try {
        const existing = await db.payment.findUnique({
          where: { bookingId: params.bookingId },
          select: { status: true, checkoutUrl: true, pspCheckoutId: true },
        })
        if (existing?.status === 'PENDING' && existing.checkoutUrl && existing.pspCheckoutId) {
          return { id: existing.pspCheckoutId, url: existing.checkoutUrl }
        }
      } catch (err) {
        // NEW-4: best-effort - fail OPEN to minting a fresh session rather
        // than blocking checkout on a lookup error, but log it instead of
        // silently swallowing (this replaces the old, now-removed silent
        // .catch(() => undefined) on the metadata counter write - the
        // counter write itself is no longer optional, see below).
        console.warn('[payments/vodapay] failed to check for a reusable checkout session - minting fresh', {
          bookingId: params.bookingId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Atomic mint (see the I-4 note above). Unlike the old best-effort
    // metadata write, this update IS the source of the attempt number now,
    // so a failure here must propagate (not be swallowed) - the outer
    // lib/payments.ts#createCheckout() already catches provider.createCheckout
    // throwing, records failureReason on the Payment row, and rethrows to the
    // caller.
    const updatedPayment = await db.payment.update({
      where: { bookingId: params.bookingId },
      data: { vodapayAttempt: { increment: 1 } },
      select: { vodapayAttempt: true },
    })
    const attempt = updatedPayment.vodapayAttempt - 1
    const paymentRequestId = `${params.bookingId}.${attempt}`

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

    // NEW-3: expose the embedded attempt index on the event so
    // handlePaymentFailed can detect and ignore a stale notify for an
    // already-abandoned attempt instead of failing a live, newer session.
    let attempt: number | null = null
    if (dotIndex >= 0) {
      const parsedAttempt = Number(rawRequestId.slice(dotIndex + 1))
      if (Number.isFinite(parsedAttempt)) attempt = parsedAttempt
    }

    return {
      type: succeeded ? 'payment.success' : 'payment.failed',
      bookingId,
      // paymentId is VodaPay's own reference for the payment.
      pspReference: n.paymentId ?? '',
      amount: n.paymentAmount?.value ? Number(n.paymentAmount.value) : 0,
      currency: n.paymentAmount?.currency ?? 'ZAR',
      raw: { ...n, [VODAPAY_ATTEMPT_RAW_KEY]: attempt },
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
