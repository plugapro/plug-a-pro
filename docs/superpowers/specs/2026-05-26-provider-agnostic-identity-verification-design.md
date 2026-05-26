# Provider-Agnostic Identity Verification — Design Spec

- **Project:** Plug A Pro (`field-service/`)
- **Date:** 2026-05-26
- **Status:** Approved design → ready for implementation plan
- **Feature flags:**
  - `provider.identity.verification.automation` (master switch)
  - `provider.identity.vendor.smile_id` (existing — defense-in-depth)
  - `provider.identity.vendor.thisisme` (existing)
  - `provider.identity.vendor.datanamix` (existing)
  - `provider.identity.vendor.omnicheck` (existing)
  - `provider.identity.verification.liveness.degraded_kill_switch` (fail-closed)
  - `provider.identity.verification.freeze_vendor_verdicts` (rollback)

---

## 1. Problem & goal

Today, identity verification for providers is collection-only. After a provider uploads their ID document and selfie via WhatsApp or the PWA, the verification transitions straight to `NEEDS_MANUAL_REVIEW`. Every case waits for a human reviewer before the provider can pass the credit gate in [`field-service/lib/identity-verification/credit-gate.ts`](field-service/lib/identity-verification/credit-gate.ts) (`buildHighAssuranceCreditVerificationWhere` + `assertIdentityVerifiedForCredits`) and start accepting paid work.

**Relationship to Sprint 4-6 plan** ([`docs/superpowers/plans/2026-05-26-sprint-4-6-identity-verification-qualified-shortlist.md`](docs/superpowers/plans/2026-05-26-sprint-4-6-identity-verification-qualified-shortlist.md)): that plan adds ENFORCEMENT of identity verification at additional touchpoints (PWA credits UI, WhatsApp top-up precheck, selected-provider acceptance, lead-accept paths). This spec adds AUTOMATION of how a verification reaches the PASSED state in the first place. Both stack: Sprint 4-6 makes the gate effective everywhere; this spec reduces the share of verifications that need manual review to clear the gate. No conflicts — the gate predicate (`buildHighAssuranceCreditVerificationWhere`) is unchanged by either, and vendor-issued PASSED rows satisfy it because the orchestrator sets `assuranceLevel = HIGH` (§3.3.3).

The goal of this design is to introduce a provider-agnostic identity-verification abstraction that:

1. Lets us submit collected documents/selfie/identifier to an external KYC vendor (Smile ID, ThisIsMe, Datanamix, OmniCheck) and receive an automated PASS/FAIL/INCONCLUSIVE decision.
2. Auto-passes high-confidence vendor PASS results; routes everything else (low-confidence PASS, FAIL, INCONCLUSIVE, vendor errors, timeouts) to `NEEDS_MANUAL_REVIEW`.
3. Supports both server-to-server document submission (ThisIsMe, Datanamix API checks) and hosted-session liveness (Smile ID Smart Selfie, OmniCheck face-match) without forking the orchestration code per vendor.
4. Preserves the existing manual-review path as a first-class adapter — both as today's default and as an explicit fallback when automation is disabled or vendor outages occur.
5. Ships behind feature flags with a staged rollout (staff → pilot providers → open).

**Primary success criterion:** at steady state, fewer than 30% of provider identity verifications require human review, while maintaining ≥95% agreement between auto-PASSED decisions and what a human reviewer would have decided.

---

## 2. Architectural reality (do not fight it)

The current schema was already designed with external providers in mind. The design extends what exists rather than introducing a parallel verification system.

**Already present in Prisma (`field-service/prisma/schema.prisma`):**

- `ProviderIdentityVerification` has `sourceCheckProvider`, `documentConfidenceScore`, `livenessScore`, `selfieMatchScore`, `riskFlags`, `failureReasonCode`, `assuranceLevel`, `decision`, `expiresAt`, `accessTokenHash`, `consentAcceptedAt`, encrypted `identifierEncrypted`, `dhaMatchResult`, `immigrationStatusResult`.
- `ProviderIdentityDocument` has `blobKey`, `sha256`, `deleteAfter`, `status`.
- `VerificationStatus` enum already has `PROCESSING`, `NEEDS_MANUAL_REVIEW`, `RETRY_REQUIRED`, `PASSED`, `FAILED`, `EXPIRED`, `CANCELLED`.
- `VerificationDecision` enum already has `PROVIDER_UNAVAILABLE`.
- `ProviderVerificationEvent` already supports `metadata Json?` for raw event data.
- `ProviderSensitiveDataAccessLog` already supports per-row auditing for `VIEW_DOC`, `REVEAL_IDENTIFIER`, `SIGNED_URL_ISSUED`, `EXPORT`.

**Existing infrastructure to reuse:**

- `crudAction()` for all admin mutations — writes `AuditLog` + `AdminAuditEvent`.
- `lib/flags.ts` — DB-row → env JSON → default. Per-user `enabledForUsers` exists; this spec adds a per-provider pilot allowlist (see §3.6).
- `lib/identity-verification/orchestrator.ts` — existing transitions and `ALLOWED_TRANSITIONS` table.
- `lib/identity-verification/credit-gate.ts` — already requires PASSED/PASS/HIGH; works unchanged for vendor-issued PASS.
- Existing application-layer encryption helper for identifier values (referenced from `identifierEncrypted` field).
- Existing `accessTokenHash` machinery on `ProviderIdentityVerification` for signed PWA links.

**What's missing and added by this spec:**

- An adapter abstraction (`VerificationVendorAdapter`) per vendor.
- An orchestration entry point that drives the automated flow (no vendor I/O inside DB transactions).
- A per-vendor webhook route with deterministic idempotency.
- A small DB-backed config table for per-vendor behavior (active, threshold, liveness-required).
- Schema additions for vendor reference, encrypted liveness session URLs, consent audit fields, webhook event log, pilot allowlist.
- New status `AWAITING_LIVENESS` to disambiguate "vendor processing" from "user must complete liveness".

