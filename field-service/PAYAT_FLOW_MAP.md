# PayAt Flow Map

Last updated: 2026-05-23 16:00 SAST

## Scope

This map separates the two PayAt-related payment surfaces found in the repository:

- Legacy provider wallet top-up flow using `PAYAT_*` variables and `lib/payat/*`.
- PayAtGo booking RTP flow using `PAYAT_GO_*` variables and `lib/payat-go/*`.

No code changes have been made for this investigation phase.

## Evidence Index

- E-001: `lib/payat/payment.ts` creates legacy provider wallet RTP requests using `PAYAT_API_BASE`, `PAYAT_MERCHANT_IDENTIFIER`, and `/integrator/rtp/create/single/{merchantIdentifier}`.
- E-002: `lib/payat/token.ts` obtains legacy PayAt tokens from `PAYAT_TOKEN_URL` using HTTP Basic auth plus `grant_type=client_credentials`.
- E-003: `lib/payat-go/client.ts` obtains PayAtGo tokens from a derived `/yapi/oauth/token` URL using form fields `client_id`, `client_secret`, `grant_type`, and `scope`.
- E-004: `lib/payat-go/client.ts` sends booking RTP requests to `/integrator/rtp/create/single/{merchantIdentifier}` and status reads to `/integrator/rtp/read/{merchantIdentifier}/{clientAccountNumber}`.
- E-005: `app/api/provider/wallet/top-up-intents/route.ts` exposes a JSON API for provider wallet top-ups and defaults `paymentMethod` to `PAYAT`.
- E-006: `app/(provider)/provider/credits/actions.ts` exposes a server action for the `/provider/credits` UI and calls `createPayatTopUpIntent`.
- E-007: `app/api/payat/webhook/route.ts` handles legacy PayAt wallet webhook callbacks and credits provider wallets.
- E-008: `app/api/payat-go/booking/[bookingId]/route.ts` creates booking payment requests through `createPayAtGoBookingPaymentRequest`.
- E-009: `app/api/payat-go/booking/[bookingId]/status/route.ts` refreshes booking payment status by polling PayAtGo.
- E-010: `app/api/payat-go/callback/route.ts` handles PayAtGo callbacks using a shared secret header, then polls PayAtGo for authoritative status.
- E-011: `prisma/schema.prisma` has `Payment` for booking payments and `PaymentIntent` for provider wallet top-ups.
- E-012: Vercel production logs from 2026-05-23 15:33 SAST show `POST /provider/credits` activity, not `/api/payat-go/*` booking activity.
- E-013: Vercel production logs from the same window show `POST /api/payat/webhook` returning 307 redirects.
- E-014: `vercel env ls` shows `PAYAT_GO_*` variables present except `PAYAT_GO_MERCHANT_IDENTIFIER`; legacy `PAYAT_MERCHANT_IDENTIFIER` exists in Production and Preview.
- E-015: PayAt Swagger config exposes grouped OpenAPI documents at `/yapi/v3/api-docs/integrator`, `/merchant`, and `/ecommerce`.
- E-016: Integrator OpenAPI server is `https://go.payat.co.za/yapi/v1`; token URL is `https://go.payat.co.za/yapi/oauth/token`.
- E-017: Integrator RTP create path is `POST /integrator/rtp/create/single/{merchantIdentifier}` with scope `rtp:create:single`.
- E-018: Integrator RTP read path is `GET /integrator/rtp/read/{merchantIdentifier}/{clientAccountNumber}` with scope `rtp:read`.
- E-019: Integrator RTP cancel path is `PUT /integrator/rtp/cancel/single/{merchantIdentifier}/{clientAccountNumber}` with scope `rtp:cancel:single`.
- E-020: Integrator create success returns HTTP 201 with required `requestToPayId` and `sourceReference`; `paymentLink` is optional.
- E-021: Fresh `vercel env pull --environment=production` shows `PAYAT_TOKEN_URL` as the Swagger token URL and `PAYAT_MERCHANT_IDENTIFIER` as present, but does not expose enough sensitive values to run a local production-credential test.
- E-022: Controlled POST to the production webhook route currently reaches the route and returns HTTP 401 invalid signature; earlier 307 events were not reproduced by the current direct-path request.

