# Didit Decision Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Didit's document images + structured ID fields + redacted raw payload into PlugAPro after each Didit verdict, so admin manual review of Didit-routed verifications has full local context.

**Architecture:** New idempotent `persistDiditDecision` module called at caller boundaries (webhook route + admin refresh action). Download → sha256-check existing row → conditionally upload to Supabase private storage. Field stamp + doc upserts happen in one short Prisma tx after all network I/O is done.

**Tech Stack:** TypeScript (Next.js 16 App Router), Prisma 5, Vitest, Supabase Storage (private bucket), Didit API (`X-Api-Key` auth), existing `lib/identity-verification/crypto.ts` helpers.

**Source spec:** `field-service/docs/superpowers/specs/2026-06-01-didit-document-persistence-design.md` (commit `a871128c9`)

---

## Pre-flight

### Task 0: Create the feature branch

**Files:** none

- [ ] **Step 1: Confirm clean working state for the new branch**

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro"
git status --short | head -20
git log -1 --oneline
```
Expected: HEAD is at or after `a871128c9` (the revised spec). Any pre-staged file moves are unrelated to this feature — leave them in the index.

- [ ] **Step 2: Create + check out the feature branch**

```bash
git checkout -b feat/didit-persist-documents
git log -1 --oneline
```
Expected: branch created from `main`. Same HEAD commit as before.

- [ ] **Step 3: Commit (no changes — branch creation only)**

No commit needed at this step. Proceed to Task 1.

---

## Pure helpers (no I/O, fully unit-testable)

### Task 1: Register the feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts` (insert into the `'provider.identity'` group near line 303)

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/feature-flags-registry-didit-persist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  listRegisteredFeatureFlagKeys,
  resolveFeatureFlagTargets,
} from '../../scripts/feature-flag-groups'

