# Provider Wallet Ledger

**Date:** 2026-04-29
**Project:** Plug A Pro — field-service
**Status:** Implemented (wallet foundation + Payfast gateway + lead unlocks)
**Scope:** Provider wallet model, ledger principles, credit types, balance rules, idempotency, admin adjustments

---

## 1. Wallet model

Every provider has exactly one `ProviderWallet` (created on first credit if not yet present). The wallet tracks:

| Field | Meaning |
|---|---|
| `paidCreditBalance` | Credits from top-up payments. Non-negative. |
| `promoCreditBalance` | Credits from promotional awards. Non-negative. Expire. |
| `reservedCreditBalance` | Reserved for future hold-and-capture (currently unused). |
| `status` | `ACTIVE` / `SUSPENDED` / `CLOSED` |

**Invariant:** Neither `paidCreditBalance` nor `promoCreditBalance` may go below zero. Both fields have database-level `CHECK` constraints enforcing this.

---

## 2. Ledger-first principle

The `WalletLedgerEntry` table is the source of truth for wallet history. Every credit or debit creates an entry before the balance field is updated. The `balanceAfterPaidCredits` and `balanceAfterPromoCredits` columns on each entry snapshot the post-transaction state, enabling full audit and replay.

**Rule:** No code outside `lib/provider-wallet.ts` may modify `paidCreditBalance` or `promoCreditBalance` directly.

---

## 3. Ledger entry types

| `WalletLedgerEntryType` | Direction | Description |
|---|---|---|
| `TOPUP_CREDIT` | + | Credits from a confirmed payment (EFT or gateway) |
| `PROMO_CREDIT` | + | Credits from a promotional campaign or first-top-up award |
| `LEAD_UNLOCK_DEBIT` | − | Credits spent to unlock a matched lead |
| `LEAD_REFUND_CREDIT` | + | Credits refunded after a lead dispute resolution |
| `ADMIN_ADJUSTMENT` | ± | Manual admin adjustment (requires reason) |
| `PROMO_EXPIRY` | − | Promo credits removed at expiry (future — not yet wired to a cron job) |
| `PAYMENT_REVERSAL` | − | Credits reversed after a confirmed payment refund (future) |

---

## 4. Credit types

| `WalletCreditType` | Used for |
|---|---|
| `PAID` | All `TOPUP_CREDIT`, `LEAD_UNLOCK_DEBIT`, `LEAD_REFUND_CREDIT`, and `PAYMENT_REVERSAL` entries |
| `PROMO` | All `PROMO_CREDIT` and `PROMO_EXPIRY` entries |

---

## 5. Credit consumption order

When a lead unlock debit is applied, promo credits are consumed first, then paid credits. This ensures providers get maximum value from paid credits while promotional credits expire naturally.

Implementation: `debitCreditsInTransaction` in `lib/provider-wallet.ts`.

---

## 6. Idempotency strategy for crediting

**All crediting paths use an optimistic lock:**

```sql
UPDATE payment_intents
SET status = 'CREDITED', credited_at = NOW()
WHERE id = $intentId
  AND status IN (creditable statuses)
  AND credited_at IS NULL
```

If `updateMany.count !== 1`, another request already claimed the credit and the current transaction rolls back. The caller returns `{ credited: false, reason: 'already credited' }` without throwing.

There is also a pre-transaction guard (check `status === 'CREDITED' || creditedAt != null`) to avoid opening a transaction in the common idempotent case.

---

## 7. Transaction and row-locking pattern

Crediting runs in a Prisma `$transaction`. Inside the transaction:

1. Optimistic-lock the intent via `updateMany` with a status predicate.
2. Call `creditPaidCreditsInTransaction(tx, providerId, creditsToIssue, ...)` — this creates the ledger entry and increments the balance.
3. Call `awardFirstTopUpPromoCreditsInTransaction(tx, providerId, intentId, actorId)` — awards 5 promo credits on first ever top-up.
4. Link the ledger entry ID back onto the intent (`creditedLedgerEntryId`).

Post-transaction (outside `$transaction`, fire-and-forget):
- WhatsApp `notifyProviderPaymentCredited` notification.
- Any future event hooks.

Failure in post-transaction steps must never roll back the credit.

---

## 8. Admin adjustment convention

Admin adjustments use `entryType = ADMIN_ADJUSTMENT` and `creditType = PAID` (for paid balance adjustments) or `PROMO` (for promo balance adjustments). A reason is mandatory — stored in the ledger entry `description` field and logged in `AdminAuditEvent`.

**No-negative-balance invariant:** Admin adjustments that would reduce either balance below zero must be rejected before the transaction commits. The database `CHECK` constraint is the last guard; service-layer validation should enforce this earlier.

---

## 9. Promo credit rules

- Non-transferable: promo credits cannot be transferred between wallets.
- Non-refundable: promo credits are not refunded on payment reversal.
- Expiry: promo credits have an `expiresAt` timestamp. A cron job (not yet implemented) will create `PROMO_EXPIRY` entries at expiry.
- First-top-up award: 5 promo credits are awarded to every provider on their first successful wallet top-up. This check is idempotent — it verifies no prior `PROMO_CREDIT` entries exist for the provider before awarding.

---

## 10. Creditable statuses by path

| Path | Creditable statuses |
|---|---|
| Admin manual credit (EFT) | `PENDING_PAYMENT`, `PROOF_UPLOADED`, `MATCHED_ON_STATEMENT` |
| Admin manual credit (Payfast recovery) | `PENDING_PAYMENT`, `ITN_RECEIVED` |
| Gateway ITN auto-credit | `PENDING_PAYMENT`, `ITN_RECEIVED` |

`ITN_RECEIVED` means Payfast confirmed payment but automatic crediting failed. Admin crediting in this state requires an admin note (ITN data serves as the reconciliation trail — no bank reference needed).