## Legacy Provider Wallet PayAt Top-Up Flow

```text
Provider opens /provider/credits
-> components/provider/credits/index.tsx calls createProviderPayatTopUpIntent()
-> app/(provider)/provider/credits/actions.ts authenticates provider
-> createPayatTopUpIntent() in lib/provider-credit-payment-intents.ts
-> creates PaymentIntent row with paymentMethod=PAYAT and status=PENDING_PAYMENT
-> lib/payat/token.ts fetches OAuth access token from PAYAT_TOKEN_URL
-> lib/payat/payment.ts POSTs RTP create request to PAYAT_API_BASE + /integrator/rtp/create/single/{PAYAT_MERCHANT_IDENTIFIER}
-> PayAt response is parsed into paymentLink/sourceReference/requestToPayId
-> PaymentIntent is updated with PayAt identifiers and metadata
-> frontend redirects to /provider/credits/intent/[intentId]
-> provider sees PayAt link/reference/QR and may receive WhatsApp notification
-> PayAt posts callback to /api/payat/webhook
-> app/api/payat/webhook/route.ts validates x-payat-signature with PAYAT_WEBHOOK_SECRET
-> route normalizes payload, locates PaymentIntent, verifies amount, and marks ITN_RECEIVED
-> creditProviderWalletFromPayatWebhook() credits paid wallet ledger
-> provider wallet UI/status polling sees CREDITED
```

## PayAtGo Booking RTP Flow

```text
Customer/admin initiates payment for a booking
-> frontend should POST /api/payat-go/booking/[bookingId]
-> app/api/payat-go/booking/[bookingId]/route.ts authenticates session and verifies booking access
-> route loads quote amount and customer details from Booking -> Match -> JobRequest -> Customer
-> createPayAtGoBookingPaymentRequest() validates amount/currency and idempotency
-> lib/payat-go/client.ts fetches OAuth access token from derived PAYAT_GO_BASE_URL ../oauth/token
-> lib/payat-go/client.ts POSTs /integrator/rtp/create/single/{PAYAT_GO_MERCHANT_IDENTIFIER}
-> booking Payment row is upserted with pspProvider=payat_go and pspCheckoutId=clientAccountNumber
-> API returns paymentLink, PayAt reference if present, expiry, and WhatsApp-ready message
-> frontend displays payment instruction/link/reference
-> status can be refreshed via GET /api/payat-go/booking/[bookingId]/status
-> callback can be received at /api/payat-go/callback if PayAtGo is configured to call it
-> callback handler verifies x-payat-go-secret or x-callback-secret
-> callback handler extracts accountNumber/clientAccountNumber and reads current status from PayAtGo
-> applyProviderStatusToPayment() marks Payment PAID only after provider status maps to PAID
-> handlePaymentSuccess() updates booking/payment side effects
```

## Runtime Observation From Latest Retest

The latest observed phone retest did not exercise the PayAtGo booking API. Production logs show authenticated provider traffic to `/provider/credits`, including `POST /provider/credits`, which is the legacy provider wallet route group.

No `/api/payat-go/booking/*` request was found in the same log window.

## Configuration Map

