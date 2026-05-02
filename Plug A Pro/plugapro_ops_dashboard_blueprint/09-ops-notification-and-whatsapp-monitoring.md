# 09 — Ops Notification and WhatsApp Monitoring

## Task

Implement or align Ops monitoring for WhatsApp and notification events.

## Required visibility

Ops should see notification type, recipient role, masked phone, request/job/provider/customer reference, channel, template/message name, status, provider response, WhatsApp message ID, error code, retry count, last attempt, and trace ID.

## Required actions

Ops may:

```text
retry failed notification
send manual support message where allowed
view message timeline
filter failed/pending/sent
view webhook inbound history
view duplicate webhook handling
```

## Important flows to monitor

```text
client request submitted
shortlist ready
provider selected
provider accepted
provider opportunity preview
provider interest submitted
customer selected provider
job accepted
arrival confirmed
on the way
arrived
completed
lead expired
```

## Acceptance criteria

- Ops can see notification failures.
- Ops can retry safely.
- Webhook inbound/outbound messages are traceable.
- Tests pass.
