# 03 — Provider WhatsApp Command and State Machine

## Task

Implement or align the provider WhatsApp command model and state machine.

## Required commands

Provider should be able to reply:

```text
menu
credits
jobs
status
profile
availability
help
interested
not interested
accept job
decline
on the way
arrived
start
complete
issue
```

Support common variations:

```text
hi
hello
start
register
find work
balance
credit
my jobs
available
unavailable
```

## Menu

WhatsApp menu should show:

```text
1. View credits
2. View opportunities
3. View active jobs
4. Update availability
5. Update profile
6. Contact support
```

## State machine requirements

The bot must track the provider's current context:

```text
application_capture
application_submitted
pending_review
approved_idle
opportunity_review
interest_capture_callout
interest_capture_arrival
interest_capture_rate
customer_selected_pending_acceptance
accepted_job_active
arrival_confirmation
job_execution
job_completion
support
```

## Implementation requirements

1. Reuse existing WhatsApp state machine where possible.
2. Add missing provider commands.
3. Ensure commands are context-aware.
4. Ensure idempotency for repeated replies and webhook retries.
5. Ensure invalid commands receive helpful responses.
6. Ensure menu is always recoverable.
7. Add tests for command routing.

## Acceptance criteria

- Provider can use `menu` anytime.
- Provider can check credits in WhatsApp.
- Provider can view active jobs in WhatsApp.
- Provider can update availability in WhatsApp.
- Invalid command gives helpful next step.
- Tests pass.
