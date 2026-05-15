# Payfast Adapter

**Date:** 2026-04-29
**Project:** Plug A Pro — field-service
**Status:** Implemented and deployed to production
**Scope:** Payfast payment gateway adapter — MD5 signature, ITN verification, checkout payload, IP allowlist

---

## 1. Scope

The Payfast adapter (`lib/payfast.ts`) is the single point of contact between Plug A Pro and the Payfast payment gateway. It has no knowledge of the provider wallet, ledger, or any other internal domain. Every other module that touches Payfast calls this module's exported functions and must not replicate its logic.

**What it handles:**
- Checkout payload construction (fields + MD5 signature)
- ITN (Instant Transaction Notification) signature verification
- Source IP validation against Payfast's known notification server ranges
- Sandbox vs live environment switching
- Payfast payment method code mapping

**What it does not handle:**
- Wallet balance changes
- Intent lifecycle management
- WhatsApp notifications
- Admin reconciliation

---

## 2. Merchant account configuration

All config comes from environment variables. No values are hardcoded.

| Variable | Purpose |
|---|---|
| `PAYFAST_MERCHANT_ID` | Merchant ID from Payfast dashboard |
| `PAYFAST_MERCHANT_KEY` | Merchant key from Payfast dashboard (never sent to browser) |
| `PAYFAST_PASSPHRASE` | Set in Payfast dashboard; empty string if not configured |
| `PAYFAST_SANDBOX` | `"true"` for sandbox, `"false"` or omitted for live |
| `PAYFAST_NOTIFY_URL` | ITN handler endpoint: `https://app.plugapro.co.za/api/webhooks/payfast` |
| `PAYFAST_RETURN_URL` | Browser redirect after checkout: `https://app.plugapro.co.za/provider/credits?topup=success` |
| `PAYFAST_CANCEL_URL` | Browser redirect on cancel: `https://app.plugapro.co.za/provider/credits?topup=cancelled` |

**CRITICAL:** The return URL is not payment proof. Payfast redirects the provider's browser there regardless of payment outcome. Wallet crediting must never be triggered from the return URL handler.

---

## 3. Supported payment methods

| Internal constant | Payfast code | Label |
|---|---|---|
| `PAYFAST_CARD` | `cc` | Credit / debit card |
| `PAYFAST_EFT` | `ef` | Instant EFT (banking app) |
| `PAYFAST_SCODE` | `sc` | Scan to Pay (QR / SnapScan) |

**Important:** EFT code is `ef`, NOT `eft`. Using `eft` silently breaks checkout. This is confirmed from live Payfast documentation and production credentials (2026-04-29).

---

## 4. Signature algorithm

Payfast requires an MD5 signature over all non-empty form fields (excluding the signature field itself).

**Steps:**
1. Collect all non-empty parameters in their insertion order (order matters — reordering produces a different hash).
2. URL-encode each value using percent-encoding with spaces as `+` (not `%20`).
3. Concatenate as a query string: `key=value&key=value`.
4. If `PAYFAST_PASSPHRASE` is non-empty, append `&passphrase=<url_encoded_passphrase>`.
5. MD5-hash the resulting UTF-8 string.
6. Return as lowercase hex (32 characters).

**Note:** `merchant_key` is included in signature computation but must NOT be sent to the browser in the form fields. The signature itself goes in the form as the `signature` field.

Implementation: `generateSignature(params, passphrase)` in `lib/payfast.ts`.

---

## 5. ITN verification sequence

`verifyItn(payload, remoteIp, config)` validates in this order:

1. **IP validation** — if not sandbox, the remote IP must be in `PAYFAST_LIVE_NOTIFY_IPS`. If IP cannot be determined (`null`/empty), reject. In sandbox mode this check is skipped.
2. **Signature present** — if `signature` field is absent, reject.
3. **Signature match** — re-compute MD5 over received fields (excluding `signature`), compare using `timingSafeEqual`. Reject on mismatch.
4. **Payment status** — if `payment_status !== "COMPLETE"`, reject.

Returns `{ valid: true }` only when all four checks pass. Returns `{ valid: false, reason }` on any failure.

---

## 6. IP allowlist

Payfast sends ITNs only from a known set of server IPs. The list is maintained in `lib/payfast.ts` as `PAYFAST_LIVE_NOTIFY_IPS`.

**Ranges as of 2026-04-29 (confirmed from live Payfast account):**

| Range | CIDR | IPs |
|---|---|---|
| 197.97.145.144/28 | /28 | .144–.159 |
| 41.74.179.192/27 | /27 | .192–.223 |
| 102.216.36.0/28 | /28 | .0–.15 |
| 102.216.36.128/28 | /28 | .128–.143 |
| 144.126.193.139 | single host | — |

**Maintenance:** When Payfast updates their IP ranges, update the `expandCidr` calls in `lib/payfast.ts` and re-deploy. Verify at `https://developers.payfast.co.za/docs`.

In sandbox mode, IP validation is skipped entirely — any IP (or no IP) is acceptable.

---

## 7. Always-200 rule

The ITN handler (`app/api/webhooks/payfast/route.ts`) always returns HTTP 200 to Payfast, even on verification failure or unhandled errors. Payfast retries ITNs on non-200 responses, which would cause duplicate-ITN storms. Validation failures are logged internally with their reason but are never surfaced as HTTP errors.

---

## 8. WhatsApp notification events

| Trigger | Function | Template |
|---|---|---|
| Payfast top-up created | `notifyProviderPayfastTopUpInitiated` | `wallet_payfast_topup_initiated` |
| Wallet credited (any method) | `notifyProviderPaymentCredited` | `wallet_payment_credited` |

Both calls are fire-and-forget outside their respective transactions. Failure is logged but does not roll back any data mutation.

**Note:** The `wallet_payfast_topup_initiated` template requires WhatsApp approval before it delivers in production. The notification will fail silently until approved.

---

## 9. Checkout form POST

Payfast checkout requires a form POST (not a GET redirect). The browser must submit a hidden HTML form to `checkout.action` with all fields from `checkout.fields`. The `PayfastCheckoutForwarder` client component (`components/provider/PayfastCheckoutForwarder.tsx`) handles this auto-submission on mount.

---

## 10. Environment notes

Sandbox and live Payfast use different endpoint URLs:
- Live: `https://www.payfast.co.za/eng/process`
- Sandbox: `https://sandbox.payfast.co.za/eng/process`

`getPayfastConfig()` reads `PAYFAST_SANDBOX` at request time. Setting `PAYFAST_SANDBOX=true` routes all checkouts and ITN processing to sandbox behaviour.
