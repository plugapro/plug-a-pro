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
- **Meta media retention is split.** Per Meta's media documentation: media IDs received via webhook expire after **7 days**, while media IDs from API upload expire after **30 days**. All `InboundWhatsAppMessage.payload` media IDs in this recovery are webhook-sourced, so the practical retention ceiling is 7 days for inbound media — not 30. Replay is "attemptable, not guaranteed." Treat every harvested media ID as a candidate and verify by live sample GET before claiming completeness. Source: https://support.chatarchitect.com/books/meta-whatsapp/page/media-developer-documentation/revisions/640 (mirror of Meta WhatsApp Cloud API media docs).
- **Idempotency.** Every recovery step must be safely re-runnable. `downloadAndStoreWhatsAppMedia` is already idempotent via the `uploadedBy = system:whatsapp:${mediaId}` + `label` lookup.
- **Additive only.** No schema migrations; no drops or renames; no inline `'use server'` actions touched.
- **Column-naming convention in raw SQL.** Prisma models in this repo use `@@map` for table names but do **not** use `@map` on individual fields, so Postgres column names are the field names verbatim in camelCase. All raw SQL must double-quote camelCase identifiers (`"externalId"`, `"firstSeenAt"`, `"verificationId"`, `"blobKey"`, etc.). Snake_case identifiers will silently fail to resolve.

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

### Gate 0 — Survival counts + high-watermark capture (5 min, runs only if Phase 0 outcome is "real data loss")

Compare prod and restore-clone counts for: `inbound_whatsapp_messages`, `attachments`, `provider_identity_verifications`, `provider_identity_documents`, `provider_verification_webhook_events`, and `storage.objects WHERE bucket_id = 'identity-documents'`.

**High-watermark bound.** Because writes are reopened after Phase 0, count equality is no longer a safe re-run guard — new inbound messages and attachments can legitimately arrive between dry-run and apply. The gate captures a single timestamp `gateCapturedAt = now()` (recorded into the plan JSON), and **all subsequent recovery reads filter rows to `"firstSeenAt" <= gateCapturedAt` (or `"createdAt" <= gateCapturedAt` for tables without `firstSeenAt`)**. Rows newer than `gateCapturedAt` are out of scope for this recovery; they belong to live operation post-reopening.

The apply step re-runs Gate 0 with the same `gateCapturedAt` and verifies that counts of rows `<= gateCapturedAt` have not changed (those are now historical and should be frozen). If they have changed, the apply aborts and asks for a fresh plan. A short maintenance window during apply is recommended but not required — the high-watermark filter is the primary correctness mechanism.

### Workstream A — WhatsApp media replay (`Attachment`)

**Source of truth:** live prod `inbound_whatsapp_messages`. Restore clone is cross-referenced for expected `Attachment` metadata (label, FK ids).

**Step A1 — Harvest media IDs.**

Postgres column names are Prisma field names verbatim (no `@map` directives on `InboundWhatsAppMessage` fields), so identifiers are camelCase and must be double-quoted in raw SQL. The 7-day inbound-media retention ceiling sets the upper bound on harvest age — anything older is a guaranteed Meta 404.

```sql
SELECT
  "externalId",
  phone,
  "messageType",
  "firstSeenAt",
  payload -> "messageType" ->> 'id'      AS media_id,
  payload -> "messageType" ->> 'caption' AS caption
FROM inbound_whatsapp_messages
WHERE "messageType" IN ('image','document','video')
  AND "firstSeenAt" <= :gateCapturedAt
  AND "firstSeenAt" >= :gateCapturedAt - interval '7 days'
ORDER BY "firstSeenAt";
```

Produces a `media_candidates` working table: `externalId`, `phone`, `messageType`, `firstSeenAt`, `media_id`, `caption`, plus a derived `age_bucket` column (`< 24h`, `1–3 d`, `3–7 d`) used for prioritisation and for live-sample-GET sizing in step A2.

**Step A2 — Filter by replay eligibility.**

**Live sample GET first.** Before any bulk replay, attempt a Meta GET on 3 candidate IDs from each `age_bucket`. A 200 confirms the bucket is replayable. A 404 across all samples in a bucket marks the bucket as expired — those rows go to the reconciliation CSV with `reason = WHATSAPP_MEDIA_BEYOND_META_RETENTION` rather than being attempted in bulk.

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

**Step A4 — Replay via a new recovery helper.**

`downloadAndStoreWhatsAppMedia` only accepts a `providerApplicationId` parameter and only populates that FK on the created `Attachment` row (`field-service/lib/whatsapp-media.ts:41,98`). It is **not** sufficient on its own for `jobId`, `jobRequestId`, or `inspectionSlotId` recovery. Two ways to fix this; the spec picks the first:

