# 07 — Provider Interest and Rate Response WhatsApp Flow

## Task

Implement or align provider interest, call-out fee, arrival time, and negotiable-rate capture fully in WhatsApp.

## Flow

```text
Provider replies Interested
↓
Bot asks call-out fee
↓
Bot asks estimated arrival time
↓
Bot asks whether rate is negotiable
↓
Bot optionally asks provider note
↓
Bot confirms response
↓
Customer can see provider in shortlist
```

## Important credit copy

Provider must be told:

```text
No credits are used at this stage.
```

## Confirmation message

```text
Interest submitted.

Call-out: {{call_out_fee}}
Arrival: {{arrival_time}}
Rate: {{rate_summary}}

No credits were used.
We’ll notify you if the customer selects you.
```

## Data captured

```text
lead_invite_id
provider_id
response = interested
call_out_fee
estimated_arrival_at
rate_type
rate_amount optional
negotiable
provider_note optional
```

## Implementation requirements

1. Support WhatsApp multi-step capture.
2. Validate fee.
3. Validate arrival time.
4. Support negotiable flag.
5. Store provider response.
6. Do not deduct credits.
7. Handle duplicate/interrupted responses.
8. Add tests.

## Acceptance criteria

- Provider can respond interested fully in WhatsApp.
- Fee/arrival/rate stored correctly.
- No credit deducted.
- Confirmation sent.
- Tests pass.
