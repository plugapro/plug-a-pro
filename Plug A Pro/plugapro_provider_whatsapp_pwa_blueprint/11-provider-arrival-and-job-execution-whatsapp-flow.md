# 11 — Provider Arrival and Job Execution WhatsApp Flow

## Task

Implement or align provider arrival confirmation and job status updates fully in WhatsApp.

## Commands

Provider can reply:

```text
14:00
confirm arrival 14:00
on the way
arrived
start
complete
issue
```

## Arrival confirmation

Provider sends arrival time.

Bot replies:

```text
Arrival time confirmed.

Customer has been notified:
{{arrival_time}}
```

Customer receives update.

## Job status updates

### On the way

```text
Status updated: On the way.
Customer notified.
```

### Arrived

```text
Status updated: Arrived.
Customer notified.
```

### Start

```text
Status updated: Job in progress.
```

## Implementation requirements

1. Support WhatsApp commands for arrival/job status.
2. Validate provider is assigned to job.
3. Validate job state allows transition.
4. Notify customer where appropriate.
5. Prevent duplicate notifications from webhook retries.
6. Update job timeline/activity log.
7. Add tests.

## Acceptance criteria

- Provider can confirm arrival in WhatsApp.
- Provider can mark on the way in WhatsApp.
- Provider can mark arrived in WhatsApp.
- Provider can start job in WhatsApp.
- Customer receives appropriate updates.
- Tests pass.
