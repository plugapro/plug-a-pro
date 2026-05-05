# 07 — Ops Credit Ledger and Adjustments

## Task

Implement or align Ops credit ledger visibility and audited credit adjustment tooling.

## Required views

Ops/finance should see provider, available credits, starter/onboarding credits, purchased credits, reserved credits if supported, ledger entries, transaction type, amount, balance before/after, related request/job/lead, source, reason, created by, trace ID, and timestamp.

## Required actions

Authorized users may:

```text
award promo/starter credits
add purchased credits if manually needed
reverse/refund credits
adjust credits with reason
view reconciliation
export ledger
```

## Rules

- No direct balance mutation without ledger entry.
- Adjustments require reason.
- Adjustments require proper role.
- Adjustments are audited.
- Provider WhatsApp credit balance must reflect server-side balance.

## Acceptance criteria

- Ops can view provider credit ledger.
- Adjustments are role-protected.
- Adjustments write ledger entries.
- Balance reconciles with ledger.
- Tests pass.