---

## 3. Design

### 3.1 Schema changes (additive only)

#### 3.1.1 `ProviderIdentityVerification` — added fields

```
vendorReference              String?       // vendor's job/check id for the current attempt
livenessSessionReference     String?       // vendor's session id (safe to store)
livenessSessionUrlEncrypted  String?       // encrypted vendor URL; bearer/session material — see §3.1.2 access rule
livenessSessionExpiresAt     DateTime?     // vendor-specified expiry
consentVendorKey             String?       // 'smile_id' | 'thisisme' | 'datanamix' | 'omnicheck' | 'manual'
consentVendorDisplayName     String?       // exact name shown at consent time
consentTextHash              String?       // SHA-256 of the normalised consent text bytes shown to the user

@@index([sourceCheckProvider, vendorReference])
```

`vendorReference` joins webhook events back to this row. `consentTextHash` paired with the versioned text archive at `lib/identity-verification/consent-text.ts` proves what the provider accepted even after copy changes.

#### 3.1.2 `livenessSessionUrlEncrypted` access rule

Only one path may decrypt:

- `GET /provider/verify/[token]/liveness` (a `route.ts`, not `page.tsx`, so response headers are controllable).

Every decrypt writes a `ProviderSensitiveDataAccessLog` row with `accessType = SIGNED_URL_ISSUED`, `actorId = providerId`, `actorRole = 'PROVIDER_SELF'`, and the route enforces `Referrer-Policy: no-referrer` + `Cache-Control: no-store` on the 302 response.

#### 3.1.3 `VerificationStatus` — add `AWAITING_LIVENESS`

```
NOT_STARTED, STARTED, CONSENTED, AWAITING_IDENTIFIER,
AWAITING_DOCUMENT, AWAITING_SELFIE, SUBMITTED,
PROCESSING,
AWAITING_LIVENESS,            // NEW
NEEDS_MANUAL_REVIEW, RETRY_REQUIRED, PASSED, FAILED, EXPIRED, CANCELLED
```

**Propagation checklist** (every list in TS must be updated; no enum value should exist only in Prisma):

- `field-service/lib/identity-verification/types.ts` — `VERIFICATION_STATUSES`.
- `field-service/lib/identity-verification/link.ts` — `NON_TERMINAL_VERIFICATION_STATUSES` (add).
- `field-service/lib/identity-verification/orchestrator.ts` — `ALLOWED_TRANSITIONS`.

**Allowed transitions added:**

```
SUBMITTED          -> PROCESSING | AWAITING_LIVENESS | NEEDS_MANUAL_REVIEW | PASSED | FAILED | RETRY_REQUIRED
PROCESSING         -> AWAITING_LIVENESS | NEEDS_MANUAL_REVIEW | PASSED | FAILED | RETRY_REQUIRED
AWAITING_LIVENESS  -> PROCESSING | NEEDS_MANUAL_REVIEW | PASSED | FAILED | RETRY_REQUIRED | EXPIRED | CANCELLED
RETRY_REQUIRED     -> SUBMITTED | PROCESSING | AWAITING_LIVENESS | NEEDS_MANUAL_REVIEW | PASSED | FAILED
```

`RETRY_REQUIRED` allows direct transitions to the same set of "post-submit" states as `SUBMITTED`, because the orchestrator accepts either as a starting state (§3.3.1) and the admin "Retry with vendor" path sets `RETRY_REQUIRED` before re-invoking. `RETRY_REQUIRED → SUBMITTED` is also kept for callers that prefer to normalise before re-submitting.

#### 3.1.4 New model — `ProviderVerificationWebhookEvent`

Separate from `ProviderVerificationEvent` (which is a status-transition log). Webhooks are transport/audit records and may be duplicate, unknown, invalid, or out-of-order.

```
model ProviderVerificationWebhookEvent {
  id                  String   @id @default(cuid())
  verificationId      String?
  vendorKey           String
  vendorEventId       String?
  idempotencyKey      String   @unique
  vendorReference     String?
  eventType           String?
  signatureValid      Boolean
  payloadHash         String?
  rawPayloadRedacted  Json?
  receivedAt          DateTime @default(now())
  processedAt         DateTime?
  processingError     String?

  verification ProviderIdentityVerification? @relation(fields: [verificationId], references: [id], onDelete: SetNull)

  @@index([verificationId, receivedAt])
  @@index([vendorKey, vendorReference])
  @@map("provider_verification_webhook_events")
}
```

**`idempotencyKey` derivation** (computed by adapter):

- If vendor supplies a stable event id: `idempotencyKey = vendorKey + ":" + vendorEventId`.
- Otherwise: `idempotencyKey = vendorKey + ":" + (vendorReference ?? "_") + ":" + (eventType ?? "_") + ":" + payloadHash`.
- `payloadHash` is `sha256(canonicalRedactedPayload)` — canonicalised JSON (sorted keys, no whitespace) so duplicate webhooks with cosmetic differences still dedupe.

#### 3.1.5 New model — `VerificationVendorConfig`

```
model VerificationVendorConfig {
  vendorKey           String   @id        // 'smile_id' | 'thisisme' | 'datanamix' | 'omnicheck'
  active              Boolean  @default(false)
  confidenceThreshold Float    @default(0.9)  // 0..1; PASS below this -> NEEDS_MANUAL_REVIEW
  livenessRequired    Boolean  @default(true)
  configJson          Json?                  // displayName, sandbox URL, expectedTurnaroundMinutes, etc.
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@map("verification_vendor_configs")
}
```

Mutations always go through `crudAction()`; `AdminAuditEvent` captures actor + before/after.

#### 3.1.6 New model — `ProviderIdentityVerificationPilotAllowlist`

Pilot gating cannot use `enabledForUsers` (Supabase user IDs) because WhatsApp-channel verifications can exist before a Supabase user is provisioned. Allowlist works on provider/application records.

