# Smile ID Adapter — Implementation Notes

- **Project:** Plug A Pro (`field-service/`)
- **Date:** 2026-05-26 (revised 2026-05-27 after review)
- **Status:** Adapter implementation reference for the provider-agnostic identity verification system
- **Parent spec:** [`2026-05-26-provider-agnostic-identity-verification-design.md`](2026-05-26-provider-agnostic-identity-verification-design.md)

This document records how Smile ID's actual contract maps onto the vendor-agnostic adapter interface defined in the parent spec. It exists because Smile ID's surface differs from the generic "doc + selfie + webhook" KYC vendor shape that the parent spec assumes — the parent spec stays vendor-agnostic, and the translation lives here.

> **Revision 2026-05-27 — implementation-readiness fixes.** Seven issues found in review (3 blockers, 3 highs, 1 medium). The biggest is that `createLivenessSession` cannot access the partner job id returned by `submitDocumentCheck` because the orchestrator hasn't stamped it yet. Fix requires extending the parent spec's `CreateLivenessSessionInput` with two fields — see **§15 Parent spec dependencies**. Other fixes: EVD result codes (0810 PASS, not 1012); SA id_type `IDENTITY_CARD` not `NATIONAL_ID`; cancel is `PUT … {is_disabled:true}` not `PATCH … {is_single_use_completed:true}`; `callback_url` is required per request; `crypto.randomUUID()` for partner job id; redaction list expanded; `IsFinalResult` may be absent on EVD callbacks (fallback to terminal-code detection).

> **Revision 2026-05-27 (post-doc-research) — Smile API specifics corrected.**
> The earlier revision fixed architectural gaps; this revision corrects Smile API specifics that were plausible-but-unverified:
> - Response field on POST /v1/smile_links is `link_url`, not `link`.
> - `user_id` is nested INSIDE `partner_params`, not a top-level request field.
> - `verification_method` for EVD on Smile Links uses `doc_verification` (the DocV string), with EVD selected by partner product config. NOT `enhanced_document_verification`.
> - ResultCode `1014` is REJECTED ("Unsupported ID number format"), NOT inconclusive.
> - `IsFinalResult` returns as a STRING `"true"` / `"false"` (per smile-identity-core SDK), not boolean. The parser handles both.
> - SA EVD currently only supports `IDENTITY_CARD` for `id_type`; broader DocV id-types are not confirmed for EVD.
> - Security: in-body HMAC scheme doesn't cover the body. Adapter adds a 5-minute timestamp freshness window in `parseSmileWebhook` (via `isTimestampFresh` in `signing.ts`) to mitigate replay of captured (timestamp, signature) pairs.

---

## 1. Scope

This doc covers the `smile_id` adapter at `lib/identity-verification/vendors/smile-id/`. The adapter is internal to the `VerificationVendorAdapter` contract from the parent spec — schema, orchestrator phasing, and webhook dispatcher are untouched.

**Exception in this revision:** §7 and §11 require two new fields on `CreateLivenessSessionInput` (`submittedVendorReference: string | null`, `webhookCallbackUrl: string`) so that the Smile Link request can carry the partner job id minted in `submitDocumentCheck` and the per-request `callback_url` that Smile Links requires. These are additive and remain vendor-agnostic — see **§15 Parent spec dependencies** for the exact diff and the downstream code changes that follow. Without them, the adapter cannot be implemented correctly.

---

## 2. Product choice

For South African provider onboarding Plug A Pro uses **Enhanced Document Verification** (`job_type = 11`) via the **Smile Links** delivery mode.

| Why | Notes |
|---|---|
| Single job covers DHA lookup + document OCR/authenticity + selfie-to-document match + liveness | One webhook callback, one cost line |
| Smile Links delivers the full UX (document capture, selfie, liveness) on Smile's hosted browser flow | Matches the parent spec's session-mode liveness pattern |
| DHA-backed lookup of the SA ID number | Highest assurance available without contracting directly with Home Affairs |

Other Smile ID products (Biometric KYC `1`, Enhanced KYC `5`, Document Verification `6`, SmartSelfie `2`/`4`) are NOT used in v1. They remain available for future flows (e.g., periodic re-verification could use SmartSelfie `2`).

**Why not raw `/v1/upload` REST:** that path requires us to capture 8 liveness frames in our PWA. Plug A Pro does not ship a liveness capture surface. Smile Links delegates the full capture flow to Smile's hosted UI.

---

## 3. Authentication and secrets

Smile ID uses **one shared key for both directions** (outbound request signing AND inbound webhook verification). There is no separate webhook secret.

