# engineering — Client funnel observability Tier 1 (2026-06-22)

**Project:** Plug-A-Pro
**Domain:** engineering
**Tags:** funnel-observability, tier-1, workflow-events, admin-reports
**Branch:** `feat/ops-agent-workflow-team-phase-1`
**Spec:** [docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md](../../../docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md)

## What shipped

Tier 1 of the 3-tier client funnel observability rollout. Wires the existing `WorkflowEvent` table (added in PR `20260621120000_workflow_events`, zero call sites before this work) into seven customer-journey emit-sites, plus a date-filterable admin report and an operator CLI.

### Code surface

| Area | Files |
|---|---|
| Migrations (additive) | `prisma/migrations/20260622000000_funnel_tier1_workflow_event_enum/` (7 enum values), `prisma/migrations/20260622000100_funnel_tier1_message_event_fks/` (nullable `providerId`/`leadId` FKs on `message_events`, 2 indexes, 2 FKs with `ON DELETE SET NULL`) |
| Schema | `prisma/schema.prisma` — `WorkflowEventType` enum extended; `MessageEvent` model gets `providerId`, `leadId`, back-relations on `Provider` + `Lead` |
| New API endpoint | `app/api/funnel/request-started/route.ts` — POST that writes REQUEST_STARTED; anonymous-friendly; never blocks the client |
| 7 emit-sites | `BookingFlow.tsx` (REQUEST_STARTED via fetch), `lib/job-requests/create-job-request.ts` (REQUEST_SUBMITTED), `lib/matching/dispatch.ts` (PROVIDER_NOTIFIED, delivered bool), `app/leads/access/[token]/page.tsx` (PROVIDER_VIEWED + writes `Lead.viewedAt`), `lib/selected-provider-acceptance.ts` (PROVIDER_ACCEPTED, idempotent on retry), `lib/matching-engine.ts` (PROVIDER_DECLINED, both qualified-shortlist + standard paths), `lib/post-match-communications.ts` (CLIENT_NOTIFIED, gated on `customerNotified`) |
| Admin report | `app/(admin)/admin/reports/funnel/page.tsx` + `lib/admin/funnel-aggregate.ts` (4 fetchers + 3 pure helpers) |
| Daily CLI | `scripts/daily-customer-funnel-report.ts` — text + `--json` + `--days=N` |
| Flag + nav | `lib/feature-flags-registry.ts` (`admin.reports.customer_funnel` default OFF, owner=ops), `lib/admin-nav-routes.ts` (flag-gated entry) |
| Tests | 9 vitest files: extended `record.test.ts`, new `funnel-aggregate.test.ts`, `dispatch-funnel.test.ts`, `selected-provider-acceptance-funnel.test.ts`, `matching-engine-decline-funnel.test.ts`, `post-match-communications-funnel.test.ts`, `leads-access-funnel.test.ts`, `customer-bookings-funnel.test.ts`, `daily-customer-funnel-report.test.ts` — 45 tests, all green |

### Confirmed non-bugs (audit corrections)

- **Insufficient-credit acceptance is atomically blocked.** Initial fresh-agent audit read the code as "status flips before credit check → stranded state". The whole `$transaction` in `lib/selected-provider-acceptance.ts` rolls back if any step throws (commit `66b2eee9`). No fix required; the original spec's open question was already closed.

### Things the spec author predicted that turned out to need adaptation

- Spec lists `REQUEST_STARTED` and `REQUEST_SUBMITTED` as new enum values — these are net-new even though the existing enum already has `SERVICE_REQUEST_STARTED` / `SERVICE_REQUEST_SUBMITTED`. Decision: added the spec's names verbatim (additive, both coexist). The Tier 1 reporting reads from the new ones; the older ones may be used elsewhere by Phase 1 ops agents.
- Spec lists `PROVIDER_DECLINED` similarly alongside the existing `PROVIDER_DECLINED_REQUEST`.
- Spec call site #1 ("BookingFlow.tsx initial step") needed a small API endpoint (`/api/funnel/request-started`) since BookingFlow is a client component. Endpoint is anonymous-tolerant and dedupes per browser session via sessionStorage.
- `biggestLeak()` in `lib/admin/funnel-aggregate.ts` was authored ranking by absolute drop; switched to ratio after the JSON-snapshot test surfaced that the spec's sample output ("Top leak: matched → accepted 45%") implied ratio-based ranking. Ratio also matches how operators read funnel charts.

## Pre-existing test failure (NOT a regression)

`__tests__/security/rls-migration-coverage.test.ts` fails with 7 missing-RLS reports. All 7 tables (`ops_agent_runs`, `ops_recommendations`, `ops_draft_messages`, `provider_profile_scores`, `request_friction_signals`, `ops_daily_briefings`, `workflow_events`) were created in **pre-existing** Phase 1 migrations (`20260620063639_ops_agent_workflow_team` + `20260621120000_workflow_events`). My migrations only `ALTER TYPE` and `ALTER TABLE ADD COLUMN` — no `CREATE TABLE`. **Phase 1 owner should add RLS in a follow-up migration.**

## Verification needed in prod (rollout §8)

1. Apply migrations: `20260622000000_funnel_tier1_workflow_event_enum` then `20260622000100_funnel_tier1_message_event_fks`. Both additive — production-safe.
2. After deploy, query `workflow_events WHERE eventType='REQUEST_SUBMITTED'` to confirm rows are flowing.
3. Flip `admin.reports.customer_funnel` flag ON for ops users.
4. Run `pnpm tsx scripts/daily-customer-funnel-report.ts` locally pointed at prod DB; sanity-check the output matches the admin page.

## Deferred to Tier 2 (per spec §9, restated for visibility)

- Anonymous-visit `VisitSession` table (true platform visits, not just request-flow starts)
- `PaymentStatusEvent` history table
- `INSUFFICIENT_CREDIT` as a filter exclusion (currently checked at accept-time, over-inflating eligible counts)
- SMS/email fallback for failed WhatsApp lead sends

## Deferred to Tier 3

- Per-request drill-down panel + ops dashboard UI
- `LeadView` model with per-tap view tracking
- `Invoice` status enum + send-attempt log
- Historical WorkflowEvent backfill (from MessageEvent / Lead / JobRequest)
- Vercel cron wiring for the daily script
- Posting daily script output to Slack / OpenBrain / pubsub

## What the platform can now answer (Tier 1 acceptance)

| Acceptance criterion | Source |
|---|---|
| Clients entered the funnel | ⚠ Partial — REQUEST_STARTED count (in-flow); true platform visits await Tier 2 |
| Became submitted requests | ✅ REQUEST_SUBMITTED |
| Triggered matching | ✅ `DispatchDecision.createdAt` |
| Matched to ≥1 provider | ✅ `DispatchDecision.eligibleCount > 0` |
| Providers notified | ✅ PROVIDER_NOTIFIED |
| Providers accepted | ✅ PROVIDER_ACCEPTED |
| Clients notified after acceptance | ✅ CLIENT_NOTIFIED |
| Requests stuck at each stage | ✅ Daily script + page drop-off table |
| Manual intervention needed | ✅ Daily script ops list |
| Provider acceptance blocked without credits | ✅ (already true — confirmed by audit) |
| PII-safe funnel data | ✅ Aggregate-only response payloads |
| Date-filterable reporting | ✅ Chip + custom range |
