// app/api/payat/webhook/route.ts
// Pay@ YAPI webhook handler — receives payment status callbacks from Pay@.
//
// Pay@ POSTs to this URL whenever a payment status changes (PAID, FAILED, etc.).
// We must:
//   1. Read the raw request body (needed for HMAC verification — never parse first)
//   2. Validate the HMAC-SHA256 signature in the header
//   3. Return 200 immediately — Pay@ will retry if we take too long or return non-200
//   4. Process the event asynchronously (or inline if fast enough)
//
// Webhook URL registered in Pay@Go: https://plug-a-pro-main.vercel.app/api/payat/webhook

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// ─── Pay@ webhook payload shape ───────────────────────────────────────────────
// These are the fields Pay@ sends in the callback body.
// Extend this as you discover more fields from the Pay@Go dashboard logs.

interface PayatWebhookPayload {
  /** Matches the sourceReference from the RTP creation response */
  sourceReference?: string;
  /** Matches the clientAccountNumber you sent when creating the RTP */
  clientAccountNumber?: string;
  /** Payment status — e.g. "PAID", "FAILED", "PENDING", "CANCELLED" */
  status?: string;
  /** Amount in cents (numeric) */
  amount?: number;
  /** The merchant ID (418856 for Plug A Pro) */
  merchantId?: string;
  /** Pay@'s internal RTP ID */
  requestToPayId?: string;
  /** Any other fields Pay@ may send */
  [key: string]: unknown;
}

// ─── Signature validation ──────────────────────────────────────────────────────
// Pay@ signs the raw request body with HMAC-SHA256 using the webhook secret.
// The signature arrives in the X-PayAt-Signature header (or x-signature as fallback).

function validateSignature(rawBody: string, incomingSignature: string | null): boolean {
  const secret = process.env.PAYAT_WEBHOOK_SECRET;

  // If no secret is configured, skip validation in development but log a warning
  if (!secret) {
    console.warn('[payat/webhook] PAYAT_WEBHOOK_SECRET is not set — skipping signature validation');
    return true; // Allow through in dev; must be set in production
  }

  if (!incomingSignature) {
    console.warn('[payat/webhook] Request has no signature header — rejecting');
    return false;
  }

  // Compute the expected HMAC-SHA256 signature over the raw request body
  const expectedSig = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  // Both buffers must be the same length — pad if needed
  try {
    const expected = Buffer.from(expectedSig, 'utf8');
    const received = Buffer.from(incomingSignature, 'utf8');

    if (expected.length !== received.length) {
      return false; // Different length means different signatures
    }

    return timingSafeEqual(expected, received);
  } catch {
    return false; // Any error means invalid signature
  }
}

// ─── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Step 1: Read the raw body as text BEFORE any parsing
  // This is critical — JSON.parse() would change the string representation
  // and break the HMAC check
  const rawBody = await req.text();

  // Step 2: Pull the signature from Pay@'s header
  // Try the most likely header names — check Pay@Go docs/logs to confirm the exact name
  const signature =
    req.headers.get('x-payat-signature') ||
    req.headers.get('x-signature') ||
    req.headers.get('x-webhook-signature') ||
    null;

  // Step 3: Validate the signature
  const isValid = validateSignature(rawBody, signature);

  if (!isValid) {
    console.error('[payat/webhook] Invalid signature — rejecting request', {
      receivedSig: signature?.substring(0, 20) + '...',
      headers: Object.fromEntries(req.headers.entries()),
    });
    // Return 401 so Pay@Go shows the failure clearly in the dashboard
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Step 4: Parse the JSON payload now that signature is verified
  let payload: PayatWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('[payat/webhook] Failed to parse JSON body', { rawBody, err });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Step 5: Log the event — useful for debugging and audit trail
  console.log('[payat/webhook] Received event', {
    status:             payload.status,
    sourceReference:    payload.sourceReference,
    clientAccountNumber: payload.clientAccountNumber,
    amount:             payload.amount,
    requestToPayId:     payload.requestToPayId,
    merchantId:         payload.merchantId,
  });

  // Step 6: Handle payment status changes
  // Return 200 quickly — do heavy processing asynchronously if needed
  try {
    await handlePaymentEvent(payload);
  } catch (err) {
    // Log but don't surface error to Pay@ — we've received the event, don't want retries
    console.error('[payat/webhook] Error processing payment event', { payload, err });
  }

  // Step 7: Return 200 immediately — Pay@ considers anything non-200 a failure and retries
  return NextResponse.json({ received: true }, { status: 200 });
}

// ─── Payment event handler ────────────────────────────────────────────────────
// This is where you update your database, send WhatsApp messages, trigger dispatch, etc.
// Swap out the console.log calls for real DB updates once the booking schema is in place.

async function handlePaymentEvent(payload: PayatWebhookPayload): Promise<void> {
  const { status, sourceReference, clientAccountNumber, amount } = payload;

  // Use sourceReference OR clientAccountNumber — Pay@ may use either depending on flow
  const reference = sourceReference || clientAccountNumber;

  if (!reference) {
    console.warn('[payat/webhook] No reference in payload — cannot match to a booking');
    return;
  }

  switch (status?.toUpperCase()) {
    case 'PAID': {
      // 💡 TODO: Update booking payment status in Prisma/Supabase
      //   await prisma.payment.update({
      //     where: { payatReference: reference },
      //     data:  { status: 'PAID', paidAt: new Date(), amountPaid: amount },
      //   });
      //
      // 💡 TODO: Send WhatsApp confirmation to customer via Plug A Pro WhatsApp flow
      //   await sendWhatsAppPaymentConfirmation({ reference, amount });
      //
      // 💡 TODO: Trigger technician dispatch workflow if applicable
      console.log(`[payat/webhook] PAID — reference: ${reference}, amount: ${amount} cents`);
      break;
    }

    case 'FAILED': {
      // 💡 TODO: Mark booking payment as failed, notify customer
      console.log(`[payat/webhook] FAILED — reference: ${reference}`);
      break;
    }

    case 'CANCELLED': {
      // 💡 TODO: Mark booking payment as cancelled
      console.log(`[payat/webhook] CANCELLED — reference: ${reference}`);
      break;
    }

    case 'PENDING': {
      // 💡 TODO: Update booking status to pending-payment if not already set
      console.log(`[payat/webhook] PENDING — reference: ${reference}`);
      break;
    }

    default: {
      // Unknown status — log for visibility
      console.warn(`[payat/webhook] Unknown status "${status}" — reference: ${reference}`);
      break;
    }
  }
}

// ─── GET handler (health check) ───────────────────────────────────────────────
// Pay@Go dashboard sometimes does a GET to check if the URL is reachable.
// Return 200 so the health check passes.

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: 'payat-webhook' }, { status: 200 });
}
