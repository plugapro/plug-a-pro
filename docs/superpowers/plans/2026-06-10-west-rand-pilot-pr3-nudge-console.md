# West Rand Pilot — PR3: Provider Nudge Console Implementation Plan (RETROSPECTIVE)

> **Status:** RETROSPECTIVE. Code was committed before this plan was written. Tasks below are checked `[x]` where the audit verified the shipped commit matches the spec; drift annotations describe the small deltas.
>
> **As-built commit:** `e0d455c91` on `feat/west-rand-pilot-nudges`.
>
> **Spec:** `docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md` (v2) — §3.0 PR3 row, §3.4 flag + batch cap, §4.4 admin nudges page, §4.5 template + label mapping, §5.3 nudge lifecycle, §6.2 admin errors, §8.1 PR3 test rows, §9 AC #7/#8/#9/#11.
>
> **Audit summary:** 9 of 9 core requirements MATCH spec. Three minor deviations documented at the bottom (none blocking).

**Goal:** Land the admin-facing provider nudge console — an ordered queue of approved-but-incomplete pilot candidates, per-row template preview, CSV export, and bulk "Mark sent" with typed confirmation. No outbound Meta API in this scope; ops sends out-of-band and returns to mark the batch as sent. Audit-only side effects. Gated by `launch.west_rand_pilot.nudge_console` (default OFF).

**Architecture:** `lib/nudges/queue.ts` orders candidates: R5-plumbing → R5 → R4 → PENDING_R1, then `lastNudgedAt` ASC nulls-first (sourced from `AdminAuditEvent` queries), then `updatedAt` DESC tiebreaker. `lib/nudges/template.ts` renders the corrected pilot-nudge copy. `lib/nudges/csv.ts` produces a CSV stream. Server component `app/(admin)/admin/nudges/page.tsx` renders the queue; `actions.ts` exposes three `crudAction()`-wrapped server actions for preview, CSV export, and mark-sent. Mark-sent guards (confirm-phrase, batch cap default 200, empty batch) reject before any `crudAction` so failed guards leave no audit row.

**Tech Stack:** Next.js 16 App Router, React Server Components, Prisma, Vitest, TypeScript.

---

## File Structure (as built)

| File | Status | Responsibility |
|---|---|---|
| `field-service/lib/nudges/queue.ts` | Created | Build ordered queue from providers + `AdminAuditEvent` lookups; expose `NUDGE_MARK_SENT_BATCH_CAP` (default 200, env-override). |
| `field-service/lib/nudges/template.ts` | Created | `renderNudgeMessage({firstName, missingItemsLabel})` and `buildMissingItemsLabel(items)` (serial-comma). |
| `field-service/lib/nudges/csv.ts` | Created | CSV serialization for export. |
| `field-service/app/(admin)/admin/nudges/page.tsx` | Created | SSR queue + bulk-select UI, flag-gated. |
| `field-service/app/(admin)/admin/nudges/actions.ts` | Created | `previewNudgeAction`, `exportNudgeQueueCsvAction`, `markNudgeBatchSentAction` — all via `crudAction()`. |
| `field-service/lib/feature-flags-registry.ts` | Modified | `launch.west_rand_pilot.nudge_console` added. |
| `field-service/__tests__/lib/nudges/queue.test.ts` | Created | Ordering, nulls-first, filtering, audit-event lookup. |
| `field-service/__tests__/lib/nudges/template.test.ts` | Created | Exact template copy + serial-comma + fallback. |
| `field-service/__tests__/lib/nudges/csv.test.ts` | Created | Header, escaping, skill-join, pipe delimiter. |
| `field-service/__tests__/app/admin/nudges-actions.test.ts` | Created | Action audit events; mark-sent guards. |

> **Note on `missing-items.ts`:** the spec listed `lib/nudges/missing-items.ts`; the implementation kept that function (`listMissingProfileItems`) in `lib/provider-tier.ts` from PR2 to avoid duplicating the missing-fields list. Functionally equivalent; one fewer file. Spec wording was aspirational, not load-bearing.

---

## Task 1: Implement `renderNudgeMessage` template + serial-comma label builder (TDD)

