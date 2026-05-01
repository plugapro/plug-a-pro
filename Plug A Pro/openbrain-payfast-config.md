# OpenBrain — Payfast Integration Configuration Reference
## Plug-A-Pro · field-service app

**Created:** 2026-04-29  
**Source:** Retrieved directly from live Payfast merchant dashboard (my.payfast.io)  
**Account name:** DisciplinedEdge  
**Purpose:** Claude Code reference for implementing Tasks 0–10 of the Payfast provider wallet top-up integration

---

> ⚠️ **Security rule for Claude Code:**  
> The credential values in this document must be placed in `.env.local` only.  
> `.env.local` must be in `.gitignore` and must never be committed to the repository.  
> Do not hardcode any of these values in source files.  
> Do not log any of these values to the console in production.

---

## Environment Variables — Live Account

These are the exact values to place in `field-service/.env.local` for the live Payfast environment.

```env
# Payfast Live Credentials
# Source: my.payfast.io → Dashboard and Settings → Developer Settings
# Account: DisciplinedEdge (lebogang@kgolaentle.com)

PAYFAST_MERCHANT_ID=34260853
PAYFAST_MERCHANT_KEY=9h6okkw8xmgod
PAYFAST_PASSPHRASE=DEdge.PayF4st_2026
PAYFAST_SANDBOX=false

# Live Payfast endpoint URLs
PAYFAST_CHECKOUT_URL=https://www.payfast.co.za/eng/process
PAYFAST_VALIDATE_URL=https://www.payfast.co.za/eng/query/validate

# Your app ITN webhook endpoint (update path once Task 4 route is built)
PAYFAST_NOTIFY_URL=https://app.plugapro.co.za/api/webhooks/payfast

# Your app redirect URLs (UI only — never treated as payment proof)
PAYFAST_RETURN_URL=https://app.plugapro.co.za/wallet/top-up/success
PAYFAST_CANCEL_URL=https://app.plugapro.co.za/wallet/top-up/cancel

# Credit pricing constant — R20 per credit (2000 cents)
# Do not hardcode this value elsewhere — always reference this env var
CREDIT_VALUE_CENTS=2000
```

---

## Environment Variables — Sandbox Account (for development/testing)

> ⚠️ The sandbox account must be created separately at `sandbox.payfast.co.za`.  
> Sandbox credentials are completely separate from the live account above.  
> Never test against the live account.

```env
# Payfast Sandbox Credentials
# Register at: https://sandbox.payfast.co.za
# After registering, find credentials on the sandbox dashboard

PAYFAST_MERCHANT_ID=<your-sandbox-merchant-id>
PAYFAST_MERCHANT_KEY=<your-sandbox-merchant-key>
PAYFAST_PASSPHRASE=<your-sandbox-passphrase>
PAYFAST_SANDBOX=true

# Sandbox Payfast endpoint URLs
PAYFAST_CHECKOUT_URL=https://sandbox.payfast.co.za/eng/process
PAYFAST_VALIDATE_URL=https://sandbox.payfast.co.za/eng/query/validate

# Sandbox ITN — must be a publicly reachable URL, not localhost
# Use ngrok or Cloudflare Tunnel during local development
# Example: PAYFAST_NOTIFY_URL=https://abc123.ngrok.io/api/webhooks/payfast
PAYFAST_NOTIFY_URL=<your-ngrok-or-tunnel-url>/api/webhooks/payfast

PAYFAST_RETURN_URL=http://localhost:3000/wallet/top-up/success
PAYFAST_CANCEL_URL=http://localhost:3000/wallet/top-up/cancel

CREDIT_VALUE_CENTS=2000
```

---

## ITN Notification Settings — Confirmed Live Dashboard State

| Setting | Value |
|---|---|
| ITN Status | **Enabled On** ✅ |
| Current Notify URL | `https://app.plugapro.co.za/` |
| **Required action** | Update Notify URL to full path once Task 4 is deployed |

**Notify URL to set after Task 4 deployment:**  
`https://app.plugapro.co.za/api/webhooks/payfast`

Update this in: **Payfast Dashboard → Settings → Developer Settings → Notifications Settings → Notify URL**

---

## Payfast IP Allowlist — Updated April 2026

> ⚠️ Payfast announced an extended IP range in April 2026 (visible on dashboard).  
> The adapter ITN verification must whitelist ALL of the following ranges.  
> Store these in a config constant — not hardcoded inline — so they can be updated without a code change.

