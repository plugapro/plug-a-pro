# Operations Dashboard — Full Implementation Plan

## Purpose

Build the admin operations dashboard into a day-to-day execution console for the Plug A Pro operations team.

The end state is not a passive reporting screen. It is a queue-first operating surface that helps ops:

- see what needs attention now
- understand what is slipping
- claim and resolve work
- drill into the underlying entity quickly
- trust the numbers on screen
- recover safely when one data source or widget fails

## Framework Selection

### Chosen framework

**Queue-First Control Tower**

### Why this framework is the right fit

Based on the current codebase and the retrievable OpenBrain evidence, the strongest fit is a **queue-first control tower**, not a BI dashboard and not a generic analytics home page.

Evidence:

- the current `/admin` page is already framed as a control tower and is organized around actionable queues rather than static business reports
- the admin app already has dedicated operational routes for:
  - validation
  - dispatch
  - quotes
  - field exceptions
  - payments
  - disputes
  - provider applications
- the codebase already has reusable assignment primitives in [`lib/ops-queue.ts`](../lib/ops-queue.ts)
- the recent assurance sweep in OpenBrain emphasized:
  - queue ownership
  - degraded states
  - trust in KPI definitions
  - refresh visibility
  - partial failure isolation
  - drill-down usefulness

### Note on the VDS reference

No directly retrievable OpenBrain artifact named `VDS` was available during planning. OpenBrain `search_memory` returned assurance and deployment context, but not a specific VDS architecture spec. Because of that, this plan chooses the closest evidence-based pattern already reflected in the product and code:

**Control Tower + Queue Ownership + Drill-Down Workbench**

## Product Goal

Turn the admin operations dashboard into the default place the operations team uses to run the marketplace during the day.

That means the dashboard must answer these questions at a glance:

1. What is on fire right now?
2. What is aging toward SLA breach?
3. Which queues are growing faster than they are being cleared?
4. Who owns each unresolved item?
5. Where do I click next to fix it?
6. Can I trust the metric I am looking at?

## Current State Summary

### What exists today

- Admin shell with broad route coverage in [`app/(admin)/layout.tsx`](../app/(admin)/layout.tsx)
- Operations Dashboard at [`app/(admin)/admin/page.tsx`](../app/(admin)/admin/page.tsx)
- Dedicated operational pages:
  - [`validation`](../app/%28admin%29/admin/validation/page.tsx)
  - [`dispatch`](../app/%28admin%29/admin/dispatch/page.tsx)
  - quotes
  - bookings
  - disputes
  - payments
  - provider applications
- Queue assignment support in [`lib/ops-queue.ts`](../lib/ops-queue.ts)
- Recent improvements already shipped:
  - refresh timestamp and manual refresh affordance
  - KPI descriptions
  - partial section error isolation

### What is still missing for full ops usefulness

- explicit time-range controls on the funnel and trend surfaces
- true trend visualization instead of static metric tiles
- unified SLA model across queues
- stronger “what changed since last refresh” behavior
- consistent claim/release/owner visibility across all major queues
- real alerting/escalation model
- richer drill-down contracts from dashboard to workbench pages
- standardized widget data contracts and degraded-state patterns
- operational traceability for counts, definitions, and freshness

## Operating Principles

1. **Action beats analytics**
   Every widget must either point to work or explain why work is blocked.

2. **Queues before reports**
   Reports remain useful, but the dashboard should optimize for operational flow control.

3. **Trust requires definitions**
   Every KPI needs a precise formula, time window, and source.

4. **Partial failure must degrade cleanly**
   One broken query must never take down the page.

5. **Freshness must be visible**
   If data is stale, the user must know.

6. **Ownership must be explicit**
   Unclaimed and claimed work must be visually distinct and filterable.

7. **Mobile is secondary, but not ignored**
   The admin console is desktop-first, but responsive enough for emergency triage.

## Target Information Architecture

The dashboard should evolve into five layers:

### Layer 1 — Command Header

Purpose:
- show environment confidence and freshness
- allow refresh
- set the current view window

Contents:
- `Refreshed at HH:MM`
- refresh action
- time window presets: `Today`, `7d`, `14d`, `30d`, `Custom`
- incident banner area
- optional environment badge for non-production

### Layer 2 — Executive KPI Strip

Purpose:
- show the most important system-level operational numbers

Contents:
- Requests needing validation
- Dispatch queue size
- Jobs active in field
- Total open exceptions
- Optional:
  - active disputes
  - failed payments
  - unreviewed provider applications

Requirement:
- every KPI shows:
  - label
  - count/value
  - one-line definition
  - tooltip/title definition
  - freshness timestamp

### Layer 3 — Trend and Funnel Zone

Purpose:
- show whether operations are improving or degrading over time

Contents:
- request → match → quote → booking funnel with date controls
- daily trend chart for:
  - incoming requests
  - matched requests
  - approved quotes
  - completed jobs
- backlog aging trend

