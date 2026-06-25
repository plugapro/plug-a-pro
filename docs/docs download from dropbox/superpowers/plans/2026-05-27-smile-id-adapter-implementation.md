# Smile ID Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaffolded `smile-id.ts` adapter with a fully-functional Smile ID integration for South African individual KYC via Enhanced Document Verification (`job_type=11`) over Smile Links, covering submission, hosted liveness, webhook ingestion, idempotent decision derivation, cancellation, and PII redaction — ready for stage-1 sandbox round-trip.

**Architecture:** Single adapter under `field-service/lib/identity-verification/vendors/smile-id/` split into seven focused modules (`index.ts` is the `VerificationVendorAdapter` implementation; `signing.ts`, `smile-links-client.ts`, `parse.ts`, `result-codes.ts`, `redact.ts`, `types.ts` are support). The adapter wraps the official `smile-identity-core` Node SDK for HMAC and request transport, but parses webhook payloads ourselves so we can normalise into `NormalizedVerificationResult`. All API calls go through Smile Links — pure `/v1/upload` is out of scope because Plug A Pro does not ship a liveness capture surface.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Vitest, `smile-identity-core` v3.1.0 (Smile's official Node SDK), Node ≥ 18 `crypto` for additional verification, the existing provider-agnostic identity verification framework.

**Scope:** Individual KYC only. Business KYC products (Business Registration, AML add-ons) are explicitly out of scope. Only `job_type = 11` (Enhanced Document Verification) is wired in v1.

---

## Source Map

These are the files the plan reads, modifies, or creates. Listed once here so an engineer executing the plan has the inventory upfront.

**Reads (existing context):**
- `docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md` — adapter design reference; treat as source of truth for behavior
- `docs/superpowers/specs/2026-05-26-provider-agnostic-identity-verification-design.md` — parent vendor-agnostic spec
- `field-service/lib/identity-verification/vendors/types.ts` — `VerificationVendorAdapter` interface
- `field-service/lib/identity-verification/orchestrator.ts` — three-phase orchestrator the adapter is called from
- `field-service/lib/identity-verification/vendors/registry.ts` — adapter registry
- `field-service/lib/identity-verification/vendors/mock.ts` — reference implementation patterns
- `field-service/lib/identity-verification/vendors/manual.ts` — reference

**Creates (new files):**
- `field-service/lib/identity-verification/vendors/smile-id/index.ts`
- `field-service/lib/identity-verification/vendors/smile-id/signing.ts`
- `field-service/lib/identity-verification/vendors/smile-id/smile-links-client.ts`
- `field-service/lib/identity-verification/vendors/smile-id/parse.ts`
- `field-service/lib/identity-verification/vendors/smile-id/result-codes.ts`
- `field-service/lib/identity-verification/vendors/smile-id/redact.ts`
- `field-service/lib/identity-verification/vendors/smile-id/types.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/signing.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/redact.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/parse.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/smile-links-client.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts`
- `field-service/__tests__/lib/identity-verification/vendors/smile-id/sandbox-roundtrip.test.ts` (opt-in)
- `field-service/scripts/check-smile-id-codes.ts`

**Modifies:**
- `field-service/lib/identity-verification/vendors/registry.ts` (import path after restructure)
- `field-service/__tests__/lib/identity-verification/vendors.test.ts` (existing smile-id tests; consolidate or delete)
- `field-service/scripts/seed-verification-vendors.ts` (`configJson` for smile_id)
- `field-service/package.json` (add `smile-identity-core` dependency)
- `docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md` (apply 7 corrections discovered in 2026-05-27 doc-research pass)

**Deletes:**
- `field-service/lib/identity-verification/vendors/smile-id.ts` (replaced by the subdirectory)

---

## Decisions baked in from 2026-05-27 doc-research pass

The earlier adapter spec had several plausible-but-unverified assumptions. The research pass corrected them; the plan tasks below reflect the corrections:

| Decision | Earlier (wrong) | Now (right) | Source |
|---|---|---|---|
| Smile Links response field | `json.link` | `json.link_url` | Smile Links REST API page |
| `user_id` placement in request | top-level field | nested inside `partner_params` | Smile Links REST API example |
| `verification_method` for EVD | `enhanced_document_verification` | **unverified** — best guess `doc_verification`; verified via Task 2 sandbox probe | Public docs show `doc_verification` / `biometric_kyc` only |
| `1014` ResultCode | `INCONCLUSIVE` | `FAIL` (rejected — "Unsupported ID number format") | Smile result-codes page |
| `IsFinalResult` type | boolean | **string** `"true"` / `"false"` | smile-identity-core source |
| Signing algorithm | hand-rolled HMAC in `smile-id.ts` (uses `SMILE_ID_WEBHOOK_SECRET` env that we are deleting) | use `smile-identity-core` SDK's `Signature` class | smile-identity-core v3.1.0 |

`SMILE_ID_WEBHOOK_SECRET` is removed entirely; `SMILE_ID_API_KEY` signs both directions per adapter spec §3.

---

## Task 1: Pre-flight and worktree setup

**Files:**
- Read: `docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md`
- Read: `field-service/lib/identity-verification/vendors/types.ts`

- [ ] **Step 1: Confirm PR #11 merged**

Run: `gh pr view 11 --json state,mergedAt`
Expected: `state: MERGED`. If not merged, **stop** — this plan depends on `feature/verifications-sidebar-link` being on `main`.

- [ ] **Step 2: Create isolated worktree off latest main**

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro"
git fetch origin
git worktree add .worktrees/smile-id-adapter -b feature/smile-id-adapter-integration origin/main
cd .worktrees/smile-id-adapter/field-service
pnpm install
pnpm db:generate
```

Expected: Prisma client generates successfully; no install errors.

- [ ] **Step 3: Run baseline focused tests**

```bash
pnpm vitest run \
  __tests__/lib/identity-verification/vendors.test.ts \
  __tests__/lib/identity-verification/orchestrator.test.ts
```

Expected: all tests pass. If they don't, the merge of PR #11 left a regression; stop and investigate.

- [ ] **Step 4: Commit no code**

Setup-only; nothing to commit yet.

---

## Task 2: Sandbox verification probe (one-time, manual)

**Files:**
- Create (working notes only): `docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md`

This is the only manual task — it captures Smile sandbox behavior for items the public docs leave unverified (per the 2026-05-27 research pass). Skipping it means later tasks rely on educated guesses that will likely cause sandbox round-trip failures.

**Required before starting:** Smile portal account with sandbox `SMILE_ID_PARTNER_ID` + `SMILE_ID_API_KEY` issued, and an HTTPS tunnel to a local `/api/webhooks/verification/smile_id` endpoint (use `ngrok http 3000` or a Vercel preview).

- [ ] **Step 1: Mint a Smile Link with each candidate `verification_method` string**

For each candidate value `"doc_verification"`, `"enhanced_document_verification"`, `"enhanced_doc_verification"`:

```bash
curl -sS -X POST https://testapi.smileidentity.com/v1/smile_links \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "partner_id":   "<SANDBOX_PARTNER_ID>",
  "timestamp":    "<ISO-8601>",
  "signature":    "<computed via SDK Signature helper>",
  "name":         "Plug A Pro EVD probe",
  "company_name": "Plug A Pro",
  "id_types": [{
    "country": "ZA",
    "id_type": "IDENTITY_CARD",
    "verification_method": "<CANDIDATE>"
  }],
  "callback_url": "<NGROK_URL>/api/webhooks/verification/smile_id",
  "is_single_use": true,
  "partner_params": {
    "user_id": "probe-user",
    "job_id":  "probe-job-<RANDOM_UUID>",
    "job_type": 11
  },
  "expires_at": "<ISO-8601 +1h>"
}
EOF
```

Record which candidate string returns 2xx with a `link_url`. The 4xx responses (with error JSON) also matter — capture them.

- [ ] **Step 2: Complete one sandbox EVD flow end-to-end with a "PASS" test ID**

Open the returned `link_url`, complete document + selfie + liveness, wait for the callback. Capture:
- Full callback JSON (sanitised — strip real values, keep keys and types).
- Whether `IsFinalResult` is present and its type (string vs boolean).
- Whether `ResultType` is present.
- Full `Actions` key list.
- All extracted-ID field names and their placement (top-level vs nested in `Personal_Info`).
- The exact `ResultCode` for a clean EVD pass (likely `0810`, but confirm).

- [ ] **Step 3: Repeat with a "REJECTED" test ID and a "PROVISIONALLY APPROVED" test ID**

Capture the result codes for each. Confirm whether provisional results carry `IsFinalResult: "false"` and whether a final callback follows.

- [ ] **Step 4: Probe PUT /v1/smile_links/:ref_id with body variants**

```
A) { "is_disabled": true }
B) { "is_disabled": true, "partner_id": "...", "timestamp": "...", "signature": "..." }
```

Try both. Capture status codes, response body shapes, and Smile portal effect (link should be marked disabled). Record which body shape Smile accepts.

- [ ] **Step 5: Capture intentional 4xx error responses**

POST with deliberately malformed bodies (missing `signature`, missing `callback_url`, invalid `id_type`, duplicate `partner_params.job_id`). Record the JSON error shape Smile returns.

- [ ] **Step 6: Write findings to a notes file**

```bash
mkdir -p docs/superpowers/notes
$EDITOR docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md
```

Include the candidate that worked, the exact callback shape, ResultCodes observed, PUT body shape, and 4xx shape. This file is the source of truth for downstream tasks.

- [ ] **Step 7: Commit the notes**

```bash
git add docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md
git commit -m "docs(smile-id): capture sandbox probe findings"
```

Expected: a new commit on the branch with the verification findings; downstream tasks refer to this file when the public docs are ambiguous.

---

## Task 3: Install smile-identity-core SDK

**Files:**
- Modify: `field-service/package.json`
- Modify: `field-service/pnpm-lock.yaml` (auto-updated)

- [ ] **Step 1: Add dependency**

```bash
cd field-service
pnpm add smile-identity-core@^3.1.0
```

Expected: `package.json` gets `"smile-identity-core": "^3.1.0"` under `dependencies`; lockfile updates.

- [ ] **Step 2: Run typecheck to confirm no install corruption**

```bash
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add field-service/package.json field-service/pnpm-lock.yaml
git commit -m "chore(deps): add smile-identity-core 3.1.0"
```

---

## Task 4: Restructure smile-id.ts into subdirectory

**Files:**
- Move: `field-service/lib/identity-verification/vendors/smile-id.ts` → `field-service/lib/identity-verification/vendors/smile-id/index.ts`
- Modify: `field-service/lib/identity-verification/vendors/registry.ts` (no import path change — resolution still works)

- [ ] **Step 1: Move the existing file**

```bash
cd field-service
mkdir -p lib/identity-verification/vendors/smile-id
git mv lib/identity-verification/vendors/smile-id.ts lib/identity-verification/vendors/smile-id/index.ts
```

Expected: file moved; Node module resolution still finds `./smile-id` from `registry.ts` because directories with `index.ts` resolve identically to a file.

- [ ] **Step 2: Verify imports still resolve**

```bash
pnpm tsc --noEmit
```

Expected: clean. No import path changes needed in `registry.ts` or tests.

- [ ] **Step 3: Run existing smile-id tests**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors.test.ts
```