```
model ProviderIdentityVerificationPilotAllowlist {
  id                    String   @id @default(cuid())
  providerId            String?
  providerApplicationId String?
  addedById             String
  addedAt               DateTime @default(now())
  note                  String?

  provider            Provider?            @relation(fields: [providerId], references: [id], onDelete: SetNull)
  providerApplication ProviderApplication? @relation(fields: [providerApplicationId], references: [id], onDelete: SetNull)

  @@unique([providerId, providerApplicationId])
  @@map("provider_identity_verification_pilot_allowlist")
}
```

#### 3.1.7 Secrets stay in env

Per vendor: `<VENDOR>_API_KEY`, `<VENDOR>_WEBHOOK_SECRET`, `<VENDOR>_PARTNER_ID` (Smile ID), `<VENDOR>_SANDBOX_URL`, `<VENDOR>_PROD_URL`. Never in DB.

#### 3.1.8 RLS posture

New tables enable RLS without public policies, matching existing `provider_identity_*` tables:

```sql
ALTER TABLE provider_verification_webhook_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_vendor_configs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_identity_verification_pilot_allowlist ENABLE ROW LEVEL SECURITY;
```

Access is exclusively through Prisma running under the service role. The migration step that verifies posture on existing `provider_identity_verifications` should be re-run against the new tables.

### 3.2 Adapter abstraction

#### 3.2.1 Files

```
field-service/lib/identity-verification/vendors/
  types.ts              # interface, input/output types, NormalizedVerificationResult
  registry.ts           # adapter registration + getAdapter / getActiveAdapter
  manual.ts             # ManualReviewAdapter
  mock.ts               # MockVerificationAdapter (dynamic-imported; throws on getAdapter in production)
  smile-id/
    index.ts            # SmileIdAdapter
    signing.ts          # HMAC helpers
    parse.ts            # webhook parsing / result normalisation
  thisisme/
    index.ts            # ThisIsMeAdapter (stub, throws NotImplementedError; config rejects active in prod)
  datanamix/
    index.ts            # stub
  omnicheck/
    index.ts            # stub
```

#### 3.2.2 Interface

```ts
export type VendorKey =
  | 'smile_id' | 'thisisme' | 'datanamix' | 'omnicheck'
  | 'manual' | 'mock'

export interface NormalizedVerificationResult {
  decision: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'MANUAL_REVIEW' | 'PROVIDER_UNAVAILABLE'
  confidence: number | null              // 0..1
  documentConfidence: number | null
  livenessScore: number | null
  selfieMatchScore: number | null
  riskFlags: string[]                    // canonicalised enum strings; see §3.5 metrics
  reasonCode: string | null              // canonicalised enum string when not PASS
  vendorReference: string | null
  expiresAt: Date | null
}

export interface SubmitDocumentCheckInput {
  verificationId: string
  providerId: string | null
  identityBasis: IdentityBasis
  issuingCountry: string | null
  identifierHash: string | null
  identifierLast4: string | null
  identifierPlaintext: string | null     // decrypted in orchestrator phase 1; never persisted, never logged
  documents: Array<{
    id: string
    kind: IdentityDocumentKind
    blobKey: string
    mimeType: string
    sha256: string
  }>
  webhookCallbackUrl: string
  livenessReturnUrl: string
}

export interface SubmitDocumentCheckResult {
  vendorReference: string
  immediateResult?: NormalizedVerificationResult
  expectsWebhook: boolean
}

export interface CreateLivenessSessionInput {
  verificationId: string
  livenessReturnUrl: string
}

export interface CreateLivenessSessionResult {
  vendorReference: string
  sessionUrl: string                     // encrypted before persistence
  expiresAt: Date
}

export interface ParseWebhookInput {
  headers: Record<string, string>
  rawBody: string
}

export interface ParseWebhookResult {
  signatureValid: boolean
  vendorEventId: string | null
  vendorReference: string | null
  eventType: string | null
  payloadHash: string                    // sha256(canonical(rawBody))
  redactedPayload: Record<string, unknown> | null
  result: NormalizedVerificationResult | null
}

export interface CancelVerificationJobInput {
  verificationId: string
  vendorReference: string
  reason: 'PROVIDER_WITHDREW_CONSENT' | 'ADMIN_CANCELLED' | 'INTERNAL_TIMEOUT'
}

export interface CancelVerificationJobResult {
  supported: boolean                     // false when vendor has no cancel API
  vendorAcknowledged: boolean
}

export interface VerificationVendorAdapter {
  vendorKey: VendorKey
  submitDocumentCheck(input: SubmitDocumentCheckInput): Promise<SubmitDocumentCheckResult>
  createLivenessSession?(input: CreateLivenessSessionInput): Promise<CreateLivenessSessionResult>
  parseWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult>
  cancelVerificationJob(input: CancelVerificationJobInput): Promise<CancelVerificationJobResult>
}
```

#### 3.2.3 Adapter-specific behaviours

| Adapter | `submitDocumentCheck` | `createLivenessSession` | `cancelVerificationJob` |
|---|---|---|---|
| `manual` | Returns `{ vendorReference: 'manual:<id>', immediateResult: { decision: 'MANUAL_REVIEW', reasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED' }, expectsWebhook: false }` | absent | `{ supported: true, vendorAcknowledged: true }` (no-op) |
| `mock` | Returns deterministic results based on a marker on the verification row (test-only); throws when imported in production via dynamic import gate | present (returns stub URL) | `{ supported: true, vendorAcknowledged: true }` |
| `smile_id` | Real API; HMAC-signed webhooks; both immediate and async paths | present (Smart Selfie web link) | `{ supported: true | false }` depending on Smile ID job state |
| `thisisme` | Stub returning `NotImplementedError`; config rejects `active=true` in production until wired | undefined | `{ supported: false }` |
| `datanamix` / `omnicheck` | Same stub posture | undefined | `{ supported: false }` |

