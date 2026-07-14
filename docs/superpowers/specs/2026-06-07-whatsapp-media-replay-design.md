# WhatsApp Provider Media Replay — Design Spec

**Date:** 2026-06-07
**Status:** Draft for review. Sections 1 and 2 reflect approved clarifying decisions; Section 3 is proposed and pending user sign-off.
**Spec author:** Claude Code session, brainstorming flow.
**Related:**
- `docs/superpowers/specs/2026-06-06-db-wipe-recovery-design.md` (parent incident)
- `docs/superpowers/plans/2026-06-06-db-wipe-recovery.md` (sibling read-only audit)
- `field-service/lib/whatsapp-media.ts` (the function this script wraps)

---

## 1. Problem

On 2026-06-05 a database wipe affected the production Plug A Pro field-service Postgres and the associated Vercel Blob + Supabase Storage buckets. Phase 0 of the parent incident closed with:

- Postgres restored from backup.
- Blob and Storage objects lost.
- Operator running an external WABA replay script for storage objects.

A read-only audit (`field-service/scripts/audit-whatsapp-blob-gaps.ts`) was run against production on 2026-06-07 and reported:

| Metric | Value |
|---|---|
| `Attachment` rows with `uploadedBy LIKE 'system:whatsapp:%'` | 4 |
| HEAD checks alive | 4 (100%) |
| Gap CSV rows | 0 |
| Inbound media events (`image \| document \| video`) in `inbound_whatsapp_messages` | 139 |

The 4 existing attachments are healthy. The delta — **135 inbound media events with no corresponding `Attachment` row** — represents provider-uploaded evidence (work-proof photos, profile photos, documents) that was wiped and has not yet been re-materialized in the platform.

**Goal of this spec:** define a production-safe, idempotent, read-only-by-default script that replays those inbound messages back into the platform, downloads their media bytes from WhatsApp Business Cloud API (WABA), uploads them to Vercel Blob, and creates `Attachment` rows linked to the correct `ProviderApplication` — restoring as much provider evidence as Meta's media retention window permits.

## 2. Scope

**In scope**
- Inbound messages where `messageType IN ('image', 'document', 'video')`.
- Phones that have at least one `ProviderApplication` row.
- Time-window match between inbound `firstSeenAt` and the application's `[submittedAt − 24h, COALESCE(reviewedAt, NOW())]` interval.
- Label always `evidence`.
- Single CLI script + supporting modules in `field-service/scripts/whatsapp-media-replay/`.

**Out of scope**
- Customer-side `JobRequest` attachments.
- Identity documents (separate function `downloadAndStoreWhatsAppIdentityDocument`, separate POPIA-sensitive storage path).
- Any modification of conversation state, dispatch state, payment, or messaging machinery.
- Any provider-facing WhatsApp messages.
- Any backfill of wiped pre-restore data outside the `Attachment` table (and optionally `ProviderApplication.evidenceFileUrls`).

## 3. Clarifying decisions (already approved by user)

| # | Question | Decision |
|---|---|---|
| Q1 | Where do recovered bytes live? | Not pulled yet — platform script does the WABA fetch. |
| Q2 | Routing rule? | Provider-only scope, time-windowed match. |
| Q3 | Side effects? | Silent restore + single batched admin summary at the end. |

## 4. Approaches considered

| Approach | Verdict |
|---|---|
| **A. Standalone script, two-pass (`--dry-run` → `--commit`).** Re-uses existing `downloadAndStoreWhatsAppMedia`, idempotent on `(uploadedBy, label)`, dry-run produces a reviewable manifest before any write. | **Chosen.** |
| B. Re-fire the webhook handler per inbound message. | Rejected — re-triggers conversation, dispatch, and provider-facing WhatsApp side effects. Violates Q3. |
| C. Insert "replay jobs" into a new table; background worker processes them. | Rejected — 135 messages do not warrant queue infrastructure. The dry-run CSV + idempotent commit gives the same resumability with less surface. |

## 5. Architecture & file layout (Section 1 — approved)

