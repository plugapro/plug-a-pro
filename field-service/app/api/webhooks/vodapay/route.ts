// VodaPay Cashier notify webhook.
//
// Mirrors app/api/webhooks/payments/route.ts's post-verification flow
// (shared guards, handlePaymentSuccess/handlePaymentFailed, logging incl. the
// DUPLICATE_SUCCESS_DIFFERENT_PSP_REFERENCE marker) exactly, so the two
// routes never drift on idempotency/amount-guard behaviour. The only
// differences from the generic route are VodaPay-specific:
//   - signature verification (RSA256 over method+path+clientId+requestTime+
//     body, via VodapayCashierProvider.verifyWebhook - fail-closed 401 on any
//     invalid/missing signature, headers, or configured keys)
//   - event parsing (VodapayCashierProvider.parseWebhookEvent)
//   - the ack body/shape VodaPay's Cashier product expects:
//     { result: { resultCode: 'SUCCESS', resultStatus: 'S' } } with 200
//   - an unknown bookingId ref acks (200, stops VodaPay's notify retries)
//     with a console.warn, instead of the generic route's 400
//
// Processes regardless of the payments.vodapay.v1 flag's state - a checkout
// session minted while the flag was on can still deliver its notify after
// the flag is flipped off, and that in-flight payment must still land.
import { type NextRequest, NextResponse } from 'next/server'
import { handlePaymentSuccess, handlePaymentFailed } from '@/lib/payments'
import { guardPaymentSuccessWebhook } from '@/lib/payments/webhook-guards'
import { VodapayCashierProvider } from '@/lib/payments/providers/vodapay'
import { sendPaidBookingConfirmation } from '@/lib/payment-confirmation'
import { getCorrelationId } from '@/lib/correlation'

function ack() {
  return NextResponse.json({ result: { resultCode: 'SUCCESS', resultStatus: 'S' } })
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  // VodapayCashierProvider.verifyWebhook takes a single packed
  // `<Signature header>|<Request-Time header>` argument (it splits on the
  // LAST '|' - RSA256 signatures are base64url and never contain '|').
  const signature = request.headers.get('signature') ?? ''
  const requestTime = request.headers.get('request-time') ?? ''

  const reqId = crypto.randomUUID().slice(0, 8)
  const correlationId = await getCorrelationId()
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, event: 'webhook_received', path: request.url }))

  const provider = new VodapayCashierProvider()

  // Fail-closed: verifyWebhook itself returns false for a bad signature, a
  // missing Signature/Request-Time header, or an unconfigured
  // VODAPAY_PLATFORM_PUBLIC_KEY/VODAPAY_CLIENT_ID.
  if (!provider.verifyWebhook(rawBody, `${signature}|${requestTime}`)) {
    console.warn(`[webhook/vodapay:${reqId}] Invalid signature`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let event
  try {
    event = provider.parseWebhookEvent(rawBody)
  } catch (err) {
    console.error(`[webhook/vodapay:${reqId}] Parse error:`, err)
    return ack()
  }

  try {
    if (event.type === 'payment.success') {
      // Idempotency guard + amount validation (SECURITY 7a1438d) - shared
      // with the generic PSP webhook route via lib/payments/webhook-guards.ts:
      //   a) bookingId maps to a known Payment (reject unknown references)
      //   b) event.amount matches Payment.amount within ±0.01 rand tolerance
      //   c) payment is not already PAID (idempotency)
      const guard = await guardPaymentSuccessWebhook({
        bookingId: event.bookingId,
        amountCents: event.amount,
      })

      if (guard.outcome === 'unknown_booking') {
        // Unlike the generic route (400), an unknown ref here still acks:
        // VodaPay retries a non-2xx notify, and a booking VodaPay knows about
        // that we don't (stale/foreign paymentRequestId) can never resolve
        // itself by retrying.
        console.warn(`[webhook/vodapay:${reqId}] Unknown bookingId ${event.bookingId}`)
        return ack()
      }

      if (guard.outcome === 'amount_mismatch') {
        console.error(`[webhook/vodapay:${reqId}] Amount mismatch for ${event.bookingId}`, {
          storedCents: guard.storedAmountCents,
          receivedCents: guard.receivedAmountCents,
        })
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
      }

      // Early-return BEFORE handlePaymentSuccess to prevent any duplicate DB writes.
      if (guard.outcome === 'duplicate') {
        // NEW-2b: a duplicate `success` whose incoming pspReference differs
        // from what's already stored means a SECOND, distinct session got
        // paid for this booking - a possible double charge. Loud log with a
        // distinct marker for ops/finance to grep on; still ack (this is not
        // a signature/parse failure and must not trigger VodaPay retries).
        if (guard.storedPspReference && guard.storedPspReference !== event.pspReference) {
          console.error(
            `[webhook/vodapay:${reqId}] DUPLICATE_SUCCESS_DIFFERENT_PSP_REFERENCE - possible double charge, manual refund needed`,
            {
              bookingId: event.bookingId,
              storedPspReference: guard.storedPspReference,
              incomingPspReference: event.pspReference,
            },
          )
        } else {
          console.info(
            `[webhook/vodapay:${reqId}] Duplicate delivery for ${event.bookingId} - already processed`,
          )
        }
        // SRE-02: a duplicate delivery is a free re-drive opportunity. If the
        // booking confirmation never went out (sentinel null), attempt it now.
        // sendPaidBookingConfirmation is idempotent (sentinel + attempt cap)
        // and non-throwing.
        if (!guard.bookingConfirmationSentAt) {
          const redrive = await sendPaidBookingConfirmation(event.bookingId)
          console.info(
            `[webhook/vodapay:${reqId}] Confirmation re-drive for ${event.bookingId}: ${redrive.outcome}`,
          )
        }
        return ack()
      }

      await handlePaymentSuccess(event)

      // SRE-02: the confirmation send is tracked by a sentinel on Payment and
      // never throws. A failed send no longer 500s the webhook (which used to
      // strand the confirmation behind the PAID early-return); the duplicate-
      // delivery path above and the payment-confirmation-redrive cron re-drive it.
      const confirmation = await sendPaidBookingConfirmation(event.bookingId)
      if (!confirmation.sent) {
        console.warn(
          `[webhook/vodapay:${reqId}] Booking confirmation not sent for ${event.bookingId}: ${confirmation.outcome}`,
        )
      }
    } else if (event.type === 'payment.failed') {
      await handlePaymentFailed(event)
    }
    // payment.refunded is handled by admin-initiated refunds in lib/payments.ts

    return ack()
  } catch (err) {
    console.error(`[webhook/vodapay:${reqId}] Handler error:`, err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