#### 3.2.4 `manual` decision contract

`manual` must never return `PROVIDER_UNAVAILABLE`. That reason is reserved for real adapter network/auth failures and is consumed by outage metrics. Manual-review-by-config returns `decision: 'MANUAL_REVIEW'` + `reasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED'`.

### 3.3 Orchestrator

Two new entry points extend the existing `lib/identity-verification/orchestrator.ts`.

#### 3.3.1 `submitVerificationForAutomation(verificationId)`

Three phases — vendor I/O is never inside a DB transaction.

**Phase 1 — Read (single transaction):**

```
db.$transaction(async (tx) => {
  const v = await tx.providerIdentityVerification.findUniqueOrThrow({ ... })
  assert(v.status in {SUBMITTED, RETRY_REQUIRED})
  assert(v.vendorReference == null)
  if (v.identifierEncrypted) {
    identifierPlaintext = decryptIdentifier(v.identifierEncrypted)
    await tx.providerSensitiveDataAccessLog.create({
      verificationId, actorId: 'system:orchestrator',
      actorRole: 'SYSTEM', accessType: 'REVEAL_IDENTIFIER',
    })
  }
  return snapshot
})
// identifierPlaintext is held only in this function's local scope
```

**Phase 2 — External (no transaction):**

```
const adapter = await getActiveAdapter(snapshot)
const submit = await adapter.submitDocumentCheck({...snapshot, identifierPlaintext, ...})
let liveness = null
if (config.livenessRequired && adapter.createLivenessSession && !submit.immediateResult) {
  liveness = await adapter.createLivenessSession({
    verificationId, livenessReturnUrl,
  })
}
// drop identifierPlaintext
```

**Phase 3 — Commit (single transaction, optimistic concurrency, two steps):**

Step A — **stamp vendor identifiers only.** This claims the verification for this submission attempt without committing to a final status. Status moves later, either via `applyVendorVerdict` (immediate result) or `transitionTo` (waiting state).

```
const livenessFields = liveness ? {
  livenessSessionReference:   liveness.vendorReference,
  livenessSessionUrlEncrypted: encrypt(liveness.sessionUrl),
  livenessSessionExpiresAt:    liveness.expiresAt,
} : {}

const stamped = await tx.providerIdentityVerification.updateMany({
  where: {
    id: verificationId,
    status: { in: ['SUBMITTED', 'RETRY_REQUIRED'] },
    vendorReference: null,
  },
  data: {
    sourceCheckProvider: adapter.vendorKey,
    vendorReference:     submit.vendorReference,
    ...livenessFields,
  },
})

if (stamped.count === 0) {
  // contention — someone else stamped. Log orphan vendor side effect for reconciliation.
  await tx.providerVerificationEvent.create({
    data: {
      verificationId,
      toStatus: 'NEEDS_MANUAL_REVIEW',
      reasonCode: 'ORCHESTRATOR_CONTENTION',
      metadata: { vendorKey: adapter.vendorKey, vendorReference: submit.vendorReference },
    },
  })
  return readCurrentSnapshot()
}
```

Step B — **transition status** based on what the vendor returned. Only one of these branches runs.

```
if (submit.immediateResult) {
  // Verdict known synchronously: applyVendorVerdict handles the transition
  // (SUBMITTED|RETRY_REQUIRED -> {PASSED, NEEDS_MANUAL_REVIEW}) and writes
  // the ProviderVerificationEvent.
  await applyVendorVerdict(tx, verificationId, submit.immediateResult, 'sync')
} else if (liveness) {
  await transitionTo(tx, verificationId, 'AWAITING_LIVENESS', {
    reasonCode: 'AWAITING_LIVENESS_FROM_VENDOR',
  })
} else {
  await transitionTo(tx, verificationId, 'PROCESSING', {
    reasonCode: 'AWAITING_VENDOR_WEBHOOK',
  })
}

after(() => sendDownstreamNotify(verificationId))
```

`transitionTo()` validates the move against `ALLOWED_TRANSITIONS` (§3.1.3) and writes a `ProviderVerificationEvent`. `applyVendorVerdict()` does the same internally — both share the same transition helper so status writes can't drift between paths.

#### 3.3.2 Decision routing (no `decideNextStatus` helper)

Earlier drafts had a `decideNextStatus(submit, liveness)` helper that returned a status. It is removed because it duplicated the routing logic already expressed in §3.3.1 Step B and risked a double-write when paired with `applyVendorVerdict`. The branching in Step B is the single decision point.

#### 3.3.3 `applyVendorVerdict(verificationId, result, source)`

| Vendor decision | Threshold | Outcome |
|---|---|---|
| `PASS` | `confidence ≥ threshold` | `PASSED` + `decision = PASS` + `assuranceLevel = HIGH` |
| `PASS` | `confidence < threshold` | `NEEDS_MANUAL_REVIEW` + `failureReasonCode = PROVIDER_LOW_CONFIDENCE` |
| `FAIL` | — | `NEEDS_MANUAL_REVIEW` + `PROVIDER_FAIL` *(pilot; later config may route to direct FAILED)* |
| `INCONCLUSIVE` | — | `NEEDS_MANUAL_REVIEW` + `PROVIDER_INCONCLUSIVE` |
| `MANUAL_REVIEW` | — | `NEEDS_MANUAL_REVIEW` + `PROVIDER_REQUESTED_MANUAL_REVIEW` |
| `PROVIDER_UNAVAILABLE` | — | `NEEDS_MANUAL_REVIEW` + `PROVIDER_UNAVAILABLE` |

**Freeze-flag override:** if `provider.identity.verification.freeze_vendor_verdicts === true`, the verdict is logged via a `ProviderVerificationEvent` with `metadata.frozenDecision = ...` but the status transitions to `NEEDS_MANUAL_REVIEW` with `failureReasonCode = VENDOR_VERDICTS_FROZEN` regardless of the original decision.

