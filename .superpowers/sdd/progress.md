# SDD progress ledger — Tier 1 funnel observability

Plan: docs/superpowers/plans/2026-06-22-funnel-observability-tier1.md
Branch: fix/funnel-observability-tier1
Base: $(git rev-parse main)

## Tasks
- [x] **Task 1**: extend `recordWorkflowEvent` + PII guard test (commits b96b10fd..b1c14bd7). Follow-ons noted: OpenBrain mirror unguarded, ANONYMOUS_SESSION should be added to WorkflowEntityType union before T2.
- [x] **Task 2**: REQUEST_STARTED endpoint + BookingFlow beacon (commit dc049416; test polish 7d7a3ae7).
- [x] **Task 3**: REQUEST_SUBMITTED at create-job-request — emit post-tx in `lib/job-requests/create-job-request.ts`; tests via `__tests__/api/customer-bookings-funnel.test.ts` (lifted-contract).
- [x] **Task 4**: PROVIDER_NOTIFIED at dispatch — `lib/matching/dispatch.ts` writes `delivered=true/false` once per offer; populates new `MessageEvent.providerId/leadId` on the 3 failure-path `messageEvent.create` calls; tests via `__tests__/lib/matching/dispatch-funnel.test.ts`.
- [x] **Task 5**: PROVIDER_VIEWED + `Lead.viewedAt` write — `app/leads/access/[token]/page.tsx` flips and emits; idempotency via the SENT-status guard; tests via `__tests__/app/leads-access-funnel.test.ts`.
- [x] **Task 6**: PROVIDER_ACCEPTED at selected-provider-acceptance — emit post-tx in `lib/selected-provider-acceptance.ts`; skipped on `result.alreadyAccepted`; tests via `__tests__/lib/selected-provider-acceptance-funnel.test.ts`.
- [x] **Task 7**: PROVIDER_DECLINED in two paths — `lib/matching-engine.ts` (`declineLead` standard + qualified-shortlist) + `lib/provider-opportunity-responses.ts` (NOT_INTERESTED branch); tests via `__tests__/lib/matching-engine-decline-funnel.test.ts`.
- [x] **Task 8**: CLIENT_NOTIFIED at post-match-communications — `lib/post-match-communications.ts` emits when `customerNotified===true`; tests via `__tests__/lib/post-match-communications-funnel.test.ts`.
- [x] **Task 9**: Feature flag + nav entry — `admin.reports.customer_funnel` (default `false`, owner=ops) registered in `lib/feature-flags-registry.ts`; nav entry added to `lib/admin-nav-routes.ts` after Ops Intelligence. Seed-flags reads from the registry automatically.
- [x] **Task 10**: Funnel aggregate query layer — `lib/admin/funnel-aggregate.ts` with `conversionRate` / `rankFunnelGroups` / `biggestLeak` pure helpers + `fetchFunnelCounts` / `fetchFunnelByService` / `fetchFunnelBySuburb` / `fetchNotificationHealth` Prisma fetchers; tests via `__tests__/admin/funnel-aggregate.test.ts`.
- [x] **Task 11**: Admin page — `app/(admin)/admin/reports/funnel/page.tsx` behind `admin.reports.customer_funnel`; date-range chip (24h/7d/30d/custom); waterfall + drop-off + by-service + by-suburb + notification health.
- [x] **Task 12**: Daily customer-funnel report script — `scripts/daily-customer-funnel-report.ts` with text + `--json` + `--days=N`; tests via `__tests__/scripts/daily-customer-funnel-report.test.ts`.
- [ ] **Task 13**: Smoke, branch hygiene, PR — pending session-end (commit + push happens after this ledger update).

## Test status (post-Task 12)

- 9 new test files + 1 extended (`record.test.ts`) → **48 tests pass**.
- Full vitest suite: **4706 pass + 1 skipped** (pre-existing branch state). The one previously-flagged RLS failure is now resolved by commit `00b77b8e` ("fix(security): enable RLS on workflow_events (catch-up after timestamp collision)") which landed independently.

## Knowledge entry

`field-service/docs/openbrain/2026-06-22-funnel-observability-tier1-shipped.md` (this branch).
Memory index entry: `~/.claude/projects/-Users-shimane-Projects-Plug-A-Pro/memory/project_funnel_observability_tier1.md`.
