# 03 — Ops Provider Review and Approval Dashboard

## Task

Implement or align the Ops provider review dashboard so provider approval has clear meaning and supports the WhatsApp-first provider journey.

## Why

The 30-minute auto-approval flow must not blindly approve unvetted providers. Ops needs a proper review workflow.

## Required capabilities

Ops must be able to:

```text
view application queue
filter by pending/more info/approved/rejected/suspended
view provider details
view services/categories
view experience
view work areas
view availability
view rates
view profile/work photos
view documents
view references
approve provider
reject provider with reason
request more information
approve category-specific capability
mark verification level
mark trust level
suspend provider
award starter credits on approval
view approval history
```

## Provider auto-approval change

If an auto-approval cron exists, change it so it does not blindly approve providers.

Allowed automation:

```text
completeness check
duplicate detection
risk flagging
category risk scoring
area support check
document presence check
more-info recommendation
routing to review queue
```

Final approval should require Ops action unless a specific low-risk auto-approval rule is explicitly documented and tested.

## Approval side effects

When provider is approved:

```text
provider status becomes approved/active
approved categories become eligible
starter credits awarded once via ledger
WhatsApp approval message sent
provider becomes eligible for matching
audit log created
```

## Acceptance criteria

- Ops can review and decide applications.
- Auto-approval no longer blindly approves unvetted providers.
- Category-specific approval works or gap is documented.
- Starter credits are awarded once only.
- Approval is audited.
- Tests pass.
