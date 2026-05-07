# Matching Engine — As-Is and Gap Analysis

## Matching model (sequential vs score-based)

The engine is **score-based with sequential reservation**. One provider is selected per dispatch cycle.

Flow:
1. Candidate pool is loaded (precomputed `candidate_pool` table, 10-minute freshness; falls back to direct DB scan)
2. Hard eligibility filters applied: area coverage, skills, certifications, equipment, vehicles, live status, capacity, cooldown, explicit declines
3. Score computed for each eligible candidate (pure function, no DB calls)
4. Top-5 candidates tried in rank order via `SELECT FOR UPDATE SKIP LOCKED` — first successful reservation wins
5. One `AssignmentHold` created and WhatsApp lead dispatched

There is no "broadcast to N providers simultaneously" step in the base path. The `MATCHING` job status means exactly one active hold exists.

The Qualified Shortlist Model layer changes the provider response UX (free interest declaration instead of paid accept), but does **not** change the underlying sequential dispatch: one provider is offered at a time, responding with interest places them into the shortlist pool.

---

## Invite count limits

| Scope | Limit | Config |
|---|---|---|
| Providers offered simultaneously per job | **1** | Enforced by single `AssignmentHold` per job |
| Candidates tried per dispatch cycle (reservation attempt) | **5** | `ranked.slice(0, 5)` in `orchestrator.ts:172` |
| Provider daily job hard cap | **2** (`hardDailyMax`) | `config.ts` |
| Preferred daily load (soft penalty) | **1** (`preferredDailyLoad`) | `config.ts` |
| Candidate pool size | **30** | `loadCandidatePool` default |
| Cron batch — OPEN jobs processed per tick | **20** | `take: 20` in cron route |

When a hold expires or a provider declines, `offerNextRankedCandidate` attempts the next ranked candidate from the existing `DispatchDecision`. If all ranked candidates are exhausted, the job is reset to `OPEN` for the cron to retry with a fresh dispatch cycle.

**Gap:** No hard limit on total dispatch attempts per job lifetime. A job could cycle through providers indefinitely until `expiresAt` fires. No max-attempts guard exists.

---

## Lead invite lifecycle

In legacy mode (`qualified_shortlist.dispatch_v2` = off):
```
SENT → (VIEWED) → ACCEPTED (paid, triggers Match) | DECLINED | EXPIRED
```

In dispatch_v2 mode (Qualified Shortlist Model, flag = on):
```
SENT → (VIEWED) → INTERESTED (free, with rate/arrival) | DECLINED | EXPIRED
INTERESTED → SHORTLISTED (after shortlist generation) | EXPIRED
SHORTLISTED → CUSTOMER_SELECTED | SUPERSEDED
CUSTOMER_SELECTED → ACCEPTED (paid, triggers Match) | EXPIRED
```

The `Lead` model (`leads` table) is the same record in both paths. The `LeadStatus` enum contains all states for both models. `ProviderLeadResponse` stores interest data (callOutFee, estimatedArrivalAt, rateType, rateAmount) for dispatch_v2 responses.

A separate model family supports the shortlist:
- `ProviderShortlist` — the shortlist publication (`status: PUBLISHED | SUPERSEDED`)
- `ProviderShortlistItem` — per-provider slot (`leadInviteId`, `rank`, `displayCallOutFee`, `displayArrivalTime`)

`LeadInvite` is not a separate Prisma model — the code uses `Lead` for both paths and refers to it as "lead invite" in qualified shortlist context.

---

## Expiry handling

### Provider offer expiry (AssignmentHold TTL: 15 minutes)
- `expiresAt = now + MATCHING_CONFIG.offerTtlMinutes * 60s` set at reservation time
- Cron step 1 calls `processPendingAssignmentWorkflows()`, which finds ACTIVE holds past `expiresAt` and calls `expireAssignmentOffer()` for each
- `expireAssignmentOffer()` in a transaction:
  - Sets `assignmentHold.status = EXPIRED`
  - Sets `lead.status = EXPIRED` (for SENT/VIEWED leads only — INTERESTED leads are **not** expired)
  - Sets `matchAttempt.stage = TIMED_OUT`
  - Releases schedule items
- After transaction: decrements `providerCapacity.activeHolds`, checks auto-pause threshold
- Then calls `offerNextRankedCandidate()` to cascade to the next ranked provider
- If no next candidate: `offerNextRankedCandidate` resets job to `OPEN` and calls `notifyExpiredJobParties()`