Requirement:
- charts must be backed by explicit daily aggregation, not ad hoc page math

### Layer 4 — Queue Grid

Purpose:
- let ops see every major lane that needs action

Queues:
- Validation
- Dispatch
- Quote approvals
- Field exceptions
- Finance follow-up
- Disputes / trust recovery
- Provider onboarding

Every queue card should show:
- total open count
- SLA target
- overdue count
- unclaimed count
- claimed-by-you count
- oldest item age
- quick drill-down

### Layer 5 — Workbench Panels

Purpose:
- enable quick work without leaving context

Patterns:
- side panel or inline drill-down for a selected item
- claim / release / assign / escalate actions
- contextual audit history
- linked entity summary

## Role Model

Current roles:

- `owner`
- `admin`

Target dashboard behavior:

- both roles keep `/admin/*` access
- owner gains future-only capabilities for:
  - feature configuration
  - KPI formula management
  - alert threshold configuration
  - release/ops settings

Short-term:
- no route split required
- use capability flags inside the dashboard where future owner-only controls are introduced

## Data Architecture

### Recommendation

Keep the first implementation **read-through from Prisma**, but structure it behind a dedicated service layer so it can evolve into a cached/read-model architecture later.

### Phase 1 pattern

Add a dedicated service layer such as:

- `lib/ops-dashboard/service.ts`
- `lib/ops-dashboard/types.ts`
- `lib/ops-dashboard/formatters.ts`
- `lib/ops-dashboard/sla.ts`

The page should depend on **one orchestrator** rather than hand-assembling queries directly in `page.tsx`.

Suggested contract:

```ts
type OpsDashboardSnapshot = {
  generatedAt: Date
  range: { from: Date; to: Date; preset: string }
  kpis: ...
  trends: ...
  queues: ...
  exceptions: ...
  incidents: ...
  freshness: ...
  partialErrors: ...
}
```

### Phase 2 pattern

Once query complexity or latency grows:

- add lightweight read-model tables or materialized snapshots for trend series
- keep queue lists live
- cache trend data briefly with explicit refresh labels

### Why this split matters

- queue items need near-live reads
- trend series can tolerate short-lived caching
- failure isolation is easier when contracts are separated by section

## Backend Contract Plan

## 1. Snapshot service

Build a server-side dashboard service with four query groups:

1. `hero + freshness`
2. `queues + assignments + SLA health`
3. `trend/funnel`
4. `exceptions + trust + finance`

Each group returns:

```ts
type SectionResult<T> = {
  ok: boolean
  data: T | null
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
}
```

This matches the recent error isolation direction already introduced.

## 2. Shared SLA engine

Move queue aging thresholds into one place:

- validation: 15 min
- dispatch: 20 min
- quote chase: 4 hr
- field exception: 1 hr
- disputes: 2 hr
- finance follow-up: 1 day
- provider onboarding: 1 day

Expose:

```ts
getQueueSla(queueType)
computeQueueHealth(items, assignments, now)
```

## 3. Trend aggregation service

Add daily aggregation helpers:

- requests created by day
- matches created by day
- quotes created by day
- bookings created by day
- jobs completed by day

Use a shared date-range parser:

```ts
parseDashboardRange(searchParams)
```

## 4. Incident and warning layer

Add a lightweight system warning layer for:

- no data returned
- stale data beyond threshold
- partial section failure
- unresolved backfill-dependent degradation where relevant

## Frontend UX Plan

## A. Dashboard shell

Add:

- range preset control
- refresh button
- refreshed timestamp
- incident banner slot
- per-section degraded banners

## B. KPI tiles

Each tile should show:

- value
- label
- definition
- delta versus previous range when available
- drill-down target

## C. Queue cards

Each queue card should add:

- overdue count
- unclaimed count
- claimed-by-you count
- oldest age
- “open next item” action
- “view all” action

## D. True trend chart

Replace static funnel metric tiles with:

- one daily trend chart
- one conversion funnel summary

Recommended approach:

- lightweight charting, minimal motion
- no chart if only one or two data points
- clear empty state
- clear partial-failure state

## E. Workbench drill-down

For the first pass, reuse existing route pages.

Then add a side-panel workbench for:

- validation request summary
- dispatch candidate summary
- quote approval context
- field exception context

This avoids forcing ops to lose context on every click.

## F. Search and filters

Phase 1:

- date range
- queue ownership
- queue state

Phase 2:

- free-text search by customer name, phone, suburb, provider, ticket reference

## Alerting and Escalation Plan

The dashboard should not only display problems. It should identify SLA breaches clearly.

### Add status levels

- `normal`
- `warning`
- `critical`

### Add alert conditions

- overdue count above threshold
- queue growth rate spike
- no successful matches within recent period
- payment failures above baseline
- disputes spiking above baseline

### Add escalation behaviors

Phase 1:
- visual banners and badges only

Phase 2:
- outbound ops notification hooks:
  - admin message event
  - email
  - WhatsApp ops alert

## Implementation Phases