1. **(chosen) Introduce `recoverWhatsAppAttachment(params: { mediaId, parent: { kind, id }, label })`** in `lib/whatsapp-media.ts`. Extract the download-and-blob-upload portion of `downloadAndStoreWhatsAppMedia` into a private helper, then have both functions call it. The new function creates the `Attachment` row with the correct FK populated based on `parent.kind ∈ { 'providerApplication', 'jobRequest', 'job', 'inspectionSlot' }`. Idempotency is preserved by the same `uploadedBy = system:whatsapp:${mediaId}` + `label` lookup.
2. Post-create FK repair: call the existing function (which leaves `providerApplicationId` null for non-application parents), then UPDATE the new row to set the correct FK. Rejected because it requires a follow-up write per row, hides intent, and the helper's existing `findFirst` idempotency check would falsely match an unrelated null-parent attachment from a previous run.

For each eligible `(media_id, parent.kind, parent.id, label)` with confidence ≥ MEDIUM, call `recoverWhatsAppAttachment`. `LOW`-confidence rows go to the reconciliation CSV instead and are reviewed manually.

The function only writes to `Attachment`. No status transitions are touched, so workstream A is silent by construction. We do not need to patch global senders.

**Parent-FK mismatch check.** If `recoverWhatsAppAttachment` finds an existing `Attachment` row matching `uploadedBy` + `label` whose populated FK disagrees with the `parent` argument (e.g. existing row has `jobRequestId = X`, request says `providerApplicationId = Y`), the function refuses to write and emits a `PARENT_FK_MISMATCH` reconciliation row instead. This prevents a bad parent-resolution from clobbering a correct earlier write on rerun.

### Workstream B — KYC replay (`ProviderIdentityVerification` + `ProviderIdentityDocument`)

**Source-of-truth priority:** (1) restore clone metadata + surviving Supabase Storage objects, then (2) Didit read API for anything still missing.

**Step B1 — Import surviving Supabase Storage objects + restore-clone metadata.**

Postgres columns are camelCase quoted (same Prisma `@@map`-without-`@map` pattern). `storage.objects` is a Supabase-managed table — it has `id`, `bucket_id`, `name`, `owner`, `created_at`, `updated_at`, `last_accessed_at`, `metadata` (jsonb), `path_tokens`, `version`, `user_metadata`. **There is no `mime_type` column on `storage.objects`**; the MIME type lives in `metadata->>'mimetype'`. Verify the exact key name against the live `storage.objects` row before relying on it.

```sql
-- in restore clone
SELECT
  id,
  "verificationId",
  "documentKind",
  "blobKey",
  "mimeType",
  "sizeBytes",
  sha256
FROM provider_identity_documents
WHERE "createdAt" <= :gateCapturedAt;

-- in live prod (storage.objects survived)
SELECT
  name,
  bucket_id,
  metadata->>'mimetype' AS mime_type,
  (metadata->>'size')::bigint AS size_bytes,
  created_at
FROM storage.objects
WHERE bucket_id = 'identity-documents'
  AND created_at <= :gateCapturedAt;
```

**Match by parsing `blobKey`.** The identity-document `blobKey` is stored in the format `supabase://${bucket}/${path}` (see `SUPABASE_IDENTITY_REF_PREFIX` and `supabaseIdentityReference` in `field-service/lib/storage.ts:11,459`). Use the existing `parseSupabaseIdentityReference` helper (`storage.ts:463`) to split each restore-clone `blobKey` into `{ bucket, path }`, then join `bucket = storage.objects.bucket_id` and `path = storage.objects.name` to pair restore-clone document rows with live storage objects.

Re-create rows directly in live prod for matched pairs:

- Insert the restore-clone `ProviderIdentityVerification` row (using restore values, preserving original `id`, `vendorReference`, `vendorWorkflowId`, scores, decision, `consentTextHash`, `accessTokenHash`).
- Insert the restore-clone `ProviderIdentityDocument` row, keeping the original `blobKey` (so the surviving storage object is the live target without a re-upload), `sha256`, `mimeType`, `sizeBytes`, `deleteAfter`.

This covers the 4 documents and 2 verifications that exist in the restore clone.

**Step B2 — Reconcile the 10 storage objects vs 4 document rows.**

There are 6 storage objects that have no metadata anywhere. **Do not auto-reconstruct stub `ProviderIdentityVerification` rows from orphan webhook events.** Webhook events alone do not prove which provider or application a verification belonged to — `verificationId` may be null on an orphan webhook event, `vendorReference` may correspond to a deleted attempt, and inserting a provider-linked stub on weak evidence risks silently mis-attributing a stranger's KYC to a real provider.