```
field-service/
  scripts/
    replay-whatsapp-provider-media.ts          # CLI entry; arg parsing + orchestration
    whatsapp-media-replay/
      types.ts                                  # PlanRow, ResultRow, Outcome, SkipReason
      planner.ts                                # SELECT + time-window join → PlanRow[]
      meta-probe.ts                             # Optional HEAD on graph.facebook.com (dry-run resolvability check)
      executor.ts                               # Per-row: calls downloadAndStoreWhatsAppMedia, classifies outcome
      evidence-backfill.ts                      # Optional append to ProviderApplication.evidenceFileUrls
      audit.ts                                  # Writes AuditLog rows per restored attachment
      summary.ts                                # Per-application rollup + admin summary body
      csv.ts                                    # PlanRow[] / ResultRow[] → CSV
  __tests__/scripts/whatsapp-media-replay/
    planner.test.ts                             # Routing rule (time-window match, phone normalization, multi-app)
    executor.test.ts                            # Outcome classification (mocked downloadAndStoreWhatsAppMedia)
    evidence-backfill.test.ts                   # Idempotent append, no duplicate URLs
    summary.test.ts                             # Rollup math + email body shape
    csv.test.ts                                 # Header + row encoding
```

### CLI surface

```
pnpm tsx scripts/replay-whatsapp-provider-media.ts \
  [--dry-run | --commit] \
  [--out ./recovery] \
  [--concurrency 4] \
  [--timeout-ms 15000] \
  [--backfill-urls] \
  [--limit N] \
  [--phones +27821234567,+27821234568] \
  [--admin-email ops@kgolaentle.com]
```

- Default mode: `--dry-run`. `--commit` is the explicit gate. Mutually exclusive.
- `--limit` and `--phones` exist for a controlled pilot of 1–5 phones before a full run.
- Re-uses existing `lib/db.ts` Prisma singleton, `lib/whatsapp-media.ts#downloadAndStoreWhatsAppMedia`, and the existing admin notification path (TBD — see §9 open questions).

## 6. Planning query, routing rule, taxonomy (Section 2 — approved)

### 6.1 Planning query (read-only)

Single Prisma `$queryRawUnsafe` join. Selects every candidate row in one pass:

```sql
WITH media_msgs AS (
  SELECT
    id              AS message_id,
    "externalId",
    phone,
    "messageType",
    "firstSeenAt",
    payload -> "messageType" ->> 'id' AS media_id
  FROM inbound_whatsapp_messages
  WHERE "messageType" IN ('image','document','video')
),
already_attached AS (
  SELECT REPLACE("uploadedBy", 'system:whatsapp:', '') AS media_id
  FROM attachments
  WHERE "uploadedBy" LIKE 'system:whatsapp:%'
)
SELECT
  m.message_id, m."externalId", m.phone, m."messageType",
  m."firstSeenAt", m.media_id,
  pa.id            AS application_id,
  pa.status        AS application_status,
  pa."submittedAt", pa."reviewedAt"
FROM media_msgs m
LEFT JOIN already_attached a ON a.media_id = m.media_id
LEFT JOIN provider_applications pa
       ON pa.phone = m.phone
      AND m."firstSeenAt" BETWEEN (pa."submittedAt" - INTERVAL '24 hours')
                              AND COALESCE(pa."reviewedAt", NOW())
WHERE a.media_id IS NULL                              -- skip already-present
  AND m.media_id IS NOT NULL                          -- skip malformed payload
ORDER BY m.phone, m."firstSeenAt" ASC;
```

A TypeScript pass then collapses any phone-with-multiple-application matches using the tie-breaker in §6.2.

### 6.2 Time-window routing rule

For each `(phone, firstSeenAt)`:

