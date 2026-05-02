# 08 — Ops Job Operations and Escalations

## Task

Implement or align Ops job management and escalation tools for active jobs.

## Required views

Ops should see job reference, request reference, customer, provider, status, arrival time, timeline, current next action, photos, notes, messages, credit transaction, notifications, and exceptions.

## Required actions

Ops may need to:

```text
view job timeline
contact customer/provider
send manual update
reassign job if allowed
cancel job
escalate job
mark issue/dispute
add internal note
view provider status
view notification history
```

## Escalation triggers

Ops should be alerted for provider did not accept selected job, provider did not confirm arrival, provider no-show, customer complaint, notification failure, job stuck in state too long, credit deduction failed, and assignment conflict.

## Acceptance criteria

- Ops can monitor jobs.
- Ops can see stuck jobs.
- Ops can intervene with audit.
- Tests pass.
