# Pay@ Integration — Claude Code Implementation Tasks
# Plug A Pro / Kgolaentle Solutions
# Primary payment method (PayFast is secondary)

---

## Account Credentials & Config

| Item | Value |
|---|---|
| Merchant ID | 418856 |
| Business | KGOLAENTLE SOLUTIONS (PTY) LTD |
| Display Name | Plug A Pro |
| Client ID | Retrieve from email sent to lebogang@kgolaentle.com |
| Client Secret | Retrieve from email sent to lebogang@kgolaentle.com |
| Pay@Go Dashboard | https://go.payat.co.za/app/secure/business/settings |
| Pay@ OAuth Token URL | https://go.payat.co.za/oauth/token |
| Pay@ API Base URL | https://go.payat.co.za/api/v1 |
| Webhook URL (production) | https://plug-a-pro-main.vercel.app/api/payat/webhook |
| Webhook URL (preview) | https://plug-a-pro-main.vercel.app/api/payat/webhook |

---

## Payment Model Context

Plug A Pro providers top up their wallet to get credits:
- R100 = 5 credits
- R200 = 10 credits
- R500 = 25 credits
- 1 credit = R20

Pay@ is the **primary** payment gateway for wallet top-ups — covering:
- QR code payments (retail cash at stores like Shoprite, Pick n Pay, Checkers)
- Payment links (sent via WhatsApp or SMS)
- Online card payments via Pay@ hosted page

PayFast handles card payments as a **secondary/fallback** option.

---

## Environment Variables Required

Add these to Vercel (plug-a-pro-main project) and your local `.env.local`:

```
PAYAT_CLIENT_ID=<from email>
PAYAT_CLIENT_SECRET=<from email>
PAYAT_MERCHANT_ID=418856
PAYAT_WEBHOOK_SECRET=<generate a random 32-char hex string for HMAC validation>
PAYAT_API_BASE=https://go.payat.co.za/api/v1
PAYAT_TOKEN_URL=https://go.payat.co.za/oauth/token
```

---

## Task 1 — Pay@ OAuth Token Service

**Task to execute:**
Create `lib/payat/token.ts` — a server-side service that fetches and caches a Pay@ OAuth access token.

**Why it is needed:**
Every Pay@ API call requires a valid Bearer token. Tokens expire, so we need to fetch a new one when the current one is stale, without hammering the token endpoint on every request.

**What good output looks like:**
- `getPayatToken()` returns a valid access token string
- Token is cached in memory (or Redis/Upstash if available) with a TTL of token expiry minus 60 seconds
- Uses `PAYAT_CLIENT_ID` and `PAYAT_CLIENT_SECRET` from env
- Fails fast with a descriptive error if env vars are missing

**Acceptance criteria:**
- `getPayatToken()` makes a POST to `PAYAT_TOKEN_URL` with `grant_type=client_credentials`
- Response `access_token` and `expires_in` are cached
- Second call within TTL returns cached token without a network request
- On 401 from Pay@ API, the cached token is invalidated and a fresh one is fetched

**Risks and edge cases:**
- Token endpoint may be slow — add a 5-second timeout
- Clock skew: subtract 60s from `expires_in` before caching
- Do not log the token value anywhere

**Files likely affected:**
- `lib/payat/token.ts` (new)
- `lib/payat/index.ts` (new barrel export)

**Test expectations:**
- Unit test: mock fetch, assert token is cached on second call
- Unit test: expired token triggers a fresh fetch

```typescript
// lib/payat/token.ts
// Fetches and caches a Pay@ OAuth2 access token using client_credentials grant.
// Token is stored in module-level cache with expiry tracking.

interface TokenCache {
  token: string;
  expiresAt: number; // Unix ms
}

let cache: TokenCache | null = null;

export async function getPayatToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cache && Date.now() < cache.expiresAt) {
    return cache.token;
  }

  const clientId = process.env.PAYAT_CLIENT_ID;
  const clientSecret = process.env.PAYAT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYAT_CLIENT_ID and PAYAT_CLIENT_SECRET must be set');
  }

  // POST to Pay@ token endpoint
  const res = await fetch(process.env.PAYAT_TOKEN_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(5000), // 5s timeout
  });

  if (!res.ok) {
    throw new Error(`Pay@ token fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Cache with 60s buffer before real expiry
  cache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cache.token;
}