Expected: pass (these test the scaffolded throws and existing webhook parsing — still valid against the moved file).

- [ ] **Step 4: Commit**

```bash
git add -A lib/identity-verification/vendors/smile-id
git commit -m "refactor(smile-id): migrate to subdirectory layout"
```

---

## Task 5: Build `result-codes.ts` (PASS/FAIL/TERMINAL sets + derivation helpers)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/result-codes.ts`
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `field-service/__tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  SMILE_ID_EVD_FAIL_RESULT_CODES,
  SMILE_ID_EVD_TERMINAL_RESULT_CODES,
  isTerminalResultCode,
  deriveDecision,
} from '../../../../../lib/identity-verification/vendors/smile-id/result-codes'

describe('Smile ID EVD result codes', () => {
  it('PASS set contains 0810', () => {
    expect(SMILE_ID_EVD_PASS_RESULT_CODES.has('0810')).toBe(true)
  })

  it('FAIL set contains 0811, 0812, 0816, 1014', () => {
    for (const code of ['0811', '0812', '0816', '1014']) {
      expect(SMILE_ID_EVD_FAIL_RESULT_CODES.has(code)).toBe(true)
    }
  })

  it('TERMINAL set is the union of PASS and FAIL', () => {
    for (const code of ['0810', '0811', '0812', '0816', '1014']) {
      expect(SMILE_ID_EVD_TERMINAL_RESULT_CODES.has(code)).toBe(true)
    }
  })

  it('isTerminalResultCode returns true for terminal codes', () => {
    expect(isTerminalResultCode('0810')).toBe(true)
    expect(isTerminalResultCode('1014')).toBe(true)
  })

  it('isTerminalResultCode returns false for unknown codes', () => {
    expect(isTerminalResultCode('9999')).toBe(false)
    expect(isTerminalResultCode(undefined)).toBe(false)
    expect(isTerminalResultCode(null)).toBe(false)
  })

  describe('deriveDecision', () => {
    it('maps 0810 to PASS', () => {
      expect(deriveDecision('0810')).toBe('PASS')
    })

    it('maps 0811, 0812, 0816, 1014 to FAIL', () => {
      expect(deriveDecision('0811')).toBe('FAIL')
      expect(deriveDecision('0812')).toBe('FAIL')
      expect(deriveDecision('0816')).toBe('FAIL')
      expect(deriveDecision('1014')).toBe('FAIL')
    })

    it('maps unknown codes to INCONCLUSIVE', () => {
      expect(deriveDecision('9999')).toBe('INCONCLUSIVE')
      expect(deriveDecision(undefined)).toBe('INCONCLUSIVE')
      expect(deriveDecision(null)).toBe('INCONCLUSIVE')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts
```

Expected: FAIL with module-not-found error.

- [ ] **Step 3: Implement result-codes.ts**

Create `field-service/lib/identity-verification/vendors/smile-id/result-codes.ts`:

```typescript
import type { NormalizedVerificationDecision } from '../types'

// Smile ID Enhanced Document Verification (job_type=11) result codes.
// Source: docs.usesmileid.com/further-reading/result-codes
// Verified against sandbox in 2026-05-27 probe; see
// docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md.

export const SMILE_ID_EVD_PASS_RESULT_CODES: ReadonlySet<string> = new Set([
  '0810',  // Document Verified — approved
])

export const SMILE_ID_EVD_FAIL_RESULT_CODES: ReadonlySet<string> = new Set([
  '0811',  // Unable to verify document (selfie/photo mismatch, liveness fail, missing security)
  '0812',  // Unable to verify document (not classified / invalid document image)
  '0816',  // Unable to verify document — unsupported document
  '1014',  // Unsupported ID number format (also fires on sandbox data hitting prod)
])

export const SMILE_ID_EVD_TERMINAL_RESULT_CODES: ReadonlySet<string> = new Set([
  ...SMILE_ID_EVD_PASS_RESULT_CODES,
  ...SMILE_ID_EVD_FAIL_RESULT_CODES,
])

export function isTerminalResultCode(code: string | null | undefined): boolean {
  if (!code) return false
  return SMILE_ID_EVD_TERMINAL_RESULT_CODES.has(code)
}

export function deriveDecision(code: string | null | undefined): NormalizedVerificationDecision {
  if (!code) return 'INCONCLUSIVE'
  if (SMILE_ID_EVD_PASS_RESULT_CODES.has(code)) return 'PASS'
  if (SMILE_ID_EVD_FAIL_RESULT_CODES.has(code)) return 'FAIL'
  return 'INCONCLUSIVE'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/result-codes.ts \
       __tests__/lib/identity-verification/vendors/smile-id/result-codes.test.ts
git commit -m "feat(smile-id): add EVD result-code sets and decision derivation"
```

---

## Task 6: Build `signing.ts` (HMAC wrappers)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/signing.ts`
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/signing.test.ts`

- [ ] **Step 1: Write failing tests**

Create `field-service/__tests__/lib/identity-verification/vendors/smile-id/signing.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeSmileSignature,
  verifySmileSignature,
} from '../../../../../lib/identity-verification/vendors/smile-id/signing'

const TEST_PARTNER_ID = '100'
const TEST_API_KEY = 'TEST_API_KEY_DO_NOT_USE_IN_PROD'

