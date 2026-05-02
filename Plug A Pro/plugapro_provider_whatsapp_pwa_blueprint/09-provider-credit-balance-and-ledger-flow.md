# 09 — Provider Credit Balance and Ledger Flow

## Task

Implement or align provider credit balance, credit explanations, and credit history across WhatsApp and PWA.

## WhatsApp commands

Provider can reply:

```text
credits
balance
credit history
```

## Credit summary message

```text
Your credits

Available: {{available_credits}}
Starter/onboarding: {{starter_credits}}
Purchased: {{purchased_credits}}

Credits are used only when you accept a customer-selected job.
```

## Credit ledger entries

Each credit mutation must include:

```text
provider_id
transaction_type
amount
balance_before
balance_after
starter_balance_after
purchased_balance_after
request_id
job_id
lead_invite_id
reason
source
idempotency_key
trace_id
created_at
```

## Rules

Do not deduct credits for:

```text
preview
interest response
shortlist
customer selection
decline
expiry
```

Deduct exactly 1 credit for:

```text
selected provider accepts selected job
```

## Implementation requirements

1. Ensure WhatsApp credits command works.
2. Ensure PWA credits dashboard/history works where available.
3. Ensure ledger is the source of truth or balances are reconciled to ledger.
4. Ensure starter and purchased balances are visible where implemented.
5. Prevent negative balances unless explicitly supported.
6. Add tests.

## Acceptance criteria

- Provider can check credits in WhatsApp.
- Provider can view credit history in PWA if available.
- Credit deductions follow rules.
- Tests pass.
