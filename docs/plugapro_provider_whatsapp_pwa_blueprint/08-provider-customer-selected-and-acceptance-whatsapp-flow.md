# 08 — Provider Customer Selected and Acceptance WhatsApp Flow

## Task

Implement or align the WhatsApp flow when a customer selects a provider and the provider must accept or decline.

## Message

```text
✅ Customer selected you

The customer selected you for this {{category}} job in {{suburb}}.

Accepting this job uses 1 credit.

Available balance: {{available_credits}} credits
After acceptance: {{remaining_credits}} credits

Reply:
1. Accept job
2. Decline
```

Optional PWA link:

```text
View selected job: {{selected_job_url}}
```

## Acceptance transaction

When provider accepts:

```text
verify lead invite status = customer_selected
verify provider is selected provider
verify request status = provider_confirmation_pending
verify provider has at least 1 credit
deduct 1 credit
write credit ledger
assign job
unlock full customer details
send provider confirmation with full details
send customer confirmation
```

All must be atomic.

## Failure messages

### Insufficient credits

```text
Not enough credits.

You need 1 credit to accept this job.
Your current balance is {{available_credits}}.

No credit was deducted.
```

### Job unavailable

```text
This job is no longer available.
No credit was deducted.
```

### Duplicate accept

```text
This job is already assigned to you.
No additional credit was deducted.
```

## Implementation requirements

1. WhatsApp accept must be fully functional.
2. PWA must not be required.
3. Credit deduction and job assignment must be atomic.
4. Duplicate webhook delivery must not double-deduct.
5. Send clear success/failure message.
6. Add tests.

## Acceptance criteria

- Provider accepts selected job in WhatsApp.
- 1 credit deducted exactly once.
- Job assigned.
- Full customer details sent in WhatsApp after acceptance.
- Customer notified.
- Tests pass.
