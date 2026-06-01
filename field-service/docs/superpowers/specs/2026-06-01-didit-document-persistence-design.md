# Didit decision persistence — design spec

**Date:** 2026-06-01
**Status:** Approved (sections 1–9) — ready for implementation planning
**Owners:** Engineering (Lebogang)
**Related:**
- `lib/identity-verification/vendors/didit/` (existing adapter)
- `lib/identity-verification/orchestrator.ts` (existing verdict pipeline)
- `app/(admin)/admin/verifications/actions.ts:refreshDiditSessionAction` (existing admin entry)

## 1. Context

Didit is wired as a hosted-flow identity-verification vendor (PR #24, merged 2026-05-25). The adapter creates Didit sessions, receives signed webhooks, normalises decisions, and applies verdicts via `applyVendorVerdict`. End-to-end signature verification was proven against live production traffic on 2026-06-01 (5/5 real webhooks → 200 OK).

Today, when a Didit-routed verification terminates (PASSED, FAILED, NEEDS_MANUAL_REVIEW, EXPIRED), PlugAPro stores only the verdict + minimal metadata. **Document images, structured ID fields, scores, and AML/liveness/face-match artifacts remain on Didit's side.** The admin manual-review screen for a Didit-routed verification displays "No documents uploaded" because we never download them.

This blocks any meaningful manual review of Didit-routed verifications. Today's smoke test for Lovemore Sibanda (verification id `cmpv7l9j8000dl2042porhv0g`) landed in `NEEDS_MANUAL_REVIEW` with reason `PROVIDER_LIVENESS_FAILED` — but the reviewer has nothing to look at locally.

## 2. Goals

1. Persist Didit's verification artifacts (images + structured fields + redacted raw payload) into PlugAPro after each terminal-state webhook, idempotently.
2. Backfill Lovemore's existing record so his in-flight manual review can proceed with full context.
3. Provide a clean code path that the admin "Refresh from Didit" action can also use for missed-webhook recovery.

## 3. Non-goals

- New schema columns or tables. The existing `ProviderIdentityVerification` and `ProviderIdentityDocument` models cover the requirement.
- A `documentNumberEncrypted` column. Schema only supports hash + last4 for document number; raw doc number is never persisted.
- Manual-review UI redesign. The existing admin verification page already renders the fields we populate; this spec assumes the UI inherits the populated values.
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
- `field-service/app/(admin)/admin/verifications/[id]/page.tsx` — render any populated fields/documents that the current detail view does not already surface (gap-fill only)

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

- `mapDecisionToVerificationFields(decision, encContext)` — pure. Returns the Prisma update payload for `providerIdentityVerification.update({ data: ... })`.
  - For `id_verifications[0].personal_number` (SA ID equivalent): `encryptIdentifier` + `hashIdentifier('didit-personal-number', ...)` + `identifierLast4` → stamps `identifierEncrypted`, `identifierHash`, `identifierLast4`
  - For `id_verifications[0].document_number`: `hashIdentifier('didit-document-number', ...)` + `identifierLast4` → stamps `documentNumberHash`, `documentNumberLast4`. **Raw doc number is never written.**
  - Derived/plain columns: `dobDerived`, `genderDerived`, `citizenshipDerived` (from `nationality`), `nationality`, `issuingCountry` (from `issuing_state`), `documentExpiryDate` (from `expiration_date`), `selfieMatchScore` (from `face_matches[0].face_match_score`), `livenessScore` (from `liveness_checks[0].liveness_score`), `documentConfidenceScore` (from `id_verifications[0].front_image_quality_score.overall_score`), `failureReasonCode`, `riskFlags` (compiled from warnings + aml hits), `decisionAt` (from `created_at` ts → Date)

- `extractImageRefs(decision)` — pure. Returns `Array<{ kind: IdentityDocumentKind; sourceUrl: string }>`. **Only the four mapped kinds:**
  | Didit field | Our kind |
  |---|---|
  | `id_verifications[0].front_image` | `ID_FRONT` |
  | `id_verifications[0].back_image` | `ID_BACK` |
  | `id_verifications[0].portrait_image` | `SELFIE` |
  | `liveness_checks[0].reference_image` | `LIVENESS_FRAME` |
  Skips `full_front_image`, `full_back_image`, `front_image_camera_front`, `back_image_camera_front`, all video URLs, `face_matches[].source_image`/`target_image`, NFC and POA artifacts. Not in V1 scope.

- `downloadDocumentImage(url)` — side-effectful HTTP. `fetch(url, { headers: { 'X-Api-Key': diditConfig.apiKey } })`. Returns `{ bytes: Buffer; sha256: string; mimeType: string }` or throws `DiditImageDownloadError(reason, status?)`. If 401 with X-Api-Key, retry once with bare GET and surface the finding in the persist event metadata (Didit docs do not explicitly state CDN auth; we expect X-Api-Key but verify).

- `redactPayload(decision)` — pure. Produces JSON for `rawPayloadRedacted`:
  - **Drops** every image URL (`front_image`, `back_image`, `portrait_image`, `full_*`, `*_camera_front`, `face_image`, `reference_image`, `source_image`, `target_image`, `signature_image`, `document_file`) and every video URL (`front_video`, `back_video`, `video_url`).
  - Replaces `personal_number`, `document_number`, `address`, `formatted_address`, `parsed_address.street_1/street_2`, `screened_data.full_name`, `screened_data.date_of_birth` with `<HASH:xxxx>` markers (HMAC last 8 chars of the field-hash) — preserves audit-traceability without leaking PII.
  - Preserves scores, statuses, IDs, timestamps, structured non-PII metadata.

### 4.3 Integration points (caller boundary)

Persist is called **at caller boundaries, NOT inside `applyVendorVerdict`**. The verdict applier has no visibility into the raw decision object (it receives `NormalizedVerificationResult`); pushing persist into it would force a signature change we don't want.

**Webhook path (`app/api/webhooks/verification/[vendor]/route.ts`):**
1. Existing: `parseWebhook` → signature gate → idempotent webhook-event row → `applyVendorVerdict(verification.id, parsed.result, 'webhook')`
2. **(NEW)** After `applyVendorVerdict` returns:
   ```ts
   const flagOn = await isEnabled('provider.identity.vendor.didit.persist_documents')
   if (vendorKey === 'didit' && flagOn && parsed.result && isTerminalDecision(parsed.result.decision)) {
     try {
       const full = await getSessionDecision(verification.vendorReference!)
       await persistDiditDecision(verification.id, full, { source: 'webhook' })
     } catch (err) {
       // Audit-only event: reuse verification.status for both from/to since this
       // is a side-effect log, not a state transition.
       await db.providerVerificationEvent.create({
         data: {
           verificationId: verification.id,
           fromStatus: verification.status,
           toStatus: verification.status,
           reasonCode: 'DIDIT_PERSIST_FAILED',
           metadata: { source: 'webhook', error: String(err) },
         },
       })
     }
   }
   ```
3. Webhook returns 200 regardless of persist success/failure.
4. **Why refetch full decision?** Didit's webhook envelope may not carry every image URL (status.updated may contain only the metadata delta). The decision endpoint is the canonical, complete source.

**Admin refresh (`app/(admin)/admin/verifications/actions.ts:refreshDiditSessionAction`):**
1. Existing: `refreshDiditSession` returns `{ raw, normalized }` (outside `crudAction`).
2. Existing: `crudAction(...)` block calls `applyVendorVerdict(verification.id, refreshed.normalized.result, 'webhook', tx)` (currently labelled 'webhook'; left as-is).
3. **(NEW)** After `crudAction` returns ok:
   ```ts
   try {
     await persistDiditDecision(input.verificationId, refreshed.raw, { source: 'admin_refresh' })
   } catch (err) {
     // Same DIDIT_PERSIST_FAILED event log; do not propagate.
   }
   ```
4. **No flag check** — admin clicked the button; they opted in. This is the path we use to backfill Lovemore on day 1.

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

  // 3. Upload only when new or changed.
  const ref = await uploadIdentityDocument({ verificationId, bytes, mimeType, kind })

  return existing
    ? { kind, action: 'update' as const, existingId: existing.id, ref, sha256, mimeType, sizeBytes: bytes.length }
    : { kind, action: 'create' as const, ref, sha256, mimeType, sizeBytes: bytes.length }
}))

