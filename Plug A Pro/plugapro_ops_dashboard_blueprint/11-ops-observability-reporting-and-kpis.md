# 11 — Ops Observability, Reporting, and KPIs

## Task

Implement or align Ops observability and operational KPIs for the new journeys.

## Required dashboard metrics

```text
new requests
requests matching
requests awaiting provider responses
shortlists ready
customer selections pending provider acceptance
assigned jobs
jobs stuck by state
provider applications pending review
providers approved/rejected
notification failures
matching failures
credit deduction failures
scheduler failures
```

## Matching KPIs

```text
average providers eligible per request
average provider response time
shortlist creation time
customer selection time
provider acceptance time
no-match rate
no-response rate
```

## Provider KPIs

```text
active providers
approved providers
trusted providers
suspended providers
provider response rate
acceptance rate
no-show rate
completion rate
credit balance distribution
```

## Scheduler observability

Show last run time, next run time, duration, records processed, success/failure, error message, trace ID, and manual rerun option where safe.

## Acceptance criteria

- Ops has basic operational visibility.
- Scheduler health is visible.
- Matching and notification failures are visible.
- Tests pass where practical.
