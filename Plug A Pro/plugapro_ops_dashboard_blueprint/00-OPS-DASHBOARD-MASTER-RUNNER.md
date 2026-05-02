# 00 — OPS DASHBOARD + SCHEDULER MASTER RUNNER

## Purpose

This is the single instruction file to give to Codex.

Codex must use this file as the execution controller for the **Plug A Pro Ops Dashboard and Scheduler/Cron alignment blueprint**.

The Ops Dashboard is the internal web app used by Ops users to manage and support:

1. Client WhatsApp + PWA journey
2. Service Provider WhatsApp-first + PWA-optional journey
3. Matching / shortlist / provider acceptance / credit flow
4. Notification, escalation, job execution, and support workflows
5. Scheduler/cron jobs that drive matching, provider review, expiry, reminders, and reconciliation

Codex must execute the blueprint files in sequence, write a physical Markdown implementation output after each file, and update the execution index after each step.

There must be **no single final implementation summary**. Each blueprint file must produce its own implementation output file.

## Product context

The customer and provider journeys have changed.

### Customer journey

The customer journey is:

```text
WhatsApp-first
PWA-assisted
state-aware
shortlist-based
```

Customers may use PWA for request capture, photo/address review, shortlist comparison, provider profile viewing, provider selection, job tracking, and rating/review.

### Provider journey

The provider journey is:

```text
WhatsApp-first
WhatsApp-complete
PWA-optional
```

Providers must be able to apply, check credits, receive opportunity previews, respond interested, submit rates/times, accept selected jobs, receive full details, confirm arrival, update job status, and complete jobs in WhatsApp.

### Matching model

Plug A Pro uses the **Qualified Shortlist Model**, not blind auto-allocation.

```text
Client submits request
↓
System filters and scores suitable approved providers
↓
Top providers receive safe opportunity preview
↓
Interested providers submit rate / availability
↓
Customer receives shortlist
↓
Customer selects provider
↓
Selected provider accepts job
↓
1 credit is deducted
↓
Full customer details unlock
↓
Job is assigned
```

## Important scheduler change

Existing cron/scheduler jobs must be reviewed and changed.

Known current scheduler assumptions to investigate:

```text
auto-match every 5 minutes
auto-approval of new service providers every 30 minutes
```

These cannot continue blindly if they conflict with the new product model.

### Matching scheduler must not blindly assign jobs

The matching scheduler should support:

```text
find eligible providers
score providers
create opportunity invites
send safe previews
track provider responses
generate shortlist
notify customer when shortlist is ready
expire stale invites
offer next candidates where needed
escalate no-match/no-response cases to Ops
```

### Provider auto-approval must not blindly approve providers

Because registration is not proof of competence, the 30-minute auto-approval job must be reviewed.

The new model requires admin review, verification status, category-specific approval, starter-credit award on approval, and audit trail.

Automation may include completeness checks, duplicate detection, risk scoring, supported-area checks, document presence checks, and queue routing. Final approval should require Ops action unless a specific low-risk auto-approval product decision is documented and tested.

## Blueprint files

This runner should live in the same folder as:

```text
01-ops-as-is-assessment.md
02-ops-role-permissions-and-navigation.md
03-ops-provider-review-and-approval-dashboard.md
04-ops-client-request-monitoring-dashboard.md
05-ops-matching-queue-and-shortlist-oversight.md
06-ops-scheduler-and-cron-redesign.md
07-ops-credit-ledger-and-adjustments.md
08-ops-job-operations-and-escalations.md
09-ops-notification-and-whatsapp-monitoring.md
10-ops-security-audit-and-data-privacy.md
11-ops-observability-reporting-and-kpis.md
12-ops-test-matrix-and-release-plan.md
```

If this runner file is not in the same folder, search the repo for `01-ops-as-is-assessment.md` and use that directory as the Ops blueprint directory.

## Output folder

Create:

```text
docs/ops-dashboard-execution/
```

Create and continuously update:

```text
docs/ops-dashboard-execution/000-ops-dashboard-execution-index.md
```

After each file, create:

```text
docs/ops-dashboard-execution/001-ops-as-is-assessment-output.md
docs/ops-dashboard-execution/002-ops-role-permissions-and-navigation-output.md
docs/ops-dashboard-execution/003-ops-provider-review-and-approval-dashboard-output.md
docs/ops-dashboard-execution/004-ops-client-request-monitoring-dashboard-output.md
docs/ops-dashboard-execution/005-ops-matching-queue-and-shortlist-oversight-output.md
docs/ops-dashboard-execution/006-ops-scheduler-and-cron-redesign-output.md
docs/ops-dashboard-execution/007-ops-credit-ledger-and-adjustments-output.md
docs/ops-dashboard-execution/008-ops-job-operations-and-escalations-output.md
docs/ops-dashboard-execution/009-ops-notification-and-whatsapp-monitoring-output.md
docs/ops-dashboard-execution/010-ops-security-audit-and-data-privacy-output.md
docs/ops-dashboard-execution/011-ops-observability-reporting-and-kpis-output.md
docs/ops-dashboard-execution/012-ops-test-matrix-and-release-plan-output.md
```

