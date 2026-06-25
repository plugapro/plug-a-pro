# Payments And Credit Wallet Incident Runbook

## Detect

- Payment callbacks fail.
- Payment intent has paid status without wallet ledger entry.
- Wallet reconciliation mismatch or negative-balance block occurs.

## Triage

1. Confirm provider payment gateway status.
2. Inspect payment intent, callback audit, and wallet ledger entries.
3. Verify idempotency key scope and duplicate callback handling.
4. Confirm promo and paid credits remain separated.

## Mitigate

- Replay callbacks only through approved replay tooling.
- Never manually edit wallet balances without immutable ledger entries.
- Escalate payment-provider credential or settlement issues to operations.

## Close

Record affected provider IDs, payment intent IDs, ledger evidence, replay result, and reconciliation status in OpenBrain without exposing payment credentials.