```typescript
// field-service/src/modules/payments/payfast/config.ts
// Updated: 2026-04-29 — verified from developers.payfast.co.za/docs#ports-ips

export const PAYFAST_ALLOWED_IP_RANGES = [
  '197.97.145.144/28',  // 197.97.145.144 – 197.97.145.159
  '41.74.179.192/27',   // 41.74.179.192  – 41.74.179.223
  '102.216.36.0/28',    // 102.216.36.0   – 102.216.36.15
  '102.216.36.128/28',  // 102.216.36.128 – 102.216.36.143
  '144.126.193.139',    // Single IP
] as const;

export const PAYFAST_ALLOWED_DOMAINS = [
  'www.payfast.co.za',
  'sandbox.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
] as const;

export const PAYFAST_ITN_PORTS = [80, 8080, 8081, 443] as const;
```

---

## Payment Method Codes — Confirmed from Payfast Docs

These are the exact string values to pass in the `payment_method` field of the Payfast checkout payload.

| Internal enum value | Payfast code | Description |
|---|---|---|
| `PAYFAST_CARD` | `cc` | Credit card |
| `PAYFAST_EFT` | `ef` | Instant EFT |
| `PAYFAST_SCODE` | `sc` | SCode |

> Note: If `payment_method` is omitted from the checkout payload, Payfast shows all available methods. For Plug-A-Pro MVP, pass the value the provider selected so they land on the correct payment screen.

---

## Checkout Payload Reference

**Live URL:** `https://www.payfast.co.za/eng/process`  
**Sandbox URL:** `https://sandbox.payfast.co.za/eng/process`  
**Method:** HTTP POST (form submission)

Required field order for signature generation (order matters — do not alphabetise):

```
merchant_id
merchant_key
return_url
cancel_url
notify_url
name_first          (optional but recommended)
name_last           (optional but recommended)
email_address       (optional but recommended)
m_payment_id        (our internal intent ID)
amount              (formatted as "100.00" — two decimal places, ZAR)
item_name           (e.g. "Plug-A-Pro Credits — 5 credits")
item_description    (optional — e.g. "R100 top-up · 5 Plug-A-Pro Credits")
payment_method      (cc | ef | sc)
signature           (MD5 hash — computed last, over all non-empty fields above)
```

**Signature algorithm:**
1. Concatenate all non-empty fields as `key=urlencoded(value)&` in the order above
2. Remove the trailing `&`
3. Append `&passphrase=urlencoded(PAYFAST_PASSPHRASE)` if passphrase is set (it is — always append it)
4. MD5 hash the resulting string → lowercase hex
5. Pass as `signature` field

---

## ITN Payload — Fields Received from Payfast

Key fields Claude Code must handle in the ITN handler (Task 4):

| Field | Type | Notes |
|---|---|---|
| `m_payment_id` | string | Maps to our `ProviderWalletTopUpIntent.id` |
| `pf_payment_id` | integer | Payfast's own transaction ID — store as `payfastPaymentId` |
| `payment_status` | string | Must be `COMPLETE` to credit. Also: `CANCELLED`, `FAILED` |
| `amount_gross` | decimal string | e.g. `"100.00"` — convert to cents: `Math.round(parseFloat(v) * 100)` |
| `amount_fee` | decimal string | Payfast's fee deducted |
| `amount_net` | decimal string | Net credited to merchant account |
| `merchant_id` | integer | Validate matches `PAYFAST_MERCHANT_ID` |
| `signature` | MD5 hash | Verify before any action |

**ITN Validation sequence (Task 4 must follow this exact order):**
1. Validate source IP against `PAYFAST_ALLOWED_IP_RANGES`
2. Verify MD5 signature (exclude `signature` field, append passphrase, MD5)
3. Look up `ProviderWalletTopUpIntent` by `m_payment_id`
4. Check idempotency — if status is already `CREDITED`, return 200, do nothing
5. Validate `payment_status === 'COMPLETE'`
6. Validate `amount_gross` matches intent `amountCents` (convert to cents, compare integers)
7. Optionally: POST to `PAYFAST_VALIDATE_URL` for server-side confirmation
8. Call `creditProviderWalletFromTopUp(intentId)`
9. Return HTTP 200 always — regardless of outcome

---

## Top-Up Package Pricing — Confirmed Business Rules

