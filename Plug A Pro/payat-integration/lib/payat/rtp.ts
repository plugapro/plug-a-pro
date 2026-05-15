// lib/payat/rtp.ts
// Creates a Pay@ Request-to-Pay (RTP) — the payment object customers pay against.
// One RTP per booking deposit/payment. Returns a paymentLink to redirect the customer to.

import { getPayatToken } from './token';

// ─── Input shape ──────────────────────────────────────────────────────────────

export interface CreateRtpInput {
  /** Unique 14-digit numeric string that identifies this payment in your system.
   *  Generate with: String(Date.now()).padStart(14, '0').slice(-14)
   *  Or use a zero-padded booking ID: String(bookingId).padStart(14, '0')
   */
  clientAccountNumber: string;

  /** Amount in CENTS as a string — e.g. "10000" for R100.00 */
  amountCents: string;

  /** Human-readable description shown on the Pay@ payment screen */
  description: string;

  /** Your internal reference for this payment (booking ID, invoice number, etc.) */
  clientReferenceNumber: string;

  /** Customer's full name, shown on the payment page */
  customerName: string;

  /** Customer mobile in E.164 format — "+27XXXXXXXXX" */
  customerMobile: string;

  /** Customer email address */
  customerEmail: string;

  /** Line items shown on the payment breakdown */
  lineItems: Array<{
    description: string;
    /** Amount in cents as a string */
    amount: string;
  }>;

  /** How many days the payment link stays valid (default 7) */
  daysValid?: string;
}

// ─── Response shape ───────────────────────────────────────────────────────────

export interface CreateRtpResult {
  /** Pay@'s internal ID for this RTP — store this, used to look up payment status */
  requestToPayId: string;

  /** The URL to redirect (or WhatsApp to) the customer so they can pay */
  paymentLink: string;

  /** Pay@'s source reference — matches what Pay@ sends in webhook callbacks */
  sourceReference: string;

  /** Raw response from Pay@ — useful for debugging and audit logging */
  raw: Record<string, unknown>;
}

// ─── Service function ─────────────────────────────────────────────────────────

export async function createRtp(input: CreateRtpInput): Promise<CreateRtpResult> {
  // Fetch a valid (cached) OAuth token before calling the YAPI API
  const token = await getPayatToken();

  const apiBase = process.env.PAYAT_API_BASE || 'https://go.payat.co.za/yapi/v1';
  const merchantId = process.env.PAYAT_MERCHANT_ID || '';
  const merchantIdentifier = process.env.PAYAT_MERCHANT_IDENTIFIER || '';

  if (!merchantId || !merchantIdentifier) {
    throw new Error('PAYAT_MERCHANT_ID and PAYAT_MERCHANT_IDENTIFIER must be set');
  }

  const {
    clientAccountNumber,
    amountCents,
    description,
    clientReferenceNumber,
    customerName,
    customerMobile,
    customerEmail,
    lineItems,
    daysValid = '7',
  } = input;

  // Build the Pay@ YAPI RTP request body
  // Amounts must be strings in cents — Pay@ rejects numeric values
  const body = {
    clientAccountNumber,                          // unique 14-digit ID we generate per RTP
    amount:             amountCents,              // e.g. "10000" = R100
    minimumAmount:      amountCents,              // lock min == max so customer can't pay less
    maximumAmount:      amountCents,              // lock max == min so customer can't overpay
    description,
    clientReferenceNumber,
    merchantDisplayName: 'Plug A Pro',
    notificationNumber:  customerMobile,          // Pay@ notifies customer here (WhatsApp/SMS)
    customerNameSurname: customerName,
    customerMobileNumber: customerMobile,
    customerEmail,
    daysValid,
    merchantEcommerceStoreName: 'PLUGAPRO',
    // Where Pay@ redirects the browser after payment attempt
    successReturnUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://plug-a-pro-main.vercel.app'}/payment/success`,
    failureReturnUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://plug-a-pro-main.vercel.app'}/payment/failure`,
    lineItems,
    multiPremium: 1,                              // required by Pay@ YAPI — enables the ecommerce flow
  };

  // POST to the YAPI RTP creation endpoint
  const res = await fetch(
    `${apiBase}/integrator/ecommerce/rtp/create/single/${merchantIdentifier}`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store', // never cache payment requests
    }
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Pay@ RTP creation failed (${res.status}): ${text}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Pay@ RTP response is not valid JSON: ${text}`);
  }

  // Validate the fields we need are present in the response
  if (!data.requestToPayId) {
    throw new Error(`Pay@ RTP response missing requestToPayId: ${JSON.stringify(data)}`);
  }
  if (!data.paymentLink) {
    throw new Error(`Pay@ RTP response missing paymentLink: ${JSON.stringify(data)}`);
  }

  return {
    requestToPayId:  String(data.requestToPayId),
    paymentLink:     String(data.paymentLink),
    sourceReference: String(data.sourceReference ?? data.requestToPayId),
    raw:             data,
  };
}

// ─── Helper: generate a unique 14-digit clientAccountNumber ──────────────────
// Call this when creating an RTP if you don't have a booking ID yet.

export function generateClientAccountNumber(): string {
  // Timestamp gives 13 digits in 2026 — pad to 14 just in case
  return String(Date.now()).padStart(14, '0').slice(-14);
}