describe('Smile ID signing', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', TEST_PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', TEST_API_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('computeSmileSignature returns the same signature for the same timestamp', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const a = computeSmileSignature(ts)
    const b = computeSmileSignature(ts)
    expect(a).toEqual(b)
  })

  it('computeSmileSignature returns a base64-shaped string', () => {
    const sig = computeSmileSignature('2026-05-27T10:00:00.000Z')
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(Buffer.from(sig, 'base64').length).toBe(32) // SHA-256 digest
  })

  it('computeSmileSignature differs across timestamps', () => {
    const a = computeSmileSignature('2026-05-27T10:00:00.000Z')
    const b = computeSmileSignature('2026-05-27T10:00:01.000Z')
    expect(a).not.toEqual(b)
  })

  it('verifySmileSignature accepts a signature it just generated', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    expect(verifySmileSignature(ts, sig)).toBe(true)
  })

  it('verifySmileSignature rejects a tampered signature', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    const tampered = sig.replace(/.$/, sig.endsWith('A') ? 'B' : 'A')
    expect(verifySmileSignature(ts, tampered)).toBe(false)
  })

  it('verifySmileSignature rejects when API_KEY env differs', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    vi.stubEnv('SMILE_ID_API_KEY', 'DIFFERENT_KEY')
    expect(verifySmileSignature(ts, sig)).toBe(false)
  })

  it('verifySmileSignature returns false when env not set', () => {
    vi.unstubAllEnvs()
    expect(verifySmileSignature('2026-05-27T10:00:00.000Z', 'anything')).toBe(false)
  })

  it('verifySmileSignature returns false for malformed input', () => {
    expect(verifySmileSignature('', 'sig')).toBe(false)
    expect(verifySmileSignature('ts', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/signing.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement signing.ts**

Create `field-service/lib/identity-verification/vendors/smile-id/signing.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

// Smile ID signing — legacy /v1/* convention.
// HMAC-SHA256 over: timestamp + partner_id + "sid_request", base64-encoded.
// One shared key (SMILE_ID_API_KEY) signs outbound requests AND verifies
// inbound webhooks; no separate webhook secret.
//
// Reference: smile-identity-core-js/src/signature.ts

const SIGNING_SUFFIX = 'sid_request'

function getCredentials(): { partnerId: string; apiKey: string } | null {
  const partnerId = process.env.SMILE_ID_PARTNER_ID
  const apiKey = process.env.SMILE_ID_API_KEY
  if (!partnerId || !apiKey) return null
  return { partnerId, apiKey }
}

export function computeSmileSignature(timestamp: string): string {
  const creds = getCredentials()
  if (!creds) {
    throw new Error('SMILE_ID_PARTNER_ID and SMILE_ID_API_KEY must be set')
  }
  const hmac = createHmac('sha256', creds.apiKey)
  hmac.update(timestamp, 'utf8')
  hmac.update(creds.partnerId, 'utf8')
  hmac.update(SIGNING_SUFFIX, 'utf8')
  return hmac.digest().toString('base64')
}

export function verifySmileSignature(timestamp: string, signature: string): boolean {
  if (!timestamp || !signature) return false
  const creds = getCredentials()
  if (!creds) return false
  let expected: string
  try {
    const hmac = createHmac('sha256', creds.apiKey)
    hmac.update(timestamp, 'utf8')
    hmac.update(creds.partnerId, 'utf8')
    hmac.update(SIGNING_SUFFIX, 'utf8')
    expected = hmac.digest().toString('base64')
  } catch {
    return false
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/signing.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/signing.ts \
       __tests__/lib/identity-verification/vendors/smile-id/signing.test.ts
git commit -m "feat(smile-id): HMAC sign/verify with single API key"
```

---

## Task 7: Build `types.ts` (Smile-internal request/response shapes)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/types.ts`

No tests for this task — pure type definitions.

- [ ] **Step 1: Create the file**

```typescript
// Smile ID API request/response types.
// Sourced from: docs.usesmileid.com/integration-options/no-code/smile-links/rest-api
// Items confirmed only in sandbox are noted in
// docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md.

// ─── Smile Links create request ──────────────────────────────────────────

export type SmileLinkIdType = {
  country: string                  // ISO 3166-1 alpha-2 (e.g. 'ZA')
  id_type: string                  // 'IDENTITY_CARD' for SA EVD
  verification_method: string      // resolved by sandbox probe (Task 2) — likely 'doc_verification'
}

export type SmileLinkPartnerParams = {
  user_id: string                  // Smile requires user_id nested HERE, not top-level
  job_id: string                   // partner-supplied, globally unique forever
  job_type: number                 // 11 for Enhanced Document Verification
  verification_id: string          // Plug A Pro internal id — travels back on every callback
  [key: string]: string | number   // partner_params accepts arbitrary string-coerced extras
}

export type SmileLinksCreateRequest = {
  partner_id: string
  timestamp: string                // ISO-8601 with ms
  signature: string                // base64 HMAC; see signing.ts
  source_sdk: 'rest_api'
  source_sdk_version: string

  name: string                     // shown in Smile portal for this link
  company_name: string
  id_types: SmileLinkIdType[]
  callback_url: string             // REQUIRED — Smile Links rejects requests without this
  is_single_use: boolean
  partner_params: SmileLinkPartnerParams
  expires_at: string               // ISO-8601 with ms

  // Optional fields, not used in v1:
  data_privacy_policy_url?: string
  logo_url?: string
  redirect_url?: string
}

// ─── Smile Links create response ─────────────────────────────────────────

export type SmileLinksCreateResponse = {
  link_url: string                 // user-facing URL we 302 to from /provider/verify/[token]/liveness
  ref_id: string                   // Smile Link id; stored as livenessSessionReference
  disabled_at: string | null
  id_types: SmileLinkIdType[]
  expires_at?: string
  is_single_use?: boolean
  partner_id?: string
}

// ─── Smile Links disable request (PUT) ───────────────────────────────────

export type SmileLinksDisableRequest = {
  partner_id: string
  timestamp: string
  signature: string
  is_disabled: true
}

// ─── EVD webhook payload ─────────────────────────────────────────────────

export type SmileEvdActions = {
  Liveness_Check?: string
  Selfie_To_ID_Card_Compare?: string
  Document_Check?: string
  Verify_Document?: string
  Register_Selfie?: string
  Return_Personal_Info?: string
  Human_Review_Compare?: string
  Human_Review_Document_Check?: string
  Human_Review_Liveness_Check?: string
  [key: string]: string | undefined
}

export type SmileEvdImageLinks = {
  id_card_back?: string
  id_card_image?: string
  selfie_image?: string
  [key: string]: string | undefined
}

export type SmileEvdWebhookPayload = {
  SmileJobID: string
  PartnerParams: SmileLinkPartnerParams
  ResultCode: string
  ResultText?: string
  ResultType?: string
  Actions?: SmileEvdActions
  Source?: string
  signature: string
  timestamp: string

  // IsFinalResult comes back as a STRING "true"/"false" (per smile-identity-core SDK);
  // do NOT compare with `=== true` boolean. Adapter normalises in parse.ts.
  IsFinalResult?: string | boolean

  // PII fields — keys present depend on EVD product variant. Treat ALL of these
  // as PII for redaction; do not log raw values.
  ImageLinks?: SmileEvdImageLinks
  KYCReceipt?: string
  FullName?: string
  IDNumber?: string
  SecondaryIDNumber?: string
  DOB?: string
  Gender?: string
  Address?: string
  IssuanceDate?: string
  ExpirationDate?: string
  Photo?: string
  Personal_Info?: Record<string, unknown>

  [key: string]: unknown
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/types.ts
git commit -m "feat(smile-id): add Smile API request/response types"
```

---

## Task 8: Build `redact.ts` (PII redaction with denylist)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/redact.ts`
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/redact.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { redactSmilePayload } from '../../../../../lib/identity-verification/vendors/smile-id/redact'

const FIXTURE: Record<string, unknown> = {
  SmileJobID: 'smile-job-123',
  PartnerParams: {
    user_id: 'usr-1',
    job_id: 'pap-uuid-here',
    job_type: 11,
    verification_id: 'ver-1',
  },
  ResultCode: '0810',
  ResultText: 'Document Verified',
  Actions: {
    Liveness_Check: 'Passed',
    Selfie_To_ID_Card_Compare: 'Completed',
    Document_Check: 'Passed',
    Verify_Document: 'Passed',
  },
  IsFinalResult: 'true',
  signature: 'A_REAL_HMAC_VALUE',
  timestamp: '2026-05-27T10:00:00.000Z',
  source_sdk: 'rest_api',
  source_sdk_version: '3.1.0',
  Photo: 'BASE64_PHOTO_DATA_LONG_STRING',
  ImageLinks: {
    id_card_back:  'https://smile-cdn/abc/back.jpg?sig=token',
    id_card_image: 'https://smile-cdn/abc/front.jpg?sig=token',
    selfie_image:  'https://smile-cdn/abc/selfie.jpg?sig=token',
  },
  KYCReceipt:        'https://smile-cdn/abc/receipt.pdf?sig=token',
  FullName:          'JANE DOE',
  IDNumber:          '8001015009087',
  SecondaryIDNumber: 'REF-12345',
  DOB:               '1980-01-01',
  Gender:            'F',
  Address:           '123 Test Street, Sandton',
  IssuanceDate:      '2010-05-12',
  ExpirationDate:    '2030-05-11',
  Personal_Info:     { FullName: 'JANE DOE', IDNumber: '8001015009087' },
}

describe('redactSmilePayload', () => {
  it('strips Photo, ImageLinks, KYCReceipt to [REDACTED]', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.Photo).toBe('[REDACTED]')
    expect(r.ImageLinks).toBe('[REDACTED]')
    expect(r.KYCReceipt).toBe('[REDACTED]')
  })

  it('strips FullName/IDNumber/DOB/Gender/Address/IssuanceDate/ExpirationDate/SecondaryIDNumber', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.FullName).toBe('[REDACTED]')
    expect(r.IDNumber).toBe('[REDACTED]')
    expect(r.SecondaryIDNumber).toBe('[REDACTED]')
    expect(r.DOB).toBe('[REDACTED]')
    expect(r.Gender).toBe('[REDACTED]')
    expect(r.Address).toBe('[REDACTED]')
    expect(r.IssuanceDate).toBe('[REDACTED]')
    expect(r.ExpirationDate).toBe('[REDACTED]')
  })

  it('strips nested Personal_Info values', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.Personal_Info).toBe('[REDACTED]')
  })

  it('drops the raw signature entirely (not even as [REDACTED])', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(Object.keys(r)).not.toContain('signature')
  })

  it('preserves SmileJobID, PartnerParams, ResultCode, Actions, timestamp', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.SmileJobID).toBe('smile-job-123')
    expect(r.PartnerParams).toEqual(FIXTURE.PartnerParams)
    expect(r.ResultCode).toBe('0810')
    expect(r.Actions).toEqual(FIXTURE.Actions)
    expect(r.timestamp).toBe('2026-05-27T10:00:00.000Z')
  })

  it('contains no PII string literals after serialisation', () => {
    const r = redactSmilePayload(FIXTURE)
    const serialised = JSON.stringify(r)
    expect(serialised).not.toContain('JANE DOE')
    expect(serialised).not.toContain('8001015009087')
    expect(serialised).not.toContain('REF-12345')
    expect(serialised).not.toContain('1980-01-01')
    expect(serialised).not.toContain('123 Test Street')
    expect(serialised).not.toContain('BASE64_PHOTO_DATA_LONG_STRING')
    expect(serialised).not.toContain('A_REAL_HMAC_VALUE')
  })

  it('redacts keys matching the generic denylist regex', () => {
    const r = redactSmilePayload({ phone_number: '+27123456', email: 'a@b.co', some_id_number: 'X' })
    expect(r.phone_number).toBe('[REDACTED]')
    expect(r.email).toBe('[REDACTED]')
    expect(r.some_id_number).toBe('[REDACTED]')
  })

  it('returns a non-object payload as an empty redacted record', () => {
    expect(redactSmilePayload(null)).toEqual({})
    expect(redactSmilePayload('string')).toEqual({})
    expect(redactSmilePayload(42)).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/redact.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement redact.ts**

```typescript
// Smile ID webhook payload redaction for audit storage.
// Strategy: explicit denylist of known PII keys, PLUS a regex catch-all for variants.
// Raw `signature` is DROPPED (not preserved as [REDACTED]) because signatureValid
// is recorded on the event row's own column and the raw signature has no audit value.

const REDACTED = '[REDACTED]'

const EXPLICIT_PII_KEYS: ReadonlySet<string> = new Set([
  'Photo', 'ImageLinks', 'KYCReceipt',
  'FullName', 'FirstName', 'LastName', 'MiddleName',
  'IDNumber', 'SecondaryIDNumber',
  'DOB', 'Gender', 'Nationality', 'Country',
  'IssuanceDate', 'ExpirationDate',
  'Address', 'PhoneNumber', 'Email',
  'Personal_Info',
])

const GENERIC_PII_KEY_REGEX = /^(id_number|secondary_id|dob|name|photo|address|phone|email|image_link|kyc_receipt|gender|expiration|issuance|first_name|last_name|middle_name)/i

const DROPPED_KEYS: ReadonlySet<string> = new Set(['signature'])

export function redactSmilePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (EXPLICIT_PII_KEYS.has(key) || GENERIC_PII_KEY_REGEX.test(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested)
  }
  return out
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (EXPLICIT_PII_KEYS.has(key) || GENERIC_PII_KEY_REGEX.test(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested)
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/redact.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/redact.ts \
       __tests__/lib/identity-verification/vendors/smile-id/redact.test.ts
git commit -m "feat(smile-id): PII redaction with explicit denylist and regex catch-all"
```

---

## Task 9: Build `parse.ts` (webhook → ParseWebhookResult)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/parse.ts`
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/parse.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseSmileWebhook } from '../../../../../lib/identity-verification/vendors/smile-id/parse'
import { computeSmileSignature, currentIsoTimestamp } from '../../../../../lib/identity-verification/vendors/smile-id/signing'

const PARTNER_ID = '100'
const API_KEY = 'TEST_KEY'

function signedPayload(body: Record<string, unknown>) {
  const timestamp = currentIsoTimestamp()
  const signature = computeSmileSignature(timestamp)
  return JSON.stringify({ timestamp, signature, ...body })
}

describe('parseSmileWebhook', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', API_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('marks signatureValid=true for a payload we just signed', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.signatureValid).toBe(true)
  })

  it('marks signatureValid=false for a tampered signature', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const tampered = rawBody.replace(/"signature":"[^"]+"/, '"signature":"DEADBEEF"')
    const r = await parseSmileWebhook({ headers: {}, rawBody: tampered })
    expect(r.signatureValid).toBe(false)
  })

  it('treats IsFinalResult="true" string as final', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      PartnerParams: { user_id: 'u', job_id: 'j', job_type: 11, verification_id: 'v' },
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
    expect(r.result).not.toBeNull()
    expect(r.result?.decision).toBe('PASS')
    expect(r.result?.livenessVerified).toBe(true)
  })

  it('treats IsFinalResult=true boolean as final', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: true,
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
  })

  it('falls back to terminal-code detection when IsFinalResult absent', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
    expect(r.result?.decision).toBe('PASS')
  })

  it('returns eventType=interim and result=null for non-final + non-terminal', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '9999',
      IsFinalResult: 'false',
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('interim')
    expect(r.result).toBeNull()
  })

  it('derives livenessVerified=true on Actions.Liveness_Check="Passed"', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.result?.livenessVerified).toBe(true)
  })

  it('derives livenessVerified=false on Actions.Liveness_Check="Failed"', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Failed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.result?.livenessVerified).toBe(false)
  })

  it('derives livenessVerified=null on "Under Review" or missing', async () => {
    const a = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Under Review' },
    }) })
    expect(a.result?.livenessVerified).toBeNull()
    const b = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true', Actions: {},
    }) })
    expect(b.result?.livenessVerified).toBeNull()
  })

  it('binary confidence = 1.0 only when PASS+final+liveness Passed', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Passed' },
    }) })
    expect(r.result?.confidence).toBe(1.0)
  })

  it('binary confidence = 0.0 when liveness not passed', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Failed' },
    }) })
    expect(r.result?.confidence).toBe(0.0)
  })

  it('extracts vendorReference from PartnerParams.job_id', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'smile-x', ResultCode: '0810', IsFinalResult: 'true',
      PartnerParams: { user_id: 'u', job_id: 'pap-uuid', job_type: 11, verification_id: 'v' },
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.vendorReference).toBe('pap-uuid')
  })

  it('extracts livenessSessionReference from ref_id at top level', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      ref_id: 'link-ref-abc',
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.livenessSessionReference).toBe('link-ref-abc')
  })

  it('computes deterministic payloadHash that does not depend on key order', async () => {
    const a = await parseSmileWebhook({ headers: {}, rawBody: '{"a":1,"b":2}' })
    const b = await parseSmileWebhook({ headers: {}, rawBody: '{"b":2,"a":1}' })
    expect(a.payloadHash).toBe(b.payloadHash)
  })

  it('returns FAIL decision on codes 0811, 0812, 0816, 1014', async () => {
    for (const code of ['0811', '0812', '0816', '1014']) {
      const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
        SmileJobID: 'x', ResultCode: code, IsFinalResult: 'true',
      }) })
      expect(r.result?.decision).toBe('FAIL')
    }
  })

  it('does not include any raw PII in the redactedPayload', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      FullName: 'JANE DOE', IDNumber: '8001015009087',
      Photo: 'BASE64', ImageLinks: { selfie_image: 'https://x' },
    }) })
    const ser = JSON.stringify(r.redactedPayload)
    expect(ser).not.toContain('JANE DOE')
    expect(ser).not.toContain('8001015009087')
    expect(ser).not.toContain('BASE64')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/parse.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement parse.ts**

