# Ops Dashboard KPI Dictionary

This document defines the operational metrics shown on the Operations Dashboard.

It exists for two reasons:

1. the ops team must be able to trust what a number means
2. engineering must have one source of truth for formulas, labels, and time scope

## Scope

These definitions apply to:

- the main Operations Dashboard at `/admin`
- future trend and range controls
- queue cards and hero KPI tiles

## Global Rules

- Unless otherwise stated, queue metrics are **live counts at render time**
- Trend and funnel metrics are **range-scoped**
- Every KPI displayed in the UI must include:
  - label
  - formula
  - time scope
  - source tables
  - drill-down target

## Hero KPIs

| KPI | Definition | Formula | Time Scope | Primary Source | Drill-down |
|---|---|---|---|---|---|
| Requests needing validation | Requests blocked before matching because ops validation has not completed | `count(job_requests where status = PENDING_VALIDATION)` | Live | `job_requests` | `/admin/validation` |
| Dispatch queue | Requests that are open for assignment or still actively matching | `count(job_requests where status in (OPEN, MATCHING))` | Live | `job_requests` | `/admin/dispatch` |
| Jobs in field | Jobs currently in a live field-work state | `count(jobs where status in (EN_ROUTE, ARRIVED, STARTED, PAUSED, AWAITING_APPROVAL, PENDING_COMPLETION_CONFIRMATION))` | Live | `jobs` | `/admin/bookings` or `/admin/field-exceptions` |
| Operational exceptions | Sum of major open exception classes | `field_exception_count + payment_exception_count + dispute_count` | Live | `jobs`, `payments`, `disputes` | Mixed by exception type |

## Queue Cards

### Validation queue

- Definition:
  Requests that require human review before matching can start
- Formula:
  `count(job_requests where status = PENDING_VALIDATION)`
- SLA target:
  `15 minutes`
- Primary page:
  `/admin/validation`

### Dispatch pressure

- Definition:
  Requests in active matching or awaiting dispatch attention
- Formula:
  `count(job_requests where status in (OPEN, MATCHING))`
- SLA target:
  `20 minutes`
- Primary page:
  `/admin/dispatch`

### Quote approvals

- Definition:
  Quotes awaiting customer approval or ops chase
- Formula:
  `count(quotes where status in (PENDING, REVISED))`
- SLA target:
  `4 hours`
- Primary page:
  `/admin/quotes`

### Field exceptions

- Definition:
  Jobs that need human intervention because progress is blocked or failed
- Formula:
  `count(jobs where status in (AWAITING_APPROVAL, PENDING_COMPLETION_CONFIRMATION, FAILED, CALLBACK_REQUIRED))`
- SLA target:
  `1 hour`
- Primary page:
  `/admin/field-exceptions`

### Finance follow-up

- Definition:
  Payments in unresolved or exception states
- Formula:
  `count(payments where status in (PENDING, FAILED, PARTIALLY_REFUNDED, REFUNDED))`
- SLA target:
  `1 day`
- Primary page:
  `/admin/payments`

### Trust recovery

- Definition:
  Disputes and complaints that need acknowledgement or review
- Formula:
  `count(disputes where status in (OPEN, UNDER_REVIEW))`
- SLA target:
  `2 hours`
- Primary page:
  `/admin/disputes`

### Provider onboarding

- Definition:
  Provider applications waiting for review
- Formula:
  `count(provider_applications where status = PENDING)`
- SLA target:
  `1 day`
- Primary page:
  `/admin/applications`

## Queue Health Sub-Metrics

The next dashboard iteration should standardize these sub-metrics for every major queue:

| Sub-metric | Definition |
|---|---|
| Open count | Total items currently in the queue |
| Overdue count | Items older than queue SLA |
| Unclaimed count | Items with no active ops queue assignment |
| Claimed by you | Items currently assigned to the logged-in ops user |
| Oldest age | The age of the oldest open item in the queue |

## Range Presets

The funnel and trend sections are range-scoped. The range is controlled by `?range=` search param.

| Preset | Window |
|--------|--------|
| `today` | 00:00 – 23:59 today (SAST) |
| `7d` | Last 7 days (default) |
| `14d` | Last 14 days |
| `30d` | Last 30 days |
| `custom` | Requires `?from=YYYY-MM-DD&to=YYYY-MM-DD` params |

## Funnel Metrics

Scoped to the selected date range (default: last 7 days).

| KPI | Definition | Formula | Time Scope | Source |
|---|---|---|---|---|
| Requests | New job requests created in range | `count(job_requests where created_at >= range_start)` | 7d today; later variable | `job_requests` |
| Matches | Matches created in range | `count(matches where created_at >= range_start)` | 7d today; later variable | `matches` |
| Quotes | Quotes created in range | `count(quotes where created_at >= range_start)` | 7d today; later variable | `quotes` |
| Bookings | Bookings created in range | `count(bookings where created_at >= range_start)` | 7d today; later variable | `bookings` |
| Completed jobs | Jobs completed in range | `count(jobs where status = COMPLETED and completed_at >= range_start)` | 7d today; later variable | `jobs` |
| Paid | Payments completed in range | `count(payments where status = PAID and paid_at >= range_start)` | 7d today; later variable | `payments` |
| Revenue collected | Sum of paid amount in range | `sum(payments.amount where status = PAID and paid_at >= range_start)` | 7d today; later variable | `payments` |

## Freshness Rules

Every dashboard response should carry:

- `generatedAt`
- `range`
- section-level error state

Future enhancement:

- widget-level stale threshold
- explicit last successful refresh if cached read models are introduced

## Implementation Status

| Phase | Deliverable | Status |
|-------|-------------|--------|
| Phase 0 | KPI dictionary | ✅ Done |
| Phase 0 | `lib/ops-dashboard/types.ts` | ✅ Done |
| Phase 0 | `lib/ops-dashboard/sla.ts` | ✅ Done |
| Phase 1 | `lib/ops-dashboard/service.ts` | ✅ Done |
| Phase 1 | `/admin/page.tsx` refactored to service layer | ✅ Done |
| Phase 1 | Range preset contract | ✅ Done |
| Phase 3 | Date range UI controls | ⏳ Pending |
| Phase 3 | Daily trend chart | ⏳ Pending |
| Phase 4 | Workbench drill-downs | ⏳ Pending |
| Phase 5 | Alerting and incident hooks | ⏳ Pending |

## Known Follow-Ups

- Add a real trend chart backed by daily aggregation (Phase 3)
- Add date range preset controls to the dashboard shell (Phase 3)
- Add delta/change indicators once prior-window comparison is defined
- Add KPI ownership so ops knows who is accountable for each lane