## Phase 0 — Baseline and Definitions

Goal:
- define what each metric means before coding more UI

Deliverables:
- KPI dictionary
- queue SLA dictionary
- range preset contract
- dashboard section contracts

Files:
- new `docs/ops-dashboard-kpi-dictionary.md`
- new `lib/ops-dashboard/types.ts`
- new `lib/ops-dashboard/sla.ts`

Gate:
- OpenBrain decision log for chosen framework and KPI formulas

## Phase 1 — Service Layer Refactor

Goal:
- move dashboard logic out of `app/(admin)/admin/page.tsx`

Deliverables:
- `lib/ops-dashboard/service.ts`
- section-level loaders
- standardized `SectionResult`
- shared freshness metadata

Outcome:
- the page becomes orchestration-only

## Phase 2 — Queue Health Upgrade

Goal:
- make queue cards operationally complete

Deliverables:
- overdue, unclaimed, claimed-by-you, oldest-age counts
- stronger tone system
- better empty states
- drill-down CTA per queue

Files:
- dashboard page
- shared queue card component

## Phase 3 — Trend and Date Controls

Goal:
- add true time-scoped operational trends

Deliverables:
- date presets
- range parser
- daily trend aggregation
- funnel + trend components

This should land before any more visual polish.

## Phase 4 — Workbench Drill-Downs

Goal:
- reduce context loss and improve operator speed

Deliverables:
- selected-item side panel or modal workbench
- richer entity summary blocks
- audit trace snippet
- assignment controls where relevant

## Phase 5 — Alerting and Incident Layer

Goal:
- make the dashboard proactive

Deliverables:
- queue breach banners
- partial-failure incident strip
- stale-data warning
- optional admin alert hook design

## Phase 6 — Owner/Admin Capabilities and Hardening

Goal:
- prepare for more explicit owner-only operational controls

Deliverables:
- capability-flag model
- owner-only settings placeholders
- stricter observability around dashboard query failures

## File-Level Plan

### New files

- `lib/ops-dashboard/types.ts`
- `lib/ops-dashboard/service.ts`
- `lib/ops-dashboard/sla.ts`
- `lib/ops-dashboard/range.ts`
- `components/admin/dashboard/HeroKpis.tsx`
- `components/admin/dashboard/QueueGrid.tsx`
- `components/admin/dashboard/TrendChart.tsx`
- `components/admin/dashboard/FunnelSummary.tsx`
- `components/admin/dashboard/SectionState.tsx`
- `docs/ops-dashboard-kpi-dictionary.md`

### Modified files

- `app/(admin)/admin/page.tsx`
- `app/(admin)/admin/dispatch/page.tsx`
- `app/(admin)/admin/validation/page.tsx`
- likely `reports/page.tsx` for shared aggregation logic
- possibly `lib/ops-queue.ts` for SLA helpers if kept together

## Acceptance Criteria

The dashboard is considered “fully useful for day-to-day ops” when:

1. every top-level queue shows open, overdue, unclaimed, claimed-by-you, and oldest-age signals
2. every KPI has a visible definition and date scope
3. date range changes update both funnel and trend views correctly
4. partial backend failures degrade by section, not page-wide
5. operators can get from dashboard to the relevant work item in one click
6. ownership is visible for all major queues
7. refresh/freshness state is always visible
8. stale or partial data cannot be mistaken for healthy data
9. at least one trend chart exists that is actually useful to ops, not decorative

## OpenBrain Gates for This Initiative

Use the deployment framework pattern, but for implementation planning and rollout:

### Gate A — KPI definitions approved

Evidence:
- KPI dictionary written
- formulas reviewed by product/ops

### Gate B — Service contracts stable

Evidence:
- section contracts implemented
- dashboard renders from service layer

### Gate C — Queue health complete

Evidence:
- all major queue cards show actionable ownership/SLA signals

### Gate D — Trend/range layer complete

Evidence:
- date controls work
- trend chart is backed by real aggregation

### Gate E — Ops usability validation

Evidence:
- live walkthrough with ops users
- friction notes captured
- blockers resolved or deferred explicitly

### Gate F — Production rollout and verification

Evidence:
- deploy gates completed
- post-deploy dashboard smoke complete

## Suggested Delivery Order

If only one team is working this:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5

If two tracks can run in parallel:

- Track 1:
  - Phase 0
  - Phase 1
  - Phase 2
- Track 2:
  - Phase 3 trend/range work after Phase 0 formulas are locked

## Non-Goals for the First Full Build

- full BI/report designer
- arbitrary ad hoc filtering across every admin entity
- real-time websocket live updates
- owner-only route split

These can follow later if ops truly needs them.

## Recommended Next Move

Start with a short design/implementation spike that produces:

1. KPI dictionary
2. queue SLA map
3. `lib/ops-dashboard/service.ts` skeleton
4. range parser contract
5. one sample section migrated out of `page.tsx`

That spike is the right first PR because it reduces risk for every later dashboard change.