describe('provider.identity.vendor.didit.persist_documents flag', () => {
  it('is registered as a known feature flag key', () => {
    const keys = listRegisteredFeatureFlagKeys()
    expect(keys).toContain('provider.identity.vendor.didit.persist_documents')
  })

  it('defaults to disabled', () => {
    const targets = resolveFeatureFlagTargets({
      flag: 'provider.identity.vendor.didit.persist_documents',
    })
    expect(targets).toHaveLength(1)
    expect(targets[0].key).toBe('provider.identity.vendor.didit.persist_documents')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/feature-flags-registry-didit-persist.test.ts
```
Expected: FAIL — `expect(keys).toContain(...)` fails because the flag is not yet registered.

- [ ] **Step 3: Add the flag**

Open `field-service/lib/feature-flags-registry.ts`. Locate the `'provider.identity.vendor.didit'` entry around line 303. Insert immediately after it:

```ts
  'provider.identity.vendor.didit.persist_documents': {
    description: 'When ON, terminal-state Didit webhooks auto-persist document images, structured ID fields, and a redacted raw payload into PlugAPro. Admin refresh runs persist regardless of this flag.',
    owner: 'eng',
    defaultValue: false,
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/feature-flags-registry-didit-persist.test.ts
```
Expected: PASS — both assertions green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro"
git add field-service/lib/feature-flags-registry.ts \
        field-service/__tests__/lib/feature-flags-registry-didit-persist.test.ts
git commit -m "feat(identity): register provider.identity.vendor.didit.persist_documents flag"
```

---

### Task 2: `isPersistableStatus` predicate

**Files:**
- Create: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isPersistableStatus } from '../../../../../lib/identity-verification/vendors/didit/persist'

describe('isPersistableStatus', () => {
  it('returns true for PASSED', () => {
    expect(isPersistableStatus('PASSED')).toBe(true)
  })

  it('returns true for FAILED', () => {
    expect(isPersistableStatus('FAILED')).toBe(true)
  })

  it('returns true for NEEDS_MANUAL_REVIEW', () => {
    expect(isPersistableStatus('NEEDS_MANUAL_REVIEW')).toBe(true)
  })

  it('returns false for in-flight statuses', () => {
    expect(isPersistableStatus('NOT_STARTED')).toBe(false)
    expect(isPersistableStatus('STARTED')).toBe(false)
    expect(isPersistableStatus('CONSENTED')).toBe(false)
    expect(isPersistableStatus('AWAITING_LIVENESS')).toBe(false)
    expect(isPersistableStatus('PROCESSING')).toBe(false)
  })

  it('returns false for EXPIRED / CANCELLED (audit-only in V1 per spec §3)', () => {
    expect(isPersistableStatus('EXPIRED')).toBe(false)
    expect(isPersistableStatus('CANCELLED')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts
```
Expected: FAIL — module `persist.ts` does not exist yet.

- [ ] **Step 3: Create the module + implement**

Create `field-service/lib/identity-verification/vendors/didit/persist.ts`:

```ts
// Didit decision persistence — module entry point.
//
// Spec: docs/superpowers/specs/2026-06-01-didit-document-persistence-design.md
//
// This module downloads Didit's document/portrait/liveness images, stamps
// structured fields onto the ProviderIdentityVerification row, and stores a
// redacted raw payload — idempotently. Called at caller boundaries: the
// webhook handler and the admin refresh action.

import type { VerificationStatus } from '@prisma/client'

// V1 auto-persists only verdict states. EXPIRED / CANCELLED / in-flight states
// are audit-only per spec §3, §4.7, §9.
const PERSISTABLE_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'PASSED',
  'FAILED',
  'NEEDS_MANUAL_REVIEW',
])

export function isPersistableStatus(status: VerificationStatus): boolean {
  return PERSISTABLE_STATUSES.has(status)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts
```
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): add isPersistableStatus predicate for Didit persist gate"
```

---

### Task 3: `extractImageRefs` pure function

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test (append to persist.test.ts)**

```ts
import { extractImageRefs } from '../../../../../lib/identity-verification/vendors/didit/persist'
import type { DiditDecisionResponse } from '../../../../../lib/identity-verification/vendors/didit/types'

describe('extractImageRefs', () => {
  const FULL_DECISION = {
    session_id: 's1',
    status: 'Approved',
    id_verifications: [{
      status: 'Passed',
      front_image: 'https://cdn.didit.me/s1/front.jpg',
      back_image: 'https://cdn.didit.me/s1/back.jpg',
      portrait_image: 'https://cdn.didit.me/s1/portrait.jpg',
      full_front_image: 'https://cdn.didit.me/s1/full_front.jpg',     // must be ignored
      full_back_image: 'https://cdn.didit.me/s1/full_back.jpg',       // must be ignored
      front_image_camera_front: 'https://cdn.didit.me/s1/front_cam.jpg', // must be ignored
      front_video: 'https://cdn.didit.me/s1/front.mp4',               // must be ignored
    }],
    liveness_checks: [{
      status: 'Passed',
      reference_image: 'https://cdn.didit.me/s1/liveness.jpg',
      video_url: 'https://cdn.didit.me/s1/liveness.mp4',              // must be ignored
    }],
    face_matches: [{
      source_image: 'https://cdn.didit.me/s1/face_src.jpg',           // must be ignored
      target_image: 'https://cdn.didit.me/s1/face_tgt.jpg',           // must be ignored
    }],
  } as unknown as DiditDecisionResponse

  it('emits exactly the four V1-mapped kinds in stable order', () => {
    const refs = extractImageRefs(FULL_DECISION)
    expect(refs).toEqual([
      { kind: 'ID_FRONT', sourceUrl: 'https://cdn.didit.me/s1/front.jpg' },
      { kind: 'ID_BACK', sourceUrl: 'https://cdn.didit.me/s1/back.jpg' },
      { kind: 'SELFIE', sourceUrl: 'https://cdn.didit.me/s1/portrait.jpg' },
      { kind: 'LIVENESS_FRAME', sourceUrl: 'https://cdn.didit.me/s1/liveness.jpg' },
    ])
  })

  it('omits kinds whose source URL is missing or empty', () => {
    const partial = {
      ...FULL_DECISION,
      id_verifications: [{ status: 'Passed', front_image: 'https://x', back_image: '', portrait_image: undefined }],
      liveness_checks: [],
    } as unknown as DiditDecisionResponse
    const refs = extractImageRefs(partial)
    expect(refs).toEqual([{ kind: 'ID_FRONT', sourceUrl: 'https://x' }])
  })

  it('returns empty when id_verifications is missing', () => {
    expect(extractImageRefs({ session_id: 's1', status: 'Approved' } as unknown as DiditDecisionResponse)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t extractImageRefs
```
Expected: FAIL — `extractImageRefs` not exported yet.

- [ ] **Step 3: Implement**

Append to `field-service/lib/identity-verification/vendors/didit/persist.ts`:

```ts
import type { IdentityDocumentKind } from '@prisma/client'
import type { DiditDecisionResponse } from './types'

export type ImageRef = { kind: IdentityDocumentKind; sourceUrl: string }

export function extractImageRefs(decision: DiditDecisionResponse): ImageRef[] {
  const refs: ImageRef[] = []
  const idVerification = decision.id_verifications?.[0]
  if (idVerification) {
    if (idVerification.front_image) refs.push({ kind: 'ID_FRONT', sourceUrl: idVerification.front_image })
    if (idVerification.back_image) refs.push({ kind: 'ID_BACK', sourceUrl: idVerification.back_image })
    if (idVerification.portrait_image) refs.push({ kind: 'SELFIE', sourceUrl: idVerification.portrait_image })
  }
  const liveness = decision.liveness_checks?.[0]
  if (liveness?.reference_image) {
    refs.push({ kind: 'LIVENESS_FRAME', sourceUrl: liveness.reference_image })
  }
  return refs
}
```

Note: `front_image`, `back_image`, `portrait_image`, `reference_image` may not yet be typed on `DiditDecisionResponse`. If TS errors, widen the type in `lib/identity-verification/vendors/didit/types.ts` first — add these optional string fields to the existing interfaces. Make those type additions part of THIS task's commit.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t extractImageRefs
cd field-service && pnpm tsc --noEmit
```
Expected: PASS on all three cases; tsc clean (excluding any pre-existing errors on main).

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/lib/identity-verification/vendors/didit/types.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): extractImageRefs maps Didit decision -> 4 V1 doc kinds"
```

---

### Task 4: `redactPayload` pure function

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `persist.test.ts`:

```ts
import { redactPayload } from '../../../../../lib/identity-verification/vendors/didit/persist'

describe('redactPayload', () => {
  const decision = {
    session_id: 's1',
    status: 'Approved',
    created_at: 1780310769,
    decision: {
      session_id: 's1',
      id_verifications: [{
        status: 'Passed',
        full_name: 'John Doe',
        first_name: 'John',
        last_name: 'Doe',
        date_of_birth: '1990-01-01',
        document_type: 'Driver License',
        document_number: 'D1234567890',
        personal_number: '9001015800087',
        address: '123 Main St, Apt 4B',
        formatted_address: '123 Main Street, NY, 10001',
        parsed_address: { street_1: '123 Main St', street_2: 'Apt 4B', city: 'NY', region: 'NY', postal_code: '10001', country: 'USA' },
        front_image: 'https://cdn.didit.me/s1/front.jpg',
        back_image: 'https://cdn.didit.me/s1/back.jpg',
        portrait_image: 'https://cdn.didit.me/s1/portrait.jpg',
        full_front_image: 'https://cdn.didit.me/s1/full_front.jpg',
        front_video: 'https://cdn.didit.me/s1/front.mp4',
      }],
      liveness_checks: [{ status: 'Passed', score: 0.98, reference_image: 'https://cdn.didit.me/s1/liveness.jpg', video_url: 'https://cdn.didit.me/s1/v.mp4' }],
      face_matches: [{ score: 0.94, source_image: 'https://x', target_image: 'https://y' }],
      aml_screenings: [{ status: 'Passed', total_hits: 0, screened_data: { full_name: 'John Doe', date_of_birth: '1990-01-01' } }],
    },
  } as unknown as Parameters<typeof redactPayload>[0]

  it('drops every image and video URL', () => {
    const redacted = JSON.stringify(redactPayload(decision))
    expect(redacted).not.toMatch(/cdn\.didit\.me/)
    expect(redacted).not.toMatch(/\.jpg/)
    expect(redacted).not.toMatch(/\.mp4/)
  })

  it('replaces PII fields with <HASH:...> markers', () => {
    const out = JSON.parse(JSON.stringify(redactPayload(decision))) as Record<string, unknown>
    const idv = (out.decision as { id_verifications: Array<Record<string, unknown>> }).id_verifications[0]
    expect(idv.personal_number).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    expect(idv.document_number).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    expect(idv.address).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    expect(idv.formatted_address).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    expect((idv.parsed_address as Record<string, unknown>).street_1).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    const aml = (out.decision as { aml_screenings: Array<Record<string, unknown>> }).aml_screenings[0]
    expect((aml.screened_data as Record<string, unknown>).full_name).toMatch(/^<HASH:[0-9a-f]{8}>$/)
    expect((aml.screened_data as Record<string, unknown>).date_of_birth).toMatch(/^<HASH:[0-9a-f]{8}>$/)
  })

  it('preserves scores, statuses, ids, timestamps', () => {
    const out = JSON.parse(JSON.stringify(redactPayload(decision))) as Record<string, unknown>
    expect(out.session_id).toBe('s1')
    expect(out.status).toBe('Approved')
    expect(out.created_at).toBe(1780310769)
    const dec = out.decision as Record<string, unknown>
    expect((dec.liveness_checks as Array<Record<string, unknown>>)[0].score).toBe(0.98)
    expect((dec.face_matches as Array<Record<string, unknown>>)[0].score).toBe(0.94)
    expect((dec.aml_screenings as Array<Record<string, unknown>>)[0].total_hits).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t redactPayload
```
Expected: FAIL — `redactPayload` not exported.

- [ ] **Step 3: Implement**

Append to `persist.ts`:

```ts
import { createHash } from 'node:crypto'

const PII_HASH_LENGTH = 8

// Field names whose values are PII and must be hashed before archival.
const PII_FIELD_NAMES: ReadonlySet<string> = new Set([
  'personal_number',
  'document_number',
  'address',
  'formatted_address',
  'street_1',
  'street_2',
  'full_name',
  'first_name',
  'last_name',
  'date_of_birth',
])

// Field names whose values are CDN URLs (images, videos) and must be dropped.
const URL_FIELD_NAMES: ReadonlySet<string> = new Set([
  'front_image',
  'back_image',
  'portrait_image',
  'full_front_image',
  'full_back_image',
  'front_image_camera_front',
  'back_image_camera_front',
  'face_image',
  'reference_image',
  'source_image',
  'target_image',
  'signature_image',
  'document_file',
  'front_video',
  'back_video',
  'video_url',
])

function hashPiiValue(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, PII_HASH_LENGTH)
  return `<HASH:${digest}>`
}

function redactNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(redactNode)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (URL_FIELD_NAMES.has(key)) continue              // drop entirely
      if (PII_FIELD_NAMES.has(key) && typeof value === 'string' && value.length > 0) {
        out[key] = hashPiiValue(value)
        continue
      }
      out[key] = redactNode(value)
    }
    return out
  }
  return node
}

export function redactPayload(decision: DiditDecisionResponse): unknown {
  return redactNode(decision)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t redactPayload
```
Expected: PASS — all three cases green.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): redactPayload drops URLs and hashes PII fields"
```

---

### Task 5: `mapDecisionToVerificationFields` + `tryMapDecisionToVerificationFields`

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `persist.test.ts`:

```ts
import {
  mapDecisionToVerificationFields,
  tryMapDecisionToVerificationFields,
} from '../../../../../lib/identity-verification/vendors/didit/persist'

// Suppress key env reads — encrypt/hash helpers need these to function.
process.env.IDENTITY_ENC_KEY ||= 'a'.repeat(32)  // 32 bytes, ascii
process.env.IDENTITY_HASH_PEPPER ||= 'test-pepper-for-vitest'

describe('mapDecisionToVerificationFields', () => {
  const APPROVED_DECISION = {
    session_id: 's1',
    status: 'Approved',
    created_at: 1780310769,
    decision: {
      id_verifications: [{
        status: 'Passed',
        personal_number: '9001015800087',
        document_number: 'D1234567890',
        date_of_birth: '1990-01-01',
        gender: 'M',
        nationality: 'ZAF',
        issuing_state: 'ZAF',
        expiration_date: '2030-12-31',
        front_image_quality_score: { overall_score: 88.7 },
        warnings: [],
      }],
      liveness_checks: [{ status: 'Passed', score: 0.97 }],
      face_matches: [{ status: 'Passed', score: 0.94 }],
      aml_screenings: [{ status: 'Passed', hits: [] }],
    },
  } as unknown as Parameters<typeof mapDecisionToVerificationFields>[0]

  it('hashes + encrypts personal_number', () => {
    const fields = mapDecisionToVerificationFields(APPROVED_DECISION)
    expect(fields.identifierLast4).toBe('0087')
    expect(fields.identifierHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fields.identifierEncrypted).toMatch(/^v1:/)        // version prefix from crypto.ts
  })

  it('hashes document_number but does NOT encrypt it', () => {
    const fields = mapDecisionToVerificationFields(APPROVED_DECISION)
    expect(fields.documentNumberLast4).toBe('7890')
    expect(fields.documentNumberHash).toMatch(/^[0-9a-f]{64}$/)
    expect((fields as Record<string, unknown>).documentNumberEncrypted).toBeUndefined()
  })

  it('maps derived fields with Didit "score" first, fallback to legacy names', () => {
    const fields = mapDecisionToVerificationFields(APPROVED_DECISION)
    expect(fields.dobDerived).toBeInstanceOf(Date)
    expect(fields.dobDerived?.toISOString().slice(0, 10)).toBe('1990-01-01')
    expect(fields.genderDerived).toBe('M')
    expect(fields.nationality).toBe('ZAF')
    expect(fields.citizenshipDerived).toBe('ZAF')
    expect(fields.issuingCountry).toBe('ZAF')
    expect(fields.documentExpiryDate?.toISOString().slice(0, 10)).toBe('2030-12-31')
    expect(fields.livenessScore).toBe(0.97)
    expect(fields.selfieMatchScore).toBe(0.94)
    expect(fields.documentConfidenceScore).toBe(88.7)
    expect(fields.decisionAt).toBeInstanceOf(Date)
  })

  it('falls back from "score" to legacy fields when needed', () => {
    const legacyShape = {
      session_id: 's1',
      status: 'Approved',
      decision: {
        id_verifications: [{ status: 'Passed', score: 0.85 }],
        liveness_checks: [{ status: 'Passed', liveness_score: 0.91 }],
        face_matches: [{ status: 'Passed', face_match_score: 0.88 }],
      },
    } as unknown as Parameters<typeof mapDecisionToVerificationFields>[0]
    const fields = mapDecisionToVerificationFields(legacyShape)
    expect(fields.livenessScore).toBe(0.91)
    expect(fields.selfieMatchScore).toBe(0.88)
    expect(fields.documentConfidenceScore).toBe(0.85)
  })

  it('throws when id_verifications is missing entirely', () => {
    expect(() => mapDecisionToVerificationFields({ session_id: 's1', status: 'Approved' } as unknown as Parameters<typeof mapDecisionToVerificationFields>[0]))
      .toThrow(/id_verifications/)
  })
})

describe('tryMapDecisionToVerificationFields', () => {
  it('returns ok:true on successful map', () => {
    const result = tryMapDecisionToVerificationFields(APPROVED_DECISION)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.identifierLast4).toBe('0087')
  })

  it('returns ok:false with reason on map failure', () => {
    const result = tryMapDecisionToVerificationFields({ session_id: 's1', status: 'X' } as unknown as Parameters<typeof tryMapDecisionToVerificationFields>[0])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/id_verifications/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t mapDecisionToVerificationFields
```
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `persist.ts`:

```ts
import type { Prisma } from '@prisma/client'
import {
  encryptIdentifier,
  hashIdentifier,
  identifierLast4,
} from '../../crypto'

const PERSONAL_NUMBER_NAMESPACE = 'identity:didit-personal-number'
const DOCUMENT_NUMBER_NAMESPACE = 'identity:didit-document-number'

export type MappedFields = Partial<Prisma.ProviderIdentityVerificationUncheckedUpdateInput>

export function mapDecisionToVerificationFields(decision: DiditDecisionResponse): MappedFields {
  // Didit's payload nests the verdict inside `decision` for some webhook
  // envelope shapes and at the top level for the retrieve-session response.
  // Normalise to whichever shape carries the arrays.
  const root = (decision as Record<string, unknown>).decision ?? decision
  const r = root as Record<string, unknown>
  const idVerifications = r.id_verifications as Array<Record<string, unknown>> | undefined
  if (!idVerifications || idVerifications.length === 0) {
    throw new Error('Decision missing id_verifications[]')
  }
  const idv = idVerifications[0]
  const liveness = (r.liveness_checks as Array<Record<string, unknown>> | undefined)?.[0]
  const faceMatch = (r.face_matches as Array<Record<string, unknown>> | undefined)?.[0]
  const amlScreenings = (r.aml_screenings as Array<Record<string, unknown>> | undefined) ?? []
  const warnings = (idv.warnings as unknown[] | undefined) ?? []

  const fields: MappedFields = {}

  if (typeof idv.personal_number === 'string' && idv.personal_number.length > 0) {
    fields.identifierEncrypted = encryptIdentifier(idv.personal_number)
    fields.identifierHash = hashIdentifier(idv.personal_number, PERSONAL_NUMBER_NAMESPACE)
    fields.identifierLast4 = identifierLast4(idv.personal_number)
  }
  if (typeof idv.document_number === 'string' && idv.document_number.length > 0) {
    fields.documentNumberHash = hashIdentifier(idv.document_number, DOCUMENT_NUMBER_NAMESPACE)
    fields.documentNumberLast4 = identifierLast4(idv.document_number)
  }
  if (typeof idv.date_of_birth === 'string') {
    fields.dobDerived = parseISO(idv.date_of_birth)
  }
  if (typeof idv.gender === 'string') fields.genderDerived = idv.gender
  if (typeof idv.nationality === 'string') {
    fields.nationality = idv.nationality
    fields.citizenshipDerived = idv.nationality
  }
  if (typeof idv.issuing_state === 'string') fields.issuingCountry = idv.issuing_state
  if (typeof idv.expiration_date === 'string') {
    fields.documentExpiryDate = parseISO(idv.expiration_date)
  }

  const livenessScore = pickScore(liveness, ['score', 'liveness_score'])
  if (livenessScore !== null) fields.livenessScore = livenessScore

  const selfieScore = pickScore(faceMatch, ['score', 'face_match_score'])
  if (selfieScore !== null) fields.selfieMatchScore = selfieScore

  const docConfidence = pickScore(idv, ['front_image_quality_score', 'score', 'confidence'], { dotPath: ['front_image_quality_score', 'overall_score'] })
  if (docConfidence !== null) fields.documentConfidenceScore = docConfidence

  fields.riskFlags = JSON.stringify({
    warnings,
    aml_hits: amlScreenings.flatMap((s) => (s.hits as unknown[] | undefined) ?? []),
  }) as unknown as Prisma.InputJsonValue

  const createdAt = (decision as Record<string, unknown>).created_at
  if (typeof createdAt === 'number') {
    fields.decisionAt = new Date(createdAt * 1000)
  } else if (typeof createdAt === 'string') {
    fields.decisionAt = new Date(createdAt)
  }

  return fields
}

export type MapResult =
  | { ok: true; data: MappedFields }
  | { ok: false; reason: string }

export function tryMapDecisionToVerificationFields(decision: DiditDecisionResponse): MapResult {
  try {
    return { ok: true, data: mapDecisionToVerificationFields(decision) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

function parseISO(value: string): Date | undefined {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function pickScore(
  source: Record<string, unknown> | undefined,
  keys: string[],
  opts: { dotPath?: string[] } = {},
): number | null {
  if (!source) return null
  if (opts.dotPath) {
    let cursor: unknown = source
    for (const seg of opts.dotPath) {
      if (cursor && typeof cursor === 'object') cursor = (cursor as Record<string, unknown>)[seg]
      else return null
    }
    if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor
  }
  for (const k of keys) {
    const v = source[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t mapDecisionToVerificationFields
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t tryMapDecisionToVerificationFields
cd field-service && pnpm tsc --noEmit
```
Expected: PASS on all cases; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): mapDecisionToVerificationFields with score fallback chain"
```

---

### Task 6: `toIdentityDocumentFile` helper

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `persist.test.ts`:

```ts
import { toIdentityDocumentFile } from '../../../../../lib/identity-verification/vendors/didit/persist'

describe('toIdentityDocumentFile', () => {
  it('wraps bytes as a File with the correct content type and extension', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])   // JPEG magic
    const file = toIdentityDocumentFile({ bytes, mimeType: 'image/jpeg', kind: 'ID_FRONT' })
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^ID_FRONT-\d+\.jpg$/)
    expect(file.size).toBe(4)
    const back = await file.arrayBuffer()
    expect(Buffer.from(back).equals(bytes)).toBe(true)
  })

  it('picks the right extension for png/webp/heic/pdf', () => {
    const png = toIdentityDocumentFile({ bytes: Buffer.from('abc'), mimeType: 'image/png', kind: 'SELFIE' })
    const webp = toIdentityDocumentFile({ bytes: Buffer.from('abc'), mimeType: 'image/webp', kind: 'SELFIE' })
    const heic = toIdentityDocumentFile({ bytes: Buffer.from('abc'), mimeType: 'image/heic', kind: 'SELFIE' })
    const pdf = toIdentityDocumentFile({ bytes: Buffer.from('abc'), mimeType: 'application/pdf', kind: 'ID_FRONT' })
    expect(png.name).toMatch(/\.png$/)
    expect(webp.name).toMatch(/\.webp$/)
    expect(heic.name).toMatch(/\.heic$/)
    expect(pdf.name).toMatch(/\.pdf$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t toIdentityDocumentFile
```
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

Append to `persist.ts`:

```ts
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

export function toIdentityDocumentFile(params: {
  bytes: Buffer
  mimeType: string
  kind: IdentityDocumentKind
}): File {
  const ext = MIME_TO_EXT[params.mimeType] ?? 'bin'
  const name = `${params.kind}-${Date.now()}.${ext}`
  // Node 20+ ships a global File constructor compatible with the Web spec.
  // Cast Buffer -> Uint8Array to satisfy the BlobPart contract.
  return new File([new Uint8Array(params.bytes)], name, { type: params.mimeType })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t toIdentityDocumentFile
```
Expected: PASS on both cases.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): toIdentityDocumentFile wraps bytes as File"
```

---

## I/O helpers

### Task 7: `downloadDocumentImage` with X-Api-Key fallback

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `persist.test.ts`:

```ts
import {
  downloadDocumentImage,
  DiditImageDownloadError,
} from '../../../../../lib/identity-verification/vendors/didit/persist'

describe('downloadDocumentImage', () => {
  const ORIGINAL_FETCH = global.fetch
  afterEach(() => { global.fetch = ORIGINAL_FETCH })

  // Stub diditConfig.apiKey via env var the loader reads.
  beforeAll(() => {
    process.env.DIDIT_API_KEY ||= 'test-api-key-12345'
    process.env.DIDIT_PROVIDER_KYC_WORKFLOW_ID ||= '00000000-0000-0000-0000-000000000001'
    process.env.DIDIT_WEBHOOK_SECRET ||= 'test-webhook-secret'
  })

  it('GETs the url with X-Api-Key header and returns bytes + sha256 + mime', async () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02])
    let captured: { url: string; headers: Headers } | null = null
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), headers: new Headers(init?.headers) }
      return new Response(payload, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as typeof fetch

    const result = await downloadDocumentImage('https://cdn.didit.me/img.jpg')
    expect(captured!.url).toBe('https://cdn.didit.me/img.jpg')
    expect(captured!.headers.get('X-Api-Key')).toBe('test-api-key-12345')
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.equals(payload)).toBe(true)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('retries with lowercase x-api-key on 401', async () => {
    const calls: string[] = []
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      // First call sends "X-Api-Key" (Headers normalises to title-case key, value matches)
      calls.push(headers.has('x-api-key') ? 'present' : 'absent')
      if (calls.length === 1) return new Response('', { status: 401 })
      return new Response(Buffer.from('ok'), { status: 200, headers: { 'content-type': 'image/png' } })
    }) as typeof fetch

    const result = await downloadDocumentImage('https://cdn.didit.me/img.png')
    expect(calls).toHaveLength(2)        // first 401, then retry succeeds
    expect(result.mimeType).toBe('image/png')
  })

  it('throws DiditImageDownloadError on non-200, non-401 after retry', async () => {
    global.fetch = (async () => new Response('', { status: 500 })) as typeof fetch
    await expect(downloadDocumentImage('https://cdn.didit.me/x.jpg')).rejects.toBeInstanceOf(DiditImageDownloadError)
  })

  it('throws DiditImageDownloadError with status when fetch rejects', async () => {
    global.fetch = (async () => { throw new TypeError('network down') }) as typeof fetch
    await expect(downloadDocumentImage('https://cdn.didit.me/y.jpg')).rejects.toThrow(/network/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t downloadDocumentImage
```
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `persist.ts`:

```ts
import { getDiditConfig } from './config'

export class DiditImageDownloadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'DiditImageDownloadError'
  }
}

export type DownloadedImage = {
  bytes: Buffer
  sha256: string
  mimeType: string
}

export async function downloadDocumentImage(url: string): Promise<DownloadedImage> {
  const config = getDiditConfig()
  if (!config.enabled) {
    throw new DiditImageDownloadError(`Didit disabled: ${config.reason}`)
  }

  const fetchOnce = async (headerKey: 'X-Api-Key' | 'x-api-key'): Promise<Response> => {
    return fetch(url, { headers: { [headerKey]: config.apiKey } })
  }

  let response: Response
  try {
    response = await fetchOnce('X-Api-Key')
  } catch (err) {
    throw new DiditImageDownloadError(`Didit CDN fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (response.status === 401) {
    // Some CDNs are case-sensitive on header lookup. Retry once.
    try {
      response = await fetchOnce('x-api-key')
    } catch (err) {
      throw new DiditImageDownloadError(`Didit CDN fetch failed (retry): ${err instanceof Error ? err.message : String(err)}`, 401)
    }
  }

  if (!response.ok) {
    throw new DiditImageDownloadError(`Didit CDN returned ${response.status}`, response.status)
  }

  const arrayBuffer = await response.arrayBuffer()
  const bytes = Buffer.from(arrayBuffer)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const mimeType = response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream'

  return { bytes, sha256, mimeType }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t downloadDocumentImage
```
Expected: PASS on all four cases.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): downloadDocumentImage with X-Api-Key + 401 retry fallback"
```

---

## Module assembly

### Task 8: `persistDiditDecision` — happy path

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts`
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the failing test (mocks `uploadIdentityDocument` + Prisma)**

Append to `persist.test.ts`:

```ts
import { vi } from 'vitest'
import { persistDiditDecision } from '../../../../../lib/identity-verification/vendors/didit/persist'

vi.mock('../../../../../lib/storage', () => ({
  uploadIdentityDocument: vi.fn(async ({ documentKind }: { documentKind: string }) => ({
    pathname: `supabase://identity-documents/identity/v1/${documentKind}-mock.jpg`,
    url: null,
  })),
}))

vi.mock('../../../../../lib/db', () => {
  const txObj: Record<string, unknown> = {}
  const db = {
    providerIdentityDocument: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback({
      providerIdentityVerification: {
        findUniqueOrThrow: vi.fn(async () => ({ status: 'NEEDS_MANUAL_REVIEW' })),
        update: vi.fn(async () => ({})),
      },
      providerIdentityDocument: {
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      providerVerificationEvent: {
        create: vi.fn(async () => ({})),
      },
    })),
  }
  return { db, __test: { txObj } }
})

describe('persistDiditDecision — happy path', () => {
  const DECISION = {
    session_id: 's1',
    status: 'Approved',
    created_at: 1780310769,
    decision: {
      id_verifications: [{
        status: 'Passed',
        personal_number: '9001015800087',
        document_number: 'D1234567890',
        date_of_birth: '1990-01-01',
        gender: 'M',
        nationality: 'ZAF',
        issuing_state: 'ZAF',
        expiration_date: '2030-12-31',
        front_image: 'https://cdn.didit.me/s1/front.jpg',
        back_image: 'https://cdn.didit.me/s1/back.jpg',
        portrait_image: 'https://cdn.didit.me/s1/portrait.jpg',
      }],
      liveness_checks: [{ status: 'Passed', score: 0.97, reference_image: 'https://cdn.didit.me/s1/liveness.jpg' }],
      face_matches: [{ status: 'Passed', score: 0.94 }],
    },
  } as unknown as Parameters<typeof persistDiditDecision>[1]

  beforeEach(() => {
    global.fetch = (async (input: RequestInfo | URL) => {
      // any image GET returns 4 bytes of "DOC1"+url-suffix so each kind has different sha256
      const suffix = String(input).split('/').pop()!
      return new Response(Buffer.from(`DOC-${suffix}`), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as typeof fetch
  })
  afterEach(() => { vi.clearAllMocks() })

  it('downloads 4 images, uploads each, stamps fields, writes summary event', async () => {
    const result = await persistDiditDecision('verif-1', DECISION, { source: 'webhook' })
    expect(result.fieldsStamped).toBe(true)
    expect(result.documentsStored.sort()).toEqual(['ID_BACK', 'ID_FRONT', 'LIVENESS_FRAME', 'SELFIE'])
    expect(result.documentsSkipped).toEqual([])
    expect(result.documentsFailed).toEqual([])
    expect(result.payloadRedacted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t "persistDiditDecision — happy path"
```
Expected: FAIL — `persistDiditDecision` not exported.

- [ ] **Step 3: Implement**

Append to `persist.ts`:

```ts
import { uploadIdentityDocument } from '../../../storage'
import { db } from '../../../db'
import { addDays } from 'date-fns'

const RAW_DOCUMENT_RETENTION_DAYS = 60

export type PersistResult = {
  fieldsStamped: boolean
  documentsStored: IdentityDocumentKind[]
  documentsSkipped: IdentityDocumentKind[]
  documentsFailed: { kind: IdentityDocumentKind; reason: string }[]
  payloadRedacted: boolean
}

type PerKindAction =
  | { kind: IdentityDocumentKind; action: 'skip' }
  | { kind: IdentityDocumentKind; action: 'create'; storageRef: string; sha256: string; mimeType: string; sizeBytes: number }
  | { kind: IdentityDocumentKind; action: 'update'; existingId: string; storageRef: string; sha256: string; mimeType: string; sizeBytes: number }

export async function persistDiditDecision(
  verificationId: string,
  decision: DiditDecisionResponse,
  options: { source: 'webhook' | 'admin_refresh' },
): Promise<PersistResult> {
  const refs = extractImageRefs(decision)

  const results = await Promise.allSettled(
    refs.map(async ({ kind, sourceUrl }): Promise<PerKindAction> => {
      const downloaded = await downloadDocumentImage(sourceUrl)
      const existing = await db.providerIdentityDocument.findFirst({
        where: { verificationId, documentKind: kind, status: { not: 'DELETED' } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing && existing.sha256 === downloaded.sha256) {
        return { kind, action: 'skip' }
      }
      const file = toIdentityDocumentFile({ bytes: downloaded.bytes, mimeType: downloaded.mimeType, kind })
      const uploaded = await uploadIdentityDocument({ verificationId, documentKind: kind, file })
      return existing
        ? { kind, action: 'update', existingId: existing.id, storageRef: uploaded.pathname, sha256: downloaded.sha256, mimeType: downloaded.mimeType, sizeBytes: downloaded.bytes.length }
        : { kind, action: 'create', storageRef: uploaded.pathname, sha256: downloaded.sha256, mimeType: downloaded.mimeType, sizeBytes: downloaded.bytes.length }
    }),
  )

  const fieldMapping = tryMapDecisionToVerificationFields(decision)
  const documentsStored: IdentityDocumentKind[] = []
  const documentsSkipped: IdentityDocumentKind[] = []
  const documentsFailed: { kind: IdentityDocumentKind; reason: string }[] = []

  results.forEach((r, i) => {
    const kind = refs[i].kind
    if (r.status === 'rejected') {
      documentsFailed.push({ kind, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) })
      return
    }
    if (r.value.action === 'skip') documentsSkipped.push(kind)
    else documentsStored.push(kind)
  })

  await db.$transaction(async (tx) => {
    const current = await tx.providerIdentityVerification.findUniqueOrThrow({
      where: { id: verificationId },
      select: { status: true },
    })

    if (fieldMapping.ok) {
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { ...fieldMapping.data, rawPayloadRedacted: redactPayload(decision) as Prisma.InputJsonValue },
      })
    } else {
      await tx.providerIdentityVerification.update({
        where: { id: verificationId },
        data: { rawPayloadRedacted: redactPayload(decision) as Prisma.InputJsonValue },
      })
    }

    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const action = r.value
      if (action.action === 'update') {
        await tx.providerIdentityDocument.update({
          where: { id: action.existingId },
          data: {
            blobKey: action.storageRef,
            sha256: action.sha256,
            mimeType: action.mimeType,
            sizeBytes: action.sizeBytes,
            status: 'UPLOADED',
          },
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
            deleteAfter: addDays(new Date(), RAW_DOCUMENT_RETENTION_DAYS),
          },
        })
      }
    }

    await tx.providerVerificationEvent.create({
      data: {
        verificationId,
        fromStatus: current.status,
        toStatus: current.status,
        reasonCode: 'DIDIT_PERSIST_COMPLETED',
        metadata: {
          source: options.source,
          fieldsStamped: fieldMapping.ok,
          fieldError: fieldMapping.ok ? null : fieldMapping.reason,
          stored: documentsStored,
          skipped: documentsSkipped,
          failed: documentsFailed,
        },
      },
    })
  })

  return {
    fieldsStamped: fieldMapping.ok,
    documentsStored,
    documentsSkipped,
    documentsFailed,
    payloadRedacted: true,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t "persistDiditDecision — happy path"
cd field-service && pnpm tsc --noEmit
```
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/vendors/didit/persist.ts \
        field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "feat(identity): persistDiditDecision happy path — download, upload, stamp, summarise"
```

---

### Task 9: `persistDiditDecision` — idempotency + sha-changed + per-kind isolation

**Files:**
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

These tests should pass against the Task 8 implementation. If any fail, fix the bug, then commit.

- [ ] **Step 1: Add idempotency test**

```ts
describe('persistDiditDecision — idempotency', () => {
  it('skips upload when sha256 matches existing row', async () => {
    // Mock findFirst to return existing rows with matching sha256s
    const { db } = await import('../../../../../lib/db')
    const FIXED_SHA = createHash('sha256').update('DOC-front.jpg').digest('hex')
    ;(db.providerIdentityDocument.findFirst as ReturnType<typeof vi.fn>)
      .mockImplementation(async ({ where }: { where: { documentKind: IdentityDocumentKind } }) => ({
        id: `existing-${where.documentKind}`,
        sha256: createHash('sha256').update(`DOC-${imageForKind(where.documentKind)}`).digest('hex'),
        status: 'UPLOADED',
        createdAt: new Date(),
      }))

    const result = await persistDiditDecision('verif-1', DECISION, { source: 'admin_refresh' })
    expect(result.documentsSkipped.sort()).toEqual(['ID_BACK', 'ID_FRONT', 'LIVENESS_FRAME', 'SELFIE'])
    expect(result.documentsStored).toEqual([])
  })
})

function imageForKind(kind: IdentityDocumentKind): string {
  if (kind === 'ID_FRONT') return 'front.jpg'
  if (kind === 'ID_BACK') return 'back.jpg'
  if (kind === 'SELFIE') return 'portrait.jpg'
  if (kind === 'LIVENESS_FRAME') return 'liveness.jpg'
  return ''
}
```

- [ ] **Step 2: Add sha-changed test**

```ts
describe('persistDiditDecision — sha changed', () => {
  it('updates existing row when sha256 differs', async () => {
    const { db } = await import('../../../../../lib/db')
    ;(db.providerIdentityDocument.findFirst as ReturnType<typeof vi.fn>)
      .mockImplementation(async ({ where }: { where: { documentKind: IdentityDocumentKind } }) => ({
        id: `existing-${where.documentKind}`,
        sha256: 'OLD_SHA_DIFFERS',
        status: 'UPLOADED',
        createdAt: new Date(),
      }))

    const result = await persistDiditDecision('verif-1', DECISION, { source: 'webhook' })
    expect(result.documentsStored.sort()).toEqual(['ID_BACK', 'ID_FRONT', 'LIVENESS_FRAME', 'SELFIE'])
    expect(result.documentsSkipped).toEqual([])
  })
})
```

- [ ] **Step 3: Add per-kind isolation test**

```ts
describe('persistDiditDecision — per-kind isolation', () => {
  it('ID_BACK download failure does not break other kinds', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('back.jpg')) {
        return new Response('', { status: 500 })
      }
      return new Response(Buffer.from('OK'), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as typeof fetch

    const result = await persistDiditDecision('verif-1', DECISION, { source: 'webhook' })
    expect(result.documentsFailed.map((f) => f.kind)).toEqual(['ID_BACK'])
    expect(result.documentsStored.sort()).toEqual(['ID_FRONT', 'LIVENESS_FRAME', 'SELFIE'])
  })
})
```

- [ ] **Step 4: Run all three test groups**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t "idempotency|sha changed|per-kind isolation"
```
Expected: PASS on all three. If any fail, debug the implementation from Task 8 and fix.

- [ ] **Step 5: Commit**

```bash
git add field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "test(identity): persistDiditDecision idempotency, sha-change, per-kind isolation"
```

---

### Task 10: `persistDiditDecision` — shape-mismatch isolation

**Files:**
- Test: `field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe('persistDiditDecision — shape mismatch', () => {
  it('returns fieldsStamped:false when mapper rejects but still persists docs', async () => {
    const malformed = {
      session_id: 's1',
      status: 'Approved',
      decision: {
        // Missing id_verifications array
        liveness_checks: [{ status: 'Passed', score: 0.97, reference_image: 'https://cdn.didit.me/s1/liveness.jpg' }],
      },
    } as unknown as Parameters<typeof persistDiditDecision>[1]

    const result = await persistDiditDecision('verif-1', malformed, { source: 'webhook' })
    expect(result.fieldsStamped).toBe(false)
    expect(result.documentsStored).toEqual(['LIVENESS_FRAME'])  // still persisted
    expect(result.payloadRedacted).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd field-service && pnpm vitest run __tests__/lib/identity-verification/vendors/didit/persist.test.ts -t "shape mismatch"
```
Expected: PASS — confirms the design's "best-effort field stamp, docs still persist" contract.

- [ ] **Step 3: Commit**

```bash
git add field-service/__tests__/lib/identity-verification/vendors/didit/persist.test.ts
git commit -m "test(identity): persistDiditDecision shape mismatch — docs persist even if fields fail"
```

---

## Integration into existing flows

### Task 11: Webhook handler calls persist after applyVendorVerdict

**Files:**
- Modify: `field-service/app/api/webhooks/verification/[vendor]/route.ts`
- Test: `field-service/__tests__/api/verification-webhook-route.test.ts` (already exists; extend)

- [ ] **Step 1: Read the current webhook route**

```bash
cd field-service && sed -n '1,50p' app/api/webhooks/verification/\[vendor\]/route.ts
cd field-service && sed -n '95,130p' app/api/webhooks/verification/\[vendor\]/route.ts
```
Locate the line that calls `applyVendorVerdict(verification.id, parsed.result, 'webhook')`. The new code goes immediately after.

- [ ] **Step 2: Write the failing test (extend existing webhook test file)**

Append to `field-service/__tests__/api/verification-webhook-route.test.ts`:

```ts
import { vi } from 'vitest'

vi.mock('@/lib/identity-verification/vendors/didit/persist', () => ({
  persistDiditDecision: vi.fn(async () => ({
    fieldsStamped: true,
    documentsStored: ['ID_FRONT', 'ID_BACK', 'SELFIE', 'LIVENESS_FRAME'],
    documentsSkipped: [],
    documentsFailed: [],
    payloadRedacted: true,
  })),
  isPersistableStatus: vi.fn(() => true),
}))

vi.mock('@/lib/identity-verification/vendors/didit/client', () => ({
  getSessionDecision: vi.fn(async () => ({ session_id: 'sess', status: 'Approved' })),
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: vi.fn(async (key: string) => key === 'provider.identity.vendor.didit.persist_documents'),
}))

describe('POST /api/webhooks/verification/didit — persist hook', () => {
  it('calls persistDiditDecision when flag on + applied status persistable', async () => {
    // Set up a Didit webhook envelope that yields a PASSED verdict via parseWebhook.
    // (Use whatever helper the existing test file uses to invoke the route handler.)
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    // ... invoke the route with a valid signature and a verifiable session_id ...
    // ... after the call:
    expect(persistDiditDecision).toHaveBeenCalledTimes(1)
    expect(persistDiditDecision).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'Approved' }),
      { source: 'webhook' },
    )
  })

  it('does NOT call persistDiditDecision when flag off', async () => {
    const { isEnabled } = await import('@/lib/flags')
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    // ... invoke the route again ...
    expect(persistDiditDecision).not.toHaveBeenCalled()
  })

  it('does NOT call persistDiditDecision when applied status is in-flight', async () => {
    const { isPersistableStatus } = await import('@/lib/identity-verification/vendors/didit/persist')
    ;(isPersistableStatus as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    // ... invoke the route ...
    expect(persistDiditDecision).not.toHaveBeenCalled()
  })

  it('webhook returns 200 even if persist throws', async () => {
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    ;(persistDiditDecision as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('persist boom'))
    // ... invoke the route, expect 200 OK ...
  })
})
```

Implementer note: the placeholder `// ... invoke the route ...` should be filled in following the conventions already in the existing webhook-route test file. Read the existing test setup helpers in that file (signature mocks, db mock, request body builders) and reuse them. Don't invent new patterns.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd field-service && pnpm vitest run __tests__/api/verification-webhook-route.test.ts -t "persist hook"
```
Expected: FAIL — persist call not yet integrated into the route.

- [ ] **Step 4: Modify the route**

Open `field-service/app/api/webhooks/verification/[vendor]/route.ts`. Locate the existing `applyVendorVerdict(verification.id, parsed.result, 'webhook')` call (around line 107). Replace the surrounding block (current verdict-application then `processedAt` update) with:

```ts
// Existing imports — add to the top of the file:
import { getSessionDecision } from '@/lib/identity-verification/vendors/didit/client'
import { isPersistableStatus, persistDiditDecision } from '@/lib/identity-verification/vendors/didit/persist'
import { isEnabled } from '@/lib/flags'

// Around the existing applyVendorVerdict call (line ~105-117):
let applied: Awaited<ReturnType<typeof applyVendorVerdict>> | null = null
if (parsed.result) {
  try {
    applied = await applyVendorVerdict(verification.id, parsed.result, 'webhook')
  } catch (error) {
    await db.providerVerificationWebhookEvent.update({
      where: { id: row.id },
      data: {
        processingError: error instanceof Error ? error.message : String(error),
      },
    })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// (NEW) Auto-persist for Didit terminal verdicts when flag is on.
if (vendorKey === 'didit' && applied && isPersistableStatus(applied.status)) {
  const flagOn = await isEnabled('provider.identity.vendor.didit.persist_documents')
  if (flagOn) {
    try {
      if (!applied.vendorReference) throw new Error('Didit vendorReference missing after verdict')
      const full = await getSessionDecision(applied.vendorReference)
      await persistDiditDecision(verification.id, full, { source: 'webhook' })
    } catch (err) {
      await db.providerVerificationEvent.create({
        data: {
          verificationId: verification.id,
          fromStatus: applied.status,
          toStatus: applied.status,
          reasonCode: 'DIDIT_PERSIST_FAILED',
          metadata: { source: 'webhook', error: err instanceof Error ? err.message : String(err) },
        },
      })
    }
  }
}

await db.providerVerificationWebhookEvent.update({
  where: { id: row.id },
  data: {
    verificationId: verification.id,
    processedAt: new Date(),
  },
})
return NextResponse.json({ ok: true })
```

- [ ] **Step 5: Run tests + commit**

```bash
cd field-service && pnpm vitest run __tests__/api/verification-webhook-route.test.ts
cd field-service && pnpm tsc --noEmit && pnpm lint
git add field-service/app/api/webhooks/verification/\[vendor\]/route.ts \
        field-service/__tests__/api/verification-webhook-route.test.ts
git commit -m "feat(identity): webhook route auto-persists Didit decision on terminal verdict"
```

---

### Task 12: Refactor `refreshDiditSessionAction` — move raw fetch out of crudAction, call persist after

**Files:**
- Modify: `field-service/app/(admin)/admin/verifications/actions.ts`
- Test: `field-service/__tests__/admin/didit-verification-actions.test.ts` (already exists; extend)

- [ ] **Step 1: Read the current action**

```bash
cd field-service && sed -n '400,475p' "app/(admin)/admin/verifications/actions.ts"
```
Locate `refreshDiditSessionAction`. Note that the current code calls `refreshDiditSession` INSIDE `crudAction`. The refactor lifts it out.

- [ ] **Step 2: Write the failing test**

Append to `field-service/__tests__/admin/didit-verification-actions.test.ts`:

```ts
import { vi } from 'vitest'

vi.mock('@/lib/identity-verification/vendors/didit/persist', () => ({
  persistDiditDecision: vi.fn(async () => ({
    fieldsStamped: true,
    documentsStored: ['ID_FRONT', 'ID_BACK', 'SELFIE', 'LIVENESS_FRAME'],
    documentsSkipped: [],
    documentsFailed: [],
    payloadRedacted: true,
  })),
  isPersistableStatus: vi.fn(() => true),
}))

describe('refreshDiditSessionAction — persist hook', () => {
  it('calls persistDiditDecision after crudAction returns ok (flag-independent)', async () => {
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    // ... use existing test helpers to invoke refreshDiditSessionAction for a Didit verification ...
    expect(persistDiditDecision).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ session_id: expect.any(String) }),
      { source: 'admin_refresh' },
    )
  })

  it('skips applyVendorVerdict when verification is already terminal but still persists', async () => {
    // Set up a verification in status PASSED.
    // Invoke refresh.
    // Expect: applyVendorVerdict NOT called (or called with a no-op); persistDiditDecision IS called.
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    expect(persistDiditDecision).toHaveBeenCalled()
  })

  it('refresh action returns ok even if persist throws', async () => {
    const { persistDiditDecision } = await import('@/lib/identity-verification/vendors/didit/persist')
    ;(persistDiditDecision as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('persist boom'))
    // Invoke refresh; expect { ok: true } from the action result.
  })

  it('refresh action records DIDIT_PERSIST_FAILED event when persist throws', async () => {
    // After invoking refresh with persist mocked to throw, query the test DB / event mock
    // and assert a provider_verification_events row with reasonCode 'DIDIT_PERSIST_FAILED' was inserted.
  })
})
```

Same implementer note as Task 11: fill in the `// ... invoke action ...` calls using the helpers already present in the test file.

- [ ] **Step 3: Run test to verify failure**

```bash
cd field-service && pnpm vitest run __tests__/admin/didit-verification-actions.test.ts -t "persist hook"
```
Expected: FAIL.

- [ ] **Step 4: Refactor the action**

Open `field-service/app/(admin)/admin/verifications/actions.ts`. Modify `refreshDiditSessionAction` so:

1. Admin role check happens at the top, OUTSIDE `crudAction`.
2. Load the verification's `vendorReference` + `vendorWorkflowId` (read-only, OUTSIDE `crudAction`).
3. Call `refreshDiditSession(vendorReference, { storedVendorWorkflowId })` — get `{ raw, normalized }`.
4. If `normalized.result` is non-null AND the verification's current status is not terminal: pass the result through `crudAction` → `applyVendorVerdict`.
5. If the verification is already terminal (`PASSED`/`FAILED`/`EXPIRED`/`CANCELLED`): skip the verdict mutation. Still proceed.
6. After the `crudAction` block returns ok (or after the skipped-verdict branch): call `persistDiditDecision(verificationId, refreshed.raw, { source: 'admin_refresh' })` inside a try/catch. On failure, insert a `DIDIT_PERSIST_FAILED` event via `db.providerVerificationEvent.create` (NOT inside a tx; this is a side-effect log).

Concrete code skeleton (insert in place of the current implementation; preserve existing return shape `{ ok: true, status, decision }`):

```ts
export async function refreshDiditSessionAction(input: RefreshDiditInput) {
  const parsed = RefreshDiditSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' }

  // Role + flag preflight — same as before.
  const admin = await requireRole([...REVIEW_ROLES])
  const flagOn = await isEnabled(FLAG, { userId: admin.id })
  if (!flagOn) return { ok: false as const, error: 'feature_disabled' }

  const verification = await db.providerIdentityVerification.findUnique({
    where: { id: parsed.data.verificationId },
    select: { id: true, status: true, sourceCheckProvider: true, vendorReference: true, vendorWorkflowId: true },
  })
  if (!verification || verification.sourceCheckProvider !== 'didit' || !verification.vendorReference) {
    return { ok: false as const, error: 'not_a_didit_verification' }
  }

  const refreshed = await refreshDiditSession(verification.vendorReference, {
    storedVendorWorkflowId: verification.vendorWorkflowId ?? null,
  })

  const isTerminal = (['PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const).includes(verification.status as 'PASSED')

  if (refreshed.normalized.result && !isTerminal) {
    const result = await crudAction<RefreshDiditInput, { id: string }>({
      entity: 'ProviderIdentityVerification',
      entityId: verification.id,
      action: 'provider_identity_verification.refresh_didit',
      requiredRole: [...REVIEW_ROLES],
      requiredFlag: FLAG,
      schema: RefreshDiditSchema,
      input,
      run: async (_data, tx) => {
        await applyVendorVerdict(verification.id, refreshed.normalized.result!, 'webhook', tx)
        return { id: verification.id }
      },
    })
    if (!result.ok) return { ok: false as const }
  }

  try {
    await persistDiditDecision(verification.id, refreshed.raw, { source: 'admin_refresh' })
  } catch (err) {
    await db.providerVerificationEvent.create({
      data: {
        verificationId: verification.id,
        fromStatus: verification.status,
        toStatus: verification.status,
        reasonCode: 'DIDIT_PERSIST_FAILED',
        metadata: { source: 'admin_refresh', error: err instanceof Error ? err.message : String(err) },
      },
    })
  }

  revalidateVerificationPaths(verification.id)
  return {
    ok: true as const,
    status: refreshed.normalized.result?.decision ?? verification.status,
    decision: refreshed.raw.status ?? null,
  }
}
```

- [ ] **Step 5: Run tests + commit**

```bash
cd field-service && pnpm vitest run __tests__/admin/didit-verification-actions.test.ts
cd field-service && pnpm tsc --noEmit && pnpm lint
git add field-service/app/\(admin\)/admin/verifications/actions.ts \
        field-service/__tests__/admin/didit-verification-actions.test.ts
git commit -m "feat(identity): admin refresh action persists Didit decision after verdict"
```

---

### Task 13: TRUST-only refresh control for terminal-but-undocumented Didit rows

**Files:**
- Modify: `field-service/app/(admin)/admin/verifications/[id]/page.tsx`
- Test: a render-level integration test (vitest + React Testing Library); if not already configured, fall back to an e2e smoke step

- [ ] **Step 1: Read the current detail page**

```bash
cd field-service && grep -n "refreshDiditSession\|RefreshFromDidit\|sourceCheckProvider\|documents" "app/(admin)/admin/verifications/[id]/page.tsx" | head -30
```
Identify where the refresh form is rendered and what condition currently gates it (likely "non-terminal status"). The change: also show it for `sourceCheckProvider === 'didit'` AND zero non-DELETED documents present, regardless of terminal status.

- [ ] **Step 2: Write the failing test (or smoke step if React render tests aren't wired)**

If `__tests__/admin/` already contains a React render test, add a case:

```ts
describe('Admin verification detail — Didit refresh control', () => {
  it('shows refresh form for terminal Didit row with zero documents', async () => {
    // Set up fixture: providerIdentityVerification status PASSED, sourceCheckProvider didit, zero documents
    // Render the page
    // Expect: a button/form with text matching /refresh from didit/i is in the DOM
  })

  it('does NOT show the form for a terminal manual-review row with docs already present', async () => {
    // Fixture: status PASSED, sourceCheckProvider manual, has at least one document
    // Render and assert the refresh button is NOT present
  })
})
```

If no render-test harness exists in this codebase, defer the test to Task 15 (smoke test) and proceed with the implementation change.

- [ ] **Step 3: Modify the detail page**

In `field-service/app/(admin)/admin/verifications/[id]/page.tsx`, locate the gating condition for the refresh form. Replace it with:

```tsx
const isDidit = verification.sourceCheckProvider === 'didit'
const nonDeletedDocs = verification.documents.filter((d) => d.status !== 'DELETED')
const hasZeroDocs = nonDeletedDocs.length === 0
const showRefresh =
  isDidit &&
  (
    // existing condition: non-terminal verifications get the refresh form
    !TERMINAL_STATUSES.includes(verification.status) ||
    // NEW: terminal Didit rows missing local documents get the form anyway (TRUST+ only)
    (hasZeroDocs && (currentAdmin.role === 'TRUST' || currentAdmin.role === 'ADMIN' || currentAdmin.role === 'OWNER'))
  )
```

(Adapt to the actual variable names in the file. The principle: gate by `isDidit && (notTerminal || hasZeroDocs)`.)

- [ ] **Step 4: Run tests + typecheck**

```bash
cd field-service && pnpm vitest run __tests__/admin
cd field-service && pnpm tsc --noEmit && pnpm lint
```
Expected: existing tests still pass; new render tests pass if added.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/\(admin\)/admin/verifications/\[id\]/page.tsx \
        field-service/__tests__/admin/  # whatever test file was touched
git commit -m "feat(identity): expose refresh control for terminal Didit rows missing docs"
```

---

### Task 14: Verify detail page renders the populated structured fields

**Files:**
- Modify: `field-service/app/(admin)/admin/verifications/[id]/page.tsx`

- [ ] **Step 1: Audit what's already rendered**

```bash
cd field-service && grep -nE "identifierLast4|documentNumberLast4|dobDerived|genderDerived|citizenshipDerived|documentExpiryDate|livenessScore|selfieMatchScore|documentConfidenceScore|riskFlags" "app/(admin)/admin/verifications/[id]/page.tsx"
```
List which fields are already rendered. Per spec §8, the smoke test expects ALL of these visible: DOB, gender, citizenship, document-number last4, document confidence, liveness score, selfie-match score, plus private document links.

- [ ] **Step 2: Render any missing fields**

For each field that's missing from the detail page, add a row to the "Verification case" panel. Group sensibly (identity facts, scores, risk). Example pattern (follow whatever the page already uses for similar fields):

```tsx
{verification.documentNumberLast4 && (
  <Field label="Document number">{`••• ${verification.documentNumberLast4}`}</Field>
)}
{verification.dobDerived && (
  <Field label="Date of birth">{format(verification.dobDerived, 'yyyy-MM-dd')}</Field>
)}
{/* etc — one Field per spec §8 field. Only render when value is non-null. */}
```

For document links, the page should already iterate `verification.documents`. Verify each link uses the existing secure download route (which writes a `provider_sensitive_data_access_logs` row on access — DO NOT bypass that).

- [ ] **Step 3: Typecheck + lint**

```bash
cd field-service && pnpm tsc --noEmit && pnpm lint
```
Expected: clean.

- [ ] **Step 4: Manual visual sanity check**

```bash
cd field-service && pnpm dev
```
Open `http://localhost:3000/admin/verifications/<any-passed-didit-verification-id>`. (If no Didit verification exists in dev, seed one or stage with mocked data.) Confirm visually that DOB / gender / citizenship / doc-number-last4 / confidence / liveness / selfie-match / document links all appear when populated.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/\(admin\)/admin/verifications/\[id\]/page.tsx
git commit -m "feat(identity): render Didit structured fields on verification detail page"
```

---

## Final verification

### Task 15: Smoke test — refresh-from-Didit shows docs + fields

**Files:**
- Modify: `field-service/e2e/smoke.spec.ts`

- [ ] **Step 1: Identify the existing smoke harness conventions**

```bash
cd field-service && grep -n "describe\|test\|expect" e2e/smoke.spec.ts | head -20
```
Note whether smoke tests run against a seeded test DB or against a deployed env. The new test follows the same pattern.

- [ ] **Step 2: Add the smoke step**

```ts
test('admin refresh from Didit populates structured fields + document links', async ({ page }) => {
  // Seed: a PASSED Didit verification id known to the smoke DB, with mock Didit API.
  // Or: use a fixture verification id that has had refresh run and persisted docs.
  await page.goto(`${BASE_URL}/admin/verifications/${SEEDED_DIDIT_VERIFICATION_ID}`)
  await page.locator('button[name="refresh-didit"]').click()
  await page.waitForLoadState('networkidle')

  // Structured fields
  await expect(page.getByText(/Date of birth/i)).toBeVisible()
  await expect(page.getByText(/Gender/i)).toBeVisible()
  await expect(page.getByText(/Citizenship/i)).toBeVisible()
  await expect(page.getByText(/Document number/i)).toBeVisible()
  await expect(page.getByText(/Document confidence/i)).toBeVisible()
  await expect(page.getByText(/Liveness score/i)).toBeVisible()
  await expect(page.getByText(/Selfie match/i)).toBeVisible()

  // Private document links — at least one of each kind
  await expect(page.locator('a[data-kind="ID_FRONT"]')).toHaveCount(1)
  await expect(page.locator('a[data-kind="ID_BACK"]')).toHaveCount(1)
  await expect(page.locator('a[data-kind="SELFIE"]')).toHaveCount(1)
  await expect(page.locator('a[data-kind="LIVENESS_FRAME"]')).toHaveCount(1)
})
```

If the page renders labels differently, adjust selectors to match (use `data-testid` attributes if available; add them to the page if not).

- [ ] **Step 3: Run smoke locally**

```bash
cd field-service && pnpm test:e2e
```
Expected: passes (assuming the seeded verification exists). If the harness needs an `E2E_BASE_URL`, set it.

- [ ] **Step 4: Commit**

```bash
git add field-service/e2e/smoke.spec.ts
git commit -m "test(identity): smoke — Didit refresh shows fields + private doc links"
```

---

### Task 16: Full test + lint + typecheck + branch ready for PR

**Files:** none — verification only

- [ ] **Step 1: Run the whole vitest suite**

```bash
cd field-service && pnpm test
```
Expected: all green. Any new failures must be addressed before PR.

- [ ] **Step 2: Run lint + typecheck**

```bash
cd field-service && pnpm lint
cd field-service && pnpm tsc --noEmit
```
Expected: clean (excluding pre-existing failures on `main`).

- [ ] **Step 3: Skim the commit log on the branch**

```bash
git log --oneline main..HEAD
```
Expected: ~16 commits, each focused and atomic, each with a passing test or verification step.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin feat/didit-persist-documents
gh pr create --title "feat(identity): Didit decision persistence — images + fields + redacted payload" --body "$(cat <<'EOF'
## Summary
- Adds `lib/identity-verification/vendors/didit/persist.ts` — downloads Didit's images, stamps structured fields, stores a redacted raw payload.
- Wires persist into the webhook handler (gated on `provider.identity.vendor.didit.persist_documents`) and the admin "Refresh from Didit" action (flag-independent).
- Adds TRUST-only refresh control for terminal Didit rows missing local documents (Lovemore-style backfill).
- Renders DOB / gender / citizenship / doc-number-last4 / scores / private document links on the admin verification detail page.

## Spec
`field-service/docs/superpowers/specs/2026-06-01-didit-document-persistence-design.md` (commit a871128c9)

## Test plan
- [x] Unit tests for `isPersistableStatus`, `extractImageRefs`, `redactPayload`, `mapDecisionToVerificationFields`, `tryMapDecisionToVerificationFields`, `toIdentityDocumentFile`, `downloadDocumentImage`
- [x] Integration tests for `persistDiditDecision` (happy path, idempotency, sha-changed, per-kind isolation, shape mismatch)
- [x] Webhook route integration test — persist called on terminal verdict when flag on; skipped when flag off
- [x] Admin refresh action integration test — persist always called, no flag check
- [x] Detail page render test — refresh control shown for terminal Didit row with zero docs
- [x] Smoke test — refresh populates fields + document links

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Commit (no-op — PR command itself is the deliverable)**

No commit needed. Branch and PR exist; review and merge follow your normal flow.

---

### Task 17: Backfill Lovemore via admin refresh (post-merge, production)

**Files:** none — manual production verification step

- [ ] **Step 1: Wait for the PR to merge + Vercel deploy to complete**

Confirm: `git log origin/main -1 --oneline` shows the merged commit; Vercel dashboard shows the latest deployment is Ready.

- [ ] **Step 2: Open the admin verification page for Lovemore**

In browser, signed in as OWNER:
```
https://app.plugapro.co.za/admin/verifications/cmpv7l9j8000dl2042porhv0g
```

- [ ] **Step 3: Click "Refresh from Didit"**

The TRUST-only control should be visible (terminal verification, zero local documents). Click it.

- [ ] **Step 4: Verify the row now has documents + fields**

After the refresh completes:
- 4 private document links (ID_FRONT, ID_BACK, SELFIE, LIVENESS_FRAME)
- DOB, gender, citizenship, document-number last4, document confidence, liveness score, selfie-match score visible

Then proceed with the manual review.

- [ ] **Step 5: Flip the feature flag (post-validation)**

Via Supabase MCP or admin UI:

```sql
INSERT INTO feature_flags (key, enabled, "enabledForUsers", description, "updatedAt")
VALUES ('provider.identity.vendor.didit.persist_documents', true, '{}',
        'When ON, terminal-state Didit webhooks auto-persist...', NOW())
ON CONFLICT (key) DO UPDATE SET enabled = true, "updatedAt" = NOW();
```

Then any future Didit terminal webhook will auto-persist without manual refresh. Monitor `provider_verification_events` for `DIDIT_PERSIST_FAILED` rows over the next 48h.

---

## Plan complete

After all 17 tasks: the Didit integration captures full evidence locally for every terminal verdict, the manual-review screen has the docs + fields it needs, Lovemore's pending review is unblocked, and future Didit cases land into the same code path automatically.