// Call this to force a token refresh (e.g. after a 401 response)
export function invalidatePayatToken(): void {
  cache = null;
}
```

---

## Task 2 — Pay@ Payment Request Service

**Task to execute:**
Create `lib/payat/payment.ts` — a service that creates a Pay@ payment request and returns a QR code URL and payment link.

**Why it is needed:**
When a provider selects a wallet top-up amount (R100/R200/R500), we need to create a Pay@ payment request and return a QR code (for retail cash payment) and a payment link (for WhatsApp delivery).

**What good output looks like:**
- `createPayatPaymentRequest(params)` returns `{ qrCodeUrl, paymentLink, reference }`
- Reference is a unique ID tied to the `walletTopup` record in the DB
- Amount is in ZAR cents (R100 = 10000)

**Acceptance criteria:**
- POST to `PAYAT_API_BASE/payment-request` with correct headers
- Body includes `merchantId`, `amount`, `reference`, `description`, `notifyUrl`
- Returns QR code URL and payment deep link
- Reference is stored in `walletTopup.payatReference` column
- If Pay@ returns a non-2xx, log the error and throw (do not swallow)

**Risks and edge cases:**
- Duplicate reference: use `topupId` as the Pay@ reference — always unique
- Amount validation: only R100, R200, R500 accepted — validate before calling Pay@
- Timeout: add 10s timeout on the API call

**Files likely affected:**
- `lib/payat/payment.ts` (new)
- `lib/payat/index.ts` (updated exports)
- `prisma/schema.prisma` — add `payatReference String?` to `WalletTopup` model
- `app/api/wallet/topup/route.ts` — wire up Pay@ as primary provider

**Test expectations:**
- Unit test: mock fetch, assert correct request body is sent
- Unit test: assert returned reference matches input topupId
- Integration test: end-to-end topup creation creates a Pay@ payment request

```typescript
// lib/payat/payment.ts
// Creates a Pay@ payment request for a wallet top-up.

import { getPayatToken, invalidatePayatToken } from './token';

export interface PayatPaymentRequest {
  topupId: string;        // Used as Pay@ reference
  amountCents: number;    // e.g. 10000 for R100
  description: string;   // e.g. "Plug A Pro wallet top-up R100"
}

export interface PayatPaymentResponse {
  reference: string;
  qrCodeUrl: string;
  paymentLink: string;
}