```typescript
import { createHash } from 'crypto'
import type {
  ParseWebhookInput,
  ParseWebhookResult,
  NormalizedVerificationResult,
} from '../types'
import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  deriveDecision,
  isTerminalResultCode,
} from './result-codes'
import { verifySmileSignature } from './signing'
import { redactSmilePayload } from './redact'
import type { SmileEvdActions, SmileEvdWebhookPayload } from './types'

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  )
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function deriveIsFinal(payload: SmileEvdWebhookPayload): boolean {
  // Smile sends IsFinalResult as either boolean or string "true"/"false".
  if (payload.IsFinalResult === true) return true
  if (payload.IsFinalResult === 'true') return true
  // EVD callbacks may omit IsFinalResult; treat terminal ResultCode as final.
  if (isTerminalResultCode(payload.ResultCode)) return true
  return false
}

function deriveLivenessVerified(actions: SmileEvdActions | undefined): boolean | null {
  const check = actions?.Liveness_Check
  if (check === 'Passed') return true
  if (check === 'Failed') return false
  return null  // 'Under Review', 'Not Applicable', missing — all ambiguous
}

function deriveBinaryConfidence(payload: SmileEvdWebhookPayload, isFinal: boolean): number {
  const isPass = SMILE_ID_EVD_PASS_RESULT_CODES.has(payload.ResultCode)
  const livenessPassed = payload.Actions?.Liveness_Check === 'Passed'
  return (isPass && isFinal && livenessPassed) ? 1.0 : 0.0
}

function deriveReasonCode(
  resultCode: string | undefined,
  decision: NormalizedVerificationResult['decision'],
): string | null {
  if (decision === 'PASS') return null
  return resultCode ?? null
}

function deriveRiskFlags(payload: SmileEvdWebhookPayload): string[] {
  const flags: string[] = []
  const actions = payload.Actions ?? {}
  if (actions.Document_Check === 'Failed') flags.push('DOCUMENT_FAILED_AUTHENTICITY')
  if (actions.Verify_Document === 'Failed') flags.push('DOCUMENT_OCR_MISMATCH')
  if (actions.Selfie_To_ID_Card_Compare === 'Failed') flags.push('SELFIE_NOT_MATCHING_DOCUMENT')
  if (actions.Liveness_Check === 'Failed') flags.push('LIVENESS_FAILED')
  return flags
}

export async function parseSmileWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  let payload: SmileEvdWebhookPayload
  try {
    payload = JSON.parse(input.rawBody) as SmileEvdWebhookPayload
  } catch {
    return {
      signatureValid: false,
      vendorEventId: null,
      vendorReference: null,
      livenessSessionReference: null,
      eventType: null,
      payloadHash: sha256(input.rawBody ?? ''),
      redactedPayload: null,
      result: null,
    }
  }

  const signatureValid = typeof payload.signature === 'string' && typeof payload.timestamp === 'string'
    ? verifySmileSignature(payload.timestamp, payload.signature)
    : false

  const isFinal = deriveIsFinal(payload)
  const eventType = isFinal ? 'final' : 'interim'

  const partnerJobId = payload.PartnerParams?.job_id ?? null
  const refId = (typeof (payload as Record<string, unknown>).ref_id === 'string'
    ? (payload as Record<string, unknown>).ref_id as string
    : null)

  const payloadHash = sha256(canonicalJson(payload))
  const redactedPayload = redactSmilePayload(payload as unknown as Record<string, unknown>)

  let result: NormalizedVerificationResult | null = null
  if (isFinal) {
    const decision = deriveDecision(payload.ResultCode)
    const livenessVerified = deriveLivenessVerified(payload.Actions)
    result = {
      decision,
      confidence: deriveBinaryConfidence(payload, isFinal),
      documentConfidence: null,
      livenessScore: null,
      selfieMatchScore: null,
      livenessVerified,
      riskFlags: deriveRiskFlags(payload),
      reasonCode: deriveReasonCode(payload.ResultCode, decision),
      vendorReference: partnerJobId,
      expiresAt: null,
    }
  }

  return {
    signatureValid,
    vendorEventId: null,
    vendorReference: partnerJobId,
    livenessSessionReference: refId,
    eventType,
    payloadHash,
    redactedPayload,
    result,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/parse.test.ts
```

Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/parse.ts \
       __tests__/lib/identity-verification/vendors/smile-id/parse.test.ts