**Invariant:** any path setting `status = NEEDS_MANUAL_REVIEW` also sets `decision = MANUAL_REVIEW`. Implemented as a single helper `transitionToManualReview(reasonCode)` so this cannot drift.

**Score persistence:** `documentConfidenceScore`, `livenessScore`, `selfieMatchScore`, `riskFlags` are persisted from every verdict regardless of outcome — useful for tuning the threshold and for reviewer context.

**Late-event safety:** transition validation against `ALLOWED_TRANSITIONS` means a webhook that arrives after the verification is already `PASSED` / `FAILED` / `EXPIRED` / `CANCELLED` is logged via the webhook event row and skipped by the transition layer. No "ignore" branches in the orchestrator — the transition table is the single source of truth.

### 3.4 Webhook route

`app/api/webhooks/verification/[vendor]/route.ts` — one generic dispatcher. Per-vendor knowledge stays in the adapter.

```
POST /api/webhooks/verification/[vendor]

1. rawBody = await request.text()
2. adapter = getAdapter(params.vendor)              // 404 if unknown
3. parsed = await adapter.parseWebhook({ headers, rawBody })
4. idempotencyKey = computeIdempotencyKey(parsed)   // see §3.1.4
5. try:
     row = await db.providerVerificationWebhookEvent.create({ ... })
   catch UniqueViolation:
     existing = await db.providerVerificationWebhookEvent.findUnique({ idempotencyKey })
     if existing.signatureValid === false           -> return 401
     if existing.processedAt != null                -> return 200            (true duplicate)
     row = existing                                                          (reprocess in place)
6. if !parsed.signatureValid:
     await db.providerVerificationWebhookEvent.update({ id: row.id, signatureValid: false })
     return 401
7. verification = await db.providerIdentityVerification.findFirst({
     where: { sourceCheckProvider: vendorKey, vendorReference: parsed.vendorReference }
   })
   if !verification:
     await db.providerVerificationWebhookEvent.update({ id: row.id, processedAt: now() })
     return 200                                     (log only, do not make vendor retry)
8. if parsed.result:
     try: await applyVendorVerdict(verification.id, parsed.result, 'webhook')
     catch e:
       await db.providerVerificationWebhookEvent.update({ id: row.id, processingError: e.message })
       return 500                                   (vendor retries; idempotent reprocess path handles next attempt)
9. await db.providerVerificationWebhookEvent.update({ id: row.id, processedAt: now() })
   return 200
```

**Notes:**

- Synchronous processing with no queue is sufficient at pilot volumes. The handler is async-safe — failure modes degrade to "vendor retries; the duplicate-handling branch reprocesses unfinished events".
- 401 returned for signature failures so vendor stops retrying with the same bad signature. The event row stays for forensics.
- `signatureValid = false` rows are excluded from admin queues by default; a dedicated "Invalid webhook signatures" view surfaces them for security review.

### 3.5 Metrics

All metrics use controlled enum values. No high-cardinality tags.

| Metric | Tags |
|---|---|
| `identity_verification.vendor.submit.count` | `vendor`, `outcome ∈ {immediate, awaiting_liveness, processing, error}` |
| `identity_verification.vendor.webhook.count` | `vendor`, `outcome ∈ {ok, duplicate, signature_invalid, unknown_ref, reprocess, error}` |
| `identity_verification.vendor.decision.count` | `vendor`, `decision ∈ NormalizedVerificationResult.decision`, `reason_code ∈ ReasonCode enum` |
| `identity_verification.vendor.confidence` (distribution) | `vendor`, `decision` |
| `identity_verification.vendor.turnaround_seconds` (distribution, submit → final webhook) | `vendor` |

A whitelist is defined in `lib/identity-verification/metrics.ts` for `ReasonCode` and risk-flag categories. The metrics module rejects any tag value not in the whitelist at compile time. **Never tag with:** verification IDs, vendor references, provider IDs, phone numbers, document keys, or raw vendor strings.

### 3.6 Feature flags

| Flag | Default | Resolution | Purpose |
|---|---|---|---|
| `provider.identity.verification.automation` | `false` | DB → env → default | Master switch. Off = today's manual-only behavior, regardless of `VerificationVendorConfig.active`. |
| `provider.identity.vendor.smile_id` | existing | existing | Defense-in-depth on top of `VerificationVendorConfig.active`. Both must be `true` for Smile ID to be selectable. |
| `provider.identity.vendor.thisisme` | existing | existing | Same, for ThisIsMe. |
| `provider.identity.vendor.datanamix` | existing | existing | Same. |
| `provider.identity.vendor.omnicheck` | existing | existing | Same. |
| `provider.identity.verification.liveness.degraded_kill_switch` | `false` | DB → env → default | **Fail-closed.** When `true`: liveness-required vendors transition liveness-required cases to `NEEDS_MANUAL_REVIEW` instead of creating sessions. Never downgrades assurance. |
| `provider.identity.verification.freeze_vendor_verdicts` | `false` | DB → env → default | Rollback flag. When `true`: webhooks are still stored, but all vendor verdicts route to `NEEDS_MANUAL_REVIEW`. Used when vendor accuracy or webhook integrity is in doubt. |

**Pilot gating** does not use `enabledForUsers`. The orchestrator reads `ProviderIdentityVerificationPilotAllowlist` and only invokes the automated path when the verification's `providerId` or `providerApplicationId` is present in the allowlist. Outside pilot stages, the master automation flag is the only gate.

### 3.7 Channel changes

#### 3.7.1 WhatsApp flow (`lib/whatsapp-flows/identity-verification.ts`)

After selfie upload (currently transitioning to `NEEDS_MANUAL_REVIEW`), the flow instead calls `submitVerificationForAutomation()` and branches on the returned status:

