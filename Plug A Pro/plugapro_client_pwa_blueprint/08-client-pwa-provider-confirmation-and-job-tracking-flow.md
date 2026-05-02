# 08 — Client PWA Provider Confirmation and Job Tracking Flow

## Task

Implement or align the Client PWA state after provider selection through assigned job tracking.

## States

```text
provider_confirmation_pending
assigned
scheduled
arrival_time_confirmed
on_the_way
arrived
in_progress
completed
```

## Waiting for provider confirmation

Display:

```text
You selected {{provider_name}}.

We’re asking them to confirm the job now.
You’ll be notified once accepted.
```

Actions:

```text
Choose another provider, if timeout or decline
Cancel request, if allowed
Contact support
```

## Provider accepted screen

Display:

```text
Your provider accepted the job

Provider: {{provider_name}}
Expected arrival: {{arrival_time}}
Call-out fee: {{call_out_fee}}
```

Actions:

```text
Track job
View provider
Contact support
```

## Job tracking timeline

Show:

```text
Request submitted
Providers matched
You selected provider
Provider accepted
Arrival time confirmed
Provider on the way
Provider arrived
Job in progress
Job completed
```

## Arrival confirmed

Display:

```text
Arrival time confirmed

{{provider_name}} confirmed arrival for:
{{arrival_time}}
```

## Completion

Display:

```text
Job completed

Please confirm everything is in order.
```

Actions:

```text
Rate provider
Report issue
Book again
View invoice/receipt, if available
```

## WhatsApp handoff

WhatsApp messages for provider accepted, arrival confirmed, on the way, arrived, and completed must link to the current job tracking screen.

## Acceptance criteria

- Client sees waiting state after provider selection.
- Client sees assigned state after provider accepts.
- Job timeline reflects backend state.
- Old WhatsApp links resolve to current job state.
- Completed jobs show rating/report actions.
- Tests pass.