**Files:**
- Create: `field-service/lib/nudges/template.ts`
- Create: `field-service/__tests__/lib/nudges/template.test.ts`

- [x] **Step 1: Write failing test asserting exact copy.**
  - `template.test.ts:26–58` includes a substring assertion for the corrected closing line "so you can be considered for more suitable leads."

- [x] **Step 2: Implement template + serial-comma builder.**
  - `template.ts:17–25` renders the verbatim spec §4.5 copy.
  - `template.ts:5–11` `buildMissingItemsLabel(items)` produces serial-comma list ("a, b, and c"; "a and b"; "a").
  - Friendly-label mapping lives in `provider-tier.ts:54–61` (re-used from PR2).

- [x] **Step 3: Commit.**

**Audit:** MATCH §4.5 exactly.

---

## Task 2: Implement queue ordering with `AdminAuditEvent` last-nudge lookup (TDD)

**Files:**
- Create: `field-service/lib/nudges/queue.ts`
- Create: `field-service/__tests__/lib/nudges/queue.test.ts`

- [x] **Step 1: Write failing tests for ordering.**
  - `queue.test.ts:57–207` covers:
    - R5-plumbing (rank 0) before R5 (rank 1) before R4 (rank 2) before PENDING_R1 (rank 3).
    - Within-tier: `lastNudgedAt === null` sorts first; non-null sorts ASC by timestamp.
    - Audit-metadata extraction: last `AdminAuditEvent(action='nudge.batch.marked_sent')` matching `providerId ∈ metadata.providerIds` provides `lastNudgedAt`.
    - Filtering: by suburb / category / tier.

- [x] **Step 2: Implement `tierRank` + sort.**
  - `queue.ts:109–169` implements ranking and nulls-first sort.
  - `queue.ts:29` exports `NUDGE_MARK_SENT_BATCH_CAP = 200`; env override via `process.env.NUDGE_MARK_SENT_BATCH_CAP`.

- [x] **Step 3: Implement candidate selection + audit-event lookup.**
  - Reads providers that pass `isPilotLaunchCandidate(p)` (per PR2 helper) with `listMissingProfileItems(p).length > 0`.
  - For each candidate, finds the most recent `AdminAuditEvent` with `action='nudge.batch.marked_sent'` whose metadata contains the provider id.

- [x] **Step 4: Commit.**

**Audit:** MATCH spec §5.3. Tiebreaker on `updatedAt` is present but not explicitly DESC — irrelevant in practice (millisecond ties are rare for `lastNudgedAt`); document as minor drift.

---

## Task 3: Implement CSV serialization (TDD)

**Files:**
- Create: `field-service/lib/nudges/csv.ts`
- Create: `field-service/__tests__/lib/nudges/csv.test.ts`

- [x] **Step 1: Write failing test.**
  - `csv.test.ts:18–53` covers: header order, comma/quote escaping, skill-join with pipe delimiter, missing-items rendering.

- [x] **Step 2: Implement CSV builder.**
  - `csv.ts` builds rows with columns: `provider_id, name, phone, tier, primary_skills, missing_items, suburb_label, application_status, rendered_message`.

- [x] **Step 3: Commit.**

**Audit:** MATCH §5.3 columns. **Minor drift:** `suburb_label` column carries the suburb **slug**, not a human label. Pragmatic for ops working with raw data; spec wording was ambiguous. Track as **PR3-FOLLOWUP-CSV-LABEL** if ops requests a friendly label later.

---

## Task 4: Build admin `/admin/nudges` SSR page (flag-gated)

**Files:**
- Create: `field-service/app/(admin)/admin/nudges/page.tsx`

- [x] **Step 1: Flag-gate + requireAdmin.**
  - `page.tsx:26–28` calls `isEnabled('launch.west_rand_pilot.nudge_console')` → 404 if OFF.

- [x] **Step 2: Render ordered queue + bulk-select + per-row preview + CSV export button + Mark-sent dialog.**

- [x] **Step 3: Commit.**

**Audit:** MATCH §4.4.

---

## Task 5: Implement three server actions via `crudAction()` (TDD)

