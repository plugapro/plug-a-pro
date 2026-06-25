# Execution Output — 06-ops-scheduler-and-cron-redesign.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_ops_dashboard_blueprint/06-ops-scheduler-and-cron-redesign.md`

## Objective

Align scheduler/cron behavior with the Qualified Shortlist Model and remove unsafe provider auto-approval.

## Implementation completed

- Added `/admin/scheduler`.
- Shows configured cron jobs, current queue pressure, failed message count, and recent Ops scheduler alerts.
- Restricts scheduler dashboard access to Admin/Owner using the Ops capability map.
- Documents safety rules directly in the dashboard:
  - No blind provider auto-approval.
  - No credit deduction during matching.
  - No job assignment before customer selection and selected-provider acceptance.
- Updated `/api/cron/match-leads` in Step 3 so provider applications are routed for review instead of auto-approved.
- Added a safety test that prevents reintroducing the old provider auto-approval constants/credit-award import.

## Scheduler behavior after remediation

### Matching scheduler

The 5-minute cron still calls the existing matching orchestrator for `OPEN` requests. The orchestrator dispatches provider opportunities/lead invites and records dispatch decisions. It does not deduct provider credits and does not create the selected-provider booking. Credits and job assignment remain inside selected-provider acceptance.

### Provider review scheduler

The cron now performs review support only:

```text
pending application → completeness/risk assessment → Ops onboarding queue → manual Ops decision
```

It no longer:

- Marks applications approved.
- Marks providers verified/active.
- Awards starter credits.
- Sends approval notifications.
- Makes providers eligible for matching without Ops action.

### Expiry/reminder scheduler

Existing expiry/reminder paths remain in place:

- Assignment/lead expiry workflow.
- Quote expiry.
- Open request expiry.
- Approved-notification retry.
- Lead reminders.
- Queue breach Ops alerts.

## Files changed

| File | Change summary |
|---|---|
| `field-service/app/(admin)/admin/scheduler/page.tsx` | New scheduler/Ops cron dashboard. |
| `field-service/__tests__/api/cron-match-leads-safety.test.ts` | Safety test preventing old provider auto-approval path from returning. |
| `docs/ops-dashboard-execution/006-ops-scheduler-and-cron-redesign-output.md` | Step 6 execution output. |
| `docs/ops-dashboard-execution/000-ops-dashboard-execution-index.md` | Updated execution status. |

## Schema / migration changes

None.

## Tests added or updated

- Added `field-service/__tests__/api/cron-match-leads-safety.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/api/cron-match-leads-safety.test.ts __tests__/lib/provider-application-review-support.test.ts __tests__/lib/ops-dashboard-permissions.test.ts
npx tsc --noEmit
```

## Test results

- Focused Vitest: passed; 3 files, 6 tests.
- TypeScript: passed.

## Remaining risks

- Scheduler run history is still inferred from current queues and audit logs rather than a dedicated scheduler-run table.
- Manual safe rerun actions are not added yet; dashboard access is restricted to Admin/Owner in preparation for that.

## OpenBrain note

Scheduler alignment now enforces the critical product boundary: cron may route and support provider review, but final provider approval and starter-credit award require Ops action. Matching remains opportunity/shortlist-oriented and does not deduct credits before selected-provider acceptance.