| Variable | Loaded by | Observed runtime presence | Notes |
|---|---|---:|---|
| `PAYAT_TOKEN_URL` | `lib/payat/token.ts` | Production pull: `https://go.payat.co.za/yapi/oauth/token` | Matches Swagger token URL. |
| `PAYAT_CLIENT_ID` | `lib/payat/token.ts` | Listed in Vercel; empty in pulled file | Secret redacted/unavailable locally; runtime value unconfirmed. |
| `PAYAT_CLIENT_SECRET` | `lib/payat/token.ts` | Listed in Vercel; empty in pulled file | Secret redacted/unavailable locally; runtime value unconfirmed. |
| `PAYAT_SCOPES` | `lib/payat/token.ts` | Optional | Defaults to `rtp:create:single`; production diagnostic proved RTP create requires this scope. |
| `PAYAT_API_BASE` | `lib/payat/payment.ts` | Listed in Vercel; empty in pulled file | Runtime value unconfirmed; expected Swagger server is `https://go.payat.co.za/yapi/v1`. |
| `PAYAT_MERCHANT_IDENTIFIER` | `lib/payat/payment.ts` | Production pull: present, 10 chars | Value is merchant-sensitive; do not print raw. |
| `PAYAT_MERCHANT_ID` | config/docs | Production/Preview/Development: present | Not observed in current legacy RTP client code path. |
| `PAYAT_WEBHOOK_SECRET` | `app/api/payat/webhook/route.ts` | Listed in Vercel; empty in pulled file | Secret redacted/unavailable locally; runtime value unconfirmed. |
| `PAYAT_MERCHANT_FEE_FIXED_CENTS` | WhatsApp top-up helpers | Unknown in Vercel listing | `.env.local.example` documents default/optional fee. |
| `PAYAT_GO_BASE_URL` | `lib/payat-go/client.ts` | Listed in Vercel; empty in pulled file | Required for booking PayAtGo flow; runtime value unconfirmed. |
| `PAYAT_GO_MERCHANT_IDENTIFIER` | `lib/payat-go/client.ts` | Not present in Vercel listing | Current booking PayAtGo flow should fail fast without this. |
| `PAYAT_GO_CLIENT_ID` | `lib/payat-go/client.ts` | Production/Preview: present | Secret redacted. |
| `PAYAT_GO_CLIENT_SECRET` | `lib/payat-go/client.ts` | Production/Preview: present | Secret redacted. |
| `PAYAT_GO_GRANT_TYPE` | `lib/payat-go/client.ts` | Production/Preview: present | Expected `client_credentials`; value not printed. |
| `PAYAT_GO_SCOPES` | `lib/payat-go/client.ts` | Production/Preview: present | Value not printed; must be confirmed against Swagger/OpenAPI. |
| `PAYAT_GO_CALLBACK_SECRET` | `app/api/payat-go/callback/route.ts` | Production/Preview: present | Secret redacted. |
| `PAYAT_GO_WEBHOOK_SECRET` | `app/api/payat-go/callback/route.ts` | Not shown separately in Vercel latest list | Callback route falls back to this if callback secret absent. |
| `PAYAT_GO_ENABLED` | `lib/payat-go/client.ts`, `lib/payat-go/booking-payments.ts` | Production/Preview: present | Value not printed. |
| `PAYAT_GO_MOCK_MODE` | `lib/payat-go/client.ts`, status route | Production/Preview: present | Value not printed. |
| `PSP_PROVIDER` | `lib/payments.ts` | Production/Preview: present | Booking checkout provider selection outside PayAtGo-specific routes. |
| `PAYMENT_COLLECTION_MODE` | `lib/payments.ts` | Production/Preview: present | Controls checkout vs bypass in generic payment layer. |
| `APP_PUBLIC_URL` | notification/link builders | Production: present | Used for public links. |
| `NEXT_PUBLIC_APP_URL` | frontend/link builders | Production: present | Client-visible value. |

## Phase 1 Open Items

- Run a server-runtime diagnostic or local test-credential probe because the production env pull does not expose enough values for a local minimal PayAt request.
- Capture the actual generated app PayAt request for one new provider wallet top-up attempt; latest logs do not include the outbound PayAt response line.
- Confirm why earlier `/api/payat/webhook` requests returned 307 if PayAt still reports callback redirects; current direct-path test reaches the route.
