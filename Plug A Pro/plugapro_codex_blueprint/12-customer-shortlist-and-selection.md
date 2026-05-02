# 12 — Customer Shortlist and Selection

## Task to execute

Implement customer shortlist generation, provider comparison cards, profile view, and provider selection.

## Why this is needed

The customer must be able to compare suitable providers and select one instead of the system blindly assigning a provider.

## Shortlist source

Shortlist includes providers who:

```text
passed eligibility filters
received invite
responded interested
submitted call-out fee
submitted estimated arrival
are still eligible
```

## Provider card fields

Show:

```text
provider name
profile photo
service category
years of experience
verification badge
call-out fee
rate / negotiable flag
estimated arrival time
rating, if available
completed jobs, if available
short bio
previous work photos
view profile
select provider
```

Do not show provider private personal data.

## Customer actions

```text
view profile
select provider
ask for more options
cancel request
```

## Selection flow

When customer selects a provider:

```text
request.status = provider_confirmation_pending
lead_invite.status = customer_selected
selected_provider_id = provider_id
notify selected provider
```

Do not deduct credits at customer selection stage.

## Customer message

```text
You selected {{provider_name}}.

We’re asking them to confirm the job now. You’ll be notified once accepted.
```

## Provider selected message

```text
✅ Customer selected you

The customer selected you for this {{category}} job in {{suburb}}.

Accepting this job uses 1 credit.

Available balance: {{available_credits}} credits
After acceptance: {{remaining_credits}} credits

Accept job?
```

## Implementation requirements

1. Create shortlist generation from provider responses.
2. Create customer shortlist view.
3. Create provider profile card view.
4. Allow customer to select provider.
5. Notify selected provider.
6. Mark non-selected providers according to product rule:
   - keep as backup, or
   - mark superseded.
7. Do not reveal full customer details yet.
8. Do not deduct credits yet.
9. Use production URLs in messages.

## Acceptance criteria

- Client can view shortlist.
- Shortlist shows interested providers only.
- Provider cards include rate and availability.
- Client can view provider profile.
- Client can select provider.
- Selected provider receives confirmation request.
- No credit deducted at selection.
- Full customer details remain hidden.
- Tests pass.

## Test cases

```text
shortlist contains interested providers
shortlist excludes declined providers
shortlist excludes expired providers
provider card renders call-out fee
provider card renders estimated arrival
client selects provider
selected invite status updated
request status updated
selected provider notified
no credit deducted on selection
```
