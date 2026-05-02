# 06 — Ops Scheduler and Cron Redesign

## Task

Redesign and align scheduler/cron jobs with the new journeys.

## Known current jobs to investigate

```text
auto-match every 5 minutes
auto-approval of new service providers every 30 minutes
```

## Matching scheduler

Must support:

```text
find submitted requests needing matching
run eligibility filters
score providers
create provider opportunity invites
send safe WhatsApp previews
expire stale invites
detect enough provider responses
generate/publish shortlist
notify customer when shortlist ready
escalate no providers found
escalate no provider responses
avoid duplicate invites
avoid duplicate shortlists
```

Must not:

```text
blindly assign provider
deduct credits
unlock full customer details
bypass customer selection
```

## Provider review scheduler

If auto-approval exists, replace or constrain it.

Safe scheduler actions:

```text
mark application incomplete
detect duplicates
detect missing required fields
flag high-risk categories
route to Ops review
send more-info reminder
send pending review reminders
```

Must not:

```text
blindly approve providers
award credits without approval
make provider eligible for matching without review
```

## Expiry/reminder scheduler

Support:

```text
provider opportunity expiry
selected-provider confirmation timeout
customer shortlist reminder
provider response reminder
job arrival reminder
stale job escalation
failed notification retry
credit ledger reconciliation
```

## Scheduler hardening

Each job must have idempotency, locking/concurrency control, trace IDs, structured logs, safe retries, failure visibility in Ops dashboard, and safe manual run option.

## Acceptance criteria

- Auto-match aligns to shortlist model.
- Auto-approval no longer blindly approves providers.
- Expiry/reminder jobs support new states.
- Scheduler jobs are idempotent.
- Ops can see scheduler status/failures.
- Tests pass.