**Env vars** (replacing the parent spec's tentative list for Smile ID):

| Env var | Purpose |
|---|---|
| `SMILE_ID_PARTNER_ID` | Numeric partner id assigned by Smile. Semi-public — appears in every request body and webhook. |
| `SMILE_ID_API_KEY` | Shared secret. Signs outbound requests AND verifies inbound webhooks. Rotation is bidirectional. |
| `SMILE_ID_BASE_URL` | One of `https://testapi.smileidentity.com` (sandbox) or `https://api.smileidentity.com` (production). Sandbox/prod selection is by URL only — no header switch. |

`SMILE_ID_WEBHOOK_SECRET` from the parent spec's example list is **dropped** — the API key is the secret.

**Outbound signature scheme** (legacy `/v1/*` endpoints — including `/v1/smile_links`):

```
timestamp = ISO-8601 with milliseconds, e.g. "2026-05-26T12:34:56.123Z"
signature = base64( HMAC-SHA256( key = SMILE_ID_API_KEY,
                                  msg = timestamp + SMILE_ID_PARTNER_ID + "sid_request" ) )

POST /v1/smile_links HTTP/1.1
Host: api.smileidentity.com
Content-Type: application/json

{
  "partner_id":   "<SMILE_ID_PARTNER_ID>",
  "timestamp":    "<timestamp>",
  "signature":    "<signature>",
  "source_sdk":   "rest_api",
  "source_sdk_version": "<our adapter version>",
  ... product-specific fields ...
}
```

Signature lives in the **request body**, not in a header. Newer `/v2/*` endpoints (not used by us in v1) use header-based signing — different scheme; do not mix.

**Inbound webhook verification** uses the same recipe with the timestamp Smile sent:

```
expected = base64( HMAC-SHA256( SMILE_ID_API_KEY,
                                 payload.timestamp + SMILE_ID_PARTNER_ID + "sid_request" ) )
signatureValid = timingSafeEqual(expected, payload.signature)
```

The official `smile-identity-core` v3.1.0 SDK provides both signature compute and verify helpers (`Signature.generate_signature` and `Signature.confirm_signature`). The adapter uses `node:crypto` HMAC directly with the same algorithm — `signing.ts` documents the SDK as the reference implementation. This avoids pulling in the SDK's runtime surface (HTTP client, axios, etc.) for what is essentially 30 lines of HMAC.

**Replay-resistance note.** The legacy `/v1/*` in-body HMAC signs only `timestamp + partner_id + "sid_request"` — it does NOT cover the request body. A captured (timestamp, signature) pair could be replayed against a fabricated body. The adapter mitigates this by enforcing a 5-minute timestamp freshness window in `parseSmileWebhook` via `isTimestampFresh` in `signing.ts`; signature validity requires both HMAC match AND a timestamp within the window.

---

## 4. Adapter file layout

```
field-service/lib/identity-verification/vendors/smile-id/
  index.ts                    # SmileIdAdapter; implements VerificationVendorAdapter
  signing.ts                  # HMAC compute + verify
  smile-links-client.ts       # POST /v1/smile_links, PUT /v1/smile_links/{id} (disable)
  parse.ts                    # webhook payload -> ParseWebhookResult
  result-codes.ts             # Smile ResultCode enum + PASS_CODES set
  redact.ts                   # PII redaction for webhook audit
  types.ts                    # Smile-internal request/response types
```

Tests live alongside in `__tests__/lib/identity-verification/vendors/smile-id/` mirroring the file structure.

---

## 5. `submitDocumentCheck` implementation

For Smile-Links-mode vendors, `submitDocumentCheck` is **a logical no-op that registers intent**. It does not call the Smile API yet — the API call happens in `createLivenessSession`, which is where the Smile Link is minted (covering doc + selfie + liveness in one user flow).

```ts
async submitDocumentCheck(input: SubmitDocumentCheckInput): Promise<SubmitDocumentCheckResult> {
  const partnerJobId = generatePartnerJobId()   // see §6
  return {
    vendorReference: partnerJobId,    // partner-side correlation id; held by the orchestrator in memory
                                       // and passed into createLivenessSession as
                                       // submittedVendorReference (this doc §15)
    expectsWebhook: true,
    // immediateResult omitted — Smile is async
  }
}
```

The orchestrator's Phase 2 will then call `createLivenessSession` (because `config.livenessRequired === true` and `immediateResult` is absent). That's where Smile is actually contacted.

**Critical sequencing note:** the orchestrator does NOT stamp `vendorReference` onto the DB row until Phase 3 (parent spec §3.3.1). So `createLivenessSession` cannot read `verification.vendorReference` from the DB — it must receive the value via input. The parent spec's `CreateLivenessSessionInput` gains a `submittedVendorReference: string | null` field carrying `submitResult.vendorReference` (see §15). The Smile adapter uses this value as the `partner_params.job_id` it sends to Smile.

**Parent-spec invariant compliance:** the parent spec's §3.3.1 Phase 2 calls `createLivenessSession` only when `config.livenessRequired && adapter.createLivenessSession && (no immediateResult || sync PASS without livenessVerified)`. Smile ID adapter satisfies this trivially by never returning an `immediateResult`.

---

## 6. Partner job id generation

Smile ID requires `partner_params.job_id` to be **globally unique across all partner jobs forever** — duplicates cause hard 400s. A timestamp suffix is NOT sufficient: two concurrent submissions can land in the same millisecond, and our orchestrator's Phase 1 read + Phase 2 external + Phase 3 commit shape can interleave under load.

```ts
function generatePartnerJobId(): string {
  return `pap-${crypto.randomUUID()}`     // RFC 4122 v4; ~5.3 × 10³⁶ space
}
```

- `pap-` prefix identifies origin (debugging in Smile portal).
- `randomUUID()` provides collision-resistant uniqueness without coupling to verification id, time, or any other source. Retries (admin "Retry with vendor") simply call `generatePartnerJobId()` again — each attempt gets a fresh id.
- The verification id is NOT embedded in the partner job id; it travels in `partner_params.verification_id` instead (preserved across callbacks) — see §7.

The partner job id is stored as `ProviderIdentityVerification.vendorReference`. The Smile-assigned `SmileJobID` (a UUID Smile generates) is stored in the webhook event audit log only — it appears on every callback as `SmileJobID` and is useful for support tickets and the Smile portal UI, but is not the primary lookup key.

**Uniqueness test:** 100,000 concurrent calls to `generatePartnerJobId()` return 100,000 distinct ids (raised from the prior 1,000 — the bar was too low to catch the Date.now() bug).

---

## 7. `createLivenessSession` implementation

```ts
async createLivenessSession(input: CreateLivenessSessionInput): Promise<CreateLivenessSessionResult> {
  // input.submittedVendorReference: partnerJobId from submitDocumentCheck (this doc §15)
  // input.webhookCallbackUrl:        per-request callback URL (this doc §15; Smile Links docs
  //                                  require this field — it is NOT optional)
  // input.verificationId / providerId / returnUrl: as before
  const partnerJobId = input.submittedVendorReference
  if (!partnerJobId) {
    // Orchestrator misuse — Smile Links cannot be minted without a partner job id.
    throw new VendorContractError('smile_id', 'submittedVendorReference required for Smile Links')
  }
  const expiresAt = computeExpiresAt(config)          // see §10 — TTL config

  const body = signedBody({
    partner_id:    SMILE_ID_PARTNER_ID,
    name:          `Plug A Pro — ${input.verificationId}`,
    company_name:  'Plug A Pro',
    id_types: [{
      country: 'ZA',
      id_type: 'IDENTITY_CARD',                       // SA EVD currently only supports IDENTITY_CARD for
                                                       // id_type; broader DocV id-types are not confirmed
                                                       // for EVD. NATIONAL_ID is rejected for ZA on EVD.
      verification_method: 'doc_verification',        // The DocV string. EVD is selected by partner product
                                                       // config in the Smile portal — NOT by passing
                                                       // 'enhanced_document_verification' here.
    }],
    callback_url:  input.webhookCallbackUrl,           // REQUIRED per Smile Links API; do not omit.
                                                       // Portal-level config is a fallback, not a substitute.
    is_single_use: true,
    partner_params: {
      user_id:         input.providerId ?? input.verificationId,  // nested INSIDE partner_params, not top-level
      verification_id: input.verificationId,           // travels back on every callback
      job_id:          partnerJobId,
      job_type:        11,                             // Enhanced Document Verification
    },
    expires_at:    expiresAt.toISOString(),
  })

  const resp = await fetch(`${SMILE_ID_BASE_URL}/v1/smile_links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) throw new VendorApiError('smile_id', resp.status, await resp.text())

  const json = await resp.json()  // { link_url, ref_id, expires_at, ... }

  return {
    vendorReference: json.ref_id,                     // Smile Link id; stored on
                                                       // ProviderIdentityVerification.livenessSessionReference
    sessionUrl:      json.link_url,                    // Response field is `link_url`, NOT `link`.
                                                       // Encrypted at rest by orchestrator.
    expiresAt:       new Date(json.expires_at),
  }
}
```

The orchestrator encrypts `sessionUrl` into `livenessSessionUrlEncrypted` per parent spec §3.1.2.

---

## 8. `parseWebhook` implementation

Smile ID sends ONE callback per Smile Link / job, but may send a non-final interim callback first (`"Under Review"`) followed by a final one. Adapter must distinguish.

```ts
async parseWebhook({ headers, rawBody }): Promise<ParseWebhookResult> {
  const payload = JSON.parse(rawBody)

  // 1. Signature verification (in body, not header — see §3)
  const expected = computeSignature(payload.timestamp)
  const signatureValid = timingSafeEqual(expected, payload.signature)

  // Smile's Enhanced Document Verification (job_type 11) response excerpt in the public docs
  // does NOT consistently include IsFinalResult. Other Smile products (Biometric KYC, Enhanced
  // KYC) do. For EVD specifically, we fall back to "terminal ResultCode" detection: a code
  // in TERMINAL_RESULT_CODES means Smile has finished processing for this job.
  //
  // OPEN ITEM (§14): confirm with Smile whether EVD callbacks always carry IsFinalResult.
  // If they do, the fallback is harmless; if they don't, the fallback is load-bearing.
  //
  // NOTE: per the smile-identity-core SDK, IsFinalResult is delivered as a STRING ("true" /
  // "false"), not a boolean. The parser accepts both forms (boolean true, string "true").
  const isFinal: boolean =
       payload.IsFinalResult === true
    || payload.IsFinalResult === 'true'
    || isTerminalResultCode(payload.ResultCode)
  const eventType = isFinal ? 'final' : 'interim'

  // 2. Identifiers
  const partnerJobId   = payload.PartnerParams?.job_id ?? null
  const smileJobId     = payload.SmileJobID ?? null
  const refId          = payload.ref_id ?? payload.PartnerParams?.ref_id ?? null

  // 3. Payload hash (pre-redaction, deterministic)
  const payloadHash = sha256(canonical(payload))

  // 4. Redacted payload for audit
  const redactedPayload = redactSmilePayload(payload)   // see §9

  // 5. Result — only on final callbacks; interim returns null per parent spec
  let result: NormalizedVerificationResult | null = null
  if (isFinal) {
    result = {
      decision: deriveDecision(payload.ResultCode),                  // see §8.1
      confidence: deriveBinaryConfidence(payload),                   // see §8.2
      documentConfidence: null,                                       // Smile doesn't expose numerics
      livenessScore: null,
      livenessVerified: deriveLivenessVerified(payload.Actions),     // see §8.3
      selfieMatchScore: null,
      riskFlags: deriveRiskFlags(payload),                            // see §8.4
      reasonCode: deriveReasonCode(payload.ResultCode, payload.Actions),
      vendorReference: partnerJobId,                                  // our partner_job_id
      expiresAt: null,                                                // Smile verifications don't carry vendor TTL
    }
  }

  return {
    signatureValid,
    vendorEventId: null,                                              // Smile has no stable event id
    vendorReference: partnerJobId,                                    // matches what we stamped on submit
    livenessSessionReference: refId,                                  // matches what we stamped on liveness session
    eventType,                                                        // 'final' or 'interim' — drives idempotency
    payloadHash,
    redactedPayload,
    result,
  }
}
```

### 8.1 `deriveDecision(resultCode)`

Smile's `ResultCode` is a 4-digit string. The mapping below uses **Enhanced Document Verification (job_type 11) codes** — these differ from Enhanced KYC (job_type 5) codes. The earlier draft of this doc used `1012` / `1020` which are the Enhanced KYC codes and would have produced FALSE NEGATIVES at runtime (real PASS responses mapped to INCONCLUSIVE).

| EVD `ResultCode` | Meaning | Maps to |
|---|---|---|
| `0810` | Document Verified — approved | `PASS` |
| `0811` | Document not verified | `FAIL` |
| `0812` | Selfie does not match ID | `FAIL` |
| `0816` | Multiple authenticity checks failed | `FAIL` |
| `1014` | Unsupported ID number format (also fires on sandbox data hitting prod) | `FAIL` (REJECTED) |
| Any other `0813`–`0820` | EVD-specific quality / processing failures | `FAIL` |
| Any other `08xx` (unmapped) | Unmapped EVD code | `INCONCLUSIVE` |
| Anything else | Unmapped global code | `INCONCLUSIVE` |

The PASS set lives in `result-codes.ts` as a frozen Set:

```ts
export const SMILE_ID_EVD_PASS_RESULT_CODES: ReadonlySet<string> = new Set(['0810'])

