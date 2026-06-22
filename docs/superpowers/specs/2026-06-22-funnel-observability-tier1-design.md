# Client funnel observability — Tier 1 design

**Status**: spec, ready for implementation plan
**Author**: session 2026-06-22
**Scope**: Tier 1 of 3 (see "Out of scope" for what's deferred)
**Related**: Wave 1 Quality Uplift audit ([[project-quality-uplift-wave1]])

## 1. Goal

Give an admin or operator clear answers to:

- How many clients entered the funnel in a date range?
- How many became submitted service requests?
- How many requests triggered matching?
- How many requests matched to at least one provider?
- How many providers were notified?
- How many providers accepted?
- How many clients were notified after acceptance?
- Where are requests stuck?
- Where does manual intervention need to happen?

Tier 1 covers 7 of these 9 acceptance criteria. The remaining two (anonymous platform visits, honest eligible counts) are deferred to Tier 2.

## 2. Current-state findings (audit summary)

Audited 2026-06-22 by 6 parallel codebase scans. Full transcripts saved per session; condensed conclusions:

### What already exists and is reused
- `WorkflowEvent` table + `recordWorkflowEvent()` helper — shipped in migration `20260621120000_workflow_events`, zero call sites. **This is the funnel-event log; the work is wiring it.**
- `DispatchDecision` + `MatchAttempt` — per-provider `filteredReasonCodes[]`, aggregate `stageCounts`, indexed on `createdAt` / `failureClass` / `primaryReason`.
- `Lead` (16-status enum) with rich timestamps and `LeadUnlock` / `ProviderLeadAccessToken` siblings.
- `MessageEvent` with webhook-driven SENT/DELIVERED/READ/FAILED transitions.
- `JobStatusEvent` + `BookingStatusEvent` per-transition history.
- `AuditLog` + `AdminAuditEvent` written atomically by `crudAction()`.
- Server-stamped attribution on `JobRequest` (`utmSource/Medium/Campaign`, `landingPath`, `attribution` JSON).
- Live Sentry + GA4 + Google Ads conversions.
- `/admin/reports/acquisition` page (paid/organic mix, 30d window).

### Confirmed non-bugs
- Insufficient-credit acceptance is **atomically blocked** in `lib/selected-provider-acceptance.ts:287-315` (commit `66b2eee9`). The original spec's open question on this is closed.

### Real gaps Tier 1 closes
- No server-side events at customer-flow steps (REQUEST_STARTED, REQUEST_SUBMITTED) — GA4 client-only today.
- No `PROVIDER_NOTIFIED` / `PROVIDER_VIEWED` / `PROVIDER_ACCEPTED` / `PROVIDER_DECLINED` / `CLIENT_NOTIFIED` events as a single source of truth — state is scattered across `Lead.*At` timestamps, `MessageEvent.metadata` JSON, and stdout console lines.
- `Lead.viewedAt` is never populated on actual page view (only on INTERESTED response) — column exists, write is missing.
- `MessageEvent` has no `providerId` / `leadId` FK — every per-lead query traverses metadata JSON.
- No `/admin/funnel` page — operators can't answer acceptance criteria from the UI.

### Gaps NOT closed by Tier 1 (deferred to Tier 2/3)
- Anonymous visit / `VisitSession` table (Tier 2)
- `PaymentStatusEvent` history table (Tier 2)
- `INSUFFICIENT_CREDIT` as a filter exclusion (currently checked at accept-time, over-inflates eligible counts) (Tier 2)
- SMS/email fallback for failed WhatsApp lead sends (Tier 2)
- Per-request drill-down panel + ops dashboard UI (Tier 3)
- `Invoice` status enum + send-attempt log (Tier 3)
- `LeadView` model and per-tap view tracking (Tier 3)
- Historical backfill of `WorkflowEvent` from `MessageEvent` / `Lead` / `JobRequest` (Tier 3)

## 3. Architecture

### Event taxonomy + call sites

Seven `WorkflowEventType` enum values added. One call site per event. All seven hook into either an existing transaction's post-commit point or a clearly-defined success/failure boundary. None introduces a new transaction.

| # | Event type | Call site | Actor | Entity | Key metadata fields |
|---|---|---|---|---|---|
| 1 | `REQUEST_STARTED` | `components/customer/BookingFlow.tsx` initial step, once per session | `customer` or `anonymous` (session id) | `JobRequest` placeholder (anon sid) | `serviceId`, `source`, `landingPath` |
| 2 | `REQUEST_SUBMITTED` | `lib/job-requests/create-job-request.ts` after the DB write succeeds (~line 533) | `customer` | `JobRequest` (real id) | `category`, `suburb`, `addressId`, `source` |
| 3 | `PROVIDER_NOTIFIED` | `lib/matching/dispatch.ts` after each `sendJobOffer` resolution (success and failure paths at lines 216 / 246 / 290) | `system` | `Lead` | `providerId`, `template`, `channel`, `delivered` boolean |
| 4 | `PROVIDER_VIEWED` | `app/leads/access/[token]/page.tsx:777-787` — same spot that flips `Lead.status='VIEWED'`. Additionally writes `Lead.viewedAt`. | `provider` | `Lead` | `viewedFromChannel` |
| 5 | `PROVIDER_ACCEPTED` | `lib/selected-provider-acceptance.ts` post-commit of the lock transaction | `provider` | `Lead` + `Match` | `creditsCharged`, `path` (qualified-shortlist vs quick-match) |
| 6 | `PROVIDER_DECLINED` | `lib/matching-engine.ts:306` (`declineLead`) + `lib/provider-opportunity-responses.ts` decline branch | `provider` | `Lead` | `reason` if provided |
| 7 | `CLIENT_NOTIFIED` | `lib/post-match-communications.ts` alongside existing `AuditLog.action='post_match.customer_notified'` writes (lines 600 / 636 / 677) | `system` | `JobRequest` + `Match` | `template`, `channel`, `messageEventId` |

### Design principle: no duplicate writes

Stages whose state is already captured in a dedicated table do **not** get a `WorkflowEvent` row:

| Stage | Existing source of truth |
|---|---|
| Match attempted | `DispatchDecision.createdAt` |
| No provider available | `DispatchDecision.failureClass='NO_PROVIDER_AVAILABLE'` |
| Provider lead expired | `Lead.expiredAt` |
| Match attempt details per provider | `MatchAttempt` |

The admin page and daily script read directly from these tables for those stages.

### Failure-mode handling

`recordWorkflowEvent` writes are **post-tx, best-effort**. If the event write fails, the funnel loses one row; the underlying flow succeeds. This contract is already part of the helper. Tier 1 does not change it.

## 4. Data model changes

Two additive Prisma migrations. Pure-add, zero-rename, zero-drop. Both production-safe (additive enum value + nullable column + concurrent index creation).

### Migration A — extend `WorkflowEventType` enum

```prisma
enum WorkflowEventType {
  // existing values stay
  REQUEST_STARTED
  REQUEST_SUBMITTED
  PROVIDER_NOTIFIED
  PROVIDER_VIEWED
  PROVIDER_ACCEPTED
  PROVIDER_DECLINED
  CLIENT_NOTIFIED
}
```

### Migration B — `MessageEvent` FK columns

```prisma
model MessageEvent {
  // existing columns unchanged
  providerId  String?
  leadId      String?

  provider Provider? @relation(fields: [providerId], references: [id], onDelete: SetNull)
  lead     Lead?     @relation(fields: [leadId], references: [id], onDelete: SetNull)

  @@index([leadId, sentAt])
  @@index([providerId, sentAt])
}
```

Both columns are nullable on creation — existing callers that do not yet pass `providerId` / `leadId` continue to work unchanged. New writes (instrumentation sites + `dispatch.ts`) populate them. Historical rows stay `null`; the metadata-JSON path query still works for back-history. **No backfill in Tier 1.**

### Non-changes called out

| Considered | Decision |
|---|---|
| Add `Lead.viewedAt` column | Already exists in schema. Gap is the missing write. Section 3.1 call site #4 fixes it. |
| New `VisitSession` table | Deferred to Tier 2. |
| New `PaymentStatusEvent` table | Deferred to Tier 2. |
| Modify `Lead` status enum | Not touched. |

## 5. Admin page + query layer

### Route

`/admin/reports/funnel` — added to `lib/admin-nav-routes.ts` between **Reports** and **Acquisition**. Pattern mirrors existing `/admin/reports/acquisition` (same shell, same date-chip pattern).

### Page sections

1. **Date range chips** — Last 24h / 7d / 30d / Custom. Default 7d.
2. **Funnel waterfall** — six rows with absolute counts and conversion rates between adjacent rows:
   - Requests started (`WorkflowEvent` REQUEST_STARTED)
   - Requests submitted (`WorkflowEvent` REQUEST_SUBMITTED, union JobRequest.createdAt for pre-instrumentation rows)
   - Match attempted (`DispatchDecision.createdAt` in range)
   - ≥1 eligible provider (`DispatchDecision.eligibleCount > 0`)
   - Provider accepted (`WorkflowEvent` PROVIDER_ACCEPTED)
   - Client notified after accept (`WorkflowEvent` CLIENT_NOTIFIED)
3. **Drop-off table** — same six stages with deltas; biggest leak highlighted.
4. **By service** — top categories with submit→accept conversion %.
5. **By suburb** — same, grouped by `JobRequest.address.suburb`.
6. **Provider notification health** — `MessageEvent` where `templateName IN (lead-notification-templates)`, grouped by status. Uses the new `leadId` FK for fast joins.

### Query layer

New module `lib/admin/funnel-aggregate.ts` (pattern mirrors existing `lib/admin/acquisition-aggregate.ts`). One async function per page section:

```ts
fetchFunnelCounts({ from, to }): Promise<{ started, submitted, matched, eligible, accepted, notified }>
fetchFunnelByService({ from, to }): Promise<Array<{ category, submitted, accepted, conversionRate }>>
fetchFunnelBySuburb({ from, to }): Promise<Array<{ suburb, submitted, accepted, conversionRate }>>
fetchNotificationHealth({ from, to }): Promise<{ sent, delivered, read, failed }>
```

All backed by indexed Prisma queries — no raw SQL needed for Tier 1.

### Auth + flag gating

- `requireAdmin()` (existing pattern)
- Feature flag `admin.reports.customer_funnel` (default OFF)
- Read-only; no `crudAction` wrapping (no mutations on this page)

### PII boundary

Aggregate functions return counts + category labels + suburb labels only. No customer names, phones, addresses, or request descriptions surface in the response payload. Per-request drill-down (with its own PII gate) is explicitly Tier 3.

## 6. Daily script + ops outputs

New file `field-service/scripts/daily-customer-funnel-report.ts`. Mirrors the existing `daily-provider-funnel-report.ts` shell, auth, and output shape.

```
pnpm tsx scripts/daily-customer-funnel-report.ts [--days=1] [--json]
```

Default output is a human-readable terminal report. `--json` emits structured output for automation (OpenBrain ingest, CI digest, Slack post).

Sample output:

```
========== Plug A Pro — Customer Funnel — last 24h ==========
Window: 2026-06-21 00:00 → 2026-06-22 00:00 UTC

Funnel
  REQUEST_STARTED            127     (-)
  REQUEST_SUBMITTED           83  → 65% from started
  MATCH_ATTEMPTED             83  → 100%
  ≥1 ELIGIBLE PROVIDER        71  →  86%   ⚠ 12 with zero eligible
  PROVIDER_ACCEPTED           39  →  55%   ⚠ 32 matched-but-not-accepted
  CLIENT_NOTIFIED             37  →  95%   ⚠ 2 accepted-but-not-notified

Top leak: matched → accepted (45% drop, 32 requests)

By service (submitted → accepted)
  Plumbing            29  →  18  (62%)
  Handyman            22  →  10  (45%)
  Electrical          12  →   7  (58%)
  ...

By suburb (submitted → accepted)
  Roodepoort          18  →  11  (61%)
  Northgate           12  →   5  (42%)
  ...

Notification health (24h)
  SENT      214
  DELIVERED 198
  READ      173
  FAILED      4   ← templates: provider_lead_offer x3, customer_match_found x1

Ops action items
  - 12 requests submitted with ZERO eligible providers
  - 32 requests with providers notified but no acceptance
  - 2 requests accepted but client never notified
```

### Ops action items Tier 1 surfaces

| Spec item | Tier 1 source |
|---|---|
| Submitted but not matched | `JobRequest` without `DispatchDecision` |
| Zero eligible providers | `DispatchDecision.eligibleCount = 0` |
| Providers notified, no acceptance | `Lead.status IN (SENT, VIEWED)` aged > SLA |
| Accepted, client not notified | PROVIDER_ACCEPTED without CLIENT_NOTIFIED for same JobRequest within 5 min |
| Payment failure | `Payment.status='FAILED'` (existing in `/admin/payments`) |
| Stale > SLA | Generic age filter, configurable |
| Needs manual matching | `DispatchDecision.failureClass IN ('NO_PROVIDER_AVAILABLE', 'MANUAL_REVIEW_REQUIRED')` |
| Providers repeatedly ignoring leads | Daily script top-10 list grouped by `Lead.providerId WHERE status='EXPIRED'` (no UI in Tier 1) |
| Services/suburbs with demand but weak supply | Page table — high submitted + low eligibleCount |

### Cron

Not wired in Tier 1. The script is a manual ops tool. A Vercel cron can be added in a follow-up if useful.

## 7. Tests

### Unit (Vitest)

| File | What it proves |
|---|---|
| `__tests__/lib/workflow-events/record.test.ts` (extend existing) | New 7 enum values accepted; PII-safe metadata enforced via key allowlist |
| `__tests__/api/customer-bookings-funnel.test.ts` | POST writes REQUEST_SUBMITTED with `entityId=JobRequest.id` |
| `__tests__/lib/matching/dispatch-funnel.test.ts` | `sendJobOffer` success → PROVIDER_NOTIFIED with `delivered=true`; failure → `delivered=false` |
| `__tests__/app/leads-access-funnel.test.ts` | Tap writes PROVIDER_VIEWED, sets `Lead.viewedAt`, flips `Lead.status='VIEWED'`. Idempotent on second tap. |
| `__tests__/lib/selected-provider-acceptance-funnel.test.ts` | Successful accept tx writes PROVIDER_ACCEPTED. Insufficient-credit accept does NOT write the event. Tx atomicity preserved. |
| `__tests__/lib/matching-engine-decline-funnel.test.ts` | `declineLead` writes PROVIDER_DECLINED |
| `__tests__/lib/post-match-communications-funnel.test.ts` | Successful customer notify writes CLIENT_NOTIFIED alongside existing AuditLog |
| `__tests__/admin/funnel-aggregate.test.ts` | `fetchFunnelCounts` returns correct counts for seeded WorkflowEvent + DispatchDecision rows. Covers date-window exclusive-end edge case. |
| `__tests__/scripts/daily-customer-funnel-report.test.ts` | `--json` output matches snapshot for seeded fixture |

### Integration smoke

`/admin/reports/funnel` is auto-included in `e2e/smoke.spec.ts` via `lib/admin-nav-routes.ts`. Adding the nav entry is sufficient.

### What's not tested in Tier 1

- Page visual rendering (premature; smoke covers 200 OK)
- Backfill correctness (no backfill)
- Cron behavior (no cron)

## 8. Rollout plan

1. Land Migration A + Migration B in one PR; assert Prisma generator + tests green locally.
2. Ship the helper wiring (call sites #1-7) in the same PR with their respective tests.
3. Ship the admin page + query layer + daily script in the same PR.
4. Merge to main; Vercel auto-deploys.
5. Verify in prod: query `WorkflowEvent` directly via Supabase to confirm rows are being written.
6. Flip `admin.reports.customer_funnel` flag ON.
7. Run `pnpm tsx scripts/daily-customer-funnel-report.ts` from local dev pointed at prod DB; confirm output matches admin page.

### Risks

| Risk | Mitigation |
|---|---|
| Event write fails inside a critical tx | Post-tx best-effort writes; helper contract preserved. |
| Enum drift between Prisma and TS | Single source of truth in Prisma; TS imports by name break the build on rename. |
| Admin page exposes PII | Aggregates return counts + category + suburb only. Reviewers confirm. |
| Flag never flipped | Daily script bypasses the flag (works against raw data). |
| `REQUEST_STARTED` semantics shift in Tier 2 | Document that Tier 1 means "request flow started"; Tier 2 will redefine to "first session visit". Page label adapts to most precise available. |

## 9. Out of scope (explicit)

Listed earlier in §2; restated for spec discipline:

- Anonymous visit / `VisitSession` table
- `PaymentStatusEvent` history table
- `INSUFFICIENT_CREDIT` as a filter exclusion
- SMS/email lead notification fallback
- Per-request drill-down panel in admin page
- `LeadView` model with per-tap tracking
- `Invoice` status enum + send-attempt log
- Historical `WorkflowEvent` backfill
- Vercel cron wiring for the daily script
- Posting daily script output to Slack / OpenBrain / pubsub

Each gets its own spec when reached.

## 10. Acceptance — what we'll be able to answer

| Acceptance criterion | Source after Tier 1 |
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
| Funnel data avoids unnecessary PII | ✅ Aggregate-only response payloads |
| Funnel reporting is date-filterable | ✅ Chip + custom range |

Two of 12 criteria are deferred to Tier 2 — explicitly the anonymous-visit count and the honest-eligible-count fix.

## 11. OpenBrain hook

After implementation, log to OpenBrain `Plug-A-Pro` project:

- Title: `engineering — Client funnel observability Tier 1 (YYYY-MM-DD)`
- Domain: `engineering`
- Tags: `funnel-observability`, `tier-1`, `workflow-events`, `admin-reports`
- Content: this spec's §3 (architecture), §6 (script output), §10 (acceptance), and the PR number once shipped.

A second memory file `project_funnel_observability_tier1.md` indexes from `MEMORY.md` so future sessions know Tier 1 has shipped and what Tier 2/3 still owe.
