# 13 — Provider Final Acceptance, Credit Deduction, and Detail Unlock

## Task to execute

Implement selected provider final acceptance, atomic credit deduction, job assignment, and full customer detail unlock.

## Why this is needed

The provider should only spend credits when they accept a customer-selected job. This is the commercial point where the lead becomes valuable.

## Credit rule

Charge **1 credit only when the selected provider accepts the selected job**.

Do not charge for:

```text
receiving preview
viewing preview
responding interested
appearing in shortlist
customer viewing provider profile
customer selecting provider
declining
expiry
```

## Acceptance transaction

When provider accepts:

```text
BEGIN TRANSACTION

1. Lock selected lead invite
2. Verify invite status = customer_selected
3. Verify provider is selected provider
4. Verify request status = provider_confirmation_pending
5. Verify provider has >= 1 available credit
6. Deduct 1 credit
7. Write credit ledger entry
8. Create or activate job
9. Assign job to provider
10. Set request.status = assigned
11. Set lead_invite.status = provider_accepted
12. Unlock full details for provider
13. Write job activity log
14. Queue customer notification
15. Queue provider confirmation

COMMIT
```

Rollback if any step fails.

## Credit ledger entry

```text
transaction_type = SELECTED_JOB_ACCEPTED_CREDIT_SPENT
amount = -1
provider_id
request_id
job_id
lead_invite_id
balance_before
balance_after
source = whatsapp_accept or pwa_accept
idempotency_key
trace_id
created_at
```

## Provider success message

```text
✅ Job accepted

You used 1 credit.

Available balance: {{available_credits}} credits
Starter/onboarding: {{starter_credits}}
Purchased: {{purchased_credits}}

Full customer details are now unlocked.

View job:
{{job_url}}
```

## Customer success message

```text
✅ Your provider accepted the job

Provider: {{provider_name}}
Expected arrival: {{arrival_time}}
Call-out fee: {{call_out_fee}}

You can view your request here:
{{ticket_url}}
```

## Full details unlocked

Provider can now see:

```text
full customer name
customer mobile number
full address
unit/complex details
access notes
full job details
customer contact actions
arrival time confirmation
job status actions
```

## Error handling

Known errors:

```text
INSUFFICIENT_CREDITS
LEAD_INVITE_NOT_SELECTED
PROVIDER_NOT_SELECTED
REQUEST_NOT_AWAITING_CONFIRMATION
LEAD_EXPIRED
LEAD_ALREADY_ACCEPTED
CREDIT_DEDUCTION_FAILED
JOB_ASSIGNMENT_FAILED
DUPLICATE_ACCEPT_IGNORED
```

## Acceptance criteria

- Selected provider can accept job.
- 1 credit deducted exactly once.
- Ledger records balance before/after.
- Job assigned to provider.
- Full details unlock after acceptance.
- Provider receives credit confirmation.
- Customer receives provider accepted message.
- Duplicate accept does not double-deduct.
- Insufficient credits blocks acceptance.
- Tests pass.

## Test cases

```text
selected provider accepts successfully
credit deducted once
job assigned
full details unlocked
provider receives confirmation
customer receives confirmation
insufficient credits blocks acceptance
decline does not deduct credits
duplicate accept idempotent
credit failure rolls back job assignment
job assignment failure rolls back credit deduction
non-selected provider cannot accept
```
