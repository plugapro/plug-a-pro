# 09 — Client Request Submission and Notifications

## Task to execute

Implement or upgrade request submission, customer notifications, and matching trigger for the client service request flow.

## Why this is needed

After a client submits a request, the system must confirm submission, explain what happens next, and trigger matching.

## Submission flow

```text
Client reviews request
↓
Client submits request
↓
Request status becomes submitted
↓
Customer receives confirmation
↓
Request status becomes matching
↓
Matching job runs
↓
Customer is told providers are being checked
```

## Required messages

### Request submitted

```text
✅ Request submitted

We’ve received your {{category}} request in {{suburb}}, {{city}}.

We’re checking suitable providers in your area.

Your phone number and exact address will only be shared after you select a provider and that provider accepts the job.

Ref: {{request_ref}}
```

### Matching in progress

```text
We’re matching your request with suitable providers based on service type, area, availability, experience, and rate.
```

### Shortlist pending

```text
Suitable providers are reviewing your request. We’ll send you options as soon as they respond.
```

## Implementation requirements

1. Ensure request submission is transactional.
2. Validate all required fields before submission.
3. Confirm attachments are ready before final submission, or clearly mark failed attachments.
4. Generate request reference.
5. Trigger matching workflow.
6. Send customer WhatsApp confirmation.
7. Use production public URLs where links are included.
8. Log request submission and notification attempts.
9. Add idempotency to avoid duplicate submission effects.

## Acceptance criteria

- Request can be submitted once.
- Customer receives confirmation.
- Matching is triggered.
- Request state transitions are correct.
- Duplicate submit does not create duplicate matching runs.
- Notification failure is logged.
- Tests pass.

## Test cases

```text
valid request submits successfully
missing required field blocks submission
photo still pending blocks or warns according to product rule
request ref generated
customer notification sent
matching triggered once
duplicate submit handled idempotently
notification failure logged with trace ID
```
