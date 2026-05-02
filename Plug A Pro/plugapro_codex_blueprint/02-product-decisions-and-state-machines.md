# 02 — Product Decisions and State Machines

## Task to execute

Create the official state-machine and product-decision foundation for the Qualified Shortlist Model.

## Why this is needed

The three journeys cannot be implemented safely until statuses and transitions are explicit.

The current system may already have statuses. Reuse existing ones where practical, but align them to the product model.

## Product decision

Plug A Pro will use the **Qualified Shortlist Model**.

```text
Client submits request
↓
System matches suitable approved providers
↓
Providers confirm interest, rate, and availability
↓
Client receives shortlist
↓
Client selects provider
↓
Selected provider accepts job
↓
1 credit is deducted
↓
Full details unlock
```

## Required state machines

### Provider application / provider profile states

Target states:

```text
draft_application
application_submitted
pending_review
more_info_required
approved
trusted
suspended
rejected
inactive
```

Define what each state allows:

| State | Receive leads | Appear in shortlist | Access Worker Portal |
|---|---:|---:|---:|
| draft_application | No | No | No |
| application_submitted | No | No | Limited |
| pending_review | No | No | Limited |
| more_info_required | No | No | Limited |
| approved | Yes | Yes | Yes |
| trusted | Yes | Yes, boosted | Yes |
| suspended | No | No | Read-only or blocked |
| rejected | No | No | No |
| inactive | No | No | Read-only or blocked |

### Client service request states

Target states:

```text
draft
submitted
matching
awaiting_provider_responses
shortlist_ready
customer_selection_pending
provider_confirmation_pending
assigned
scheduled
in_progress
completed
cancelled
expired
```

### Lead invite states

Target states:

```text
created
sent
viewed
interested
not_interested
expired
shortlisted
customer_selected
provider_accepted
provider_declined_after_selection
superseded
cancelled
```

### Job states

Target states:

```text
pending_assignment
provider_selected
assigned
arrival_time_pending
arrival_time_confirmed
on_the_way
arrived
in_progress
completed
cancelled
disputed
```

## Implementation requirements

1. Compare target states to current status fields.
2. Map existing statuses to target statuses.
3. Do not introduce duplicate statuses if existing values are usable.
4. Create shared constants/enums where the app currently uses strings in multiple places.
5. Create transition guards/helper functions.
6. Add comments explaining what each state allows.
7. Update tests around status handling.
8. Log state-machine decisions to OpenBrain.

## Required helper functions

Create or update helpers similar to:

```text
canProviderReceiveLeads(provider)
canProviderAppearInShortlist(provider)
canProviderAccessWorkerPortal(provider)
canRequestRunMatching(request)
canLeadInviteReceiveProviderResponse(invite)
canCustomerSelectProvider(invite)
canProviderAcceptSelectedJob(invite, request, provider)
canProviderViewFullJobDetails(job, provider)
canShowExpiryCountdown(invite)
```

## UI rules

- Show expiry countdown only for pending/offered lead invites.
- Do not show expiry countdown for accepted jobs.
- Do not show accept action for expired, declined, superseded, or cancelled invites.
- Do not show full customer details before provider acceptance.
- Do not show provider as selectable unless provider response is valid.

## Acceptance criteria

- State machines are documented in code or docs.
- Existing statuses are mapped.
- Shared status constants/enums exist.
- Transition helper functions exist.
- Tests cover core state transitions.
- No UI relies only on raw `expires_at` to infer active lead state.
- OpenBrain decision note is logged.

## Risks / edge cases

- There may be existing production data with old statuses.
- Add migration/remediation plan if needed.
- Keep backward compatibility where possible.