**Bug identified — Gap 1:** `expireAssignmentOffer` sets `lead.status = EXPIRED` only for leads with `status IN ('SENT', 'VIEWED')`. Leads in `INTERESTED` status are silently skipped. This means:
- A provider who expressed interest will have their lead remain `INTERESTED` even after the hold expires
- The `maybeAutoTriggerShortlist` count query in `provider-opportunity-responses.ts:296` requires `expiresAt > new Date()`, so the lead will eventually stop counting — but the status is never updated to `EXPIRED`
- This creates data inconsistency in the `Lead` table and incorrect state in `qualified-shortlist-state.ts:mapLeadInviteToQualifiedState` (which checks `expiresAt <= now AND status != ACCEPTED` to determine expiry, so the runtime state is correct, but the DB row status is wrong)

### Job request expiry (max age: 7 days)
- `expiresAt` is set on submission based on `MATCHING_CONFIG.jobRequestMaxAgeDays = 7`
- Cron step 1h sweeps `OPEN` jobs with `expiresAt <= now` and calls `expireOpenJobRequest()`
- Inline guard in `orchestrator.ts:62` also checks before dispatching
- `notifyExpiredJobParties()` sends customer no-match notification (guarded by `customerNoMatchNotifiedAt`)
- Catch-up sweep (cron step 1i) retries recently-expired jobs that missed notification

### Shortlist expiry
**Gap 2 — No shortlist/customer-selection deadline enforcement.** Once a request reaches `SHORTLIST_READY` status:
- There is no `selectionDeadline` or `selectionExpiresAt` field on `JobRequest`
- There is no cron sweep to detect stalled `SHORTLIST_READY` requests
- The customer can take arbitrarily long to choose, and the shortlisted lead invites have their own `expiresAt` (copied from the `AssignmentHold`)
- When lead invites expire, `qualified-shortlist-state.ts:mapLeadInviteToQualifiedState` will compute `expired` state from `expiresAt <= now`, but the `ProviderShortlist` and `ProviderShortlistItem` rows are never cleaned up
- The `selectShortlistedProviderForRequest` guard only checks `item.leadInvite.status === 'EXPIRED'` — but as noted in Gap 1, INTERESTED leads do not get their status set to EXPIRED by the hold-expiry path
- This means a customer could in theory select an expired provider from the shortlist

### Provider-confirmation-pending expiry
**Gap 3 — No deadline for provider final acceptance.** Once `PROVIDER_CONFIRMATION_PENDING`:
- No `confirmationDeadline` field exists
- No cron sweep detects stale `PROVIDER_CONFIRMATION_PENDING` jobs
- The selected provider can take indefinitely to accept or decline

---

## Cron schedule and behaviour

Vercel Cron schedules:
- `*/5 5-16 * * *` — every 5 min during SAST 07:00–18:59
- `*/30 17-23,0-4 * * *` — every 30 min during SAST 19:00–06:59

Each cron run in order:
0. `reconcileStaleAssignmentState()` — corrects capacity counter drift
1. `processPendingAssignmentWorkflows()` — expire holds, cascade next candidate
1b. `expireStaleQuotes()`
1c. `reconcileProviderRecordsFromApplications()` — backfill provider rows from applications
1d. `routeProviderApplicationsForOpsReview()` — flag pending applications for ops
1g. Retry approved-application WhatsApp notifications that were missed
1h. Sweep `OPEN` jobs past `expiresAt`
1i. Catch-up sweep: recently-expired jobs missing customer notification
1j. Auto-resume providers whose `breakUntil` has passed
2. Dispatch leads for OPEN jobs (up to 20 per tick) via `orchestrateMatch()`
3. `sendLeadReminders()` — 10-minute nudge for SENT/VIEWED leads
4. Admin WhatsApp alert for jobs open > 1 hour
5. Ops queue breach alerts

The cron is **not idempotent-safe for step 2 re-runs in the same tick**: `orchestrateMatch()` guards internally via `ALREADY_HELD` check, but two simultaneous cron invocations could both find the same OPEN job before either creates a hold. The `SELECT FOR UPDATE SKIP LOCKED` in `reservation.ts` is the ultimate safety net.

---

## Scoring/ranking factors

Weights (from `config.ts`, applied in `scoring.ts`):