| Package label | Amount (ZAR) | Amount (cents) | Credits issued | Rate |
|---|---|---|---|---|
| Starter | R100 | 10000 | 5 | R20/credit |
| Growth | R200 | 20000 | 10 | R20/credit |
| Pro | R500 | 50000 | 25 | R20/credit |

**Credit calculation:** `creditsToIssue = amountCents / CREDIT_VALUE_CENTS`  
**`CREDIT_VALUE_CENTS` = 2000 (R20)**  
**Minimum top-up:** R100 (10000 cents)  
**R50 package:** Do not expose in pilot UI. May be added later.

---

## Sandbox Setup Checklist — Before Running Task 2 Tests

- [ ] Register sandbox account at `https://sandbox.payfast.co.za`
- [ ] Copy sandbox Merchant ID and Merchant Key into `.env.local`
- [ ] Set a passphrase in sandbox dashboard (Settings → Developer Settings → Security Passphrase)
- [ ] Copy sandbox passphrase into `.env.local`
- [ ] Set `PAYFAST_SANDBOX=true` in `.env.local`
- [ ] Install ngrok or Cloudflare Tunnel for ITN testing
- [ ] Set `PAYFAST_NOTIFY_URL` to your tunnel URL + `/api/webhooks/payfast`
- [ ] Confirm sandbox ITN is enabled and Notify URL is set in sandbox dashboard

---

## Payment Page Settings — Confirmed Dashboard State

| Setting | Current State |
|---|---|
| Enable require signature | **Enabled Off** |

> This means Payfast does not currently require an encrypted payload on the payment page. Leave this off for MVP. It can be enabled later for additional security if needed.

---

## Merchant Account Setup — Decision Log

**Decision (2026-04-29):** The Payfast merchant account is registered under the DisciplinedEdge business entity (lebogang@kgolaentle.com, Merchant ID: 34260853). DisciplinedEdge is not yet operationally active, so this account is being repurposed exclusively for Plug-A-Pro during the MVP pilot.

**Account separation strategy:** Rather than creating a second merchant account now, all Plug-A-Pro payment intents must use the `pap_` prefix on `m_payment_id` values. This ensures every Plug-A-Pro transaction is identifiable in Payfast reporting and logs, even though no separate account exists yet.

**`m_payment_id` format:**
```
pap_{intentId}
```
Example: `pap_cm9abc123def456`

This prefix must be applied consistently wherever `m_payment_id` is set — in the checkout payload builder and in the ITN handler when looking up the intent. Strip the `pap_` prefix before querying `ProviderWalletTopUpIntent` by ID.

**Future action:** When DisciplinedEdge becomes operationally active OR when Plug-A-Pro is incorporated as a standalone entity, create a dedicated Payfast merchant account and update `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, and `PAYFAST_PASSPHRASE` in the environment. No code changes required — only `.env.local` updates.

---

## Key Rules for Claude Code — Never Break These

```
1. PAYFAST_RETURN_URL is never payment proof. Never trigger wallet credit from return URL.
2. Wallet credit happens only after verified ITN with payment_status = COMPLETE.
3. ITN handler always returns HTTP 200 — even on failure. Never return 4xx or 5xx to Payfast.
4. Duplicate ITN calls for the same intent must not double-credit (idempotency guard).
5. Invalid signature = reject silently, log internally, return 200.
6. Wrong amount = reject, set intent to FAILED, return 200.
7. Never log PAYFAST_PASSPHRASE or PAYFAST_MERCHANT_KEY to console or error logs.
8. Never hardcode CREDIT_VALUE_CENTS = 2000 inline. Always reference the env constant.
9. Sandbox credentials are separate from live. Never mix them.
10. Do not commit .env.local to git.
11. Always prefix m_payment_id with "pap_" (e.g. pap_{intentId}). Strip prefix before DB lookup.
```

---

## Related OpenBrain Documents

- `field-service/docs/superpowers/specs/payfast-adapter.md` — Adapter interface spec (to be created in Task 2)
- `field-service/docs/superpowers/specs/provider-wallet-ledger.md` — Wallet ledger principles (to be created in Task 1)
- `field-service/docs/superpowers/specs/provider-wallet-topup-flow.md` — End-to-end flow spec (to be created in Task 3)
- `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md` — Discovery findings (to be created in Task 0)
- `payfast-wallet-topup-claude-code-tasks.md` — Full Claude Code implementation task instructions (Tasks 0–10)

---

*Logged by Claude · Plug-A-Pro Cowork session · 2026-04-29*  
*Credentials sourced directly from live Payfast dashboard — my.payfast.io*
