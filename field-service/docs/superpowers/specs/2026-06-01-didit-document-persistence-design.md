# Didit decision persistence — design spec

**Date:** 2026-06-01
**Status:** Review-ready — awaiting implementation planning approval
**Owners:** Engineering
**Related:**
- `lib/identity-verification/vendors/didit/` (existing adapter)
- `lib/identity-verification/orchestrator.ts` (existing verdict pipeline)
- `app/(admin)/admin/verifications/actions.ts:refreshDiditSessionAction` (existing admin entry)

## 1. Context

Didit is wired as a hosted-flow identity-verification vendor (PR #24, merged 2026-05-25). The adapter creates Didit sessions, receives signed webhooks, normalises decisions, and applies verdicts via `applyVendorVerdict`. End-to-end signature verification was proven against live production traffic on 2026-06-01 (5/5 real webhooks → 200 OK).

Today, when a Didit-routed verification reaches a persisted verdict state (PASSED, FAILED, NEEDS_MANUAL_REVIEW), PlugAPro stores only the verdict + minimal metadata. **Document images, structured ID fields, scores, and AML/liveness/face-match artifacts remain on Didit's side.** The admin manual-review screen for a Didit-routed verification displays "No documents uploaded" because we never download them.

This blocks any meaningful manual review of Didit-routed verifications. A smoke-test verification (verification id `verification-id-example`) landed in `NEEDS_MANUAL_REVIEW` with a liveness-failure reason — but the reviewer has nothing to look at locally.

## 2. Goals

1. Persist Didit's verification artifacts (images + structured fields + redacted raw payload) into PlugAPro after each Didit webhook that produces a persisted verdict state, idempotently.
2. Backfill the existing record so the in-flight manual review can proceed with full context.
3. Provide a clean code path that the admin "Refresh from Didit" action can also use for missed-webhook recovery.

## 3. Non-goals

- New schema columns or tables. The existing `ProviderIdentityVerification` and `ProviderIdentityDocument` models cover the requirement.
- A `documentNumberEncrypted` column. Schema only supports hash + last4 for document number; raw doc number is never persisted.
- Manual-review UI redesign. V1 only gap-fills the current admin verification detail view so the newly populated structured fields and private document links are visible.
- Multi-attempt document history within a single verification (one image per kind per verification).
- A new background-job infrastructure. Persist runs inline after the verdict transaction; if needed, future PR can add async.
- POPIA right-to-erasure flow for stored documents. (Existing identity-document deletion flow applies; out of scope here.)
- Storage-orphan cleanup automation. Documented as known limitation; future PR.

## 4. Architecture

### 4.1 File layout

**New:**
- `field-service/lib/identity-verification/vendors/didit/persist.ts` — orchestrates download → upload → field stamp
- `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts` — unit + integration coverage

**Modified:**
- `field-service/app/api/webhooks/verification/[vendor]/route.ts` — call `persistDiditDecision` after the verdict transaction commits, gated on flag
- `field-service/app/(admin)/admin/verifications/actions.ts:refreshDiditSessionAction` — call `persistDiditDecision` after `crudAction` returns (admin-explicit; ignores flag)
- `field-service/lib/feature-flags-registry.ts` — register `provider.identity.vendor.didit.persist_documents` (default `false`)
- `field-service/app/(admin)/admin/verifications/[id]/page.tsx` — render any populated fields/documents that the current detail view does not already surface (gap-fill only), and expose a TRUST-only "Refresh from Didit" / backfill action for Didit rows that are missing local persisted documents even if the verdict is already terminal.

**No schema changes.** Existing columns suffice (see §6).

### 4.2 Module API

```ts
// lib/identity-verification/vendors/didit/persist.ts

import type { DiditDecisionResponse } from './types'
import type { IdentityDocumentKind } from '@prisma/client'

export type PersistResult = {
  fieldsStamped: boolean
  documentsStored: IdentityDocumentKind[]
  documentsSkipped: IdentityDocumentKind[]        // sha256 unchanged
  documentsFailed: { kind: IdentityDocumentKind; reason: string }[]
  payloadRedacted: boolean
}

export async function persistDiditDecision(
  verificationId: string,
  decision: DiditDecisionResponse,
  options: { source: 'webhook' | 'admin_refresh' },
): Promise<PersistResult>
```

Internal helpers, each independently testable:

- `mapDecisionToVerificationFields(decision)` — unit-testable. Returns the Prisma update payload for `providerIdentityVerification.update({ data: ... })`. It is not strictly deterministic because `encryptIdentifier` uses a random IV, so tests assert decryptability/shape rather than exact ciphertext.
  - For `id_verifications[0].personal_number` (SA ID equivalent): `encryptIdentifier(value)` + `hashIdentifier(value, 'identity:didit-personal-number')` + `identifierLast4(value)` → stamps `identifierEncrypted`, `identifierHash`, `identifierLast4`.
  - For `id_verifications[0].document_number`: `hashIdentifier(value, 'identity:didit-document-number')` + `identifierLast4(value)` → stamps `documentNumberHash`, `documentNumberLast4`. **Raw doc number is never written.**
  - Derived/plain columns: `dobDerived`, `genderDerived`, `citizenshipDerived` (from `nationality`), `nationality`, `issuingCountry` (from `issuing_state`), `documentExpiryDate` (from `expiration_date`), `selfieMatchScore` (from `face_matches[0].score`, fallback `face_match_score`), `livenessScore` (from `liveness_checks[0].score`, fallback `liveness_score`), `documentConfidenceScore` (from `id_verifications[0].front_image_quality_score.overall_score`, fallback `id_verifications[0].score` / `confidence`), `failureReasonCode`, `riskFlags` (compiled from warnings + aml hits), `decisionAt` (from `created_at` ts/string → Date)

- `tryMapDecisionToVerificationFields(decision)` — thin wrapper around the mapper. Returns `{ ok: true, data }` or `{ ok: false, reason }` so document persistence can still complete when Didit returns an unexpected field shape.

- `extractImageRefs(decision)` — pure. Returns `Array<{ kind: IdentityDocumentKind; sourceUrl: string }>`. **Only the four mapped kinds:**
  | Didit field | Our kind |
  |---|---|
  | `id_verifications[0].front_image` | `ID_FRONT` |
  | `id_verifications[0].back_image` | `ID_BACK` |
  | `id_verifications[0].portrait_image` | `SELFIE` |
  | `liveness_checks[0].reference_image` | `LIVENESS_FRAME` |
  Skips `full_front_image`, `full_back_image`, `front_image_camera_front`, `back_image_camera_front`, all video URLs, `face_matches[].source_image`/`target_image`, NFC and POA artifacts. Not in V1 scope.

- `downloadDocumentImage(url)` — side-effectful HTTP. `fetch(url, { headers: { 'X-Api-Key': diditConfig.apiKey } })`. Returns `{ bytes: Buffer; sha256: string; mimeType: string }` or throws `DiditImageDownloadError(reason, status?)`. If 401 with `X-Api-Key`, retry once with lowercase `x-api-key` and surface the finding in persist event metadata. Didit's decision endpoint documents `x-api-key`; the retry guards against CDN/header-normalisation quirks.

- `toIdentityDocumentFile({ bytes, mimeType, kind })` — pure wrapper that converts downloaded bytes into a `File` accepted by existing `uploadIdentityDocument({ verificationId, documentKind, file })`.

- `redactPayload(decision)` — pure. Produces JSON for `rawPayloadRedacted`:
  - **Drops** every image URL (`front_image`, `back_image`, `portrait_image`, `full_*`, `*_camera_front`, `face_image`, `reference_image`, `source_image`, `target_image`, `signature_image`, `document_file`) and every video URL (`front_video`, `back_video`, `video_url`).
  - Replaces `personal_number`, `document_number`, `address`, `formatted_address`, `parsed_address.street_1/street_2`, `screened_data.full_name`, `screened_data.date_of_birth` with `<HASH:xxxx>` markers (HMAC last 8 chars of the field-hash) — preserves audit-traceability without leaking PII.
  - Preserves scores, statuses, IDs, timestamps, structured non-PII metadata.

### 4.3 Integration points (caller boundary)

Persist is called **at caller boundaries, NOT inside `applyVendorVerdict`**. The verdict applier has no visibility into the raw decision object (it receives `NormalizedVerificationResult`); pushing persist into it would force a signature change we don't want.

**Webhook path (`app/api/webhooks/verification/[vendor]/route.ts`):**
1. Existing: `parseWebhook` → signature gate → idempotent webhook-event row → `applyVendorVerdict(verification.id, parsed.result, 'webhook')`
2. **(NEW)** After `applyVendorVerdict` returns, gate on the applied status, not `parsed.result.decision`:
   ```ts
   const flagOn = await isEnabled('provider.identity.vendor.didit.persist_documents')
   let applied: SubmitVerificationForAutomationResult | null = null
   if (parsed.result) {
     applied = await applyVendorVerdict(verification.id, parsed.result, 'webhook')
   }
   if (vendorKey === 'didit' && flagOn && applied && isPersistableStatus(applied.status)) {
     try {
       if (!applied.vendorReference) throw new Error('Didit vendorReference missing after verdict')
       const full = await getSessionDecision(applied.vendorReference)
       await persistDiditDecision(verification.id, full, { source: 'webhook' })
     } catch (err) {
       // Audit-only event: reuse the applied status for both from/to since this
       // is a side-effect log, not a state transition.
       await db.providerVerificationEvent.create({
         data: {
           verificationId: verification.id,
           fromStatus: applied.status,
           toStatus: applied.status,
           reasonCode: 'DIDIT_PERSIST_FAILED',
           metadata: { source: 'webhook', error: String(err) },
         },
       })
     }
   }
   ```
3. Webhook returns 200 regardless of persist success/failure.
4. **Why refetch full decision?** Didit's webhook envelope may not carry every image URL (status.updated may contain only the metadata delta). The decision endpoint is the canonical, complete source.
5. **Persistable statuses:** V1 auto-persists only `PASSED`, `FAILED`, and `NEEDS_MANUAL_REVIEW`. Didit `Expired`, `Kyc Expired`, and `Abandoned` currently normalise to `result: null`, so they produce an audit webhook row but no `applyVendorVerdict` call and no auto-persist. If we later add explicit expiry transitions, persist can be extended then.

**Admin refresh (`app/(admin)/admin/verifications/actions.ts:refreshDiditSessionAction`):**
1. **Refactor:** preflight inside the action, outside `crudAction`, to validate admin access, load the verification's Didit `vendorReference` + `vendorWorkflowId`, and call `refreshDiditSession(...)` so `{ raw, normalized }` is available after the transaction. Current code fetches inside `crudAction`; implementation must move that fetch out of the transaction.
2. Existing transaction semantics remain: `crudAction(...)` block calls `applyVendorVerdict(verification.id, refreshed.normalized.result, 'webhook', tx)` (currently labelled 'webhook'; left as-is) when `refreshed.normalized.result` exists.
3. **(NEW)** After `crudAction` returns ok:
   ```ts
   try {
     await persistDiditDecision(input.verificationId, refreshed.raw, { source: 'admin_refresh' })
   } catch (err) {
     // Same DIDIT_PERSIST_FAILED event log; do not propagate.
   }
   ```
4. **No flag check** — admin clicked the button; they opted in. This is the path we use to backfill the example record on day 1.
5. Terminal verifications: if the verification is already `PASSED`, `FAILED`, `EXPIRED`, or `CANCELLED`, still fetch the latest Didit decision during admin refresh and run `persistDiditDecision`; skip `applyVendorVerdict` if no state transition is needed. This preserves the backfill use case for rows whose verdict already landed before V1 shipped.
6. UI exposure: current detail page hides the refresh form for most terminal rows. V1 must show a TRUST-only refresh/backfill control for Didit rows with missing local documents or missing structured Didit fields, even if the status is already `PASSED` or `FAILED`.

### 4.4 Idempotency sequence inside `persistDiditDecision`

Designed to prevent orphan Supabase Storage objects on re-runs.

```text
refs = extractImageRefs(decision)
results = await Promise.allSettled(refs.map(async ({ kind, sourceUrl }) => {
  // 1. Download + hash before touching storage.
  const { bytes, sha256, mimeType } = await downloadDocumentImage(sourceUrl)

  // 2. Read DB to decide whether to upload at all.
  const existing = await db.providerIdentityDocument.findFirst({
    where: { verificationId, documentKind: kind, status: { not: 'DELETED' } },
    orderBy: { createdAt: 'desc' },
  })

  if (existing && existing.sha256 === sha256) {
    return { kind, action: 'skip' as const }     // image unchanged; no upload, no DB write
  }

  // 3. Upload only when new or changed. Existing helper expects a File, not raw bytes.
  const file = toIdentityDocumentFile({ bytes, mimeType, kind })
  const uploaded = await uploadIdentityDocument({ verificationId, documentKind: kind, file })
  const storageRef = uploaded.pathname

  return existing
    ? { kind, action: 'update' as const, existingId: existing.id, storageRef, sha256, mimeType, sizeBytes: bytes.length }
    : { kind, action: 'create' as const, storageRef, sha256, mimeType, sizeBytes: bytes.length }
}))

// 4. Build field stamp before the tx. If it fails, keep document persistence
// best-effort and record fieldsStamped:false in the summary event.
const fieldMapping = tryMapDecisionToVerificationFields(decision)

// 5. Short tx for field stamp + queued doc upserts + summary event.
await db.$transaction(async (tx) => {
  const current = await tx.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: { status: true },
  })

  if (fieldMapping.ok) {
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { ...fieldMapping.data, rawPayloadRedacted: redactPayload(decision) },
    })
  } else {
    await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: { rawPayloadRedacted: redactPayload(decision) },
    })
  }

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const action = result.value
    if (action.action === 'update') {
      await tx.providerIdentityDocument.update({
        where: { id: action.existingId },
        data: { blobKey: action.storageRef, sha256: action.sha256, mimeType: action.mimeType, sizeBytes: action.sizeBytes, status: 'UPLOADED' },
      })
    } else if (action.action === 'create') {
      await tx.providerIdentityDocument.create({
        data: {
          verificationId,
          documentKind: action.kind,
          blobKey: action.storageRef,
          sha256: action.sha256,
          mimeType: action.mimeType,
          sizeBytes: action.sizeBytes,
          status: 'UPLOADED',
          deleteAfter: addDays(now, RAW_DOCUMENT_RETENTION_DAYS),
        },
      })
    }
  }

  // Audit-only event: reuse current.status for both from/to (not a state transition).
  await tx.providerVerificationEvent.create({
    data: {
      verificationId,
      fromStatus: current.status,
      toStatus: current.status,
      reasonCode: 'DIDIT_PERSIST_COMPLETED',
      metadata: {
        source,
        fieldsStamped: fieldMapping.ok,
        fieldError: fieldMapping.ok ? null : fieldMapping.reason,
        stored: storedKinds,
        skipped: skippedKinds,
        failed: failedKinds,
      },
    },
  })
})
```

The tx contains **only** DB operations (no network I/O); short, lock-friendly.

### 4.5 Failure handling

Persist is best-effort and isolated per kind.

| Failure | Behaviour |
|---|---|
| `downloadDocumentImage` throws | That kind is recorded in `documentsFailed`; no upload, no row written for it. Other kinds proceed. |
| `uploadIdentityDocument` throws | Same — failure recorded, no DB write. |
| `mapDecisionToVerificationFields` throws (unexpected Didit shape) | Field stamp is skipped; `rawPayloadRedacted` + successful document rows still persist; summary event records `fieldsStamped:false` + `fieldError`. Verdict stands. |
| DB tx fails | Already-uploaded Supabase objects remain. They are not referenced by any active row (active row, if any, still points at the old ref). **Orphan retained** until future cleanup. |
| `getSessionDecision` throws (webhook path) | `DIDIT_PERSIST_FAILED` event; webhook still returns 200; admin refresh later will recover. |
| Already-terminal admin refresh | Persist still runs from the freshly fetched raw decision; verdict mutation is skipped. |

### 4.6 Privacy + storage rules

| Field | Treatment |
|---|---|
| `personal_number` (SA ID) | encrypt (`identifierEncrypted`) + hash (`identifierHash`) + last4 (`identifierLast4`) |
| `document_number` | hash (`documentNumberHash`) + last4 (`documentNumberLast4`) only — raw never written |
| Document images | Supabase Storage private bucket (`identity-documents`) via existing `uploadIdentityDocument`; access logged via `provider_sensitive_data_access_logs` |
| `rawPayloadRedacted` | Image/video URLs dropped; PII (`personal_number`, `document_number`, address fields, `screened_data.*`) replaced with `<HASH:xxxx>` markers; everything else preserved |
| Didit CDN URLs after download | NOT stored in DB (no field; intentional) |

### 4.7 Feature flag

`provider.identity.vendor.didit.persist_documents` — default `false`.
- `false`: webhook path is a no-op. Admin refresh path **still runs persist** (admin explicit opt-in).
- `true`: webhook path runs persist after every Didit webhook that produces `PASSED`, `FAILED`, or `NEEDS_MANUAL_REVIEW` via `applyVendorVerdict`.

Rollout pattern: ship code with flag off → admin manually backfills the example record via refresh → verify outputs → flip flag on.

## 5. Data flow

```text
PROVIDER PHONE → Didit hosted-flow → ID + selfie uploaded to Didit
                                          │
                                          ▼
                           Didit processes → webhook fan-out
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                                                           ▼
PlugAPro webhook handler                                  Admin browser → refresh button
            │                                                           │
parseWebhook + sig check                                  refreshDiditSession (fetches raw)
            │                                                           │
applyVendorVerdict (tx)                                   crudAction { applyVendorVerdict (tx) }
            │                                                           │
            ▼ (NEW)                                                     ▼ (NEW)
flag on && applied status is persistable?                  always
            │                                                           │
            ▼                                                           │
getSessionDecision (full)                                               │
            │                                                           │
            └──────────────► persistDiditDecision ◄────────────────────┘
                                       │
                                       ▼
                       extractImageRefs → Promise.allSettled
                                       │
                       (for each kind: download → check existing.sha256 → maybe upload)
                                       │
                                       ▼
                            short Prisma tx:
                              update verification fields
                              upsert document rows (only changed)
                              insert DIDIT_PERSIST_COMPLETED event
                                       │
                                       ▼
                              admin verification page now shows
                              images + structured fields + decision metadata
```

## 6. Schema mapping

| Didit decision field | PlugAPro column / handling |
|---|---|
| `decision` (envelope) | `decision` (already by orchestrator) |
| `status` (envelope) | `status` (already by orchestrator) |
| `created_at` (envelope, unix ts) | `decisionAt` |
| `id_verifications[0].personal_number` | `identifierEncrypted`, `identifierHash`, `identifierLast4` |
| `id_verifications[0].document_number` | `documentNumberHash`, `documentNumberLast4` |
| `id_verifications[0].date_of_birth` | `dobDerived` |
| `id_verifications[0].gender` | `genderDerived` |
| `id_verifications[0].nationality` | `nationality`, `citizenshipDerived` |
| `id_verifications[0].issuing_state` | `issuingCountry` |
| `id_verifications[0].expiration_date` | `documentExpiryDate` |
| `id_verifications[0].front_image_quality_score.overall_score` | `documentConfidenceScore` (fallback `id_verifications[0].score` / `confidence`) |
| `liveness_checks[0].score` | `livenessScore` (fallback `liveness_score`) |
| `face_matches[0].score` | `selfieMatchScore` (fallback `face_match_score`) |
| `id_verifications[0].warnings`, `aml_screenings[0].hits`, etc. | compiled into `riskFlags` JSON |
| `failureReasonCode` (orchestrator-derived) | already by orchestrator |
| `id_verifications[0].front_image` | `ProviderIdentityDocument(kind=ID_FRONT, blobKey, sha256, mimeType, sizeBytes)` |
| `id_verifications[0].back_image` | `ProviderIdentityDocument(kind=ID_BACK, …)` |
| `id_verifications[0].portrait_image` | `ProviderIdentityDocument(kind=SELFIE, …)` |
| `liveness_checks[0].reference_image` | `ProviderIdentityDocument(kind=LIVENESS_FRAME, …)` |
| entire decision (redacted) | `rawPayloadRedacted` (JSON) |

## 7. Testing

Per TDD discipline:

**Unit tests (`persist.test.ts`):**
- `mapDecisionToVerificationFields`: fixtures for KYC_BASIC + KYC_AUTHORITATIVE Approved/Declined payloads; assert correct column mapping + encryption pattern for personal_number.
- `extractImageRefs`: fixture decision with all image fields present; assert exactly the four mapped kinds emitted.
- `redactPayload`: fixture decision; assert image URLs gone, PII fields hashed, scores preserved.
- `persistDiditDecision` (with mocked HTTP + mocked storage + in-memory Prisma):
  - Happy path: 4 images downloaded, uploaded, doc rows created, fields stamped, event written
  - Upload contract: downloaded bytes are converted to a `File` and passed to `uploadIdentityDocument({ verificationId, documentKind, file })`; created rows include required `deleteAfter`
  - Idempotency: re-running with same decision skips uploads (sha256 match), no new doc rows
  - Sha-changed: existing doc updated in place, no new row
  - Per-kind isolation: ID_BACK download fails → ID_FRONT/SELFIE/LIVENESS_FRAME still persist; failed kind in `documentsFailed`
  - DB tx failure: returns error from persist call; no partial DB state
  - Shape mismatch: decision missing `id_verifications` → mapper throws → persist returns with `fieldsStamped: false`

**Integration tests:**
- Webhook handler integration: simulate a terminal status.updated arriving → confirm `applyVendorVerdict` runs THEN `persistDiditDecision` is called when flag on; not called when flag off.
- Webhook handler integration: simulate Didit `Expired` / `Abandoned` with `result:null` → confirm webhook audit still succeeds and auto-persist does not run.
- Admin refresh integration: simulate `refreshDiditSessionAction` invocation → confirm persist runs regardless of flag, including for an already-terminal verification.
- Admin detail integration/render test: terminal Didit row with no local documents still exposes the TRUST-only refresh/backfill control.

**Smoke test (`e2e/smoke.spec.ts`):**
- After admin clicks "Refresh from Didit" on a Didit verification, the verification detail page renders private document links and the populated structured fields: DOB, gender, citizenship, document-number last4, document confidence, liveness score, and selfie-match score.

## 8. Rollout

1. **Feature branch:** `feat/didit-persist-documents` off `main`.
2. **Implement:** TDD per §7; conform to lint + typecheck + existing CI gates.
3. **PR review** with owner sign-off.
4. **Merge to `main`** → Vercel auto-deploys to production with flag off.
5. **Backfill the example record:** admin opens `/admin/verifications/verification-id-example` → clicks "Refresh from Didit" → persist runs (flag-independent admin path) → documents + fields populate.
6. **Verify** in admin UI: 4 private document links, structured fields visible (DOB, gender, citizenship, document-number last4, scores), decision metadata complete. Reviewer proceeds with manual review.
7. **Flag flip:** set `feature_flags.enabled = true` for `provider.identity.vendor.didit.persist_documents` in production DB. Future terminal webhooks auto-persist.
8. **Monitor:** watch `provider_verification_events` for `DIDIT_PERSIST_FAILED` over the next 48h; tune retry / error handling if anything pops.

## 9. Known limitations (intentional)

- **Orphan storage objects in rare upload-succeeds-DB-tx-fails window, and when a changed image replaces an old storage ref.** Active doc rows stay correct, so there is no functional impact. Future PR will add a nightly cron to detect storage objects not referenced by any non-DELETED `ProviderIdentityDocument` and delete them.
- **`document_number` hashed only.** No `documentNumberEncrypted` column. Reviewers can compare hashes (e.g., re-enter a candidate doc number to verify match) but cannot read the raw doc number from PlugAPro. Acceptable for SA-context KYC where personal_number is the primary identifier.
- **One image per kind per verification.** If a re-attempt fits within the same verification (rare — Didit usually issues a new session id), only the latest is kept. Multi-attempt history is a future concern.
- **Didit CDN auth assumed `X-Api-Key`.** Retrieve Session docs require `x-api-key` for the decision endpoint. Implementation includes a 401-fallback path that retries lowercase `x-api-key` and surfaces the finding in event metadata. Bumps the spec on first finding.
- **Webhook persist requires a `vendorReference` to refetch the full decision.** If the verification has only `livenessSessionReference` (edge case where refs got out of sync), persist logs a fail-safe event and exits. Caller falls back to admin refresh.
- **Expired/abandoned sessions are audit-only in V1.** Current Didit normalisation returns `result:null` for `Expired`, `Kyc Expired`, and `Abandoned`, so webhook auto-persist does not run for those events.

## 10. Decisions captured during brainstorm

(For future reference; not re-debated during implementation.)

| Question | Decision |
|---|---|
| Persist scope | Images + structured fields + raw payload (full archive) |
| Trigger | Persisted verdict webhook (`PASSED`, `FAILED`, `NEEDS_MANUAL_REVIEW`) + manual admin refresh (the recommended hybrid) |
| Approach | Single module called from both webhook + admin (Approach A) |
| Call site for persist | Caller boundary (route + action), not inside `applyVendorVerdict` |
| Document number encryption | Hash + last4 only (no encrypted column in schema) |
| Idempotency order | Download → hash → check existing row → conditionally upload (avoids orphan blobs on re-run) |
| `rawPayloadRedacted` URL handling | Image/video URLs dropped entirely |
| Schema changes | None |