1. Candidate set = all `ProviderApplication` rows for the phone where `firstSeenAt BETWEEN (submittedAt − 24h) AND COALESCE(reviewedAt, NOW())`.
2. **Tie-breaker:** most recently `submittedAt` wins.
3. If candidate set empty → `skip:no_application_match`.
4. If phone has zero `ProviderApplication` rows at all → `skip:no_application_for_phone` (a subset of #3, surfaced separately so the operator can decide whether non-provider inbound media is worth a follow-up workstream).
5. Phone normalization via existing `normalizePhone()` on both sides — DB stores `+` prefix on `ProviderApplication.phone`; `InboundWhatsAppMessage.phone` is mixed historically.

The 24-hour pre-submit grace covers the existing pattern in `handlePending` where evidence is uploaded before the `ProviderApplication` row is created (FK is backfilled at submit time). Without the grace window we would lose evidence sent in the final seconds before submit.

### 6.3 Outcome taxonomy

Uniform vocabulary across `replay-plan.csv` and `replay-result.csv` so each row's life can be traced end-to-end.

**Planner verdicts (`expectedOutcome`):**

| Verdict | Meaning |
|---|---|
| `restorable` | Has a target application; commit pass will attempt fetch. |
| `restorable:beyond_meta_retention_soft` | `firstSeenAt` > 30 days ago; still attempted, but operator should expect a `skip:meta_404`. |
| `skip:already_present` | `Attachment` with this mediaId already exists. |
| `skip:no_application_match` | Phone has applications, but none bracket `firstSeenAt`. |
| `skip:no_application_for_phone` | Phone has zero applications — not a provider. |
| `error:malformed_payload` | `media_id` couldn't be extracted from payload. |

**Executor outcomes (`actualOutcome`, `--commit` only):**

| Outcome | Meaning |
|---|---|
| `restored` | New `Attachment` row created, blob uploaded. |
| `restored:reused_existing` | Idempotent hit on `downloadAndStoreWhatsAppMedia`'s `(uploadedBy, label)` dedupe. |
| `skip:meta_404` | Media expired or revoked on Meta's side. |
| `skip:meta_403` | Access denied (token/permission issue — surfaced in admin summary). |
| `skip:meta_rate_limited` | 429 after exponential-backoff retries exhausted. |
| `error:unsupported_mime_type` | Meta returned a MIME not in `ALLOWED_EVIDENCE_TYPES`. |
| `error:oversize` | `file_size` > 15 MB (`MAX_EVIDENCE_SIZE`). |
| `error:empty_body` | Meta returned 0 bytes. |
| `error:blob_upload_failed` | Vercel Blob `put()` threw. |
| `error:db_insert_failed` | Prisma `create()` threw after blob upload (rare; manual cleanup note in summary). |
| `error:unknown` | Anything else — full error captured in `replay-errors.log`. |

### 6.4 Label policy

Pass `label: 'evidence'` to `downloadAndStoreWhatsAppMedia` for every replayed message.

Rationale: the missing 135 are overwhelmingly registration-evidence uploads; the existing `handlePending` defaults to `evidence`; and conversation state from the time of upload may not be intact post-restore, so we can't reliably infer a more specific label. Identity-document replay is out of scope (see §2).

### 6.5 Concurrency, retries, Meta rate-limit guard

- Bounded concurrency: **4** in-flight `downloadAndStoreWhatsAppMedia` calls.
- Per-call timeout: **15 s** (Meta's media URL sometimes falls through to S3).
- Retry policy on Meta calls only: **3 attempts, exponential backoff (1 s, 4 s, 16 s).** Non-429 4xx → no retry. Network errors and 5xx → retry.
- Hard ceiling: if `skip:meta_rate_limited` count ≥ 3 within a 60-second window, the script stops accepting new work, drains in-flight requests, flushes partial `replay-result.csv` + `replay-summary.json` (marked `partial: true`), and exits non-zero. A subsequent `--commit` rerun resumes naturally — every already-restored attachment hits the idempotent `(uploadedBy, label)` short-circuit and the unfinished tail is retried.

---

## 7. Commit pass, audit, summary, testing, safety (Section 3 — PROPOSED, pending user approval)

### 7.1 Commit pass

For each `restorable` PlanRow:

1. Call `downloadAndStoreWhatsAppMedia({ mediaId, providerApplicationId, label: 'evidence' })`.
   - This function is **already idempotent** — it short-circuits on `(uploadedBy, label)` match and returns the existing attachmentId. Re-runs of the script are therefore safe.
2. Capture the returned `attachmentId` and the classified outcome.
3. Write an `AuditLog` row (see §7.3).
4. If `--backfill-urls`: append the new blob URL to `ProviderApplication.evidenceFileUrls[]` (see §7.2).
5. Append a `ResultRow` to the in-memory results buffer; flush to `recovery/replay-result.csv` every 25 rows.

The CLI never opens a Prisma transaction across blob + DB writes: `downloadAndStoreWhatsAppMedia` already commits the `Attachment` row in a single statement after the blob upload succeeds, and a partial failure (blob succeeded, DB row failed) is rare enough to handle by surfacing `error:db_insert_failed` in the result CSV for manual cleanup. Wrapping in a transaction adds no safety because the blob upload itself is non-transactional.

### 7.2 `evidenceFileUrls` backfill (optional, off by default)

`ProviderApplication.evidenceFileUrls: String[]` is a legacy field. The admin UI renders both this list AND the joined `attachments` rows. Restoring the `Attachment` row is enough for the admin UI to display the evidence. The backfill exists only so any other code that reads `evidenceFileUrls` (search the codebase before implementing — there are old `handlePending` consumers) sees the recovered URL.

Behavior:
- Triggered only by `--backfill-urls`.
- Reads current `evidenceFileUrls`; appends the new `blob.url` only if not already present (string dedupe).
- Writes back via `ProviderApplication.update({ where: {id}, data: {evidenceFileUrls: { set: [...] }} })`.
- No-op when the new URL is already in the array.

### 7.3 Audit trail

Each restored attachment writes one `AuditLog` row, mirroring the pattern in `recordProviderOnboardingRecoveryOutcome`:

```ts
await db.auditLog.create({
  data: {
    actorId: 'script:replay-whatsapp-provider-media',
    actorRole: 'system',
    action: 'whatsapp_media_replay.attachment_restored',
    entityType: 'Attachment',
    entityId: attachmentId,
    after: {
      messageId,
      mediaIdSuffix,        // last 8 chars only
      providerApplicationId,
      label: 'evidence',
      blobUrl: blob.url,    // public CDN URL, safe to log
      sourceFirstSeenAt: firstSeenAt.toISOString(),
      mediaAgeDays,
      outcome,              // 'restored' | 'restored:reused_existing'
    } satisfies Prisma.InputJsonObject,
  },
})
```

Phone numbers are **never** written to audit rows. mediaIds are truncated to the last 8 characters (`mediaIdSuffix`), matching the existing convention in `lib/whatsapp-media.ts`.

### 7.4 Admin summary (single batched message at end of `--commit`)

After all rows are processed, the script aggregates a summary:

```
WhatsApp Provider Media Replay — 2026-06-07 14:23 UTC

Mode: --commit
Run id: rwpm_<8-char-hex>
Duration: 2m 14s

Outcomes:
  restored                           94
  restored:reused_existing            4
  skip:meta_404                      31
  skip:no_application_match           4
  skip:no_application_for_phone       2
  skip:already_present                4
  error:oversize                      0
  error:unsupported_mime_type         0
  error:unknown                       0

Providers helped (94 attachments → 38 providers):
  app_clxx… +27**1234 (Plumbing, Soweto) — 3 attachments restored
  app_clxy… +27**5678 (Electrical, Tembisa) — 2 attachments restored
  …

Providers still without evidence (4 phones, 31 attachments unrecoverable):
  +27**0001 — 12 messages, oldest 2026-04-12 (62 days old)
  …

Artifacts:
  recovery/replay-plan.csv
  recovery/replay-result.csv
  recovery/replay-summary.json
  recovery/replay-errors.log
```

**Delivery mechanism for the email** — open question, see §9. Most likely path: Supabase Auth admin email infra is the only mail integration currently in the repo and is invite-only; we may need either (a) a new helper that uses Supabase's transactional template or (b) a Slack webhook. For the first run, the operator can read the CSV/JSON artifacts directly and the "admin summary" reduces to `console.log` + the artifacts on disk.

### 7.5 Testing

| Layer | Test | Goal |
|---|---|---|
| `planner.ts` unit | Time-window match: message exactly at `submittedAt`, at `submittedAt − 24h`, at `submittedAt − 25h`, at `reviewedAt`, at `reviewedAt + 1s`, with `reviewedAt = null` (uses `NOW()`). | Verify boundary inclusivity and the 24h grace. |
| `planner.ts` unit | Phone has 2 applications; messages distributed across both windows. | Verify each message routes to the bracketing application, not the latest one. |
| `planner.ts` unit | Phone with mixed phone normalization (`27…` vs `+27…`). | Verify `normalizePhone` is applied. |
| `planner.ts` unit | Already-attached mediaId. | Verify `skip:already_present`. |
| `planner.ts` unit | Phone has zero applications. | Verify `skip:no_application_for_phone`. |
| `executor.ts` unit | Mock `downloadAndStoreWhatsAppMedia` to throw each documented error class (mime, oversize, 404, 403, 429, blob, db). | Verify each outcome classification. |
| `executor.ts` unit | Mock returns existing attachmentId. | Verify `restored:reused_existing`. |
| `executor.ts` unit | Three consecutive `skip:meta_rate_limited` within mocked 60 s window. | Verify halt-and-dump-progress behaviour. |
| `evidence-backfill.ts` unit | URL already in array. | Verify no-op. |
| `evidence-backfill.ts` unit | URL not in array. | Verify single appended URL, no duplicates on re-run. |
| `summary.ts` unit | Rollup of fixture outcomes to provider buckets. | Verify counts. |
| `csv.ts` unit | Round-trip a `PlanRow` and `ResultRow` through CSV writer/parser. | Verify header + escaping. |

No integration test against real Meta API; the existing `lib/whatsapp-media.ts` is already covered by `__tests__/lib/whatsapp-media.test.ts`. The replay layer's job is to compose that function safely.

### 7.6 Production-safety contract

1. **Default mode is `--dry-run`.** No DB writes, no blob writes, no Meta `GET` for binary (only metadata HEAD-probes if `--probe-meta` flag is added later — out of v1).
2. `--commit` is the only mutating mode. There is no flag that combines "destructive" with anything else.
3. The only Prisma writes are: `attachment.create` (via `downloadAndStoreWhatsAppMedia`, which is already idempotent), `auditLog.create`, and optionally `providerApplication.update` for `evidenceFileUrls` (additive, dedupe on insert).
4. No `delete`, no `deleteMany`, no `$executeRaw` / `$executeRawUnsafe` against any table. Read-side `$queryRawUnsafe` is used only by the planner (§6.1) for the join that Prisma's typed query builder can't express, and is bound to a single `SELECT` statement with no user-supplied input — no SQL injection surface.
5. No conversation, dispatch, payment, or messaging state is mutated.
6. No outbound WhatsApp message is sent to providers or customers.
7. Rate-limit guard halts the script before Meta quota damage; the script can be resumed because every step is idempotent.
8. Rollback: the script's only outputs are (a) new `Attachment` rows tagged `uploadedBy = system:whatsapp:<mediaId>` — a targeted `DELETE FROM attachments WHERE "uploadedBy" LIKE 'system:whatsapp:%' AND "createdAt" > '<run start>'` reverses them; (b) new `AuditLog` rows — same shape; (c) new blob objects in Vercel Blob — listable by prefix `evidence/`. A documented rollback playbook ships alongside the script.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Meta media retention (~30 d) means most older messages will 404. | `restorable:beyond_meta_retention_soft` flag in plan; classified `skip:meta_404` in result. The script doesn't pretend to recover what Meta has dropped. |
| `payload -> "messageType" ->> 'id'` returns NULL for malformed/legacy payloads. | Filtered out at planner level as `error:malformed_payload`; surfaced in summary so operator can spot-check. |
| Provider has multiple ProviderApplications bracketing the same `firstSeenAt`. | Tie-breaker: most recent `submittedAt`. Operator can review pre-commit via `replay-plan.csv`. |
| Vercel Blob quota exhaustion mid-run. | Bounded concurrency limits parallel uploads; oversize cap (15 MB) per file; halt-and-resume model means partial runs are safe. |
| Meta `WHATSAPP_ACCESS_TOKEN` rotated since the original receipt. | The script uses the current `WHATSAPP_ACCESS_TOKEN`, which is what production uses for live receipt. Token rotation post-incident is not a regression. |
| Restored evidence is attached to a wrongly-classified application (false positive routing). | Dry-run CSV review; per-application count in summary; idempotent rerun. |

## 9. Open questions

1. **Admin notification channel.** Email via Supabase invite infra, a new Slack webhook, or simply CSV/JSON artifacts on disk for v1? Recommend artifacts-only for v1, add Slack/email in a follow-up if needed.
2. **`evidenceFileUrls` backfill default.** Off by default seems safer (additive but reversible), but if the admin UI legacy path or some other consumer hard-depends on it, on-by-default is preferable. Need a quick grep for `evidenceFileUrls` consumers before finalising.
3. **`--probe-meta` in dry-run.** Should the dry-run optionally issue `GET /{media-id}` (metadata-only, no binary) to learn whether each mediaId is still resolvable before commit? Costs 1 Meta call per row. Pro: operator sees expected success count up front. Con: doubles Meta load. Recommend leaving it out of v1.
4. **Where to run the script** — production Vercel `pnpm tsx` from CI, or operator's laptop pointed at production `DATABASE_URL`? The audit script ran from a laptop; same model is probably fine here but worth confirming. CI would centralise the audit trail.
5. **Pre-commit OWNER approval gate.** House rules require OWNER for destructive actions; this isn't destructive but does mutate prod data. Worth adding an interactive "Type RESTORE to continue" prompt before `--commit` proceeds.

## 10. What lands first (suggested execution order)

This becomes the implementation plan's task structure when we hand off to the `writing-plans` skill:

1. `types.ts` — shared types.
2. `planner.ts` + tests — pure function over snapshots, then DB-backed.
3. `csv.ts` + tests.
4. `executor.ts` + tests (mocked `downloadAndStoreWhatsAppMedia`).
5. `audit.ts` + tests.
6. `evidence-backfill.ts` + tests.
7. `summary.ts` + tests.
8. `replay-whatsapp-provider-media.ts` CLI entry — orchestration only.
9. End-to-end dry-run against staging or a controlled `--phones=<one phone>` slice in production.
10. Operator reviews `replay-plan.csv`.
11. `--commit` against the same slice; review `replay-result.csv` and `AuditLog` rows.
12. Full-run `--commit` once the slice is green.