| Result | In-window copy | Out-of-window template |
|---|---|---|
| `PASSED` | "Your identity verification is complete. Your profile has been updated." | `identity_verification_result_v1` (pass variant) |
| `NEEDS_MANUAL_REVIEW` | "Thanks. Your details are with our review team — usually within 30 minutes during business hours; otherwise next working day." | `identity_verification_result_v1` (manual variant) |
| `AWAITING_LIVENESS` | "One more step — tap this secure link to complete a quick face-match: `https://app.plugapro.co.za/provider/verify/<token>/liveness`. The link expires when your face-match session does (about `<N>` minutes from now)." | `identity_verification_liveness_link_v1` (URL button variant) |
| `PROCESSING` | "Thanks, we're verifying your details now — I'll message you the moment it's done." | `identity_verification_processing_nudge_v1` |

Webhook-driven notifications (after async result) follow the same table. The downstream notifier reads the 24-hour customer-service-window state and chooses free-form vs template automatically.

**Credit/job copy lives in the credit gate UI and provider-active notifier, not the verification flow.** Verification PASSED only maps to `kycStatus = VERIFIED`; eligibility for credit purchase and job acceptance has additional gates in [`credit-gate.ts`](field-service/lib/identity-verification/credit-gate.ts) (`assertIdentityVerifiedForCredits`, `isProviderEligibleForCredits`, `findEligibleCreditIdentity`) and the provider-active enforcement added by the Sprint 4-6 plan.

**Consent step:** between identifier capture and document upload, the flow inserts a consent step that records `consentAcceptedAt`, `consentVendorKey`, `consentVendorDisplayName`, and `consentTextHash`. Consent text is per-vendor; the active vendor's display name is read from `VerificationVendorConfig.configJson.displayName`. If `active` flips mid-session, re-prompt before submission.

#### 3.7.2 PWA flow (`app/provider/verify/[token]/actions.ts` + new routes)

- `submitIdentityVerificationForReview()` → `submitVerificationForAutomation()`.
- New step state `awaiting_liveness` rendered in `page.tsx` with a "Complete face-match" button linking to the signed Plug A Pro URL.
- **New `route.ts`:** `app/provider/verify/[token]/liveness/route.ts` (NOT `page.tsx`) — validates token; checks `livenessSessionExpiresAt > now()`; decrypts `livenessSessionUrlEncrypted`; logs `SIGNED_URL_ISSUED`; returns 302 with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. When session is expired, renders a "session expired — request new link" UI with a server action that re-runs `submitVerificationForAutomation()`.
- **New `page.tsx`:** `app/provider/verify/[token]/liveness/complete/page.tsx` — vendor `returnUrl` lands here; shows "We're checking your face-match" placeholder. v1 ships with a "Refresh status" button (no background polling). v2 (separate spec) can add a sanitised status endpoint.
- `processing` state shows "We're verifying — refresh in a minute" with no spinner-hold.

#### 3.7.3 Admin verification queue (`app/(admin)/admin/verifications/*`)

**Default queue scope:**

```
status IN ('NEEDS_MANUAL_REVIEW')
OR (status = 'AWAITING_LIVENESS' AND livenessSessionExpiresAt < now() - INTERVAL '2 minutes')
OR (status = 'PROCESSING' AND updatedAt < now() - INTERVAL <vendor.expectedTurnaroundMinutes> MINUTES)
```

`vendor.expectedTurnaroundMinutes` defaults to 30 (configured per-vendor in `configJson`).

**New views:**

- "Invalid webhook signatures": rows from `ProviderVerificationWebhookEvent` where `signatureValid = false`.
- "Vendor decisions": every verification with `sourceCheckProvider != null`, with vendor-decision-vs-final-outcome columns — used for tuning `confidenceThreshold`.

**Detail page additions:**

- Vendor name, vendor reference, decision, confidence breakdown (document/liveness/selfie-match scores).
- Risk flags.
- Webhook event timeline (raw redacted payloads collapsible).

**New admin actions:**

| Action | Role | Notes |
|---|---|---|
| Retry with vendor | TRUST minimum | Resets `vendorReference = null`, transitions to `RETRY_REQUIRED`, re-invokes `submitVerificationForAutomation`. Only allowed when `failureReasonCode ∈ {PROVIDER_LOW_CONFIDENCE, PROVIDER_INCONCLUSIVE, PROVIDER_UNAVAILABLE}`. Decrypts identifier — TRUST is the minimum sensitive-data access role. |
| Vendor config — adjust `confidenceThreshold` | TRUST | Through `crudAction()`. |
| Vendor config — toggle `active` | OWNER | Through `crudAction()`. |
| Pilot allowlist — add/remove provider | TRUST | Through `crudAction()`. |
| Cancel verification (consent withdrawal) | TRUST | Invokes `adapter.cancelVerificationJob()`; logs result; if `supported: false`, queues an `AdminAuditEvent` for manual follow-up to contact vendor for deletion. |

### 3.8 POPIA consent

**Consent text** (archived versioned in `lib/identity-verification/consent-text.ts`, hash stored on the row):

> "To verify your identity, Plug A Pro shares your ID number, photographs, and selfie with `<vendor display name>`, an accredited identity-verification provider, and (where relevant) the South African Department of Home Affairs. `<vendor display name>` retains this information only as long as needed to complete the verification, after which it is deleted in line with their policy. You can withdraw consent at any time by contacting support — withdrawal cancels your verification."

**Captured fields** on `ProviderIdentityVerification`:

- `consentAcceptedAt` (existing)
- `consentVendorKey` (new)
- `consentVendorDisplayName` (new)
- `consentTextHash` (new)

**Placement:**

- WhatsApp: consent step inserted between identifier capture and document upload. Button-tap or "I agree" required.
- PWA: consent dialog at the start of `/provider/verify/[token]`, required tickbox + button.