export const SMILE_ID_EVD_FAIL_RESULT_CODES: ReadonlySet<string> = new Set([
  '0811', '0812', '0816',
  '1014',                          // Unsupported ID number format — REJECTED, not inconclusive.
])

// "Terminal" = Smile has finished processing for the job, regardless of outcome.
// Used by the IsFinalResult fallback in §8.
export const SMILE_ID_EVD_TERMINAL_RESULT_CODES: ReadonlySet<string> = new Set([
  ...SMILE_ID_EVD_PASS_RESULT_CODES,
  ...SMILE_ID_EVD_FAIL_RESULT_CODES,
])
```

`deriveDecision` returns `'PASS'` if `code in SMILE_ID_EVD_PASS_RESULT_CODES`, `'FAIL'` if in `SMILE_ID_EVD_FAIL_RESULT_CODES` (which now includes `1014`), else the unmapped fallback above. **The full EVD ResultCode list at the Smile EVD page should be reviewed before stage-2 rollout; a unit test asserts every documented EVD code has a mapping, and `npm run check:smile-id-codes` (a small script under `scripts/`) re-fetches the result-code page and warns on diffs.**

Other Smile products (Enhanced KYC `5` uses `1020`/`1021`/`1022`; Biometric KYC `1` uses its own table) are out of scope for v1; their codes are not in `result-codes.ts`. When/if those products are added, separate `SMILE_ID_BKYC_*` / `SMILE_ID_EKYC_*` sets should be introduced rather than merging into the EVD set.

### 8.2 `deriveBinaryConfidence(payload)`

Smile ID does not expose a numeric confidence score (`ConfidenceValue` is deprecated). To remain compatible with the parent spec's threshold-based decision matrix (§3.3.3), the adapter synthesises a binary confidence:

```ts
function deriveBinaryConfidence(payload: SmilePayload): number {
  const isPass = SMILE_ID_EVD_PASS_RESULT_CODES.has(payload.ResultCode)
  // IsFinalResult may be boolean true or string "true" (smile-identity-core SDK delivers as string).
  const isFinal =
       payload.IsFinalResult === true
    || payload.IsFinalResult === 'true'
    || isTerminalResultCode(payload.ResultCode)
  const livenessPassed = payload.Actions?.Liveness_Check === 'Passed'

  return (isPass && isFinal && livenessPassed) ? 1.0 : 0.0
}
```

With this synthesis and the default `confidenceThreshold = 0.9` from parent spec §3.1.5:

- A real Smile PASS arrives → `confidence = 1.0` → `1.0 >= 0.9` → orchestrator routes `PASSED`.
- Anything else → `confidence = 0.0` → `0.0 < 0.9` → orchestrator routes `NEEDS_MANUAL_REVIEW`.

The threshold mechanism still works; for Smile ID specifically, its only meaningful values are `0.0` and `1.0`. Operators are advised in `VerificationVendorConfig.configJson` to leave `confidenceThreshold` at default for Smile ID. **The metrics distribution `identity_verification.vendor.confidence{vendor=smile_id}` will be bimodal; this is correct behavior, not a bug.**

### 8.3 `deriveLivenessVerified(actions)`

```ts
function deriveLivenessVerified(actions: SmileActions | undefined): boolean | null {
  if (!actions?.Liveness_Check) return null
  switch (actions.Liveness_Check) {
    case 'Passed':         return true
    case 'Failed':         return false
    case 'Under Review':   return null    // intermediate; parent spec treats as ambiguous
    case 'Not Applicable': return null    // means liveness wasn't run (shouldn't happen for our flow)
    default:                return null
  }
}
```

This is the field the parent spec's `applyVendorVerdict` liveness-required pre-check reads (§3.3.3). A PASS verdict with `livenessVerified !== true` AND `config.livenessRequired === true` routes to `NEEDS_MANUAL_REVIEW` per the safety net, OR creates a new liveness session per the automation lift (Phase 2 in parent §3.3.1).

### 8.4 `deriveRiskFlags(payload)`

Compose from `Actions.Document_Check`, `Actions.Verify_Document`, `IDStatus`, `IsAlive`. Map to our metrics whitelist enum:

| Smile signal | Risk flag (enum value in `lib/identity-verification/metrics.ts`) |
|---|---|
| `IDStatus === 'Expired'` | `ID_EXPIRED` |
| `IsAlive === false` | `SUBJECT_DECEASED` |
| `Actions.Document_Check === 'Failed'` | `DOCUMENT_FAILED_AUTHENTICITY` |
| `Actions.Verify_Document === 'Failed'` | `DOCUMENT_OCR_MISMATCH` |
| `Actions.Selfie_To_ID_Card_Compare === 'Failed'` | `SELFIE_NOT_MATCHING_DOCUMENT` |

The risk-flag enum is the same one used across all vendor adapters and is part of the parent spec's metrics whitelist (§3.5).

---

## 9. PII redaction (`redactSmilePayload`)

Smile's webhook payloads — particularly for Enhanced KYC and Enhanced Document Verification — embed PII directly. The adapter MUST redact before persisting to `ProviderVerificationWebhookEvent.rawPayloadRedacted`.

**Fields stripped to `'[REDACTED]'`** before persistence:

- `Photo` (base64-encoded DHA photo — most important to strip; can be tens of KB)
- `ImageLinks` (signed URLs to user-captured selfie/document images — short-lived but still PII pointers)
- `KYCReceipt` (Smile's signed receipt; can contain decoded ID payload)
- `FullName`, `FirstName`, `LastName`, `MiddleName`
- `DOB`
- `IDNumber`, `SecondaryIDNumber` (e.g., refugee number on the same record)
- `Gender`
- `IssuanceDate`, `ExpirationDate` (when paired with name/DOB these are re-identifiable)
- `Address`, `PhoneNumber`, `Email`
- `Nationality`, `Country` (low-PII but redacted by default; reviewer can de-redact case-by-case from the Smile portal)
- Any field whose key matches `/^(id_number|secondary_id|dob|name|photo|address|phone|email|image_link|kyc_receipt|gender|expiration|issuance)/i`

**Fields preserved** (safe for audit and admin display):

- `SmileJobID`, `PartnerParams.*`, `ref_id`
- `ResultCode`, `ResultText`, `ResultType`, `IsFinalResult`
- `Actions.*` (each is a string enum — no PII)
- `timestamp`
- `source_sdk`, `source_sdk_version`
- `signatureValid: boolean` (computed by us; written to the webhook event row's own column — see parent spec §3.1.4)

**Not preserved:** the raw `signature` field is dropped after verification — it is HMAC over `timestamp + partner_id + "sid_request"` and is not useful in the audit log once `signatureValid` has been recorded. Keeping it has no operational value and creates a forensic foot-gun (if `API_KEY` rotates, old signatures look "wrong" against the new key when reviewers spot-check).

The redaction function is exhaustively tested with golden payloads from Smile's sandbox: a known PII-rich payload goes in, and the test asserts none of the literal PII strings (a fixture name, ID number, photo prefix, etc.) appear anywhere in the JSON serialisation of `rawPayloadRedacted`.

---

## 10. Smile Link TTL configuration

`VerificationVendorConfig.configJson` for `smile_id`:

```jsonc
{
  "displayName": "Smile ID",
  "expectedTurnaroundMinutes": 5,
  "smileLinkTtlMinutes": 60,              // user has 60 minutes from link creation to complete capture
  "passResultCodes": ["0810"],            // EVD codes; mirrors SMILE_ID_EVD_PASS_RESULT_CODES in result-codes.ts
  "rejectResultCodes": ["0811", "0812", "0816", "1014"],  // 1014 is REJECTED (unsupported ID number format), not inconclusive
  "inconclusiveResultCodes": []
}
```

`computeExpiresAt(config)` in §7 reads `smileLinkTtlMinutes`. Default 60 minutes is a reasonable balance (Smile Links permit much longer, up to 90 days; we keep it tight for security).

---

## 11. `callback_url` constraint

Smile Links treats `callback_url` as a **required field** on `POST /v1/smile_links`. The portal-level fallback is exactly that — a fallback for misconfigured links, not a substitute for sending the field. Earlier versions of this doc assumed the field was optional; that assumption was wrong and would produce `callback_url required` 400s at link mint time.

**Plug A Pro configuration:**

- The adapter sends `callback_url = input.webhookCallbackUrl` on every `POST /v1/smile_links` call (see §7).
- `input.webhookCallbackUrl` is computed by the orchestrator and passed via `CreateLivenessSessionInput.webhookCallbackUrl` — a parent-spec interface addition; see §15.
- Per-environment values:
  - sandbox: `https://staging.plugapro.co.za/api/webhooks/verification/smile_id`
  - production: `https://app.plugapro.co.za/api/webhooks/verification/smile_id`