git commit -m "feat(smile-id): webhook payload parser with IsFinalResult fallback"
```

---

## Task 10: Build `smile-links-client.ts` (POST + PUT)

**Files:**
- Create: `field-service/lib/identity-verification/vendors/smile-id/smile-links-client.ts`
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/smile-links-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSmileLink,
  disableSmileLink,
} from '../../../../../lib/identity-verification/vendors/smile-id/smile-links-client'

const PARTNER_ID = '100'
const API_KEY = 'TEST_KEY'
const BASE_URL = 'https://testapi.smileidentity.com'

describe('Smile Links client', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', API_KEY)
    vi.stubEnv('SMILE_ID_BASE_URL', BASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('createSmileLink', () => {
    it('POSTs to /v1/smile_links with the expected body shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          link_url: 'https://links.smileidentity.com/ABC',
          ref_id: 'link-ref-1',
          disabled_at: null,
          id_types: [{ country: 'ZA', id_type: 'IDENTITY_CARD', verification_method: 'doc_verification' }],
        }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await createSmileLink({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/api/webhooks/verification/smile_id',
        expiresAt: new Date('2026-05-27T11:00:00.000Z'),
      })

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/smile_links`)
      expect(opts.method).toBe('POST')

      const body = JSON.parse(opts.body as string)
      expect(body.partner_id).toBe(PARTNER_ID)
      expect(typeof body.timestamp).toBe('string')
      expect(typeof body.signature).toBe('string')
      expect(body.source_sdk).toBe('rest_api')
      expect(body.id_types).toEqual([{
        country: 'ZA',
        id_type: 'IDENTITY_CARD',
        verification_method: 'doc_verification',
      }])
      expect(body.callback_url).toBe('https://app.test/api/webhooks/verification/smile_id')
      expect(body.is_single_use).toBe(true)
      expect(body.partner_params).toMatchObject({
        user_id: 'prov-1',
        job_id: 'pap-uuid-1',
        job_type: 11,
        verification_id: 'ver-1',
      })
      expect(body.expires_at).toBe('2026-05-27T11:00:00.000Z')

      expect(result.linkUrl).toBe('https://links.smileidentity.com/ABC')
      expect(result.refId).toBe('link-ref-1')
    })

    it('uses verificationId as user_id when providerId is null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ link_url: 'x', ref_id: 'r', disabled_at: null, id_types: [] }),
      }))
      await createSmileLink({
        verificationId: 'ver-1',
        providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })
      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.partner_params.user_id).toBe('ver-1')
    })

    it('throws SmileApiError on 4xx with status and body', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 400,
        text: async () => '{"code":"2204","error":"missing callback_url"}',
      }))
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/Smile.*400/)
    })

    it('throws when SMILE_ID_API_KEY is unset', async () => {
      vi.unstubAllEnvs()
      await expect(createSmileLink({
        verificationId: 'ver-1', providerId: null,
        partnerJobId: 'pap-uuid-1',
        callbackUrl: 'https://app.test/cb',
        expiresAt: new Date(),
      })).rejects.toThrow(/SMILE_ID/)
    })
  })

  describe('disableSmileLink', () => {
    it('PUTs to /v1/smile_links/:refId with is_disabled:true and signed body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)

      const result = await disableSmileLink('link-ref-1')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/v1/smile_links/link-ref-1`)
      expect(opts.method).toBe('PUT')

      const body = JSON.parse(opts.body as string)
      expect(body.is_disabled).toBe(true)
      expect(body.partner_id).toBe(PARTNER_ID)
      expect(typeof body.timestamp).toBe('string')
      expect(typeof body.signature).toBe('string')

      expect(result.acknowledged).toBe(true)
    })

    it('returns acknowledged=false on non-2xx', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }))
      const result = await disableSmileLink('link-ref-bogus')
      expect(result.acknowledged).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/smile-links-client.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement smile-links-client.ts**

```typescript
import { computeSmileSignature, currentIsoTimestamp } from './signing'
import type { SmileLinksCreateRequest, SmileLinksCreateResponse } from './types'

const SMILE_LINKS_PATH = '/v1/smile_links'
const SOURCE_SDK_VERSION = '1.0.0'

// EVD verification_method per sandbox probe (Task 2 notes). Public docs show
// 'doc_verification' for the DocV family; EVD is the same string with the
// product flag set at the partner level. Override here only if the probe finds
// a different value.
const EVD_VERIFICATION_METHOD = 'doc_verification'

export class SmileApiError extends Error {
  constructor(public readonly status: number, public readonly responseBody: string) {
    super(`Smile API error ${status}: ${responseBody.slice(0, 200)}`)
    this.name = 'SmileApiError'
  }
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`${key} is required`)
  return v
}

function signedHeader() {
  const timestamp = currentIsoTimestamp()
  const signature = computeSmileSignature(timestamp)
  return {
    partner_id: requireEnv('SMILE_ID_PARTNER_ID'),
    timestamp,
    signature,
  }
}

export type CreateSmileLinkInput = {
  verificationId: string
  providerId: string | null
  partnerJobId: string
  callbackUrl: string
  expiresAt: Date
}

export type CreateSmileLinkResult = {
  linkUrl: string
  refId: string
  expiresAt: string | null
}

export async function createSmileLink(input: CreateSmileLinkInput): Promise<CreateSmileLinkResult> {
  const baseUrl = requireEnv('SMILE_ID_BASE_URL')

  const body: SmileLinksCreateRequest = {
    ...signedHeader(),
    source_sdk: 'rest_api',
    source_sdk_version: SOURCE_SDK_VERSION,
    name: `Plug A Pro — ${input.verificationId}`,
    company_name: 'Plug A Pro',
    id_types: [{
      country: 'ZA',
      id_type: 'IDENTITY_CARD',
      verification_method: EVD_VERIFICATION_METHOD,
    }],
    callback_url: input.callbackUrl,
    is_single_use: true,
    partner_params: {
      user_id: input.providerId ?? input.verificationId,
      job_id: input.partnerJobId,
      job_type: 11,
      verification_id: input.verificationId,
    },
    expires_at: input.expiresAt.toISOString(),
  }

  const resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new SmileApiError(resp.status, text)
  }

  const json = await resp.json() as SmileLinksCreateResponse
  return {
    linkUrl: json.link_url,
    refId: json.ref_id,
    expiresAt: json.expires_at ?? null,
  }
}

export type DisableSmileLinkResult = {
  acknowledged: boolean
}

export async function disableSmileLink(refId: string): Promise<DisableSmileLinkResult> {
  const baseUrl = requireEnv('SMILE_ID_BASE_URL')

  const resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}/${encodeURIComponent(refId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...signedHeader(),
      is_disabled: true,
    }),
  })

  return { acknowledged: resp.ok }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/smile-links-client.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/smile-links-client.ts \
       __tests__/lib/identity-verification/vendors/smile-id/smile-links-client.test.ts