## Execution order

| Step | Blueprint | Output |
|---:|---|---|
| 1 | `01-ops-as-is-assessment.md` | `001-ops-as-is-assessment-output.md` |
| 2 | `02-ops-role-permissions-and-navigation.md` | `002-ops-role-permissions-and-navigation-output.md` |
| 3 | `03-ops-provider-review-and-approval-dashboard.md` | `003-ops-provider-review-and-approval-dashboard-output.md` |
| 4 | `04-ops-client-request-monitoring-dashboard.md` | `004-ops-client-request-monitoring-dashboard-output.md` |
| 5 | `05-ops-matching-queue-and-shortlist-oversight.md` | `005-ops-matching-queue-and-shortlist-oversight-output.md` |
| 6 | `06-ops-scheduler-and-cron-redesign.md` | `006-ops-scheduler-and-cron-redesign-output.md` |
| 7 | `07-ops-credit-ledger-and-adjustments.md` | `007-ops-credit-ledger-and-adjustments-output.md` |
| 8 | `08-ops-job-operations-and-escalations.md` | `008-ops-job-operations-and-escalations-output.md` |
| 9 | `09-ops-notification-and-whatsapp-monitoring.md` | `009-ops-notification-and-whatsapp-monitoring-output.md` |
| 10 | `10-ops-security-audit-and-data-privacy.md` | `010-ops-security-audit-and-data-privacy-output.md` |
| 11 | `11-ops-observability-reporting-and-kpis.md` | `011-ops-observability-reporting-and-kpis-output.md` |
| 12 | `12-ops-test-matrix-and-release-plan.md` | `012-ops-test-matrix-and-release-plan-output.md` |

## Execution method

For each file:

1. Read the full blueprint file.
2. Inspect existing admin/ops routes, components, server actions, APIs, scheduler jobs, cron config, queue workers, notification logs, matching services, credit services, and tests.
3. Identify what already exists.
4. Reuse existing implementation where practical.
5. Implement only the current file scope.
6. Avoid duplicate admin dashboards, matching systems, schedulers, or credit systems.
7. Add or update tests.
8. Run relevant validation.
9. Write the output file for that step.
10. Update the execution index.
11. Move to the next file.

## Stop conditions

Stop only if:

1. A destructive migration is required and no safe plan exists.
2. Existing cron/scheduler infrastructure is incompatible and needs a product/architecture decision.
3. A privacy rule cannot be enforced server-side.
4. Credit adjustment cannot be made auditable.
5. Matching changes would risk blind auto-assignment.
6. Provider approval automation would approve unvetted providers.
7. Required production public URL or scheduler secret config is missing and no safe fallback exists.
8. Tests reveal customer data exposure, duplicate credit deduction, or broken provider/customer flows.

If blocked, write the blocker into the current output file, update the index, and stop.

## Global rules

### Ops must support all journeys

Ops Dashboard must support:

```text
client WhatsApp + PWA journey
provider WhatsApp-first journey
provider PWA optional journey
matching/shortlist/credit flow
job execution and escalation
notifications and retries
scheduler monitoring
```

### No blind auto-approval

Provider auto-approval must not blindly approve providers. If a 30-minute auto-approval job exists, convert it to safe review support unless the product explicitly allows auto-approval.

### No blind auto-assignment

The matching scheduler must not directly assign a provider to a customer request unless the request is already in a state that explicitly allows it.

Default model:

```text
match → invite providers → collect responses → shortlist → customer selects → provider accepts → credit deducted → job assigned
```

### Privacy rule

Ops may see sensitive data only with proper role permissions and audit logging.

Provider safe previews must not expose customer phone, customer email, exact street address, house number, unit number, complex/access details, GPS coordinates, or private access notes.

### Credit rule

Ops credit adjustments must be ledger-backed, reason-coded, auditable, and role-protected.

No direct balance mutation without ledger entry.

### URL rule

Production WhatsApp/PWA/Admin links must use:

```text
https://app.plugapro.co.za
```

No production message or Ops-generated link may contain localhost.

## Required output format after each file

Each output report must use:

```md
# Execution Output — <Blueprint File Name>

## Status

Completed / Completed with warnings / Blocked / Partially completed

## Blueprint file executed

<relative path>

## Objective

<summary>

## Current-state findings

<what exists>

## Implementation completed

<what was changed>

## Files changed

| File | Change summary |
|---|---|

## Ops dashboard changes

<details or None>

## Scheduler/cron changes

<details or None>

## API/server changes

<details or None>

## Data/model changes

<details or None>

## Security/privacy impact

<details>

## Credit impact

<details or None>

## Tests added or updated

<details>

## Commands run

```bash
<commands>
```

## Test results

<summary>

## Manual verification checklist

- [ ] Ops can see relevant queue/dashboard
- [ ] Ops action is role-protected
- [ ] Sensitive data visibility is controlled
- [ ] Scheduler behaviour aligns to new flow
- [ ] Audit logs are written
- [ ] Tests pass

## Risks and follow-ups

<remaining risks>

## OpenBrain note

<implementation note>
```

## Execution starts now

Begin with:

```text
01-ops-as-is-assessment.md
```