- The Smile portal callback URL is set to the same per-environment value as a defence-in-depth fallback.

**Why per-request beats portal-only:** sandbox/production isolation. If a sandbox link were ever minted from a production deploy by mistake, portal-only routing would send the callback to production's webhook handler, where the verification id wouldn't resolve and we'd log a `verificationId=null` row. Per-request `callback_url` keeps the routing explicit and makes the misconfiguration impossible to perform silently.

**Verification:** an integration test in staging asserts that a sandbox Smile Link round-trip lands at the staging webhook route. The test is part of stage 1 of the rollout sequence in parent spec §5.

---

## 12. `cancelVerificationJob` implementation

```ts
async cancelVerificationJob(input: CancelVerificationJobInput): Promise<CancelVerificationJobResult> {
  if (!input.livenessSessionReference) {
    // No Smile Link to cancel — pure /v1/upload jobs cannot be cancelled at Smile ID.
    // The verification has been recorded as withdrawn locally; any late callback will be
    // logged but not applied (parent spec §3.4 step 7 handles unknown-reference 200s).
    return { supported: false, vendorAcknowledged: false }
  }

  // Smile Links disable endpoint per public docs:
  //   PUT /v1/smile_links/:linkId   with body { is_disabled: true }
  // The earlier draft of this doc said PATCH + is_single_use_completed: true — both wrong
  // (would either 405 on the method or be ignored on the body).
  const body = signedBody({
    partner_id:  SMILE_ID_PARTNER_ID,
    is_disabled: true,
  })

  const resp = await fetch(
    `${SMILE_ID_BASE_URL}/v1/smile_links/${input.livenessSessionReference}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )

  return {
    supported: true,
    vendorAcknowledged: resp.ok,
  }
}
```

**Important constraint:** for verifications that had a Smile Link, cancellation works. For verifications that somehow ended up with only a `vendorReference` (partner job id) and no `livenessSessionReference` (Smile Link `ref_id`), cancellation returns `{ supported: false }` — and the parent spec's admin action queues an `AdminAuditEvent` for manual follow-up (parent §3.7.3 cancel action notes).

In v1, the only path that creates a verification without a Smile Link is the admin "Retry with vendor" action that fails before Phase 2 completes. This is a narrow edge case.

---

## 13. Required tests (adapter-specific)

In addition to the generic adapter tests in parent spec §6.1:

| Test | Asserts |
|---|---|
| Signature compute & verify (round-trip) | Outbound signature on a known payload + key matches a fixture; inbound signature on a Smile-shaped callback verifies. |
| `parseWebhook` with `IsFinalResult: false` AND non-terminal `ResultCode` | Returns `result: null`, `eventType: 'interim'`. Dispatcher treats as informational (parent spec §3.4). |
| `parseWebhook` with `IsFinalResult` absent AND terminal `ResultCode: '0810'` | Treats as final via the terminal-code fallback (§8); returns a fully-formed verdict. |
| `parseWebhook` with `IsFinalResult: true` and `ResultCode: '0810'` and `Actions.Liveness_Check: 'Passed'` | Returns `decision: 'PASS'`, `confidence: 1.0`, `livenessVerified: true`. |
| `parseWebhook` with `IsFinalResult: true` and `ResultCode: '0810'` but `Actions.Liveness_Check: 'Failed'` | Returns `decision: 'PASS'`, `confidence: 0.0`, `livenessVerified: false`. Orchestrator's pre-check then overrides to `NEEDS_MANUAL_REVIEW` per parent spec. |
| `parseWebhook` with `ResultCode: '0811'` | Returns `decision: 'FAIL'`. |
| `parseWebhook` with `ResultCode: '0812'` (selfie mismatch) | Returns `decision: 'FAIL'`. |
| `parseWebhook` with `ResultCode: '0816'` | Returns `decision: 'FAIL'`. |
| `parseWebhook` with `ResultCode: '1014'` | Returns `decision: 'FAIL'` (REJECTED — unsupported ID number format). |
| `parseWebhook` with unmapped EVD code | Returns `decision: 'INCONCLUSIVE'`. Unit test asserts all documented EVD codes have a mapping (`scripts/check-smile-id-codes` runs in CI). |
| `parseWebhook` idempotency: interim then final | Two distinct rows in `ProviderVerificationWebhookEvent` (different `eventType` → different `idempotencyKey`); only the final triggers a verdict transition. |
| `parseWebhook` idempotency: same payload retried | Same `idempotencyKey`, second insert hits unique violation, reprocess path runs only if first `processedAt = null`. |
| Redaction strips `Photo`, `ImageLinks`, `KYCReceipt`, `FullName`, `DOB`, `IDNumber`, `SecondaryIDNumber`, `Gender`, `IssuanceDate`, `ExpirationDate`, `Address` | Golden payload test; `rawPayloadRedacted` does not contain any of those literals. |
| Redaction drops raw `signature` | `rawPayloadRedacted` has no `signature` key; only `signatureValid` survives in the event row's own column. |
| Redaction preserves `SmileJobID`, `PartnerParams.*`, `ResultCode`, `Actions.*` | Same golden payload; those fields are present. |
| `createLivenessSession` uses `input.submittedVendorReference` as `partner_params.job_id` | Mocked Smile API; outbound body has `partner_params.job_id === input.submittedVendorReference`. |
| `createLivenessSession` throws when `input.submittedVendorReference` is null | `VendorContractError` raised; no HTTP call made. |
| `createLivenessSession` includes `callback_url: input.webhookCallbackUrl` | Outbound body has `callback_url` matching the input; no portal-fallback assumption. |
| `createLivenessSession` uses `id_type: 'IDENTITY_CARD'` for `country: 'ZA'` | Body assertion; `NATIONAL_ID` would be rejected by EVD. |
| `createLivenessSession` mints a Smile Link | Outbound body contains `partner_id`, `signature`, `is_single_use: true`, `partner_params.job_type: 11`. |
| `cancelVerificationJob` with `livenessSessionReference` | Outbound is `PUT /v1/smile_links/{id}` with body `{ is_disabled: true, partner_id, signature, timestamp }`. |
| `cancelVerificationJob` without `livenessSessionReference` | Returns `{ supported: false }` without any HTTP call. |
| Partner job id uniqueness | 100,000 concurrent calls to `generatePartnerJobId()` return 100,000 distinct ids. |

---

## 14. Open items to verify with Smile ID directly

These are not in the public docs and need confirmation. Items 1, 6, 7 are blockers for stage-1; items 2-5 for stage-2.

1. **`IsFinalResult` presence on EVD callbacks.** Public EVD return-value excerpts do NOT include this field; the parent doc's `IsFinalResult === true` gating is replaced in §8 with a fallback to terminal-result-code detection (`SMILE_ID_EVD_TERMINAL_RESULT_CODES`). Must confirm whether EVD callbacks always include `IsFinalResult`; if so, the fallback is harmless; if not, the fallback is load-bearing and the test for "absent IsFinalResult + terminal code → treated as final" is critical.
2. **Webhook retry schedule and total retention window.** Stated as "exponential backoff over ~24 hours" but exact schedule not documented.
3. **Sustained throughput limits.** Sandbox observed at ~10 RPS; production limits should be confirmed in writing.
4. **SA data-residency story.** Smile is global; need confirmation that SA data isn't routed via US/EU clusters in a way that breaks POPIA.
5. **Commercial unit pricing** for `job_type = 11` in SA. Determines whether per-verification cost makes Enhanced Document Verification economical vs splitting into `5` + `6`.
6. **Exact EVD result-code list.** The mapping in §8.1 includes the codes confirmed in review (0810, 0811, 0812, 0816, 1014) but may be incomplete. `scripts/check-smile-id-codes` should compare the live result-code reference page against `result-codes.ts` in CI.
7. **`PUT /v1/smile_links/:linkId` body shape.** Confirmed via Smile Links docs as `{ is_disabled: true }` but field-level validation (does Smile accept a body with `partner_id` + `signature` + `timestamp` alongside `is_disabled`?) needs a sandbox smoke test before relying on this in production withdrawal flows.

---

## 15. Parent spec dependencies (introduced by this revision)

This revision can't be implemented as-is against the current parent spec at `2026-05-26-provider-agnostic-identity-verification-design.md` and the matching code in `field-service/lib/identity-verification/`. The following changes are required and should land in the same PR as the corrected adapter doc.

### 16.1 `CreateLivenessSessionInput` — two new required fields

`field-service/lib/identity-verification/vendors/types.ts:50`:

```diff
 export type CreateLivenessSessionInput = {
   verificationId: string
   providerId: string | null
   returnUrl: string
+  submittedVendorReference: string | null   // from preceding submitDocumentCheck().vendorReference;
+                                            // adapters that need the partner-side job id at link-mint
+                                            // time read it here. Null only when the orchestrator calls
+                                            // createLivenessSession without a preceding submit
+                                            // (currently impossible per parent spec §3.3.1).
+  webhookCallbackUrl: string                // per-request callback URL. Required because some vendors
+                                            // (e.g., Smile Links) reject requests that omit it; portal-
+                                            // level config is fallback only.
 }