**Files:**
- Create: `field-service/app/(admin)/admin/nudges/actions.ts`
- Create: `field-service/__tests__/app/admin/nudges-actions.test.ts`

- [x] **Step 1: Write failing tests.**
  - `nudges-actions.test.ts:47–130` covers preview, export, mark-sent (success), and the three guards (confirm-phrase mismatch / empty batch / oversized batch).

- [x] **Step 2: Implement `previewNudgeAction`.**
  - `actions.ts:44–57` wraps `crudAction()` with `action='nudge.preview.viewed'` and provider id in metadata.

- [x] **Step 3: Implement `exportNudgeQueueCsvAction`.**
  - `actions.ts:60–79` wraps `crudAction()` with `action='nudge.csv.exported'`, metadata `{rowCount, filter}`.

- [x] **Step 4: Implement `markNudgeBatchSentAction` with guards-before-crudAction.**
  - `actions.ts:80–133` validates `confirmPhrase === "mark-sent-<count>"` (lines 85–89), batch length ≤ cap (lines 88–92), batch non-empty (line 85), then wraps `crudAction()` with `action='nudge.batch.marked_sent'`, metadata `{providerIds, batchNote, count, filter}`. **One audit event per call, not per row.**
  - Guard failures return early before `crudAction()` → no audit row written (verified by `nudges-actions.test.ts:96–130`).

- [x] **Step 5: Commit.**

**Audit:** MATCH §4.4 / §5.3 / §6.2.

---

## Task 6: Register flag `launch.west_rand_pilot.nudge_console`

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [x] **Step 1: Add entry near other launch flags.**
  - Registered at `feature-flags-registry.ts:238–242` with `defaultValue: false`.

**Audit:** MATCH §3.4.

---

## Task 7 (DEFERRED — DRIFT vs spec): Smoke coverage for `/admin/nudges`

Same situation as PR2's deferred Task 5. The route 404s while flag is OFF, so adding it to `ADMIN_SMOKE_ROUTES` would break smoke until the flag flips on. Defer to the same follow-up that wires nav for both PR2 and PR3 routes simultaneously. Track as **PR3-FOLLOWUP-NAV**.

---

## Acceptance-criteria coverage (PR3)

| AC # | Brief | Covered by | Status |
|---|---|---|---|
| 7 | Nudge ordering correct | `queue.test.ts:57–207` | MATCH |
| 8 | Corrected nudge copy | `template.test.ts:26–58` | MATCH |
| 9 | No mass live messages without admin review/confirm | `nudges-actions.test.ts:47–130` (no outbound; guards enforced) | MATCH |
| 11 | Per-action `AdminAuditEvent` in-app side | `previewNudgeAction`, `exportNudgeQueueCsvAction`, `markNudgeBatchSentAction` all write events | MATCH |

---

## Drift / surprises (full audit detail)

| Finding | Severity | Notes |
|---|---|---|
| `listMissingProfileItems` lives in `provider-tier.ts` rather than `lib/nudges/missing-items.ts` | Low — file organisation only | Single source of truth, less duplication; the spec file path was aspirational |
| CSV `suburb_label` column carries the suburb slug, not a friendly label | Low | Pragmatic for ops; document with **PR3-FOLLOWUP-CSV-LABEL** if a friendly label is requested |
| Within-tier `updatedAt` tiebreaker not explicitly DESC | Low | Triggered only when `lastNudgedAt` ties to the millisecond; rare in practice |
| `/admin/nudges` not in `ADMIN_SMOKE_ROUTES` | Medium — same deferral as PR2 Task 5 | Track as **PR3-FOLLOWUP-NAV** |
| No outbound side effects | — | Confirmed by audit (no `WhatsappPolicy.send`, no Meta API) |
| No schema change | — | Confirmed by audit |

---

## What's NOT in PR3 (deferred for the next PR after this one)

Per spec §11, these are tracked but **out of scope**:
- Live Meta WhatsApp send (requires template approval ~48h, opt-in checks, send-rate limiter, status-webhook reconciliation, retry semantics).
- `pilot_nudge_v1` Meta template registration.
- Automated nudge cadence / cron.
