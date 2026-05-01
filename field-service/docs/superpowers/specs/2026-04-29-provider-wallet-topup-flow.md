# Provider Wallet Top-Up Flow

**Date:** 2026-04-29
**Project:** Plug A Pro — field-service
**Status:** Implemented — Payfast gateway (card, EFT, SCode) + manual EFT fallback
**Scope:** Business flow, pricing, payment paths, security rules, known limitations

---

## 1. Business flow narrative

```
Provider selects package (R100 / R200 / R500)
        ↓
Server creates PaymentIntent (status: PENDING_PAYMENT)
        ↓
 ┌──────┴────────┐
 │ Payfast path  │         │ Manual EFT path │
 │               │         │                 │
 Browser POSTed  │         │ Bank instructions
 to Payfast      │         │ shown + WhatsApp
        ↓        │         │        ↓
 Payfast ITN     │         │ Admin reconciles
 arrives at      │         │ on bank statement
 /api/webhooks/  │         │        ↓
 payfast         │         │ Admin credits
        ↓        │         │        ↓
 Signature + IP  │         └→ creditPaymentIntentInTransaction
 verified        │
        ↓        │
 creditProviderWalletFromGatewayItn
        ↓
 Wallet credited + ledger entry + promo check
        ↓
 WhatsApp: "Payment received. X credits added."
```

---

## 2. Package pricing

| Package | Price (ZAR) | Credits | Effective rate |
|---|---|---|---|
| Starter | R100 | 5 | R20 / credit |
| Growth | R200 | 10 | R20 / credit |
| Pro | R500 | 25 | R20 / credit |

**Credit pricing constant:** `CREDIT_VALUE_CENTS = 2000` (R20 per credit). Defined in `lib/provider-credit-payment-intents.ts`. Update this constant to change credit pricing without a schema change.

**Pilot restriction:** R50 (1 credit) is not exposed in the default UI. The service-layer validation (`PAYFAST_ALLOWED_AMOUNTS_CENTS`) enforces the allowed set at the server; the UI only renders the three approved packages.

---

## 3. Payment reference format

| Method | Format | Example |
|---|---|---|
| Manual EFT | `PAP-XXXXXXXX` (8 uppercase alphanumeric) | `PAP-7842-9F3K` |
| Payfast gateway | `PF-XXXXXXXXXXXX` (12 uppercase hex) | `PF-A3B8F2C19E40` |

The prefix distinguishes the two payment rails in admin tooling. The `paymentReference` is stored on `PaymentIntent` and sent to Payfast as `m_payment_id`.

---

## 4. m_payment_id mapping

Payfast's `m_payment_id` field maps to the internal `PaymentIntent.id` (cuid). This enables O(1) intent lookup on ITN arrival without a secondary mapping table.

---

## 5. Critical security rules

**Return URL is not payment proof.** Payfast redirects the provider's browser to `PAYFAST_RETURN_URL` (`/provider/credits?topup=success`) after checkout regardless of payment outcome. The success banner shown there says "payment submitted, pending confirmation" — it never implies the wallet has been credited.

**Wallet crediting happens only after verified ITN with `payment_status = "COMPLETE"`.**

The verification sequence (in `verifyItn`):
1. Source IP must be in Payfast allowlist (unless sandbox).
2. Signature must match re-computed MD5.
3. `payment_status` must equal `"COMPLETE"`.

All three must pass. Any failure → log reason → return HTTP 200 (no credit, no throw).

**Duplicate ITN calls are idempotent.** The `updateMany` optimistic lock on `PaymentIntent.status` ensures at most one crediting transaction commits per intent, regardless of how many ITNs Payfast sends.

---

## 6. Intent lifecycle

```
CREATED → PENDING_PAYMENT → ITN_RECEIVED → CREDITED
                          ↘ FAILED (amount mismatch / non-COMPLETE status)
                          ↘ CANCELLED (Payfast CANCELLED status in ITN)
                          ↘ EXPIRED (future — expiry job not yet wired)
                          ↘ REVERSED (future)
```

For manual EFT:
```
PENDING_PAYMENT → PROOF_UPLOADED → MATCHED_ON_STATEMENT → CREDITED
               ↘ FAILED (admin decision)
```

---

## 7. Admin recovery path

When a Payfast ITN is verified but automatic crediting fails (rare — e.g. DB timeout), the intent remains in `ITN_RECEIVED`. An admin can manually trigger credit from the `/admin/provider-credit-payments/[id]` detail page. The "Credit wallet" form is enabled for `ITN_RECEIVED` Payfast intents. A reason note is required.

The "Mark as matched" form is hidden for Payfast intents (bank statement reconciliation does not apply).

---

## 8. Refund and dispute policy

Not yet implemented. Future design:
- Payfast refunds are initiated via Payfast dashboard.
- On confirmation, a `PAYMENT_REVERSAL` ledger entry removes paid credits (not below zero).
- Promo credits awarded from the reversed top-up are not clawed back.
- Providers retain any credits spent before the reversal.

---

## 9. Known limitations and future enhancements

| Item | Status |
|---|---|
| Promo credit expiry cron job | Not implemented |
| Automated expired-intent cleanup | Not implemented |
| Lead pool cap enforcement | Not implemented |
| Dynamic lead pricing | Not implemented |
| PayShap / direct instant EFT | Not implemented |
| Subscription bundles | Not implemented |
| Rate limiting on intent creation | Not implemented — note added in service layer |
| `wallet_payfast_topup_initiated` WhatsApp template | Pending WhatsApp approval |

---

## 10. File map

| Concern | File |
|---|---|
| Payfast adapter | `lib/payfast.ts` |
| Intent creation (EFT + Payfast) | `lib/provider-credit-payment-intents.ts` |
| Gateway ITN crediting | `lib/provider-credit-gateway-itn.ts` |
| Manual EFT reconciliation | `lib/provider-credit-reconciliation.ts` |
| Wallet service | `lib/provider-wallet.ts` |
| Promo awards | `lib/provider-promo-awards.ts` |
| WhatsApp notifications | `lib/provider-wallet-notifications.ts` |
| ITN webhook handler | `app/api/webhooks/payfast/route.ts` |
| Provider top-up UI | `app/(provider)/provider/credits/` |
| Payfast package selector (client) | `app/(provider)/provider/credits/PayfastPackageSelector.tsx` |
| Payfast form forwarder (client) | `components/provider/PayfastCheckoutForwarder.tsx` |
| Admin credit payments list | `app/(admin)/admin/provider-credit-payments/page.tsx` |
| Admin credit payment detail | `app/(admin)/admin/provider-credit-payments/[id]/page.tsx` |
| Admin actions | `app/(admin)/admin/provider-credit-payments/actions.ts` |
