# DB Wipe Recovery — Design

**Date:** 2026-06-06
**Owner:** Lebogang (Jacob)
**Status:** Draft — gated on Phase 0 root-cause confirmation before any apply step
**Trigger:** Production writes are failing in a way that presents as missing rows in `Attachment`, `ProviderIdentityVerification`, and `ProviderIdentityDocument`. Identity-document Supabase Storage objects (10) appear to have survived. A restore clone of an earlier Supabase backup is available.

The "DB wipe" framing is **provisional**. The evidence confirms a production write-path read-only failure. It does not yet prove whether the whole Supabase project is read-only, the runtime is pointed at a read-only/replica endpoint, or the Supavisor transaction pooler has a stuck read-only backend. That distinction changes the fix — and may eliminate the need for the recovery workstreams in §4 entirely.

---

## 1. Goal

Reconstruct the lost rows in `Attachment`, `ProviderIdentityVerification`, and `ProviderIdentityDocument` — and their associated binary objects in Vercel Blob — without sending any WhatsApp / email / SMS notification to users, and without re-charging external vendors (Didit).

Out of scope (deliberately): reconstructing any blob that has no recoverable source (Meta retention has not expired, restore clone, or Supabase Storage). Those are gap-reported and either grandfathered or re-requested via a separate, deliberate communication.

---

## 2. Observed state

Counts captured 2026-06-06. "Restore clone" = a recovered Postgres clone from an earlier Supabase backup; "Live prod" = the current wiped-and-partially-restored Postgres.

| Surface | Live prod | Restore clone |
|---|---:|---:|
| `inbound_whatsapp_messages` | 2,038 | 1,959 |
| WhatsApp media candidates (image/document/video) | 137 | 133 |
| Image IDs | 126 | 123 |
| Document IDs | 5 | 4 |
| Video IDs | 6 | 6 |
| `provider_verification_webhook_events` | 0 | 10 |
| Didit `vendorReference` rows | 0 | 6 |
| WhatsApp-sourced `Attachment` rows | 2 | 66 |
| `provider_identity_verifications` | 0 | 2 |
| `provider_identity_documents` | 0 | 4 |
| `storage.objects` where `bucket_id = 'identity-documents'` | 10 | 10 |

Confirmed conclusions:

1. **Live prod `inbound_whatsapp_messages` is intact and is the canonical source of Meta media IDs.** It holds more rows than the restore clone (newer messages), so it is preferred over the clone for media-ID harvest.
2. **Didit webhook + verification metadata did not survive in live prod** but exists in the restore clone (10 webhook events, 2 verifications, 4 documents, 6 vendorReferences).
3. **Supabase Storage `identity-documents` bucket survived** with 10 objects — more than the 4 document rows in the restore clone, so some objects are orphans without metadata anywhere.
4. **Vercel Blob is wiped.** Restore-clone `Attachment` rows have valid `blobKey` / `url` strings but the underlying objects are gone — metadata-only recovery.
5. **Vercel function log retention is 24 hours in practice** (`vercel logs --since 24h --query whatsapp-media` works; `--since 720h` returns HTTP 400). Logs are supplementary only.

---

## 3. Constraints

- **No user-visible side effects.** No WhatsApp / email / SMS sent during recovery; no status transitions on `ProviderApplication`, `Provider`, `JobRequest`, or `ProviderIdentityVerification` that would trigger downstream notification handlers.
- **No re-charging vendors.** Didit re-pulls must use read-only endpoints; we do not re-initiate liveness sessions. Pricing/retention of Didit's read API is an external vendor fact and is **to be confirmed** before run — treat as "read-only, cost to confirm."
- **Meta 30-day media retention.** The wipe was within 48 h, so all media IDs in `inbound_whatsapp_messages` from the past 30 days are still retrievable from Meta. Anything older than 30 days is gone from Meta regardless.
- **Idempotency.** Every recovery step must be safely re-runnable. `downloadAndStoreWhatsAppMedia` is already idempotent via the `uploadedBy = system:whatsapp:${mediaId}` + `label` lookup.
- **Additive only.** No schema migrations; no drops or renames; no inline `'use server'` actions touched.