```

Parent spec **§3.2.2** must mirror this in the `CreateLivenessSessionInput` block.

### 16.2 Orchestrator — pass the values in

`field-service/lib/identity-verification/orchestrator.ts:172`:

```diff
       livenessResult = await adapter.createLivenessSession({
         verificationId,
         providerId: snapshot.providerId,
         returnUrl: documentInput.livenessReturnUrl,
+        submittedVendorReference: submitResult.vendorReference,
+        webhookCallbackUrl: documentInput.webhookCallbackUrl,
       })
```

The orchestrator already holds `submitResult` in scope (`orchestrator.ts:166`) and `documentInput.webhookCallbackUrl` (built from `buildSubmitDocumentInput`); no other plumbing changes are needed.

### 16.3 Adapter stubs and tests — extend signature

Every existing adapter implementation (`manual`, `mock`, `smile_id`-scaffold, `thisisme`/`datanamix`/`omnicheck` stubs) must accept the new fields in their `createLivenessSession` signature. Adapters that don't need them can ignore them; the change is purely additive at the type level.

Test fixtures that construct `CreateLivenessSessionInput` directly need the two new fields added. Search: `grep -r "CreateLivenessSessionInput" field-service/`.

### 16.4 No schema change, no migration

The values flow in memory only — they do not need to be persisted to `ProviderIdentityVerification`. The orchestrator already stamps `vendorReference` in Phase 3 from `submitResult.vendorReference`; `webhookCallbackUrl` is environment-derived and need not be persisted.

### 16.5 Rollout

These are blocking changes — the Smile ID adapter cannot be implemented correctly without them. They should ship in the same PR as this corrected adapter doc, ahead of any sandbox round-trip testing.

---

## 16. References

- Smile ID docs: https://docs.usesmileid.com/
- Smile Links REST API: https://docs.usesmileid.com/integration-options/no-code/smile-links/rest-api
- Enhanced Document Verification: https://docs.usesmileid.com/products/for-individuals-kyc/document-verification/enhanced-document-verification
- Result codes: https://docs.usesmileid.com/further-reading/result-codes
- Signing requests: https://docs.usesmileid.com/integration-options/rest-api/signing-your-api-request/generate-signature
- SA National ID supported test data: https://docs.usesmileid.com/supported-id-types/for-individuals-kyc/backed-by-id-authority/test-data/customising-sandbox-test-data
- Node SDK (reference implementation): https://github.com/smileidentity/smile-identity-core-js