**Vendor change mid-session:** if `VerificationVendorConfig.active` changes between consent and submission, the orchestrator detects mismatch and re-prompts consent before submitting. The previous consent row is preserved; a new event is recorded.

**Withdrawal flow:** existing admin "Cancel verification" action calls `adapter.cancelVerificationJob()`. Where the vendor supports cancellation, the response is logged with `vendorAcknowledged`. Where not (`supported: false`), an `AdminAuditEvent` is queued for manual contact to the vendor for record deletion.

---

## 4. Migration plan

One Prisma migration, additive only:

```
migration: add_provider_agnostic_identity_verification

ALTER TABLE provider_identity_verifications
  ADD COLUMN vendor_reference                 TEXT,
  ADD COLUMN liveness_session_reference       TEXT,
  ADD COLUMN liveness_session_url_encrypted   TEXT,
  ADD COLUMN liveness_session_expires_at      TIMESTAMP(3),
  ADD COLUMN consent_vendor_key               TEXT,
  ADD COLUMN consent_vendor_display_name      TEXT,
  ADD COLUMN consent_text_hash                TEXT;

CREATE INDEX provider_identity_verifications_source_check_provider_vendor_reference_idx
  ON provider_identity_verifications (source_check_provider, vendor_reference);

ALTER TYPE "VerificationStatus" ADD VALUE 'AWAITING_LIVENESS' AFTER 'PROCESSING';

CREATE TABLE provider_verification_webhook_events ( ... );
CREATE UNIQUE INDEX ... ON provider_verification_webhook_events (idempotency_key);
CREATE INDEX ... ON provider_verification_webhook_events (verification_id, received_at);
CREATE INDEX ... ON provider_verification_webhook_events (vendor_key, vendor_reference);
ALTER TABLE provider_verification_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE verification_vendor_configs ( ... );
ALTER TABLE verification_vendor_configs ENABLE ROW LEVEL SECURITY;

CREATE TABLE provider_identity_verification_pilot_allowlist ( ... );
CREATE UNIQUE INDEX ... ON ... (provider_id, provider_application_id);
ALTER TABLE provider_identity_verification_pilot_allowlist ENABLE ROW LEVEL SECURITY;
```

**No backfill required.** Existing verifications keep `vendorReference = null`, `consent*` = null. The orchestrator only acts on new submissions (status transitions through `SUBMITTED` after this code ships).

**Enum-value-add safety:** Postgres allows adding enum values without rewriting existing rows. The migration is committed before code that emits `AWAITING_LIVENESS`.

**Seed:** `scripts/seed-identity-verification-vendors.ts` inserts initial config rows for all four vendors with `active = false`, `confidenceThreshold = 0.9`, `livenessRequired = true`, and `configJson = { displayName: ..., expectedTurnaroundMinutes: 30 }`. Idempotent (upsert).

---

## 5. Rollout plan

| Stage | Gate | What's live | Exit criteria |
|---|---|---|---|
| 0. Pre-flight | manual | Migration + schema + adapter scaffolding + manual + mock adapters + tests; `.automation` flag off | All tests pass in CI; staging migration applied cleanly; ops has all WhatsApp templates pre-submitted |
| 1. Internal staging | `.automation=on` for staff users only via pilot allowlist | Smile ID sandbox adapter; webhook receives sandbox events; admin queue shows vendor data | 20 internal verifications run end-to-end; no signature-validation failures; manual reviewers report decision panel is usable |
| 2. Pilot providers | pilot allowlist = 10 named providers; `.vendor.smile_id=on`; `VerificationVendorConfig.active = smile_id` | Live Smile ID production for 10 named providers | 50 production verifications across pilot users; agreement rate measured; no PII leakage incidents; vendor confidence distribution analysed |
| 3. Confidence-threshold tuning | `VerificationVendorConfig.confidenceThreshold` adjusted per measured distribution | Same surface, threshold tuned | Auto-PASS rate matches manual-reviewer agreement rate within ±5pp |
| 4. Open rollout | pilot allowlist removed (all providers in scope); `.automation=on` globally | All providers | Manual-review queue volume drops to target (<30% of submissions) |
| 5. Second vendor | `.vendor.thisisme=on`; `VerificationVendorConfig.active` flipped | ThisIsMe live; Smile ID `active=false` | Same agreement-rate gate; per-vendor decision audit view used to compare |

**Rollback modes:**

- **New submissions:** flip `.automation = off`. Subsequent submissions route to manual-only.
- **Existing in-flight verifications:** flip `provider.identity.verification.freeze_vendor_verdicts = on`. Webhooks continue to be stored (idempotency + forensics), but all verdicts route to `NEEDS_MANUAL_REVIEW`. Use this when vendor accuracy or webhook integrity is in doubt.
- Both flags together = full stop without data loss.

---

## 6. Test plan (TDD — failing tests first)

### 6.1 Adapter contract

- Each adapter conforms to `VerificationVendorAdapter` (TS type test).
- `mock` returns deterministic results keyed by a marker on the verification row.
- Production-config test: `VerificationVendorConfig.active = true` rejected for `mock` when `NODE_ENV === 'production'`.
- `getAdapter('mock')` throws when `NODE_ENV === 'production'`.
- `manual` returns `MANUAL_REVIEW` + `MANUAL_REVIEW_PROVIDER_SELECTED`; never `PROVIDER_UNAVAILABLE`.
- `smile_id.parseWebhook` validates HMAC: good signature → `signatureValid=true`; tampered → `false`; wrong key → `false`.
- `smile_id.parseWebhook` computes deterministic `payloadHash` (whitespace-normalised JSON → same hash).
- Every adapter's `cancelVerificationJob` returns `{ supported: boolean, vendorAcknowledged: boolean }`.

### 6.2 Orchestrator