Instead, for each orphan storage object:

1. Attempt to establish provenance through one of three proofs:
   - A restore-clone `ProviderIdentityDocument.blobKey` that parses to the same `{ bucket, path }` (already covered in B1).
   - A restore-clone `ProviderVerificationWebhookEvent` whose payload (or `rawPayloadRedacted`) references the storage object's `name` / `path` / a derivable verification ID with non-null `verificationId` linking back to a restored `Provider` or `ProviderApplication` row.
   - A live `Provider` / `ProviderApplication` row whose surviving fields independently link to the verification (e.g. `Provider.payoutVerifiedAt` paired with a matching restore-clone verification row).
2. If at least one of the three proofs holds, reconstruct the `ProviderIdentityVerification` row from the strongest source and link the storage object via `blobKey` matching.
3. Otherwise, **gap-report only**: emit a reconciliation row with `reason = IDENTITY_STORAGE_ORPHAN` and recommended action `manual_triage_before_reconstruction`. Do not write a verification or document row.

Orphan webhook events with no corresponding storage object and no provider linkage get their own reconciliation row with `reason = KYC_VENDOR_REF_NO_PROVIDER_LINK` and remain in the restore clone only; they are not migrated to live prod.

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
- `WHATSAPP_MEDIA_BEYOND_META_RETENTION` — recommended action: re-request only if onboarding-in-progress, else grandfather. Triggered by either age (> 7 days from `firstSeenAt`) or a confirmed 404 on the live sample GET for its age bucket.
- `PARENT_FK_MISMATCH` — recommended action: reconcile against an earlier successful replay before any rerun touches the row.
- `IDENTITY_STORAGE_ORPHAN` — recommended action: manual triage; do not auto-reconstruct a verification row.
- `KYC_VENDOR_REF_NO_PROVIDER_LINK` — recommended action: leave in restore clone, do not migrate.
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

- **Wrong-parent attachment.** A phone-only resolution at `LOW` confidence could attach a media object to the wrong `ProviderApplication` / `JobRequest` / `Job` / `InspectionSlot`. Mitigation: `LOW`-confidence rows are gap-reported, not replayed. `recoverWhatsAppAttachment`'s parent-FK mismatch check prevents reruns from clobbering correct earlier writes.
- **Meta retention drift.** Inbound (webhook-sourced) media IDs are 7-day, not 30-day. Anything older than 7 days at apply time will 404. Mitigation: harvest window capped at 7 days from `gateCapturedAt`; live sample GET per `age_bucket` confirms each bucket before bulk replay.
- **Stub-verification mis-attribution.** Reconstructing `ProviderIdentityVerification` from orphan webhook events can attribute someone else's KYC to a real provider. Mitigation: B2 requires one of three independent proofs before reconstruction; otherwise gap-report.
- **Didit double-charge.** Mitigated by restricting B3 to read endpoints and confirming pricing before run.
- **Silent status side effect.** Mitigated by §4.C layer 3 (no status writes) and by the dry-run-first protocol.
- **Restore clone drift.** If the clone is being modified by parallel work, B1 reads could differ between dry-run and apply. Mitigation: take a snapshot of the clone (or freeze writes) before apply; bound clone reads by `gateCapturedAt`.
- **Post-Phase-0 live writes between gate and apply.** Mitigated by the high-watermark filter in Gate 0 — all recovery reads bound by `<= gateCapturedAt`. New rows that arrive after the gate are out of scope and remain in live operation untouched.

---

## 8. Testing

- Unit: fixture-driven test for the parent-resolution function in A3, covering each confidence level and the ambiguous-phone case.
- Unit: test for `recoverWhatsAppAttachment` covering each `parent.kind`, idempotency on rerun, and the `PARENT_FK_MISMATCH` refusal path.
- Unit: test for the storage-object → document-row matcher in B1, covering `supabase://` parsing via `parseSupabaseIdentityReference` and the `metadata->>'mimetype'` extraction path.
- Unit: test for B2 orphan triage — assert that orphan storage objects without one of the three proofs emit `IDENTITY_STORAGE_ORPHAN` and never write a verification row.
- Unit: live-sample-GET sampler — given a fixture of media IDs across age buckets, the sampler returns the correct bucket-level replay/expired verdict.
- Integration (dry-run only): run `plan --dry-run` against a snapshot of restore clone + live prod, assert the reconciliation CSV row count matches expected gaps and that the high-watermark filter excludes any rows newer than `gateCapturedAt`.
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