---

## 4. Workstreams

**Phase 0 (root-cause confirmation) must complete before any workstream in this section runs.** Workstreams A–D in this section are conditional: they execute only if Phase 0 confirms a real data-loss event and rules out a read-only/pooler/endpoint failure mode.

### Phase 0 — Root-cause confirmation (infra, not application)

The presenting symptom (writes failing, rows appearing missing) is consistent with at least four causes. Diagnose which before treating this as data loss.

**P0.1 — Direct DB state.** Run against both the direct writer connection and the runtime `DATABASE_URL` / pooler connection:

```sql
select pg_is_in_recovery();
show transaction_read_only;
show default_transaction_read_only;
```

Interpretation:

- Direct writer writable, pooled runtime read-only → **pooler/session state issue**, not project-wide lock. Action: cycle the Supavisor pooler or restart connections; see Supabase troubleshooting doc on "cannot execute UPDATE in a read-only transaction on transaction pooler connections" (https://supabase.com/docs/guides/troubleshooting/resolving-cannot-execute-update-in-a-read-only-transaction-on-transaction-pooler-connections-ef582c).
- Both read-only → **project-wide lock**. Cause is disk-full or billing per Supabase database-size docs (https://supabase.com/docs/guides/platform/database-size). Action: resolve billing / increase disk before any application action.
- Both writable → root cause is elsewhere (env target, code path, transient).

**P0.2 — Supabase dashboard.** Inspect for:

- Project banner (read-only / billing / disk warning).
- Database → Reports for database size.
- Database → Settings / compute / disk for provisioned disk usage.
- Billing status.

**P0.3 — Env target.** Confirm:

- Production `DATABASE_URL` is not a replica / read-only endpoint.
- Migration / direct connection env is not using the transaction pooler on `6543`.
- Vercel production env points at the expected Supabase project ref (`oghbryokdizklgwaqksp`).

**P0.4 — Decision tree out of Phase 0.**

- Pooler-only read-only → fix pooler, re-test writes, **abandon §4 workstreams**. The "missing rows" are likely still on disk and become visible again once writes resume; verify with a row-count sanity check and skip recovery.
- Project-wide read-only from disk-full or billing → resolve billing/disk first. If pruning is required, identify largest relations with `pg_total_relation_size`, export/snapshot business-critical data before deleting, and use Supabase's documented read-write session override only for controlled cleanup. After write-path recovery, re-evaluate whether §4 is needed.
- Env target mis-pointed → repoint env, re-test writes, **abandon §4 workstreams**.
- All three checks come back clean and writes still fail → return here and proceed with §4 as the data-loss recovery path.

**P0.5 — Recovery proof.** Before declaring Phase 0 complete:

- One direct SQL write succeeds.
- One production API business write succeeds.
- Previously failing cron / write paths stop emitting SQLSTATE 25006.
- Monitor errors for 10–15 minutes.

### Gate 0 — Survival counts (5 min, runs only if Phase 0 outcome is "real data loss")

Compare prod and restore-clone counts for: `inbound_whatsapp_messages`, `attachments`, `provider_identity_verifications`, `provider_identity_documents`, `provider_verification_webhook_events`, and `storage.objects WHERE bucket_id = 'identity-documents'`. The table in §2 is the captured snapshot for today's run. The script must re-run this gate and abort if the live counts have unexpectedly changed since the snapshot.

### Workstream A — WhatsApp media replay (`Attachment`)

**Source of truth:** live prod `inbound_whatsapp_messages`. Restore clone is cross-referenced for expected `Attachment` metadata (label, FK ids).

**Step A1 — Harvest media IDs.**

```sql
SELECT
  external_id,
  phone,
  message_type,
  first_seen_at,
  payload -> message_type ->> 'id' AS media_id,
  payload -> message_type ->> 'caption' AS caption
FROM inbound_whatsapp_messages
WHERE message_type IN ('image','document','video')
  AND first_seen_at >= now() - interval '30 days'
ORDER BY first_seen_at;
```

Produces a `media_candidates` working table: `external_id`, `phone`, `message_type`, `first_seen_at`, `media_id`, `caption`.

**Step A2 — Filter by replay eligibility.**

`downloadAndStoreWhatsAppMedia` accepts `image/jpeg`, `image/png`, `image/webp`, `application/pdf` only (see `lib/whatsapp-media.ts`'s `ALLOWED_EVIDENCE_TYPES`). Therefore:

- **Image candidates (126):** eligible. MIME is verified on download against the allow-list.
- **Document candidates (5):** eligible if MIME is `application/pdf`.
- **Video candidates (6):** **NOT eligible** for `downloadAndStoreWhatsAppMedia`. Three options:
  - **(chosen) Skip + report** — videos go into the reconciliation CSV with reason `UNSUPPORTED_MEDIA_TYPE`; a human decides per row whether to extend the allow-list and re-run, or to re-request.
  - Extend the allow-list to accept `video/mp4` etc. — out of scope for this recovery.
  - Re-request from user — only if a video turns out to be load-bearing.

**Step A3 — Resolve parent rows.**

`Attachment` FKs are `jobId`, `inspectionSlotId`, `jobRequestId`, `providerApplicationId`. Phone alone is ambiguous (a single number can have multiple ProviderApplications, JobRequests, and conversation contexts over time). Parent resolution uses, in order:

1. **Restore-clone `Attachment.uploadedBy = system:whatsapp:${media_id}` exact match.** This is the strongest signal — the clone already recorded which parent row that media ID was attached to. For ~66 attachments in the clone, this should resolve most images and documents directly.
2. **Phone + `first_seen_at` window + conversation step.** For media IDs not present in the restore clone (new messages since the backup), match the phone to the most recent `ProviderApplication` / `JobRequest` whose creation window contains `first_seen_at`, then use the conversation step (registration evidence vs job-request photo vs completion photo) to pick the right FK.
3. **Caption text and label.** Restored ProviderApplication / JobRequest rows already carry expected labels (`evidence`, `before`, `after`, `inspection`). Match the harvested caption to the expected label for tie-breaking.

Resolution is recorded as `(media_id, parent_kind, parent_id, label, confidence)` where confidence is `HIGH` (restore-clone exact match), `MEDIUM` (phone+window+step), or `LOW` (phone-only fallback).

**Step A4 — Replay via `downloadAndStoreWhatsAppMedia`.**

For each eligible `(media_id, parent_kind, parent_id, label)` with confidence ≥ MEDIUM, call the existing function. It is already idempotent — duplicate runs are no-ops. `LOW`-confidence rows go to the reconciliation CSV instead and are reviewed manually.

The function only writes to `Attachment`. No status transitions are touched, so workstream A is silent by construction. We do not need to patch global senders.

### Workstream B — KYC replay (`ProviderIdentityVerification` + `ProviderIdentityDocument`)

**Source-of-truth priority:** (1) restore clone metadata + surviving Supabase Storage objects, then (2) Didit read API for anything still missing.

**Step B1 — Import surviving Supabase Storage objects + restore-clone metadata.**

```sql
-- in restore clone
SELECT id, verification_id, document_kind, blob_key, mime_type, size_bytes, sha256
FROM provider_identity_documents;

-- in live prod (storage.objects survived)
SELECT name, bucket_id, mime_type, metadata
FROM storage.objects
WHERE bucket_id = 'identity-documents';
```

Match storage objects to restore-clone document metadata by `blob_key` (storage `name` corresponds to the `blob_key` recorded in `ProviderIdentityDocument`). Re-create rows directly in live prod for matched pairs:

- Insert the restore-clone `ProviderIdentityVerification` row (using restore values, preserving original `id`, `vendorReference`, `vendorWorkflowId`, scores, decision, `consentTextHash`, `accessTokenHash`).
- Insert the restore-clone `ProviderIdentityDocument` row, keeping the original `blobKey` (so the surviving storage object is the live target without a re-upload), `sha256`, `mimeType`, `sizeBytes`, `deleteAfter`.

This covers the 4 documents and 2 verifications that exist in the restore clone.

**Step B2 — Reconcile the 10 storage objects vs 4 document rows.**

There are 6 storage objects that have no metadata anywhere. For each, try to recover a row from the restore-clone `provider_verification_webhook_events` (10 events, 6 `vendorReference`s). A webhook event without a corresponding `ProviderIdentityVerification` is an orphan event we treat as evidence that a verification existed; we reconstruct a stub `ProviderIdentityVerification` row from the webhook payload (`vendorKey`, `vendorReference`, `livenessSessionReference`, `rawPayloadRedacted`) and link the storage object via `blobKey` matching where possible. Unmatched storage objects go to the reconciliation CSV.

**Step B3 — Didit API top-up.**

For providers/applications that have surviving `Provider` / `ProviderApplication` rows but no `ProviderIdentityVerification` after B1 + B2, call Didit's read endpoint (`getSessionDecision(sessionId)` or equivalent — confirm endpoint and pricing/retention with Didit before this step). Reconstruct verifications and download documents.

Re-creating the verification via existing persistence helpers writes a `ProviderVerificationEvent` (per `persistDiditDecision` behaviour); it does **not** send WhatsApp or email. The event row is acceptable side effect.

`persistDiditDecision` does **not** currently accept a recovery flag (confirmed by grep). This spec adds an optional `recoveryMode?: boolean` parameter to that function with the contract: when `true`, the helper still writes the row but skips any downstream notification emission and stamps `ProviderVerificationEvent.actorRole = 'system:recovery'` for auditability. Adding this parameter is part of the implementation work.

**Step B4 — Verify document integrity.**

Re-compute `sha256` for each re-imported document and compare against the restored row's `sha256`. Mismatches go to the reconciliation CSV.

### Workstream C — Silence guarantee

Three layers of defence; layer 3 is the primary mechanism, layers 1–2 are belt-and-braces only enabled if a real risk is identified during the dry run.

1. **Recovery scripts call persistence helpers only.** They do not call `lib/whatsapp.ts` outbound senders, `supabase.auth.admin.inviteUserByEmail`, the WhatsApp template senders, or any notification dispatcher. This is a code-path discipline, not a runtime gate.
2. **`RECOVERY_REPLAY_MODE=true` env flag.** Read by outbound senders and short-circuited with a `console.info` instead of an HTTP call. Only enabled if the dry-run reconciliation shows that a persistence helper has an unintended notification side effect we cannot otherwise suppress.
3. **No status transitions.** Recovery only inserts rows; never updates `ProviderApplication.status`, `Provider.status`, `JobRequest.status`, or `ProviderIdentityVerification.status` on its own. The persisted Didit-decision helper is called with `recoveryMode: true` so it stays in the same status the restore-clone row recorded.

### Workstream D — Reconciliation report + branch decisions

After A and B complete, generate a single CSV with one row per gap. Columns: `gap_kind`, `phone`, `parent_kind`, `parent_id`, `media_id_or_blob_key`, `reason`, `recommended_action`.

Gap kinds:

- `WHATSAPP_VIDEO_UNSUPPORTED` — recommended action: skip or extend allow-list.
- `WHATSAPP_MEDIA_RESOLUTION_LOW_CONFIDENCE` — recommended action: manual review before replay.
- `WHATSAPP_MEDIA_BEYOND_META_RETENTION` — recommended action: re-request only if onboarding-in-progress, else grandfather.
- `IDENTITY_STORAGE_ORPHAN` — recommended action: archive object, mark provider KYC-incomplete with documented gap.
- `IDENTITY_VENDOR_REFRESH_FAILED` — recommended action: re-request from Didit by phone, or treat as recovered-with-gaps.
- `SHA256_MISMATCH` — recommended action: investigate before treating as recovered.

Branch decisions (confirmed):

- **Grandfather** recovered pre-wipe completed KYC where restore-clone + Didit + storage evidence aligns.
- **Re-request** only for active onboarding-in-progress gaps. Re-requests are out of scope for this script — they are handled in a separate, deliberate communication after the reconciliation CSV is reviewed.

---

## 5. Execution shape

A single script in `field-service/scripts/db-wipe-recovery.ts` with three subcommands:

- `pnpm tsx scripts/db-wipe-recovery.ts gate` — runs §2 counts against live prod and restore clone, emits a snapshot JSON, and aborts if live counts have drifted unexpectedly from the captured baseline.
- `pnpm tsx scripts/db-wipe-recovery.ts plan --dry-run` — runs all of A1–A3 and B1–B4 in memory, emits the reconciliation CSV and a planned-writes summary, and writes nothing.
- `pnpm tsx scripts/db-wipe-recovery.ts apply --confirm` — runs the planned writes from a previous dry run (referencing the saved plan JSON), refusing to proceed if anything in the live DB has changed since the plan was produced.

Database access: prod via existing `lib/db.ts` singleton; restore clone via a second Prisma client constructed from a `RESTORE_DATABASE_URL` env var. The `RECOVERY_REPLAY_MODE=true` env flag (§4.C layer 2) is process-scoped — it is read by outbound senders, not by Prisma.

Vercel Blob writes go through `@vercel/blob`'s existing `put` (same auth as production).

Supabase Storage interactions (read for B1, no writes — surviving objects stay in place) go through the existing `@supabase/supabase-js` admin client.

---

## 6. Open items to confirm before `apply`

1. **Didit read API pricing/retention.** Confirm with vendor before B3. If a cost-per-read exists, decide whether B3 runs at all or whether unmatched providers are simply gap-reported.
2. **Restore-clone DSN.** Confirm the clone is a Supabase branch / a separate Postgres database and capture the read-only connection string.
3. **Active-onboarding cutoff.** Define the date / status set that qualifies as "active onboarding in progress" for the re-request branch of workstream D.
4. **Video allow-list policy.** Default plan is skip + report; confirm before run.

---

## 7. Risks

- **Wrong-parent attachment.** A phone-only resolution at `LOW` confidence could attach a media object to the wrong `ProviderApplication` or `JobRequest`. Mitigation: `LOW`-confidence rows are gap-reported, not replayed.
- **Meta retention drift.** If any media in the harvest is older than ~30 days at apply time, the Meta GET will 404. The replay function already handles that path — it errors and the row goes into the report.
- **Didit double-charge.** Mitigated by restricting B3 to read endpoints and confirming pricing before run.
- **Silent status side effect.** Mitigated by §4.C layer 3 (no status writes) and by the dry-run-first protocol.
- **Restore clone drift.** If the clone is being modified by parallel work, B1 reads could differ between dry-run and apply. Mitigation: take a snapshot of the clone (or freeze writes) before apply.

---

## 8. Testing

- Unit: a fixture-driven test for the parent-resolution function in A3, covering each confidence level and the ambiguous-phone case.
- Unit: a test for the storage-object → document-row matcher in B1.
- Integration (dry-run only): run `plan --dry-run` against a snapshot of restore clone + live prod, assert the reconciliation CSV row count matches expected gaps.
- Manual: spot-check three recovered `Attachment` rows in the admin UI to confirm the image renders via the `/api/attachments/[id]` proxy.

No new Playwright smoke is required — this is a one-time recovery script, not a feature.

---

## 9. Go / No-Go verdict

- **GO** to infra recovery immediately — execute Phase 0 (P0.1–P0.5) now.
- **NO-GO** on application code changes, including writing the recovery script in §5, until Phase 0 proves direct writer vs pooler vs project-lock and confirms the actual failure mode.
- **GO** to authenticate Supabase MCP for read-only checks (`pg_is_in_recovery`, `show transaction_read_only`, dashboard reads, disk/usage inspection).
- **NO-GO** for MCP-driven deletes, pruning, billing changes, secret rotations, or env-variable changes without explicit, separate approval at the moment of action.

### Sources

- Supabase database size / read-only mode: https://supabase.com/docs/guides/platform/database-size
- Supabase transaction pooler read-only troubleshooting: https://supabase.com/docs/guides/troubleshooting/resolving-cannot-execute-update-in-a-read-only-transaction-on-transaction-pooler-connections-ef582c