| Factor | Weight | Notes |
|---|---|---|
| Skill match (exact) | 30% | Binary 0/1 — all required skills present |
| Schedule fit | 20% | Window feasibility + travel time |
| Travel efficiency | 20% | `1 - travelMinutes/maxTravelMinutes` |
| Reliability | 15% | Composite: `reliabilityScore×0.3 + onTimeRate×0.2 + punctualityScore×0.2 + (1-cancellationRate)×0.1 + (1-complaintRate)×0.1 + acceptanceRate×0.05 + avgRating/5×0.05` |
| Customer preference | 10% | 1.0 if `preferredProviderId` matches, else 0 |
| Margin efficiency | 5% | Remaining travel capacity |
| Region fallback penalty | -12% | Applied when coverage tier is REGION_FALLBACK |
| Workload fairness penalty | variable | Decays when `dailyAssignedJobs >= preferredDailyLoad (1)` |

Secondary sort: travel minutes ascending (tiebreaker).

**TODO (noted in scoring.ts:38):** `providerPreference` (save_money / best_value / best_quality) captured from job request but weight shifts not yet implemented. Scoring always uses default weights regardless of customer preference.

**Note:** `service.ts` has a legacy `buildScoreBreakdown` function that does not apply the workload fairness penalty — only the `scoring.ts` version (used by `orchestrator.ts`) includes it. The service.ts path (`runAssignmentForJobRequest`) uses the legacy scorer. This creates divergence in scoring between the old cron path and the new orchestrator path.

---

## Idempotency

| Mechanism | Where | Behaviour |
|---|---|---|
| `ALREADY_HELD` guard | `orchestrator.ts:68` + `reservation.ts:52` | Skips dispatch if active unexpired hold exists |
| `SKIP LOCKED` transaction | `reservation.ts:41` | Prevents concurrent reservation of same provider |
| Lead upsert | `dispatch.ts:45` | Re-dispatch updates existing lead row rather than creating duplicate |
| WhatsApp dedup | `dispatch.ts:141-152` | Checks `hasSuccessfulMessageForRecipient` before sending CTA and buttons |
| DispatchDecision idempotency key | `orchestrator.ts:367` | 1-minute window keyed on (jobRequestId, status, selectedProviderId, triggeredBy) |

Re-running `orchestrateMatch()` on a job with an active hold returns `SKIP reason: ALREADY_HELD` — no duplicate invites are sent.

Re-running after hold expiry: new dispatch cycle begins with fresh scoring. Previous DECLINED/EXPIRED leads are excluded via the `declinedProviderIds` hard-filter.

---

## Request status transitions during matching

```
PENDING_VALIDATION
  └─► OPEN (on validation approval)
        ├─► MATCHING (first provider reserved — inside reservation.ts transaction)
        │     ├─► OPEN (provider declines or hold expires — via offerNextRankedCandidate)
        │     │     └─► [cron re-dispatches]
        │     └─► SHORTLIST_READY (dispatch_v2: enough INTERESTED responses)
        │           ├─► PROVIDER_CONFIRMATION_PENDING (customer selects from shortlist)
        │           │     └─► MATCHED (provider accepts final offer)
        │           └─► CANCELLED (customer cancels from shortlist UI)
        └─► EXPIRED (expiresAt reached or all candidates exhausted)
```

`AWAITING_RESPONSES` does not exist in the schema. The spec concept maps to `MATCHING` (one hold active, waiting for provider response) or the period between when INTERESTED responses are being collected and `SHORTLIST_READY` is triggered.

---

## Gaps vs Qualified Shortlist Model

| # | Gap | Severity | Location |
|---|---|---|---|
| G1 | INTERESTED leads not marked EXPIRED when hold expires | High | `service.ts:expireAssignmentOffer` |
| G2 | No selection deadline for `SHORTLIST_READY` requests | High | `cron/match-leads/route.ts` — no sweep |
| G3 | No confirmation deadline for `PROVIDER_CONFIRMATION_PENDING` | Medium | Missing cron sweep |
| G4 | `selectShortlistedProviderForRequest` reads lead status from DB but INTERESTED leads have stale status (G1) — selection guard is unreliable | High | `customer-shortlists.ts:255` |
| G5 | `AWAITING_RESPONSES` spec state not in schema; concept is implicit via `MATCHING` with dispatch_v2 flag | Low | Schema `JobRequestStatus` enum |
| G6 | `providerPreference` weight-shift scoring not implemented (save_money/best_quality/best_value) | Low | `scoring.ts:38` TODO |
| G7 | Scoring divergence: `service.ts:buildScoreBreakdown` (legacy path) lacks workload fairness penalty vs `scoring.ts` (orchestrator path) | Medium | `service.ts:670` vs `scoring.ts:87` |
| G8 | No max-attempts limit per job lifetime — infinite dispatch cycles theoretically possible | Low | `orchestrator.ts` |
| G9 | Shortlist item selectability check (`item.leadInvite.status === 'EXPIRED'`) depends on status being correctly set, which G1 breaks | High | `customer-shortlists.ts:255` |
| G10 | `maybeAutoTriggerShortlist` guarded by `qualified_shortlist.auto_trigger` flag but no cron fallback — shortlist generation depends entirely on real-time provider response events | Medium | `provider-opportunity-responses.ts:270` |