git commit -m "feat(smile-id): Smile Links HTTP client (POST create, PUT disable)"
```

---

## Task 11: Wire the adapter `index.ts`

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/smile-id/index.ts` (replaces the moved scaffolded file)
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts`

- [ ] **Step 1: Write failing adapter-level tests**

Create `field-service/__tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { smileIdVerificationAdapter } from '../../../../../lib/identity-verification/vendors/smile-id'

describe('SmileIdVerificationAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', '100')
    vi.stubEnv('SMILE_ID_API_KEY', 'TEST_KEY')
    vi.stubEnv('SMILE_ID_BASE_URL', 'https://testapi.smileidentity.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('vendorKey is smile_id', () => {
    expect(smileIdVerificationAdapter.vendorKey).toBe('smile_id')
  })

  describe('submitDocumentCheck', () => {
    it('returns a fresh partner_job_id and expectsWebhook=true', async () => {
      const a = await smileIdVerificationAdapter.submitDocumentCheck({
        verificationId: 'ver-1',
        providerId: null,
        identityBasis: 'NATIONAL_ID' as any,
        issuingCountry: 'ZA',
        identifierHash: null,
        identifierLast4: null,
        identifierPlaintext: null,
        documents: [],
        webhookCallbackUrl: 'https://app.test/cb',
        livenessReturnUrl: 'https://app.test/r',
      })
      expect(a.vendorReference).toMatch(/^pap-[0-9a-f-]{36}$/)
      expect(a.expectsWebhook).toBe(true)
      expect(a.immediateResult).toBeUndefined()
    })

    it('generates distinct partner_job_ids across calls', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const r = await smileIdVerificationAdapter.submitDocumentCheck({
          verificationId: `ver-${i}`, providerId: null,
          identityBasis: 'NATIONAL_ID' as any, issuingCountry: 'ZA',
          identifierHash: null, identifierLast4: null, identifierPlaintext: null,
          documents: [], webhookCallbackUrl: 'x', livenessReturnUrl: 'x',
        })
        ids.add(r.vendorReference)
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('createLivenessSession', () => {
    it('throws when submittedVendorReference is null', async () => {
      await expect(smileIdVerificationAdapter.createLivenessSession!({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        returnUrl: 'https://app.test/r',
        submittedVendorReference: null,
        webhookCallbackUrl: 'https://app.test/cb',
      })).rejects.toThrow(/submittedVendorReference/)
    })

    it('calls createSmileLink with input.submittedVendorReference as partnerJobId', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          link_url: 'https://links.smileidentity.com/ABC',
          ref_id: 'link-ref-1',
          disabled_at: null,
          id_types: [],
          expires_at: '2026-05-27T11:00:00.000Z',
        }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const r = await smileIdVerificationAdapter.createLivenessSession!({
        verificationId: 'ver-1',
        providerId: 'prov-1',
        returnUrl: 'https://app.test/r',
        submittedVendorReference: 'pap-job-1',
        webhookCallbackUrl: 'https://app.test/cb',
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.partner_params.job_id).toBe('pap-job-1')
      expect(body.callback_url).toBe('https://app.test/cb')
      expect(body.id_types[0].id_type).toBe('IDENTITY_CARD')

      expect(r.vendorReference).toBe('link-ref-1')
      expect(r.sessionUrl).toBe('https://links.smileidentity.com/ABC')
      expect(r.expiresAt).toBeInstanceOf(Date)
    })
  })

  describe('parseWebhook', () => {
    it('delegates to parseSmileWebhook', async () => {
      const { computeSmileSignature, currentIsoTimestamp } = await import(
        '../../../../../lib/identity-verification/vendors/smile-id/signing'
      )
      const timestamp = currentIsoTimestamp()
      const signature = computeSmileSignature(timestamp)
      const rawBody = JSON.stringify({
        timestamp, signature,
        SmileJobID: 'smile-x',
        ResultCode: '0810',
        IsFinalResult: 'true',
        PartnerParams: { user_id: 'u', job_id: 'pap', job_type: 11, verification_id: 'v' },
        Actions: { Liveness_Check: 'Passed' },
      })
      const r = await smileIdVerificationAdapter.parseWebhook({ headers: {}, rawBody })
      expect(r.signatureValid).toBe(true)
      expect(r.result?.decision).toBe('PASS')
      expect(r.vendorReference).toBe('pap')
    })
  })

  describe('cancelVerificationJob', () => {
    it('returns supported=false without HTTP when livenessSessionReference is null', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const r = await smileIdVerificationAdapter.cancelVerificationJob({
        verificationId: 'ver-1',
        vendorReference: 'pap-job-1',
        livenessSessionReference: null,
        reason: 'PROVIDER_WITHDREW_CONSENT',
      })
      expect(r.supported).toBe(false)
      expect(r.vendorAcknowledged).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('PUTs to /v1/smile_links/:refId with is_disabled when ref present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)

      const r = await smileIdVerificationAdapter.cancelVerificationJob({
        verificationId: 'ver-1',
        vendorReference: 'pap-job-1',
        livenessSessionReference: 'link-ref-1',
        reason: 'PROVIDER_WITHDREW_CONSENT',
      })
      expect(r.supported).toBe(true)
      expect(r.vendorAcknowledged).toBe(true)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.is_disabled).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts
```

Expected: FAIL — the old adapter still throws NotImplementedError.

- [ ] **Step 3: Replace index.ts with the real adapter**

Overwrite `field-service/lib/identity-verification/vendors/smile-id/index.ts`:

```typescript
import { randomUUID } from 'crypto'
import type {
  VerificationVendorAdapter,
  SubmitDocumentCheckInput,
  SubmitDocumentCheckResult,
  CreateLivenessSessionInput,
  CreateLivenessSessionResult,
  ParseWebhookInput,
  ParseWebhookResult,
  CancelVerificationJobInput,
  CancelVerificationJobResult,
} from '../types'
import { createSmileLink, disableSmileLink } from './smile-links-client'
import { parseSmileWebhook } from './parse'

const DEFAULT_SMILE_LINK_TTL_MINUTES = 60

function partnerJobId(): string {
  return `pap-${randomUUID()}`
}

function computeExpiresAt(): Date {
  const minutes = Number(process.env.SMILE_ID_LINK_TTL_MINUTES) || DEFAULT_SMILE_LINK_TTL_MINUTES
  return new Date(Date.now() + minutes * 60 * 1000)
}

async function submitDocumentCheck(
  _input: SubmitDocumentCheckInput,
): Promise<SubmitDocumentCheckResult> {
  // Smile Links combines doc + selfie + liveness into one user flow.
  // submitDocumentCheck merely mints the partner-side correlation id;
  // the actual Smile API call happens in createLivenessSession.
  return {
    vendorReference: partnerJobId(),
    expectsWebhook: true,
  }
}

async function createLivenessSession(
  input: CreateLivenessSessionInput,
): Promise<CreateLivenessSessionResult> {
  if (!input.submittedVendorReference) {
    throw new Error(
      'Smile ID createLivenessSession requires submittedVendorReference ' +
      '(the partner_job_id from submitDocumentCheck)',
    )
  }

  const created = await createSmileLink({
    verificationId: input.verificationId,
    providerId: input.providerId,
    partnerJobId: input.submittedVendorReference,
    callbackUrl: input.webhookCallbackUrl,
    expiresAt: computeExpiresAt(),
  })

  return {
    vendorReference: created.refId,
    sessionUrl: created.linkUrl,
    expiresAt: created.expiresAt ? new Date(created.expiresAt) : computeExpiresAt(),
  }
}

async function parseWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  return parseSmileWebhook(input)
}

async function cancelVerificationJob(
  input: CancelVerificationJobInput,
): Promise<CancelVerificationJobResult> {
  if (!input.livenessSessionReference) {
    return { supported: false, vendorAcknowledged: false }
  }
  const r = await disableSmileLink(input.livenessSessionReference)
  return { supported: true, vendorAcknowledged: r.acknowledged }
}

export const smileIdVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'smile_id',
  submitDocumentCheck,
  createLivenessSession,
  parseWebhook,
  cancelVerificationJob,
}
```

- [ ] **Step 4: Run adapter tests**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run the full identity-verification suite**

```bash
pnpm vitest run __tests__/lib/identity-verification/
```

Expected: every identity-verification test passes. If anything in the existing `vendors.test.ts` breaks because of the new adapter behavior (e.g., earlier tests that expected NotImplementedError throws), delete those obsolete tests in this step.

- [ ] **Step 6: Commit**

```bash
git add lib/identity-verification/vendors/smile-id/index.ts \
       __tests__/lib/identity-verification/vendors/smile-id/adapter.test.ts
git add -u __tests__/lib/identity-verification/vendors.test.ts
git commit -m "feat(smile-id): wire submit/createLiveness/parseWebhook/cancel"
```

---

## Task 12: Update vendor config seed

**Files:**
- Modify: `field-service/scripts/seed-verification-vendors.ts`

- [ ] **Step 1: Read the current seed**

```bash
head -40 scripts/seed-verification-vendors.ts
```

Locate the `smile_id` block. Find its `configJson` value.

- [ ] **Step 2: Update configJson for smile_id**

Replace the smile_id `configJson` with:

```typescript
{
  displayName: 'Smile ID',
  expectedTurnaroundMinutes: 5,
  smileLinkTtlMinutes: 60,
  passResultCodes: ['0810'],
  rejectResultCodes: ['0811', '0812', '0816', '1014'],
  product: 'enhanced_document_verification',
  jobType: 11,
}
```

- [ ] **Step 3: Run the seed locally against a test DB (if test infra supports)**

```bash
pnpm tsx scripts/seed-verification-vendors.ts --dry-run 2>&1 | head -20
```

Expected: dry-run reports the smile_id row with new configJson values. Skip if no --dry-run flag exists.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-verification-vendors.ts
git commit -m "feat(smile-id): seed config with EVD pass/fail codes"
```

---

## Task 13: Drop SMILE_ID_WEBHOOK_SECRET references

**Files:**
- Search across `field-service/` for `SMILE_ID_WEBHOOK_SECRET`
- Modify whichever files still reference it

- [ ] **Step 1: Find references**

```bash
grep -rn "SMILE_ID_WEBHOOK_SECRET" field-service/ --include="*.ts" --include="*.tsx" --include="*.md"
```

Expected output: maybe still some in older code or env validation. The new signing.ts does NOT use it.

- [ ] **Step 2: Remove env validation lines for SMILE_ID_WEBHOOK_SECRET**

For each match, replace the env-validation entry with a comment explaining the rotation now uses SMILE_ID_API_KEY for both directions. If a file has only obsolete references, delete the lines.

Example diff in the env-loader file (path depends on repo structure):

```diff
- SMILE_ID_WEBHOOK_SECRET: z.string().optional(),
+ // SMILE_ID_WEBHOOK_SECRET removed 2026-05-27: Smile uses one shared key
+ // (SMILE_ID_API_KEY) for both outbound request signing and inbound webhook verification.
```

- [ ] **Step 3: Run typecheck + tests**

```bash
pnpm tsc --noEmit
pnpm vitest run __tests__/lib/identity-verification/
```

Expected: clean.

- [ ] **Step 4: Update .env.example if it exists**

```bash
test -f .env.example && grep -n "SMILE_ID_WEBHOOK_SECRET" .env.example
```

If present, delete the line and add:

```
SMILE_ID_PARTNER_ID=
SMILE_ID_API_KEY=
SMILE_ID_BASE_URL=https://testapi.smileidentity.com
SMILE_ID_LINK_TTL_MINUTES=60
```

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore(smile-id): drop SMILE_ID_WEBHOOK_SECRET env"
```

---

## Task 14: Update existing vendors.test.ts to reflect the wired adapter

**Files:**
- Modify: `field-service/__tests__/lib/identity-verification/vendors.test.ts`

- [ ] **Step 1: Read the file**

Locate the existing Smile ID-related tests in `vendors.test.ts` (notably the "Smile ID webhook parsing redacts nested identity payload fields" test which uses the old `SMILE_ID_WEBHOOK_SECRET`).

- [ ] **Step 2: Remove or update obsolete tests**

The "Smile ID webhook parsing redacts nested identity payload fields" test (around line 65 per earlier exploration) used `vi.stubEnv('SMILE_ID_WEBHOOK_SECRET', 'secret')` and was built around the scaffolded `smile-id.ts`. Delete this test block; equivalent coverage now lives in `__tests__/lib/identity-verification/vendors/smile-id/parse.test.ts` and `redact.test.ts`.

If the existing "mock adapter can create a liveness session" test references shape that has changed, update it; the new fields (`submittedVendorReference`, `webhookCallbackUrl`) were already added in an earlier commit but verify.

- [ ] **Step 3: Run the file**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors.test.ts
```

Expected: passes after cleanup.

- [ ] **Step 4: Commit**

```bash
git add -u __tests__/lib/identity-verification/vendors.test.ts
git commit -m "test(smile-id): remove obsolete webhook-secret test"
```

---

## Task 15: Sandbox round-trip integration test (opt-in)

**Files:**
- Create: `field-service/__tests__/lib/identity-verification/vendors/smile-id/sandbox-roundtrip.test.ts`

This test requires real sandbox credentials and is opt-in via `SMILE_ID_RUN_SANDBOX_TESTS=1`. CI skips it by default.

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'crypto'

const RUN = process.env.SMILE_ID_RUN_SANDBOX_TESTS === '1'
const describeFn = RUN ? describe : describe.skip

describeFn('Smile ID sandbox round-trip', () => {
  beforeAll(() => {
    if (!process.env.SMILE_ID_PARTNER_ID || !process.env.SMILE_ID_API_KEY) {
      throw new Error('Set SMILE_ID_PARTNER_ID + SMILE_ID_API_KEY + SMILE_ID_BASE_URL to run')
    }
    if (process.env.SMILE_ID_BASE_URL !== 'https://testapi.smileidentity.com') {
      throw new Error('Refusing to run round-trip outside sandbox base URL')
    }
  })

  it('creates a Smile Link, disables it, and confirms shape', async () => {
    const { createSmileLink, disableSmileLink } = await import(
      '../../../../../lib/identity-verification/vendors/smile-id/smile-links-client'
    )

    const created = await createSmileLink({
      verificationId: `roundtrip-${Date.now()}`,
      providerId: null,
      partnerJobId: `pap-roundtrip-${randomUUID()}`,
      callbackUrl: 'https://example.invalid/webhook',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    expect(created.linkUrl).toMatch(/^https:\/\/.+/)
    expect(created.refId).toMatch(/.+/)

    const disabled = await disableSmileLink(created.refId)
    expect(disabled.acknowledged).toBe(true)
  }, 30_000)
})
```

- [ ] **Step 2: Skip-by-default verification**

```bash
pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/sandbox-roundtrip.test.ts
```

Expected: the file shows 1 skipped test.

- [ ] **Step 3: Run it with real credentials (manual)**

```bash
SMILE_ID_RUN_SANDBOX_TESTS=1 \
  SMILE_ID_PARTNER_ID=<real> \
  SMILE_ID_API_KEY=<real> \
  SMILE_ID_BASE_URL=https://testapi.smileidentity.com \
  pnpm vitest run __tests__/lib/identity-verification/vendors/smile-id/sandbox-roundtrip.test.ts
```

Expected: test passes; a Smile Link is minted and then disabled in the sandbox portal.

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/identity-verification/vendors/smile-id/sandbox-roundtrip.test.ts
git commit -m "test(smile-id): sandbox round-trip integration (opt-in)"
```

---

## Task 16: Build `scripts/check-smile-id-codes.ts` (CI drift check)

**Files:**
- Create: `field-service/scripts/check-smile-id-codes.ts`

- [ ] **Step 1: Create the drift-check script**

```typescript
#!/usr/bin/env tsx
/**
 * Drift check: fetch Smile's result-codes reference page and compare known
 * EVD codes against what's in our result-codes.ts. Run in CI so a Smile-side
 * addition or rename surfaces immediately.
 *
 * Exit codes:
 *   0 = no drift detected
 *   1 = drift detected (new EVD code found that's not in our sets)
 *   2 = could not fetch the page (network issue; informational)
 */

import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  SMILE_ID_EVD_FAIL_RESULT_CODES,
} from '../lib/identity-verification/vendors/smile-id/result-codes'

const RESULT_CODES_URL = 'https://docs.usesmileid.com/further-reading/result-codes'

async function main() {
  let html: string
  try {
    const r = await fetch(RESULT_CODES_URL, { headers: { 'user-agent': 'plug-a-pro-ci-driftcheck' } })
    if (!r.ok) {
      console.warn(`Smile docs returned ${r.status}; skipping drift check`)
      process.exit(2)
    }
    html = await r.text()
  } catch (e) {
    console.warn(`Could not fetch result codes page: ${(e as Error).message}`)
    process.exit(2)
  }

  // EVD codes are in the 08xx range; 1014 is also relevant.
  const onPage = new Set<string>()
  for (const match of html.matchAll(/\b(08[0-9]{2})\b/g)) {
    onPage.add(match[1])
  }
  if (/\b1014\b/.test(html)) onPage.add('1014')

  const known = new Set([...SMILE_ID_EVD_PASS_RESULT_CODES, ...SMILE_ID_EVD_FAIL_RESULT_CODES])
  const drift = [...onPage].filter(code => !known.has(code))

  if (drift.length === 0) {
    console.log(`No EVD result-code drift. ${onPage.size} codes on page, all accounted for.`)
    process.exit(0)
  }

  console.error(`EVD result-code drift detected. Page has codes we don't map:`)
  for (const code of drift) console.error(`  - ${code}`)
  console.error('Update lib/identity-verification/vendors/smile-id/result-codes.ts')
  process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(2)
})
```

- [ ] **Step 2: Add an npm script for it**

Edit `field-service/package.json` to add the new script under the existing `scripts` block:

```json
"check:smile-id-codes": "tsx scripts/check-smile-id-codes.ts"
```

- [ ] **Step 3: Run it locally**

```bash
pnpm check:smile-id-codes
```

Expected: exit 0 (no drift) or exit 2 (couldn't fetch — docs return 403 to unauthenticated agents; acceptable).

- [ ] **Step 4: Commit**

```bash
git add scripts/check-smile-id-codes.ts package.json
git commit -m "chore(smile-id): CI drift check for EVD result-codes"
```

---

## Task 17: Apply the 7 spec corrections to the adapter design doc

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md`

The spec was correct on architecture but contained 7 specifics-mismatch-with-Smile-docs items corrected during implementation. Update the spec to match.

- [ ] **Step 1: Add a 2026-05-27 revision note at the top**

Insert a new revision note above the existing one:

```markdown
> **Revision 2026-05-27 (post-doc-research) — Smile API specifics corrected.**
> The earlier revision fixed architectural gaps; this revision corrects Smile API specifics that were plausible-but-unverified:
> - Response field on POST /v1/smile_links is `link_url`, not `link`.
> - `user_id` is nested INSIDE `partner_params`, not a top-level request field.
> - `verification_method` for EVD on Smile Links uses `doc_verification` (the DocV string), with EVD selected by partner product config. NOT `enhanced_document_verification`.
> - ResultCode `1014` is REJECTED ("Unsupported ID number format"), NOT inconclusive.
> - `IsFinalResult` returns as a STRING `"true"` / `"false"` (per smile-identity-core SDK), not boolean. The parse handles both.
> - The official `smile-identity-core` v3.1.0 SDK provides both signature compute and verify helpers; we don't hand-roll HMAC.
> - SA EVD currently only supports `IDENTITY_CARD` for `id_type`; broader DocV id-types are not confirmed for EVD.
```

- [ ] **Step 2: Apply the inline corrections**

For each of the 7 items above, find the place in the spec where the wrong value lives and fix it to match the implementation. Use:

```bash
grep -n '"link"\|enhanced_document_verification\|1014.*INCONCLUSIVE\|IsFinalResult.*true.*boolean' \
  docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md
```

…to locate the exact lines.

- [ ] **Step 3: Verify the spec still reads coherently**

Re-read §5 (submitDocumentCheck), §7 (createLivenessSession), §8 (parseWebhook), §8.1 (deriveDecision), §10 (configJson), §13 (tests). Each should now reflect the implemented code.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md
git commit -m "docs(smile-id): correct Smile API specifics in adapter design"
```

---

## Task 18: Final validation gate

- [ ] **Step 1: Full typecheck**

```bash
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Full identity-verification test suite**

```bash
pnpm vitest run __tests__/lib/identity-verification/
```

Expected: all tests pass — including the 6 new test files under `vendors/smile-id/`, the existing `vendors.test.ts` after cleanup, and `orchestrator.test.ts`.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 5: Drift check (informational)**

```bash
pnpm check:smile-id-codes
```

Expected: exit 0 or exit 2.

- [ ] **Step 6: Push the branch and open a PR**

```bash
git push -u origin feature/smile-id-adapter-integration
gh pr create --base main --head feature/smile-id-adapter-integration \
  --title "feat(smile-id): EVD adapter wired against Smile Links REST API" \
  --body "$(cat <<'EOF'
## Summary
Replaces the scaffolded Smile ID adapter (which threw NotImplementedError) with a fully-wired implementation against Smile Links REST API for South African individual KYC via Enhanced Document Verification (`job_type=11`).

## Modules added
- `lib/identity-verification/vendors/smile-id/index.ts` — adapter wiring submit/createLiveness/parseWebhook/cancel
- `lib/identity-verification/vendors/smile-id/signing.ts` — HMAC sign/verify with single API key
- `lib/identity-verification/vendors/smile-id/smile-links-client.ts` — POST + PUT against /v1/smile_links
- `lib/identity-verification/vendors/smile-id/parse.ts` — webhook payload normalisation with IsFinalResult fallback
- `lib/identity-verification/vendors/smile-id/result-codes.ts` — EVD PASS/FAIL/TERMINAL sets and derivation helpers
- `lib/identity-verification/vendors/smile-id/redact.ts` — PII redaction (Photo, ImageLinks, KYCReceipt, FullName, IDNumber, etc.)
- `lib/identity-verification/vendors/smile-id/types.ts` — Smile API types

## Tests
- 6 new test files under `__tests__/lib/identity-verification/vendors/smile-id/`
- 1 opt-in sandbox round-trip test (skipped without `SMILE_ID_RUN_SANDBOX_TESTS=1`)
- 1 drift-check script (`pnpm check:smile-id-codes`)

## Doc corrections
- Adapter design spec at `docs/superpowers/specs/2026-05-26-smile-id-adapter-design.md` updated with 7 corrections from the 2026-05-27 Smile-docs research pass.

## Sandbox probe findings
- Captured in `docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md`.

## Validation
- `pnpm tsc --noEmit`: clean
- `pnpm vitest run __tests__/lib/identity-verification/`: passing
- `pnpm lint`: clean
- `pnpm build`: clean

## Not in this PR
- Real Smile sandbox credentials (set via env in deploy environments)
- WhatsApp template approvals
- Pilot allowlist seeding

## Test plan
- [ ] Apply migrations on staging
- [ ] Seed vendors (`pnpm seed:verification-vendors`)
- [ ] Set Smile sandbox env vars on staging
- [ ] Run `SMILE_ID_RUN_SANDBOX_TESTS=1 pnpm vitest run sandbox-roundtrip.test.ts` against staging
- [ ] Mint a Smile Link end-to-end with a test SA national ID; confirm webhook arrives and verification transitions to PASSED

EOF
)"
```

Expected: PR URL printed; CI will run on push.

---

## Items NOT in this plan (deferred)

These are tracked in the adapter design spec §14 and should be confirmed before stage-2 rollout, but they don't block this plan from completing:

- **Webhook retry schedule and total retention window** — needs Smile support contact
- **Sustained throughput limits** — needs Smile commercial contact
- **SA data-residency story** — needs Smile commercial / compliance contact
- **Commercial unit pricing finalisation** for `job_type = 11` in SA — needs Smile commercial contact
- **5 SA sandbox test ID numbers and their per-final-digit outcome mapping** — pull from Smile portal once credentials are issued

And from the commercial decision (logged in OpenBrain as `decision — Smile ID commercial proceed with cost controls (2026-05-27)`):

- **Billing trigger confirmation** (link creation vs user start vs completed capture vs final result)
- **Abandoned/expired Smile Links billable?**
- **Smile Secure monthly fee required?**
- **EVD `job_type = 11` includes liveness for SA National ID via Smile Links?**
- **Are retries charged as new checks?**

---

## Glossary

| Term | Definition |
|---|---|
| EVD | Enhanced Document Verification — Smile ID `job_type=11`. Bundles DHA lookup + document OCR/authenticity + selfie-to-document match + liveness. |
| Smile Link | A Smile-hosted browser session URL (minted via `POST /v1/smile_links`) that captures document + selfie + liveness from the end user without us shipping any capture UI. |
| `ref_id` | Smile-assigned identifier for a Smile Link; stored in our schema as `livenessSessionReference`. |
| `SmileJobID` | Smile-assigned identifier for an underlying verification job. Travels back on every webhook callback. |
| `partner_params.job_id` | OUR partner-side unique identifier for the job; stored in our schema as `vendorReference`. Globally unique forever per Smile account. |
| `IsFinalResult` | String `"true"` or `"false"` indicating whether a callback represents the final verdict or an interim ("Under Review") update. May be absent on EVD; falls back to terminal-result-code detection. |
| Partner job id (in our code) | UUID-prefixed string `pap-<uuid>` we put into `partner_params.job_id`. |