// 4. Short tx for field stamp + queued doc upserts + summary event.
await db.$transaction(async (tx) => {
  await tx.providerIdentityVerification.update({
    where: { id: verificationId },
    data: { ...mapDecisionToVerificationFields(decision), rawPayloadRedacted: redactPayload(decision) },
  })

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const action = result.value
    if (action.action === 'update') {
      await tx.providerIdentityDocument.update({
        where: { id: action.existingId },
        data: { blobKey: action.ref, sha256: action.sha256, mimeType: action.mimeType, sizeBytes: action.sizeBytes, status: 'UPLOADED' },
      })
    } else if (action.action === 'create') {
      await tx.providerIdentityDocument.create({
        data: { verificationId, documentKind: action.kind, blobKey: action.ref, sha256: action.sha256, mimeType: action.mimeType, sizeBytes: action.sizeBytes, status: 'UPLOADED' },
      })
    }
  }

  // Audit-only event: read current verification.status once at the top of the
  // tx and reuse for both from/to (not a state transition).
  await tx.providerVerificationEvent.create({
    data: {
      verificationId,
      fromStatus: currentStatus,
      toStatus: currentStatus,
      reasonCode: 'DIDIT_PERSIST_COMPLETED',
      metadata: { source, stored: storedKinds, skipped: skippedKinds, failed: failedKinds },
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
| `mapDecisionToVerificationFields` throws (unexpected Didit shape) | Caller emits `DIDIT_PERSIST_FAILED` event; entire persist aborts; verdict stands. |
| DB tx fails | Already-uploaded Supabase objects remain. They are not referenced by any active row (active row, if any, still points at the old ref). **Orphan retained** until future cleanup. |
| `getSessionDecision` throws (webhook path) | `DIDIT_PERSIST_FAILED` event; webhook still returns 200; admin refresh later will recover. |

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
- `true`: webhook path runs persist after every terminal-state Didit webhook.

Rollout pattern: ship code with flag off → admin manually backfills Lovemore via refresh → verify outputs → flip flag on.

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
flag on && terminal?                                       always
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
| `id_verifications[0].front_image_quality_score.overall_score` | `documentConfidenceScore` |
| `liveness_checks[0].liveness_score` | `livenessScore` |
| `face_matches[0].face_match_score` | `selfieMatchScore` |
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
  - Idempotency: re-running with same decision skips uploads (sha256 match), no new doc rows
  - Sha-changed: existing doc updated in place, no new row
  - Per-kind isolation: ID_BACK download fails → ID_FRONT/SELFIE/LIVENESS_FRAME still persist; failed kind in `documentsFailed`
  - DB tx failure: returns error from persist call; no partial DB state
  - Shape mismatch: decision missing `id_verifications` → mapper throws → persist returns with `fieldsStamped: false`

**Integration tests:**
- Webhook handler integration: simulate a terminal status.updated arriving → confirm `applyVendorVerdict` runs THEN `persistDiditDecision` is called when flag on; not called when flag off.
- Admin refresh integration: simulate `refreshDiditSessionAction` invocation → confirm persist runs regardless of flag.

**Smoke test (`e2e/smoke.spec.ts`):**
- After admin clicks "Refresh from Didit" on a Didit verification, the verification detail page renders ≥1 document thumbnail.

## 8. Rollout

1. **Feature branch:** `feat/didit-persist-documents` off `main`.
2. **Implement:** TDD per §7; conform to lint + typecheck + existing CI gates.
3. **PR review** with owner sign-off.
4. **Merge to `main`** → Vercel auto-deploys to production with flag off.
5. **Backfill Lovemore:** admin (Lebogang) opens `https://app.plugapro.co.za/admin/verifications/cmpv7l9j8000dl2042porhv0g` → clicks "Refresh from Didit" → persist runs (flag-independent admin path) → documents + fields populate.
6. **Verify** in admin UI: 4 document thumbnails, structured fields visible, decision metadata complete. Reviewer proceeds with manual review.
7. **Flag flip:** set `feature_flags.enabled = true` for `provider.identity.vendor.didit.persist_documents` in production DB. Future terminal webhooks auto-persist.
8. **Monitor:** watch `provider_verification_events` for `DIDIT_PERSIST_FAILED` over the next 48h; tune retry / error handling if anything pops.

## 9. Known limitations (intentional)

- **Orphan storage objects in rare upload-succeeds-DB-tx-fails window.** Active doc row is unchanged so no functional impact. Future PR will add a nightly cron to detect storage objects not referenced by any non-DELETED `ProviderIdentityDocument` and delete them.
- **`document_number` hashed only.** No `documentNumberEncrypted` column. Reviewers can compare hashes (e.g., re-enter a candidate doc number to verify match) but cannot read the raw doc number from PlugAPro. Acceptable for SA-context KYC where personal_number is the primary identifier.
- **One image per kind per verification.** If a re-attempt fits within the same verification (rare — Didit usually issues a new session id), only the latest is kept. Multi-attempt history is a future concern.
- **Didit CDN auth assumed `X-Api-Key`.** Docs are silent. Implementation includes a 401-fallback path that retries with no auth header and surfaces the finding in event metadata. Bumps the spec on first finding.
- **Webhook persist requires a `vendorReference` to refetch the full decision.** If the verification has only `livenessSessionReference` (edge case where refs got out of sync), persist logs a fail-safe event and exits. Caller falls back to admin refresh.

## 10. Decisions captured during brainstorm

(For future reference; not re-debated during implementation.)

| Question | Decision |
|---|---|
| Persist scope | Images + structured fields + raw payload (full archive) |
| Trigger | Terminal webhook + manual admin refresh (the recommended hybrid) |
| Approach | Single module called from both webhook + admin (Approach A) |
| Call site for persist | Caller boundary (route + action), not inside `applyVendorVerdict` |
| Document number encryption | Hash + last4 only (no encrypted column in schema) |
| Idempotency order | Download → hash → check existing row → conditionally upload (avoids orphan blobs on re-run) |
| `rawPayloadRedacted` URL handling | Image/video URLs dropped entirely |
| Schema changes | None |