---

## Recommendations

**Fix immediately (bugs):**

1. **G1 — Expire INTERESTED leads.** In `expireAssignmentOffer`, change the `lead.updateMany` status filter from `{ in: ['SENT', 'VIEWED'] }` to `{ in: ['SENT', 'VIEWED', 'INTERESTED'] }`. Add a regression test.

2. **G4 / G9 — Selection guard.** After fixing G1, the guard in `selectShortlistedProviderForRequest` will work correctly for the EXPIRED status path. Until G1 is fixed, add `expiresAt <= new Date()` as an additional check in the selectable guard.

**Address soon (gaps):**

3. **G2 — Customer selection deadline.** Add `selectionDeadlineAt` to `JobRequest` (nullable, set to `publishedAt + 24h` when shortlist is published). Add cron sweep step to expire `SHORTLIST_READY` jobs past deadline.

4. **G3 — Provider confirmation deadline.** Add `confirmationDeadlineAt` (nullable, set on `PROVIDER_CONFIRMATION_PENDING` transition). Cron sweep detects stale confirmation requests.

5. **G10 — Cron-side shortlist trigger fallback.** Add a cron step to find `MATCHING` jobs that have met the interest threshold but have not been promoted to `SHORTLIST_READY`. This guards against the case where all real-time interest responses arrive before the flag was enabled, or where the auto-trigger call failed silently.

**Defer:**

6. **G6** — Preference-based scoring: implement only when matching dataset is reliable enough.

7. **G7** — Scoring divergence: consolidate `service.ts:buildScoreBreakdown` and `scoring.ts:buildScoreBreakdown` into a single shared function.

8. **G8** — Max attempts: add `dispatchAttemptCount` field and a configurable `MATCHING_CONFIG.maxDispatchAttempts` guard.

---

## Bug Fixes Applied

### Fix 1 — G1: INTERESTED leads not marked EXPIRED on hold expiry

**File:** `lib/matching/service.ts`

The `updateMany` filter for lead expiry was updated to include `INTERESTED` status, ensuring that leads in the `INTERESTED` state are correctly transitioned to `EXPIRED` when their associated `AssignmentHold` expires. This fixes stale lead status data and the downstream shortlist selectable guard.

**Test added:** `__tests__/lib/matching-expiry.test.ts` — new `it` block covers INTERESTED lead expiry on hold timeout.

---

## OpenBrain Note

This assessment was produced as Step 10 of the Plug A Pro Codex Implementation Pack.

- **Root cause of key bugs:** `expireAssignmentOffer` predates the Qualified Shortlist Model's `INTERESTED` status. The lead expiry filter was never updated when `INTERESTED` was added to `LeadStatus`.
- **Clues:** `qualified-shortlist-state.ts:mapLeadInviteToQualifiedState` uses `expiresAt <= now` as a runtime fallback, masking the DB status bug. The `selectShortlistedProviderForRequest` guard reads DB status directly and is therefore unreliable.
- **Files inspected:** `lib/matching-engine.ts`, `lib/matching/orchestrator.ts`, `lib/matching/service.ts`, `lib/matching/dispatch.ts`, `lib/matching/filter.ts`, `lib/matching/scoring.ts`, `lib/matching/reservation.ts`, `lib/matching/candidate-pool.ts`, `lib/matching/config.ts`, `lib/qualified-shortlist-state.ts`, `lib/customer-shortlists.ts`, `lib/provider-opportunity-responses.ts`, `app/api/cron/match-leads/route.ts`, `prisma/schema.prisma`
- **Date:** 2026-05-07