export async function createPayatPaymentRequest(
  params: PayatPaymentRequest
): Promise<PayatPaymentResponse> {
  // Validate allowed amounts: R100, R200, R500
  const allowedAmounts = [10000, 20000, 50000];
  if (!allowedAmounts.includes(params.amountCents)) {
    throw new Error(`Invalid top-up amount: ${params.amountCents} cents`);
  }

  const token = await getPayatToken();
  const merchantId = process.env.PAYAT_MERCHANT_ID;
  const notifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/payat/webhook`;

  const res = await fetch(`${process.env.PAYAT_API_BASE}/payment-request`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      merchantId,
      amount: params.amountCents,
      reference: params.topupId,
      description: params.description,
      notifyUrl,
    }),
    signal: AbortSignal.timeout(10000),
  });

  // If 401, invalidate cached token and retry once
  if (res.status === 401) {
    invalidatePayatToken();
    return createPayatPaymentRequest(params);
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Pay@ payment request failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return {
    reference: params.topupId,
    qrCodeUrl: data.qrCodeUrl,
    paymentLink: data.paymentLink,
  };
}
```

---

## Task 3 — Pay@ Webhook Handler

**Task to execute:**
Create `app/api/payat/webhook/route.ts` — a Next.js API route handler that receives Pay@ payment notifications and updates the wallet on successful payment.

**Why it is needed:**
When a provider completes a cash payment at a retail store, Pay@ POSTs a notification to our webhook. We must validate the payload, find the matching `walletTopup` record, mark it paid, and credit the provider's wallet.

**What good output looks like:**
- POST `/api/payat/webhook` validates HMAC signature
- Finds `walletTopup` by `payatReference`
- If status is `PAID` or `COMPLETED`, marks topup as paid and credits wallet in a single DB transaction
- Responds with HTTP 200 immediately (Pay@ retries on non-200)
- Idempotent — processing the same webhook twice does not double-credit

**Acceptance criteria:**
- HMAC validation uses `PAYAT_WEBHOOK_SECRET` and SHA-256
- Unknown or invalid signature returns 401 (not 200)
- `walletTopup.status` transitions: `PENDING` → `PAID`
- `providerWallet.credits` is incremented by correct amount
- `walletTopup.paidAt` is set to current timestamp
- A `walletLedger` entry is created with `source: 'PAYAT'`
- Already-processed webhook (status already PAID) is silently ignored (return 200)

**Risks and edge cases:**
- Pay@ may send duplicate notifications — check `topup.status !== 'PAID'` before processing
- Webhook may arrive before the topup record exists (race condition) — return 200 and log a warning, do not error
- Failed DB transaction must not return 200 — return 500 so Pay@ retries

**Files likely affected:**
- `app/api/payat/webhook/route.ts` (new)
- `lib/payat/webhook.ts` (HMAC validation helper)
- `prisma/schema.prisma` — ensure `WalletTopup` has `payatReference`, `paidAt`, `status`
- `lib/wallet/credit.ts` — reuse existing `creditProviderWallet()` if it exists, otherwise create it

**Test expectations:**
- Unit test: valid HMAC passes, invalid HMAC returns 401
- Unit test: PAID status credits wallet exactly once
- Unit test: duplicate webhook (already PAID) returns 200 without double-credit
- Integration test: full webhook flow — topup created → webhook received → wallet credited

```typescript
// app/api/payat/webhook/route.ts
// Handles Pay@ payment notifications. Validates HMAC, updates walletTopup,
// credits provider wallet in a single atomic DB transaction.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { prisma } from '@/lib/prisma';

// Validates Pay@ HMAC signature
function isValidSignature(body: string, signature: string): boolean {
  const secret = process.env.PAYAT_WEBHOOK_SECRET;
  if (!secret) throw new Error('PAYAT_WEBHOOK_SECRET is not set');
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}

// Credit amounts per top-up value (cents → credits)
const TOPUP_CREDITS: Record<number, number> = {
  10000: 5,   // R100 = 5 credits
  20000: 10,  // R200 = 10 credits
  50000: 25,  // R500 = 25 credits
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-payat-signature') ?? '';

  // Validate HMAC signature
  if (!isValidSignature(rawBody, signature)) {
    console.warn('[payat/webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { reference, status, amount } = payload;

  // Only process completed payments
  if (status !== 'PAID' && status !== 'COMPLETED') {
    return NextResponse.json({ received: true });
  }

  // Find the wallet top-up record
  const topup = await prisma.walletTopup.findUnique({
    where: { id: reference },
  });

  if (!topup) {
    // May arrive before record exists — log and acknowledge
    console.warn(`[payat/webhook] No topup found for reference: ${reference}`);
    return NextResponse.json({ received: true });
  }

  // Idempotency check — already processed
  if (topup.status === 'PAID') {
    return NextResponse.json({ received: true });
  }

  const credits = TOPUP_CREDITS[amount];
  if (!credits) {
    console.error(`[payat/webhook] Unknown amount: ${amount}`);
    return NextResponse.json({ error: 'Unknown amount' }, { status: 400 });
  }

  // Atomic transaction: mark topup paid + credit wallet + write ledger entry
  try {
    await prisma.$transaction([
      prisma.walletTopup.update({
        where: { id: reference },
        data: { status: 'PAID', paidAt: new Date(), paymentProvider: 'PAYAT' },
      }),
      prisma.providerWallet.update({
        where: { providerId: topup.providerId },
        data: { credits: { increment: credits } },
      }),
      prisma.walletLedger.create({
        data: {
          providerId: topup.providerId,
          topupId: topup.id,
          credits,
          amountCents: amount,
          source: 'PAYAT',
          description: `Wallet top-up via Pay@ — ${credits} credits`,
        },
      }),
    ]);
  } catch (err) {
    console.error('[payat/webhook] DB transaction failed:', err);
    // Return 500 so Pay@ retries
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
```

---

## Task 4 — Wallet Top-Up API Route (Pay@ Primary)

**Task to execute:**
Update `app/api/wallet/topup/route.ts` to use Pay@ as the primary payment provider. PayFast remains as a secondary option selected by the provider.

**Why it is needed:**
The existing topup route likely creates a PayFast payment. We need to add a `provider` field so providers can choose Pay@ (default) or PayFast, and route accordingly.

**What good output looks like:**
- POST body: `{ amount: 100 | 200 | 500, provider: 'PAYAT' | 'PAYFAST' }`
- Default `provider` is `'PAYAT'` if not specified
- Returns `{ topupId, qrCodeUrl, paymentLink }` for Pay@
- Returns `{ topupId, paymentUrl }` for PayFast
- Creates a `walletTopup` DB record with `status: 'PENDING'` and correct `paymentProvider`

**Acceptance criteria:**
- Unauthenticated requests return 401
- Invalid amount returns 400
- Pay@ path creates payment request and returns QR + link
- PayFast path creates payment and returns redirect URL
- `walletTopup` record is always created before payment provider is called

**Files likely affected:**
- `app/api/wallet/topup/route.ts`
- `lib/payat/payment.ts`
- `lib/payfast/payment.ts` (existing)
- `prisma/schema.prisma` — `WalletTopup.paymentProvider` enum: `PAYAT | PAYFAST`

---

## Task 5 — Vercel Environment Variables

**Task to execute:**
Add Pay@ environment variables to the Vercel project `plug-a-pro-main`.

**Why it is needed:**
The Pay@ integration will fail silently in production without these vars set.

**Steps (manual or via Vercel CLI):**
```bash
vercel env add PAYAT_CLIENT_ID production
vercel env add PAYAT_CLIENT_SECRET production
vercel env add PAYAT_MERCHANT_ID production
vercel env add PAYAT_WEBHOOK_SECRET production
vercel env add PAYAT_API_BASE production
vercel env add PAYAT_TOKEN_URL production
```

Values:
- `PAYAT_CLIENT_ID` — from email sent to lebogang@kgolaentle.com
- `PAYAT_CLIENT_SECRET` — from email sent to lebogang@kgolaentle.com
- `PAYAT_MERCHANT_ID` — `418856`
- `PAYAT_WEBHOOK_SECRET` — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `PAYAT_API_BASE` — `https://go.payat.co.za/api/v1`
- `PAYAT_TOKEN_URL` — `https://go.payat.co.za/oauth/token`

Also add `PAYAT_WEBHOOK_SECRET` to the Pay@Go dashboard webhook config.

---

## Task 6 — Pay@ Webhook Registration (Dashboard)

**Task to execute:**
Register the webhook URL in the Pay@Go dashboard.

**Steps:**
1. Go to https://go.payat.co.za/app/secure/business/settings
2. Scroll to **Payment Notification Webhook**
3. Click **+ Add Webhook**
4. Enter: `https://plug-a-pro-main.vercel.app/api/payat/webhook`
5. Save

This must be done before any payments can notify the backend.

---

## Task 7 — Provider Top-Up UI (WhatsApp + PWA)

**Task to execute:**
Update the provider wallet top-up flow to show Pay@ as the primary option with QR code display and WhatsApp payment link sharing.

**Why it is needed:**
Providers need to see the QR code on screen (for retail cash payment) and get the payment link sent to their WhatsApp.

**What good output looks like:**
- Provider selects R100/R200/R500
- By default, Pay@ is selected
- On submit: QR code is displayed full-screen
- Payment link is sent to provider's WhatsApp: *"Tap here to pay for your Plug A Pro wallet top-up: [link]"*
- On successful payment (webhook fires): WhatsApp message: *"✅ Your wallet has been topped up! You now have X credits."*
- PayFast is shown as "Pay by card" secondary option

**Files likely affected:**
- `app/(provider)/wallet/topup/page.tsx`
- `components/wallet/TopupForm.tsx`
- `components/wallet/QRCodeDisplay.tsx` (new)
- `lib/whatsapp/templates.ts` — add top-up link template

---

## Execution Order

Run these tasks in this order:
1. Task 5 — Set Vercel env vars (required first)
2. Task 1 — Token service
3. Task 2 — Payment request service
4. Task 3 — Webhook handler
5. Task 4 — Topup API route update
6. Task 6 — Register webhook in Pay@Go dashboard
7. Task 7 — UI update

---

## Notes

- Pay@ API docs: check the Pay@Go dashboard FAQ or contact Tyler de Wet at Pay@
- The Client ID from the earlier (now-expired) session started with `59-fa0c-4e62-b7d5-`
- The new Client Secret was emailed to lebogang@kgolaentle.com after the reset
- Merchant ID is confirmed as **418856**
- Pay@ webhook signature header is expected to be `x-payat-signature` — verify this in the Pay@ API docs before deploying Task 3