- Phase 1 rejects when `status ∉ {SUBMITTED, RETRY_REQUIRED}` or `vendorReference IS NOT NULL`.
- Phase 1 writes `ProviderSensitiveDataAccessLog` with `REVEAL_IDENTIFIER` when decrypting identifier.
- Adapter call is NOT invoked inside a `$transaction` block (verified by mocking Prisma's `$transaction` and asserting adapter not called from inside).
- Phase 3 optimistic update with `count === 0` triggers re-read path (no double-submit, orphan vendor side effect is logged).
- `applyVendorVerdict` decision matrix: 6 cases × score/flag persistence.
- Any path setting `NEEDS_MANUAL_REVIEW` also sets `decision = MANUAL_REVIEW`.
- Late webhook for `PASSED` verification: event logged, no transition attempted.
- Failed adapter call → retry → second failure transitions to `NEEDS_MANUAL_REVIEW` with `PROVIDER_UNAVAILABLE`.
- `freeze_vendor_verdicts = true`: PASS verdict logged, status routed to `NEEDS_MANUAL_REVIEW` with `VENDOR_VERDICTS_FROZEN`.
- `liveness.degraded_kill_switch = true`: liveness-required vendor + liveness-required case → routes to `NEEDS_MANUAL_REVIEW`; assurance never downgraded.
- Pilot allowlist excludes a provider → orchestrator falls back to manual path.

### 6.3 Webhook route

- Unknown vendor → 404.
- Valid signature, new event → 200, event row inserted, verdict applied.
- Duplicate event with prior `processedAt != null` → 200, no reprocess.
- Duplicate event with prior `processedAt = null` → reprocess in-place (this is the gap addressed in design).
- Duplicate event with prior `signatureValid = false` → 401.
- Invalid signature on new event → 401, event row written with `signatureValid=false`.
- Unknown `vendorReference` → 200, event row with `verificationId=null`.
- Adapter throws during processing → 500, `processingError` set.

### 6.4 Channel changes

- WhatsApp flow with `manual` config active: post-selfie status = `NEEDS_MANUAL_REVIEW` (regression on current behavior).
- WhatsApp flow with `smile_id` + immediate PASS: status `PASSED`, neutral copy sent (no "buy credits" string in message body).
- WhatsApp flow with vendor needing liveness: status `AWAITING_LIVENESS`, link is the signed Plug A Pro URL (no vendor URL leaked).
- PWA liveness `route.ts`: response includes `Referrer-Policy: no-referrer`; expired session returns expiry UI, not the redirect.
- Admin queue default view: excludes `signatureValid=false` rows; "invalid signatures" view includes them.
- Admin "Retry with vendor" rejected for non-TRUST role.
- Admin "Vendor config — adjust threshold" rejected for non-TRUST role.
- Admin "Vendor config — toggle active" rejected for non-OWNER role.

### 6.5 Credit gate

- PASSED via vendor (`sourceCheckProvider != null`) satisfies `buildHighAssuranceCreditVerificationWhere` (regression coverage).

### 6.6 RLS smoke

- Anonymous Supabase client cannot read `provider_verification_webhook_events`.
- Anonymous Supabase client cannot read `verification_vendor_configs`.
- Anonymous Supabase client cannot read `provider_identity_verification_pilot_allowlist`.

---

## 7. Prerequisites & blockers

These must be true before any pilot stage (1 onward) ships:

1. **Identifier encryption capture is wired.** WhatsApp identifier capture (in `lib/whatsapp-flows/identity-verification.ts` identifier step) and PWA identifier form (in `app/provider/verify/[token]/*`) must populate `ProviderIdentityVerification.identifierEncrypted` using the existing encryption helper. Without this, vendor submissions lack the SA ID number and degrade silently to lower-accuracy doc/selfie-only checks. **In scope for this spec.**
2. **WhatsApp templates pre-submitted to Meta:** `identity_verification_result_v1`, `identity_verification_liveness_link_v1`, `identity_verification_processing_nudge_v1`. Code can merge before approval; production rollout cannot.
3. **Smile ID sandbox credentials provisioned** (`SMILE_ID_PARTNER_ID`, `SMILE_ID_API_KEY`, `SMILE_ID_WEBHOOK_SECRET`, `SMILE_ID_SANDBOX_URL`, `SMILE_ID_PROD_URL`).
4. **Webhook endpoint URL registered with Smile ID** sandbox.
5. **Application-layer encryption helper verified** for liveness session URLs — confirm the same helper used for `identifierEncrypted` is appropriate; if not, document the choice.
6. **Existing TRUST/OWNER role gating** verified in `lib/auth.ts` matches what the new admin actions require.

---

## 8. Open work (NOT in this spec)

- **PWA background status polling** (sanitised `/api/provider/verify/[token]/status` endpoint).
- **A/B routing between two active vendors** (registry currently throws on multiple active).
- **Automatic threshold tuning** from agreement-rate metrics (manual today).
- **Direct vendor `FAIL → FAILED`** (skipping manual review) — gated on pilot accuracy data.
- **Vendor-side retention sweep** confirmation flow (today: manual follow-up `AdminAuditEvent`).
- **ThisIsMe / Datanamix / OmniCheck production adapters** — stubs ship; production wiring is its own spec per vendor.

---

## 9. Glossary

| Term | Definition |
|---|---|
| Adapter | A per-vendor module implementing `VerificationVendorAdapter`. |
| Orchestrator | The function `submitVerificationForAutomation` in `lib/identity-verification/orchestrator.ts` that drives the automated flow. |
| Verdict | A normalised result returned by the vendor (sync or via webhook), structured as `NormalizedVerificationResult`. |
| Pilot allowlist | The `ProviderIdentityVerificationPilotAllowlist` table — gates the automated path during rollout stages 1-3. |
| Freeze-flag | `provider.identity.verification.freeze_vendor_verdicts` — rollback mode that stores webhooks but ignores their verdicts. |
| Degraded kill-switch | `provider.identity.verification.liveness.degraded_kill_switch` — fail-closed flag; never downgrades assurance. |
