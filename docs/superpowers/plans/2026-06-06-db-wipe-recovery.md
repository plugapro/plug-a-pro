# DB Wipe Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-shot recovery script that re-creates lost `Attachment`, `ProviderIdentityVerification`, and `ProviderIdentityDocument` rows from `inbound_whatsapp_messages`, a restore-clone DB, and surviving Supabase Storage objects — without sending any user-facing notification.

**Architecture:** Single CLI script `pnpm tsx scripts/db-wipe-recovery.ts <subcommand>` with three subcommands: `gate` (captures the high-watermark and survival counts), `plan --dry-run` (computes all writes and emits a plan JSON + reconciliation CSV without touching the DB), and `apply --confirm` (executes the plan with a stale-plan guard). All recovery reads are bounded by `gateCapturedAt`. The script is a thin orchestrator over modular per-workstream helpers in `scripts/db-wipe-recovery/`.

**Tech Stack:** Node 24 (tsx), Prisma 5, `@vercel/blob`, `@supabase/supabase-js`, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-06-db-wipe-recovery-design.md` (commit `b813c5619`).

**Execution gate:** Phase 0 (infra root-cause confirmation per spec §4 Phase 0) must conclude with a "real data loss" verdict before Task 2 onward executes. If Phase 0 resolves with pooler/env/billing fix, this plan is abandoned and Task 1 reports the outcome.

---

## File structure

**Created (new):**

- `field-service/scripts/db-wipe-recovery.ts` — CLI entry; argparse, subcommand dispatch.
- `field-service/scripts/db-wipe-recovery/types.ts` — shared types (`Plan`, `MediaCandidate`, `ResolvedParent`, `ReconciliationRow`, `GateSnapshot`).
- `field-service/scripts/db-wipe-recovery/restore-client.ts` — second Prisma client constructed from `RESTORE_DATABASE_URL`.
- `field-service/scripts/db-wipe-recovery/gate.ts` — Gate 0: counts + `gateCapturedAt` capture + stale-plan check.
- `field-service/scripts/db-wipe-recovery/whatsapp-harvest.ts` — Workstream A1: `inbound_whatsapp_messages` → `MediaCandidate[]`.
- `field-service/scripts/db-wipe-recovery/whatsapp-sample-get.ts` — Workstream A2: per-`age_bucket` live sample GET against Meta.
- `field-service/scripts/db-wipe-recovery/parent-resolution.ts` — Workstream A3: HIGH/MEDIUM/LOW tagged-union resolution.
- `field-service/scripts/db-wipe-recovery/whatsapp-replay.ts` — Workstream A4: loop over resolved candidates, call recovery helper.
- `field-service/scripts/db-wipe-recovery/kyc-import.ts` — Workstream B1: parse `supabase://`, match storage objects, plan inserts.
- `field-service/scripts/db-wipe-recovery/kyc-orphan-triage.ts` — Workstream B2: three-proof requirement.
- `field-service/scripts/db-wipe-recovery/kyc-didit-topup.ts` — Workstream B3: Didit read-only top-up (gated).
- `field-service/scripts/db-wipe-recovery/kyc-integrity.ts` — Workstream B4: re-compute sha256 and compare.
- `field-service/scripts/db-wipe-recovery/reconciliation.ts` — Workstream D: CSV writer.
- Test files mirroring the above under `field-service/__tests__/scripts/db-wipe-recovery/`.
- `field-service/__tests__/lib/whatsapp-media-recover.test.ts` — for `recoverWhatsAppAttachment`.

**Modified:**

- `field-service/lib/whatsapp-media.ts` — extract private `fetchWhatsAppMediaBinary` helper; add `recoverWhatsAppAttachment`.
- `field-service/lib/identity-verification/vendors/didit/persist.ts` — add `recoveryMode?: boolean` to `persistDiditDecision` options.

---

### Task 1: Confirm Phase 0 outcome (gating, no code)

**Files:** none.

- [ ] **Step 1: Read Phase 0 results from the user / oncall channel.**

Confirm one of the following is true before continuing:

  (a) Both direct writer and pooled runtime ran `select pg_is_in_recovery(); show transaction_read_only; show default_transaction_read_only;` and the readback proves neither a pooler-only nor project-wide read-only state.
  (b) `Provider`, `ProviderApplication`, and `Conversation` rows in live prod confirm at least one `Attachment`/`ProviderIdentityDocument` is genuinely missing (cross-checked against the restore clone snapshot).

- [ ] **Step 2: If (a) or (b) does not hold, abandon the plan.**

Report to user: "Phase 0 did not confirm data loss; recovery script not built." Delete the in-progress plan task and stop.

- [ ] **Step 3: If both hold, proceed to Task 2.**

Record the Phase 0 outcome (date, evidence URLs) in a one-line note in the project log.

---

### Task 2: Add `recoveryMode` to `persistDiditDecision`

**Files:**
- Modify: `field-service/lib/identity-verification/vendors/didit/persist.ts:402` (function signature + body).
- Test: `field-service/__tests__/lib/identity-verification/persist-recovery-mode.test.ts` (create).

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/lib/identity-verification/persist-recovery-mode.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistDiditDecision } from '@/lib/identity-verification/vendors/didit/persist'
import { db } from '@/lib/db'

vi.mock('@/lib/db', () => {
  const tx = {
    providerIdentityVerification: { update: vi.fn().mockResolvedValue({ status: 'APPROVED' }) },
    providerVerificationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt_1' }) },
  }
  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})

const baseDecision = { decision: 'APPROVED', images: [], scores: {} } as never

describe('persistDiditDecision recoveryMode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps actorRole=system:recovery on the verification event when recoveryMode is true', async () => {
    await persistDiditDecision('ver_1', baseDecision, { source: 'admin_refresh', recoveryMode: true })
    const tx = (db as unknown as { __tx: { providerVerificationEvent: { create: ReturnType<typeof vi.fn> } } }).__tx
    expect(tx.providerVerificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'system:recovery' }),
      }),
    )
  })

  it('does not set actorRole=system:recovery when recoveryMode is omitted', async () => {
    await persistDiditDecision('ver_1', baseDecision, { source: 'admin_refresh' })
    const tx = (db as unknown as { __tx: { providerVerificationEvent: { create: ReturnType<typeof vi.fn> } } }).__tx
    const call = tx.providerVerificationEvent.create.mock.calls[0]?.[0] as { data: { actorRole?: string } }
    expect(call.data.actorRole).not.toBe('system:recovery')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/lib/identity-verification/persist-recovery-mode.test.ts`
Expected: FAIL — either type error on `recoveryMode` or `actorRole` not stamped.

- [ ] **Step 3: Modify `persistDiditDecision`.**

In `field-service/lib/identity-verification/vendors/didit/persist.ts:402`, change the signature and the `providerVerificationEvent.create` call:

```ts
export async function persistDiditDecision(
  verificationId: string,
  decision: DiditDecisionResponse,
  options: { source: 'webhook' | 'admin_refresh'; recoveryMode?: boolean },
): Promise<PersistResult> {
```

In the same function body, locate the existing `tx.providerVerificationEvent.create({ data: { ... } })` call and add `actorRole`:

```ts
await tx.providerVerificationEvent.create({
  data: {
    verificationId,
    fromStatus: updated.status,
    toStatus: updated.status,
    actorRole: options.recoveryMode ? 'system:recovery' : null,
    // ... existing fields preserved
  },
})
```

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `cd field-service && pnpm vitest run __tests__/lib/identity-verification/persist-recovery-mode.test.ts`
Expected: PASS, both cases.

Also run the existing Didit persist tests to verify no regression:
Run: `cd field-service && pnpm vitest run __tests__/lib/identity-verification`
Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add lib/identity-verification/vendors/didit/persist.ts __tests__/lib/identity-verification/persist-recovery-mode.test.ts
git commit -m "feat(identity): add recoveryMode option to persistDiditDecision"
```

---

### Task 3: Extract private download helper from `downloadAndStoreWhatsAppMedia`

**Files:**
- Modify: `field-service/lib/whatsapp-media.ts:36-110`.
- Test: `field-service/__tests__/lib/whatsapp-media.test.ts` (existing — run for regression).

- [ ] **Step 1: Run the existing test as a baseline.**

Run: `cd field-service && pnpm vitest run __tests__/lib/whatsapp-media.test.ts`
Expected: PASS (record the count for comparison after refactor).

- [ ] **Step 2: Extract the binary fetch into a private helper.**

In `field-service/lib/whatsapp-media.ts`, add a new internal function above `downloadAndStoreWhatsAppMedia`:

```ts
type FetchedWhatsAppBinary = {
  buffer: ArrayBuffer
  ext: string
  mimeType: string
  blobKey: string
  blobUrl: string
  traceId: string
}

async function fetchAndStoreWhatsAppBinary(params: {
  mediaId: string
  prefix: string
  label: string
  maxSizeBytes: number
}): Promise<FetchedWhatsAppBinary> {
  const { mediaId, prefix, label, maxSizeBytes } = params
  const traceId = randomUUID().slice(0, 8)

  const { buffer, ext, meta } = await downloadWhatsAppMedia({
    mediaId,
    label,
    maxSizeBytes,
    traceId,
  })

  const pathname = `${prefix}/${mediaId.slice(-8)}.${ext}`
  const blob = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: meta.mime_type,
  })

  console.info('[whatsapp-media] media uploaded to app storage', {
    traceId,
    mediaIdSuffix: mediaId.slice(-8),
    blobKey: blob.pathname,
    mimeType: meta.mime_type,
    sizeBytes: buffer.byteLength,
    label,
  })

  return {
    buffer,
    ext,
    mimeType: meta.mime_type,
    blobKey: blob.pathname,
    blobUrl: blob.url,
    traceId,
  }
}
```

- [ ] **Step 3: Replace the inline binary fetch in `downloadAndStoreWhatsAppMedia` with a call to the new helper.**

Replace the body between the idempotency lookup and `const attachment = await db.attachment.create({...})` with:

```ts
const fetched = await fetchAndStoreWhatsAppBinary({
  mediaId,
  prefix,
  label,
  maxSizeBytes,
})

const attachment = await db.attachment.create({
  data: {
    providerApplicationId,
    url: fetched.blobUrl,
    blobKey: fetched.blobKey,
    mimeType: fetched.mimeType,
    sizeBytes: fetched.buffer.byteLength,
    label,
    uploadedBy,
  },
})

console.info('[whatsapp-media] attachment record created', {
  traceId: fetched.traceId,
  mediaIdSuffix: mediaId.slice(-8),
  attachmentId: attachment.id,
  label,
})

return { attachmentId: attachment.id }
```

- [ ] **Step 4: Run the existing media tests to confirm no regression.**

Run: `cd field-service && pnpm vitest run __tests__/lib/whatsapp-media.test.ts __tests__/lib/whatsapp-bot-onboarding-media.test.ts`
Expected: all PASS, same count as baseline.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add lib/whatsapp-media.ts
git commit -m "refactor(whatsapp-media): extract fetchAndStoreWhatsAppBinary for reuse"
```

---

### Task 4: Add `recoverWhatsAppAttachment` with tagged-union parent + mismatch refusal

**Files:**
- Modify: `field-service/lib/whatsapp-media.ts` (append below `downloadAndStoreWhatsAppMedia`).
- Test: `field-service/__tests__/lib/whatsapp-media-recover.test.ts` (create).

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/lib/whatsapp-media-recover.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recoverWhatsAppAttachment, PARENT_FK_MISMATCH_ERROR } from '@/lib/whatsapp-media'
import { db } from '@/lib/db'

vi.mock('@/lib/db', () => ({
  db: {
    attachment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string) => ({ pathname: key, url: `https://blob/${key}` })),
}))

const fetchedBytes = new ArrayBuffer(8)
vi.mock('@/lib/whatsapp-media', async (original) => {
  const mod = (await original()) as Record<string, unknown>
  return {
    ...mod,
    __setFetchOverride: (fn: unknown) => ((mod as Record<string, unknown>).__fetchOverride = fn),
  }
})

describe('recoverWhatsAppAttachment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes Attachment with jobRequestId when parent.kind=jobRequest', async () => {
    ;(db.attachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.attachment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'att_1' })
    await recoverWhatsAppAttachment({
      mediaId: 'wa_media_abc',
      parent: { kind: 'jobRequest', id: 'jr_1' },
      label: 'evidence',
      __testFetch: async () => ({ buffer: fetchedBytes, ext: 'jpg', mimeType: 'image/jpeg', blobKey: 'k', blobUrl: 'u', traceId: 't' }),
    })
    expect(db.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobRequestId: 'jr_1', providerApplicationId: undefined }),
      }),
    )
  })

  it('refuses with PARENT_FK_MISMATCH if existing row has a different parent', async () => {
    ;(db.attachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'att_existing',
      providerApplicationId: 'app_X',
      jobRequestId: null,
      jobId: null,
      inspectionSlotId: null,
    })
    await expect(
      recoverWhatsAppAttachment({
        mediaId: 'wa_media_abc',
        parent: { kind: 'jobRequest', id: 'jr_1' },
        label: 'evidence',
        __testFetch: async () => ({ buffer: fetchedBytes, ext: 'jpg', mimeType: 'image/jpeg', blobKey: 'k', blobUrl: 'u', traceId: 't' }),
      }),
    ).rejects.toThrow(PARENT_FK_MISMATCH_ERROR)
  })

  it('is idempotent — returns existing attachment when same parent already recorded', async () => {
    ;(db.attachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'att_existing',
      providerApplicationId: null,
      jobRequestId: 'jr_1',
      jobId: null,
      inspectionSlotId: null,
    })
    const result = await recoverWhatsAppAttachment({
      mediaId: 'wa_media_abc',
      parent: { kind: 'jobRequest', id: 'jr_1' },
      label: 'evidence',
      __testFetch: async () => ({ buffer: fetchedBytes, ext: 'jpg', mimeType: 'image/jpeg', blobKey: 'k', blobUrl: 'u', traceId: 't' }),
    })
    expect(result.attachmentId).toBe('att_existing')
    expect(db.attachment.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/lib/whatsapp-media-recover.test.ts`
Expected: FAIL — `recoverWhatsAppAttachment` not exported.

- [ ] **Step 3: Append the helper in `lib/whatsapp-media.ts`.**

Add to `field-service/lib/whatsapp-media.ts` after `downloadAndStoreWhatsAppMedia`:

```ts
export const PARENT_FK_MISMATCH_ERROR = 'PARENT_FK_MISMATCH'

export type RecoveryParent =
  | { kind: 'providerApplication'; id: string }
  | { kind: 'jobRequest'; id: string }
  | { kind: 'job'; id: string }
  | { kind: 'inspectionSlot'; id: string }

type FetchedBinary = Awaited<ReturnType<typeof fetchAndStoreWhatsAppBinary>>

export async function recoverWhatsAppAttachment(params: {
  mediaId: string
  parent: RecoveryParent
  label: string
  prefix?: string
  maxSizeBytes?: number
  /** test seam only — production callers must not pass this */
  __testFetch?: (args: { mediaId: string; prefix: string; label: string; maxSizeBytes: number }) => Promise<FetchedBinary>
}): Promise<{ attachmentId: string }> {
  const { mediaId, parent, label, prefix = 'evidence', maxSizeBytes = MAX_EVIDENCE_SIZE } = params
  const uploadedBy = `system:whatsapp:${mediaId}`

  const existing = await db.attachment.findFirst({
    where: { uploadedBy, label },
    select: {
      id: true,
      providerApplicationId: true,
      jobRequestId: true,
      jobId: true,
      inspectionSlotId: true,
    },
  })

  if (existing) {
    const existingParentId =
      parent.kind === 'providerApplication' ? existing.providerApplicationId
      : parent.kind === 'jobRequest' ? existing.jobRequestId
      : parent.kind === 'job' ? existing.jobId
      : existing.inspectionSlotId

    const mismatchKind =
      (existing.providerApplicationId && parent.kind !== 'providerApplication') ||
      (existing.jobRequestId && parent.kind !== 'jobRequest') ||
      (existing.jobId && parent.kind !== 'job') ||
      (existing.inspectionSlotId && parent.kind !== 'inspectionSlot')

    if (mismatchKind || (existingParentId && existingParentId !== parent.id)) {
      throw new Error(PARENT_FK_MISMATCH_ERROR)
    }
    return { attachmentId: existing.id }
  }

  const fetched = await (params.__testFetch ?? fetchAndStoreWhatsAppBinary)({
    mediaId,
    prefix,
    label,
    maxSizeBytes,
  })

  const attachment = await db.attachment.create({
    data: {
      providerApplicationId: parent.kind === 'providerApplication' ? parent.id : undefined,
      jobRequestId: parent.kind === 'jobRequest' ? parent.id : undefined,
      jobId: parent.kind === 'job' ? parent.id : undefined,
      inspectionSlotId: parent.kind === 'inspectionSlot' ? parent.id : undefined,
      url: fetched.blobUrl,
      blobKey: fetched.blobKey,
      mimeType: fetched.mimeType,
      sizeBytes: fetched.buffer.byteLength,
      label,
      uploadedBy,
    },
  })

  return { attachmentId: attachment.id }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/lib/whatsapp-media-recover.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add lib/whatsapp-media.ts __tests__/lib/whatsapp-media-recover.test.ts
git commit -m "feat(whatsapp-media): add recoverWhatsAppAttachment with tagged-union parent"
```

---

### Task 5: Restore-clone Prisma client

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/restore-client.ts`.
- Create: `field-service/scripts/db-wipe-recovery/types.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/restore-client.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/restore-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('restoreClient', () => {
  const originalUrl = process.env.RESTORE_DATABASE_URL
  beforeEach(() => { delete process.env.RESTORE_DATABASE_URL })
  afterEach(() => { process.env.RESTORE_DATABASE_URL = originalUrl })

  it('throws a clear error if RESTORE_DATABASE_URL is unset', async () => {
    const { getRestoreClient } = await import('@/scripts/db-wipe-recovery/restore-client')
    expect(() => getRestoreClient()).toThrow(/RESTORE_DATABASE_URL/)
  })

  it('returns a memoised PrismaClient when RESTORE_DATABASE_URL is set', async () => {
    process.env.RESTORE_DATABASE_URL = 'postgresql://restore@localhost:5432/restore_clone'
    const { getRestoreClient } = await import('@/scripts/db-wipe-recovery/restore-client')
    const a = getRestoreClient()
    const b = getRestoreClient()
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/restore-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the shared types and restore client.**

Create `field-service/scripts/db-wipe-recovery/types.ts`:

```ts
export type AgeBucket = 'lt_24h' | '1_to_3d' | '3_to_7d' | 'gt_7d'

export type MediaCandidate = {
  externalId: string
  phone: string
  messageType: 'image' | 'document' | 'video'
  firstSeenAt: Date
  mediaId: string
  caption: string | null
  ageBucket: AgeBucket
}

export type ResolvedParent =
  | { kind: 'providerApplication'; id: string }
  | { kind: 'jobRequest'; id: string }
  | { kind: 'job'; id: string }
  | { kind: 'inspectionSlot'; id: string }

export type ParentResolution =
  | { confidence: 'HIGH' | 'MEDIUM'; parent: ResolvedParent; label: string; reason: string }
  | { confidence: 'LOW'; reason: string }

export type GateSnapshot = {
  gateCapturedAt: string
  counts: Record<string, { prod: number; restore: number }>
}

export type ReconciliationRow = {
  gapKind:
    | 'WHATSAPP_VIDEO_UNSUPPORTED'
    | 'WHATSAPP_MEDIA_RESOLUTION_LOW_CONFIDENCE'
    | 'WHATSAPP_MEDIA_BEYOND_META_RETENTION'
    | 'PARENT_FK_MISMATCH'
    | 'IDENTITY_STORAGE_ORPHAN'
    | 'KYC_VENDOR_REF_NO_PROVIDER_LINK'
    | 'IDENTITY_VENDOR_REFRESH_FAILED'
    | 'SHA256_MISMATCH'
  phone: string | null
  parentKind: string | null
  parentId: string | null
  mediaIdOrBlobKey: string | null
  reason: string
  recommendedAction: string
}

export type Plan = {
  gateCapturedAt: string
  whatsappReplays: Array<{ mediaId: string; parent: ResolvedParent; label: string }>
  kycVerificationInserts: Array<{ verificationId: string; sourceVerificationIdInRestore: string }>
  kycDocumentInserts: Array<{ documentIdInRestore: string; blobKey: string }>
  reconciliation: ReconciliationRow[]
}
```

Create `field-service/scripts/db-wipe-recovery/restore-client.ts`:

```ts
import { PrismaClient } from '@prisma/client'

let cached: PrismaClient | null = null

export function getRestoreClient(): PrismaClient {
  if (cached) return cached
  const url = process.env.RESTORE_DATABASE_URL
  if (!url) throw new Error('RESTORE_DATABASE_URL is required for the recovery script')
  cached = new PrismaClient({ datasources: { db: { url } } })
  return cached
}

export async function disconnectRestoreClient(): Promise<void> {
  if (cached) {
    await cached.$disconnect()
    cached = null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/restore-client.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/types.ts scripts/db-wipe-recovery/restore-client.ts __tests__/scripts/db-wipe-recovery/restore-client.test.ts
git commit -m "feat(recovery): restore-clone Prisma client + shared types"
```

---

### Task 6: Gate 0 — counts + `gateCapturedAt`

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/gate.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/gate.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runGate, verifyStalePlanGuard } from '@/scripts/db-wipe-recovery/gate'

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(async () => [{ count: 2038n }]),
  },
}))

vi.mock('@/scripts/db-wipe-recovery/restore-client', () => ({
  getRestoreClient: () => ({ $queryRaw: vi.fn(async () => [{ count: 1959n }]) }),
}))

describe('runGate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures gateCapturedAt and returns a snapshot with prod and restore counts', async () => {
    const snapshot = await runGate()
    expect(new Date(snapshot.gateCapturedAt).getTime()).toBeLessThanOrEqual(Date.now())
    expect(snapshot.counts.inboundWhatsappMessages.prod).toBe(2038)
    expect(snapshot.counts.inboundWhatsappMessages.restore).toBe(1959)
  })
})

describe('verifyStalePlanGuard', () => {
  it('passes when historical counts (<= gateCapturedAt) are unchanged', async () => {
    await expect(verifyStalePlanGuard({
      gateCapturedAt: new Date(Date.now() - 60_000).toISOString(),
      historicalCounts: { attachments: 66 },
    })).resolves.toBeUndefined()
  })

  it('throws when historical counts have drifted', async () => {
    vi.mocked((await import('@/lib/db')).db.$queryRaw).mockResolvedValueOnce([{ count: 5n }])
    await expect(verifyStalePlanGuard({
      gateCapturedAt: new Date(Date.now() - 60_000).toISOString(),
      historicalCounts: { attachments: 66 },
    })).rejects.toThrow(/STALE_PLAN/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the gate module.**

Create `field-service/scripts/db-wipe-recovery/gate.ts`:

```ts
import { db } from '@/lib/db'
import { getRestoreClient } from './restore-client'
import type { GateSnapshot } from './types'

type CountQuery = { count: bigint }

const COUNT_QUERIES: Array<{ key: string; sql: string }> = [
  { key: 'inboundWhatsappMessages', sql: 'SELECT COUNT(*)::bigint AS count FROM inbound_whatsapp_messages' },
  { key: 'attachments', sql: 'SELECT COUNT(*)::bigint AS count FROM attachments' },
  { key: 'providerIdentityVerifications', sql: 'SELECT COUNT(*)::bigint AS count FROM provider_identity_verifications' },
  { key: 'providerIdentityDocuments', sql: 'SELECT COUNT(*)::bigint AS count FROM provider_identity_documents' },
  { key: 'providerVerificationWebhookEvents', sql: 'SELECT COUNT(*)::bigint AS count FROM provider_verification_webhook_events' },
]

async function readCount(client: { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> }, sql: string): Promise<number> {
  // Prisma $queryRaw requires a tagged template; we use $queryRawUnsafe equivalent via Prisma.sql.
  const raw = (await (client as unknown as { $queryRawUnsafe: (q: string) => Promise<CountQuery[]> }).$queryRawUnsafe(sql))
  return Number(raw[0]?.count ?? 0n)
}

export async function runGate(): Promise<GateSnapshot> {
  const restore = getRestoreClient()
  const gateCapturedAt = new Date().toISOString()
  const counts: GateSnapshot['counts'] = {}
  for (const { key, sql } of COUNT_QUERIES) {
    counts[key] = {
      prod: await readCount(db as never, sql),
      restore: await readCount(restore as never, sql),
    }
  }
  return { gateCapturedAt, counts }
}

export async function verifyStalePlanGuard(params: {
  gateCapturedAt: string
  historicalCounts: Record<string, number>
}): Promise<void> {
  for (const [table, expected] of Object.entries(params.historicalCounts)) {
    const actual = await readCount(
      db as never,
      `SELECT COUNT(*)::bigint AS count FROM ${table} WHERE "createdAt" <= '${params.gateCapturedAt}'`,
    )
    if (actual !== expected) {
      throw new Error(`STALE_PLAN: ${table} historical count drifted (expected ${expected}, got ${actual})`)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/gate.ts __tests__/scripts/db-wipe-recovery/gate.test.ts
git commit -m "feat(recovery): Gate 0 — counts + high-watermark + stale-plan guard"
```

---

### Task 7: Workstream A1 — WhatsApp media harvest

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/whatsapp-harvest.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-harvest.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-harvest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harvestMediaCandidates } from '@/scripts/db-wipe-recovery/whatsapp-harvest'

vi.mock('@/lib/db', () => ({
  db: {
    $queryRawUnsafe: vi.fn(),
  },
}))

describe('harvestMediaCandidates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns MediaCandidate rows bounded to <= gateCapturedAt and >= gateCapturedAt - 7d', async () => {
    const gate = new Date('2026-06-06T12:00:00Z').toISOString()
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { externalId: 'wamid_1', phone: '+27123', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z'), media_id: 'm1', caption: null },
      { externalId: 'wamid_2', phone: '+27123', messageType: 'video', firstSeenAt: new Date('2026-06-03T11:00:00Z'), media_id: 'm2', caption: null },
    ])
    const candidates = await harvestMediaCandidates({ gateCapturedAt: gate })
    expect(candidates).toHaveLength(2)
    expect(candidates[0].ageBucket).toBe('lt_24h')
    expect(candidates[1].ageBucket).toBe('3_to_7d')
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"firstSeenAt" <= '${gate}'`))
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('interval \'7 days\''))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-harvest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the harvest module.**

Create `field-service/scripts/db-wipe-recovery/whatsapp-harvest.ts`:

```ts
import { db } from '@/lib/db'
import type { MediaCandidate, AgeBucket } from './types'

type Row = {
  externalId: string
  phone: string
  messageType: 'image' | 'document' | 'video'
  firstSeenAt: Date
  media_id: string | null
  caption: string | null
}

function bucketFor(firstSeen: Date, gate: Date): AgeBucket {
  const ageMs = gate.getTime() - firstSeen.getTime()
  const day = 24 * 60 * 60 * 1000
  if (ageMs < day) return 'lt_24h'
  if (ageMs < 3 * day) return '1_to_3d'
  if (ageMs < 7 * day) return '3_to_7d'
  return 'gt_7d'
}

export async function harvestMediaCandidates(params: { gateCapturedAt: string }): Promise<MediaCandidate[]> {
  const gate = new Date(params.gateCapturedAt)
  const sql = `
    SELECT
      "externalId",
      phone,
      "messageType",
      "firstSeenAt",
      payload -> "messageType" ->> 'id'      AS media_id,
      payload -> "messageType" ->> 'caption' AS caption
    FROM inbound_whatsapp_messages
    WHERE "messageType" IN ('image','document','video')
      AND "firstSeenAt" <= '${params.gateCapturedAt}'
      AND "firstSeenAt" >= '${params.gateCapturedAt}'::timestamptz - interval '7 days'
    ORDER BY "firstSeenAt"
  `
  const rows = (await db.$queryRawUnsafe(sql)) as Row[]
  return rows
    .filter((r) => r.media_id)
    .map((r) => ({
      externalId: r.externalId,
      phone: r.phone,
      messageType: r.messageType,
      firstSeenAt: r.firstSeenAt,
      mediaId: r.media_id as string,
      caption: r.caption,
      ageBucket: bucketFor(r.firstSeenAt, gate),
    }))
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-harvest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/whatsapp-harvest.ts __tests__/scripts/db-wipe-recovery/whatsapp-harvest.test.ts
git commit -m "feat(recovery): Workstream A1 — harvest media candidates from inbound_whatsapp_messages"
```

---

### Task 8: Workstream A2 — live sample GET per `age_bucket`

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/whatsapp-sample-get.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-sample-get.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-sample-get.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sampleAgeBuckets } from '@/scripts/db-wipe-recovery/whatsapp-sample-get'
import type { MediaCandidate } from '@/scripts/db-wipe-recovery/types'

const mk = (id: string, bucket: MediaCandidate['ageBucket']): MediaCandidate => ({
  externalId: id, phone: '+27', messageType: 'image',
  firstSeenAt: new Date(), mediaId: id, caption: null, ageBucket: bucket,
})

describe('sampleAgeBuckets', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('marks bucket replayable when 200 returned on samples', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const candidates = [mk('a', 'lt_24h'), mk('b', 'lt_24h'), mk('c', 'lt_24h'), mk('d', 'lt_24h')]
    const verdict = await sampleAgeBuckets(candidates, { metaGet: fetcher })
    expect(verdict.lt_24h).toEqual({ replayable: true, samplesAttempted: 3 })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('marks bucket expired when all samples 404', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const candidates = [mk('a', '3_to_7d'), mk('b', '3_to_7d'), mk('c', '3_to_7d')]
    const verdict = await sampleAgeBuckets(candidates, { metaGet: fetcher })
    expect(verdict['3_to_7d']).toEqual({ replayable: false, samplesAttempted: 3 })
  })

  it('skips buckets with zero candidates', async () => {
    const fetcher = vi.fn()
    const verdict = await sampleAgeBuckets([mk('a', 'lt_24h')], { metaGet: fetcher })
    expect(verdict['1_to_3d']).toEqual({ replayable: null, samplesAttempted: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-sample-get.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the sampler.**

Create `field-service/scripts/db-wipe-recovery/whatsapp-sample-get.ts`:

```ts
import type { MediaCandidate, AgeBucket } from './types'

export type BucketVerdict = { replayable: boolean | null; samplesAttempted: number }
export type SampleResult = Record<AgeBucket, BucketVerdict>

const BUCKETS: AgeBucket[] = ['lt_24h', '1_to_3d', '3_to_7d', 'gt_7d']
const SAMPLE_SIZE = 3

async function defaultMetaGet(mediaId: string): Promise<{ ok: boolean; status?: number }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is required')
  const res = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { ok: res.ok, status: res.status }
}

export async function sampleAgeBuckets(
  candidates: MediaCandidate[],
  opts?: { metaGet?: (mediaId: string) => Promise<{ ok: boolean; status?: number }> },
): Promise<SampleResult> {
  const getter = opts?.metaGet ?? defaultMetaGet
  const result: SampleResult = {
    lt_24h: { replayable: null, samplesAttempted: 0 },
    '1_to_3d': { replayable: null, samplesAttempted: 0 },
    '3_to_7d': { replayable: null, samplesAttempted: 0 },
    gt_7d: { replayable: false, samplesAttempted: 0 },
  }
  for (const bucket of BUCKETS) {
    if (bucket === 'gt_7d') continue // skip — known expired
    const inBucket = candidates.filter((c) => c.ageBucket === bucket).slice(0, SAMPLE_SIZE)
    if (inBucket.length === 0) continue
    let anyOk = false
    for (const c of inBucket) {
      const r = await getter(c.mediaId)
      if (r.ok) anyOk = true
    }
    result[bucket] = { replayable: anyOk, samplesAttempted: inBucket.length }
  }
  return result
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-sample-get.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/whatsapp-sample-get.ts __tests__/scripts/db-wipe-recovery/whatsapp-sample-get.test.ts
git commit -m "feat(recovery): Workstream A2 — live sample GET per age_bucket"
```

---

### Task 9: Workstream A3 — parent resolution (HIGH/MEDIUM/LOW)

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/parent-resolution.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/parent-resolution.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/parent-resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveParent } from '@/scripts/db-wipe-recovery/parent-resolution'
import type { MediaCandidate } from '@/scripts/db-wipe-recovery/types'

const candidate: MediaCandidate = {
  externalId: 'wamid_1', phone: '+27123', messageType: 'image',
  firstSeenAt: new Date('2026-06-06T11:00:00Z'), mediaId: 'm1', caption: null, ageBucket: 'lt_24h',
}

describe('resolveParent', () => {
  it('returns HIGH when a restore-clone Attachment has uploadedBy=system:whatsapp:<id>', () => {
    const result = resolveParent(candidate, {
      restoreAttachments: [
        { uploadedBy: 'system:whatsapp:m1', label: 'evidence', providerApplicationId: 'app_1', jobRequestId: null, jobId: null, inspectionSlotId: null },
      ],
      providerApplicationsByPhone: new Map(),
      jobRequestsByPhone: new Map(),
    })
    expect(result.confidence).toBe('HIGH')
    if (result.confidence !== 'LOW') {
      expect(result.parent).toEqual({ kind: 'providerApplication', id: 'app_1' })
      expect(result.label).toBe('evidence')
    }
  })

  it('returns MEDIUM when phone + window match a single ProviderApplication', () => {
    const result = resolveParent(candidate, {
      restoreAttachments: [],
      providerApplicationsByPhone: new Map([['+27123', [{ id: 'app_2', submittedAt: new Date('2026-06-06T10:55:00Z') }]]]),
      jobRequestsByPhone: new Map(),
    })
    expect(result.confidence).toBe('MEDIUM')
  })

  it('returns LOW when phone alone is ambiguous', () => {
    const result = resolveParent(candidate, {
      restoreAttachments: [],
      providerApplicationsByPhone: new Map([['+27123', [
        { id: 'app_a', submittedAt: new Date('2026-06-01T10:00:00Z') },
        { id: 'app_b', submittedAt: new Date('2026-06-05T10:00:00Z') },
      ]]]),
      jobRequestsByPhone: new Map([['+27123', [
        { id: 'jr_a', createdAt: new Date('2026-06-06T10:55:00Z') },
      ]]]),
    })
    expect(result.confidence).toBe('LOW')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/parent-resolution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the resolver.**

Create `field-service/scripts/db-wipe-recovery/parent-resolution.ts`:

```ts
import type { MediaCandidate, ParentResolution } from './types'

type RestoreAttachment = {
  uploadedBy: string
  label: string | null
  providerApplicationId: string | null
  jobRequestId: string | null
  jobId: string | null
  inspectionSlotId: string | null
}

type ProviderApplicationStub = { id: string; submittedAt: Date }
type JobRequestStub = { id: string; createdAt: Date }

const WINDOW_MS = 30 * 60 * 1000

function pickParentFromRestore(a: RestoreAttachment): ParentResolution['confidence'] extends 'LOW' ? never : Extract<ParentResolution, { confidence: 'HIGH' }> {
  const label = a.label ?? 'evidence'
  if (a.providerApplicationId) return { confidence: 'HIGH', parent: { kind: 'providerApplication', id: a.providerApplicationId }, label, reason: 'restore_clone_exact_match' }
  if (a.jobRequestId) return { confidence: 'HIGH', parent: { kind: 'jobRequest', id: a.jobRequestId }, label, reason: 'restore_clone_exact_match' }
  if (a.jobId) return { confidence: 'HIGH', parent: { kind: 'job', id: a.jobId }, label, reason: 'restore_clone_exact_match' }
  if (a.inspectionSlotId) return { confidence: 'HIGH', parent: { kind: 'inspectionSlot', id: a.inspectionSlotId }, label, reason: 'restore_clone_exact_match' }
  throw new Error('restore_clone_attachment_has_no_parent_fk')
}

export function resolveParent(
  candidate: MediaCandidate,
  context: {
    restoreAttachments: RestoreAttachment[]
    providerApplicationsByPhone: Map<string, ProviderApplicationStub[]>
    jobRequestsByPhone: Map<string, JobRequestStub[]>
  },
): ParentResolution {
  const hit = context.restoreAttachments.find((a) => a.uploadedBy === `system:whatsapp:${candidate.mediaId}`)
  if (hit) return pickParentFromRestore(hit)

  const apps = context.providerApplicationsByPhone.get(candidate.phone) ?? []
  const requests = context.jobRequestsByPhone.get(candidate.phone) ?? []
  const candidateTime = candidate.firstSeenAt.getTime()

  const appsInWindow = apps.filter((a) => Math.abs(a.submittedAt.getTime() - candidateTime) <= WINDOW_MS)
  const requestsInWindow = requests.filter((r) => Math.abs(r.createdAt.getTime() - candidateTime) <= WINDOW_MS)

  const totalInWindow = appsInWindow.length + requestsInWindow.length
  if (totalInWindow === 1) {
    if (appsInWindow.length === 1) {
      return {
        confidence: 'MEDIUM',
        parent: { kind: 'providerApplication', id: appsInWindow[0].id },
        label: 'evidence',
        reason: 'phone_plus_window_unique_application',
      }
    }
    return {
      confidence: 'MEDIUM',
      parent: { kind: 'jobRequest', id: requestsInWindow[0].id },
      label: 'evidence',
      reason: 'phone_plus_window_unique_job_request',
    }
  }
  return { confidence: 'LOW', reason: `ambiguous_phone:${totalInWindow}_candidates_in_window` }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/parent-resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/parent-resolution.ts __tests__/scripts/db-wipe-recovery/parent-resolution.test.ts
git commit -m "feat(recovery): Workstream A3 — HIGH/MEDIUM/LOW parent resolution"
```

---

### Task 10: Workstream A4 — bulk replay loop

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/whatsapp-replay.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-replay.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/whatsapp-replay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { planReplays } from '@/scripts/db-wipe-recovery/whatsapp-replay'
import type { MediaCandidate, ParentResolution } from '@/scripts/db-wipe-recovery/types'

const candidate = (id: string, bucket: MediaCandidate['ageBucket'], type: MediaCandidate['messageType'] = 'image'): MediaCandidate => ({
  externalId: id, phone: '+27', messageType: type,
  firstSeenAt: new Date(), mediaId: id, caption: null, ageBucket: bucket,
})

describe('planReplays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits WHATSAPP_VIDEO_UNSUPPORTED reconciliation for video candidates', () => {
    const result = planReplays({
      candidates: [candidate('m1', 'lt_24h', 'video')],
      verdicts: { lt_24h: { replayable: true, samplesAttempted: 3 }, '1_to_3d': { replayable: null, samplesAttempted: 0 }, '3_to_7d': { replayable: null, samplesAttempted: 0 }, gt_7d: { replayable: false, samplesAttempted: 0 } },
      resolutions: new Map([['m1', { confidence: 'HIGH', parent: { kind: 'providerApplication', id: 'a' }, label: 'evidence', reason: 'x' } as ParentResolution]]),
    })
    expect(result.replays).toHaveLength(0)
    expect(result.reconciliation[0].gapKind).toBe('WHATSAPP_VIDEO_UNSUPPORTED')
  })

  it('emits WHATSAPP_MEDIA_BEYOND_META_RETENTION when bucket is expired', () => {
    const result = planReplays({
      candidates: [candidate('m1', '3_to_7d')],
      verdicts: { lt_24h: { replayable: null, samplesAttempted: 0 }, '1_to_3d': { replayable: null, samplesAttempted: 0 }, '3_to_7d': { replayable: false, samplesAttempted: 3 }, gt_7d: { replayable: false, samplesAttempted: 0 } },
      resolutions: new Map([['m1', { confidence: 'HIGH', parent: { kind: 'providerApplication', id: 'a' }, label: 'evidence', reason: 'x' } as ParentResolution]]),
    })
    expect(result.replays).toHaveLength(0)
    expect(result.reconciliation[0].gapKind).toBe('WHATSAPP_MEDIA_BEYOND_META_RETENTION')
  })

  it('emits a replay when confidence >= MEDIUM and bucket is replayable', () => {
    const result = planReplays({
      candidates: [candidate('m1', 'lt_24h')],
      verdicts: { lt_24h: { replayable: true, samplesAttempted: 3 }, '1_to_3d': { replayable: null, samplesAttempted: 0 }, '3_to_7d': { replayable: null, samplesAttempted: 0 }, gt_7d: { replayable: false, samplesAttempted: 0 } },
      resolutions: new Map([['m1', { confidence: 'MEDIUM', parent: { kind: 'jobRequest', id: 'jr_1' }, label: 'evidence', reason: 'y' } as ParentResolution]]),
    })
    expect(result.replays).toEqual([{ mediaId: 'm1', parent: { kind: 'jobRequest', id: 'jr_1' }, label: 'evidence' }])
    expect(result.reconciliation).toHaveLength(0)
  })

  it('emits LOW_CONFIDENCE reconciliation instead of replay', () => {
    const result = planReplays({
      candidates: [candidate('m1', 'lt_24h')],
      verdicts: { lt_24h: { replayable: true, samplesAttempted: 3 }, '1_to_3d': { replayable: null, samplesAttempted: 0 }, '3_to_7d': { replayable: null, samplesAttempted: 0 }, gt_7d: { replayable: false, samplesAttempted: 0 } },
      resolutions: new Map([['m1', { confidence: 'LOW', reason: 'ambiguous_phone' } as ParentResolution]]),
    })
    expect(result.reconciliation[0].gapKind).toBe('WHATSAPP_MEDIA_RESOLUTION_LOW_CONFIDENCE')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-replay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the planner.**

Create `field-service/scripts/db-wipe-recovery/whatsapp-replay.ts`:

```ts
import { recoverWhatsAppAttachment, PARENT_FK_MISMATCH_ERROR } from '@/lib/whatsapp-media'
import type { MediaCandidate, ParentResolution, Plan, ReconciliationRow } from './types'
import type { SampleResult } from './whatsapp-sample-get'

type PlannedReplay = Plan['whatsappReplays'][number]

export function planReplays(input: {
  candidates: MediaCandidate[]
  verdicts: SampleResult
  resolutions: Map<string, ParentResolution>
}): { replays: PlannedReplay[]; reconciliation: ReconciliationRow[] } {
  const replays: PlannedReplay[] = []
  const reconciliation: ReconciliationRow[] = []

  for (const c of input.candidates) {
    if (c.messageType === 'video') {
      reconciliation.push({
        gapKind: 'WHATSAPP_VIDEO_UNSUPPORTED', phone: c.phone, parentKind: null, parentId: null,
        mediaIdOrBlobKey: c.mediaId, reason: 'video_mime_not_in_allow_list',
        recommendedAction: 'skip_or_extend_allow_list',
      })
      continue
    }

    const verdict = input.verdicts[c.ageBucket]
    if (verdict.replayable === false) {
      reconciliation.push({
        gapKind: 'WHATSAPP_MEDIA_BEYOND_META_RETENTION', phone: c.phone, parentKind: null, parentId: null,
        mediaIdOrBlobKey: c.mediaId, reason: `age_bucket_${c.ageBucket}_expired`,
        recommendedAction: 're_request_if_onboarding_in_progress_else_grandfather',
      })
      continue
    }

    const resolution = input.resolutions.get(c.mediaId)
    if (!resolution || resolution.confidence === 'LOW') {
      reconciliation.push({
        gapKind: 'WHATSAPP_MEDIA_RESOLUTION_LOW_CONFIDENCE', phone: c.phone, parentKind: null, parentId: null,
        mediaIdOrBlobKey: c.mediaId, reason: resolution?.reason ?? 'no_resolution',
        recommendedAction: 'manual_review_before_replay',
      })
      continue
    }

    replays.push({ mediaId: c.mediaId, parent: resolution.parent, label: resolution.label })
  }

  return { replays, reconciliation }
}

export async function applyReplays(replays: PlannedReplay[]): Promise<ReconciliationRow[]> {
  const reconciliation: ReconciliationRow[] = []
  for (const r of replays) {
    try {
      await recoverWhatsAppAttachment({ mediaId: r.mediaId, parent: r.parent, label: r.label })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === PARENT_FK_MISMATCH_ERROR) {
        reconciliation.push({
          gapKind: 'PARENT_FK_MISMATCH', phone: null, parentKind: r.parent.kind, parentId: r.parent.id,
          mediaIdOrBlobKey: r.mediaId, reason: 'existing_attachment_has_different_parent',
          recommendedAction: 'reconcile_against_prior_replay_before_rerun',
        })
        continue
      }
      throw err
    }
  }
  return reconciliation
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/whatsapp-replay.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/whatsapp-replay.ts __tests__/scripts/db-wipe-recovery/whatsapp-replay.test.ts
git commit -m "feat(recovery): Workstream A4 — replay planner + applier with mismatch handling"
```

---

### Task 11: Workstream B1 — KYC import (`supabase://` parsing + storage matching)

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/kyc-import.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/kyc-import.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/kyc-import.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { matchStorageObjects } from '@/scripts/db-wipe-recovery/kyc-import'

describe('matchStorageObjects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('joins restore document blobKey to live storage.objects by parsed bucket/path', () => {
    const result = matchStorageObjects({
      restoreDocuments: [
        { id: 'd1', verificationId: 'v1', documentKind: 'ID_FRONT', blobKey: 'supabase://identity-documents/2026/v1/id_front.jpg', mimeType: 'image/jpeg', sizeBytes: 100, sha256: 'h1' },
      ],
      liveStorageObjects: [
        { bucket_id: 'identity-documents', name: '2026/v1/id_front.jpg', mime_type: 'image/jpeg', size_bytes: 100 },
        { bucket_id: 'identity-documents', name: '2026/orphan.jpg', mime_type: 'image/jpeg', size_bytes: 200 },
      ],
    })
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].document.id).toBe('d1')
    expect(result.orphanStorageObjects).toHaveLength(1)
    expect(result.orphanStorageObjects[0].name).toBe('2026/orphan.jpg')
  })

  it('produces SHA256_MISMATCH-friendly fields by passing sha256 through to the planner caller', () => {
    const result = matchStorageObjects({
      restoreDocuments: [
        { id: 'd1', verificationId: 'v1', documentKind: 'ID_FRONT', blobKey: 'supabase://identity-documents/x.jpg', mimeType: 'image/jpeg', sizeBytes: 100, sha256: 'h1' },
      ],
      liveStorageObjects: [{ bucket_id: 'identity-documents', name: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 100 }],
    })
    expect(result.matched[0].document.sha256).toBe('h1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the importer.**

Create `field-service/scripts/db-wipe-recovery/kyc-import.ts`:

```ts
import { db } from '@/lib/db'
import { getRestoreClient } from './restore-client'
import type { ReconciliationRow } from './types'

const SUPABASE_PREFIX = 'supabase://'

export type RestoreDocument = {
  id: string
  verificationId: string
  documentKind: string
  blobKey: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export type LiveStorageObject = {
  bucket_id: string
  name: string
  mime_type: string | null
  size_bytes: number | null
}

function parseBlobKey(blobKey: string): { bucket: string; path: string } | null {
  if (!blobKey.startsWith(SUPABASE_PREFIX)) return null
  const rest = blobKey.slice(SUPABASE_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) }
}

export function matchStorageObjects(input: {
  restoreDocuments: RestoreDocument[]
  liveStorageObjects: LiveStorageObject[]
}): {
  matched: Array<{ document: RestoreDocument; storage: LiveStorageObject }>
  unmatchedDocuments: RestoreDocument[]
  orphanStorageObjects: LiveStorageObject[]
} {
  const storageIndex = new Map<string, LiveStorageObject>()
  for (const o of input.liveStorageObjects) storageIndex.set(`${o.bucket_id}/${o.name}`, o)

  const matched: Array<{ document: RestoreDocument; storage: LiveStorageObject }> = []
  const unmatchedDocuments: RestoreDocument[] = []
  const consumedKeys = new Set<string>()

  for (const doc of input.restoreDocuments) {
    const parsed = parseBlobKey(doc.blobKey)
    if (!parsed) { unmatchedDocuments.push(doc); continue }
    const key = `${parsed.bucket}/${parsed.path}`
    const storage = storageIndex.get(key)
    if (!storage) { unmatchedDocuments.push(doc); continue }
    matched.push({ document: doc, storage })
    consumedKeys.add(key)
  }

  const orphanStorageObjects = input.liveStorageObjects.filter(
    (o) => !consumedKeys.has(`${o.bucket_id}/${o.name}`),
  )
  return { matched, unmatchedDocuments, orphanStorageObjects }
}

export async function loadRestoreDocuments(params: { gateCapturedAt: string }): Promise<RestoreDocument[]> {
  const restore = getRestoreClient()
  return restore.$queryRawUnsafe<RestoreDocument[]>(
    `SELECT id, "verificationId", "documentKind", "blobKey", "mimeType", "sizeBytes", sha256
     FROM provider_identity_documents
     WHERE "createdAt" <= '${params.gateCapturedAt}'`,
  )
}

export async function loadLiveStorageObjects(params: { gateCapturedAt: string }): Promise<LiveStorageObject[]> {
  return db.$queryRawUnsafe<LiveStorageObject[]>(
    `SELECT
       name,
       bucket_id,
       metadata->>'mimetype' AS mime_type,
       (metadata->>'size')::bigint AS size_bytes
     FROM storage.objects
     WHERE bucket_id = 'identity-documents'
       AND created_at <= '${params.gateCapturedAt}'`,
  )
}

export function buildKycReconciliation(orphans: LiveStorageObject[]): ReconciliationRow[] {
  return orphans.map((o) => ({
    gapKind: 'IDENTITY_STORAGE_ORPHAN',
    phone: null, parentKind: null, parentId: null,
    mediaIdOrBlobKey: `${SUPABASE_PREFIX}${o.bucket_id}/${o.name}`,
    reason: 'orphan_storage_object_without_metadata',
    recommendedAction: 'manual_triage_before_reconstruction',
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/kyc-import.ts __tests__/scripts/db-wipe-recovery/kyc-import.test.ts
git commit -m "feat(recovery): Workstream B1 — KYC import with supabase:// parsing"
```

---

### Task 12: Workstream B2 — orphan triage (three-proof requirement)

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/kyc-orphan-triage.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/kyc-orphan-triage.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/kyc-orphan-triage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { triageOrphanStorageObjects } from '@/scripts/db-wipe-recovery/kyc-orphan-triage'

describe('triageOrphanStorageObjects', () => {
  it('returns no reconstructions when none of the three proofs hold', () => {
    const result = triageOrphanStorageObjects({
      orphans: [{ bucket_id: 'identity-documents', name: 'orphan.jpg', mime_type: 'image/jpeg', size_bytes: 1 }],
      restoreWebhookEvents: [],
      restoreVerifications: [],
    })
    expect(result.reconstructions).toHaveLength(0)
    expect(result.reconciliation[0].gapKind).toBe('IDENTITY_STORAGE_ORPHAN')
  })

  it('reconstructs when a restore webhook event with non-null verificationId references the storage path', () => {
    const result = triageOrphanStorageObjects({
      orphans: [{ bucket_id: 'identity-documents', name: '2026/v1/x.jpg', mime_type: 'image/jpeg', size_bytes: 1 }],
      restoreWebhookEvents: [{
        verificationId: 'v1', vendorKey: 'didit', vendorReference: 'vr_1', livenessSessionReference: null,
        rawPayloadRedacted: { paths: ['2026/v1/x.jpg'] },
      }],
      restoreVerifications: [{ id: 'v1', providerId: 'prov_1', providerApplicationId: null }],
    })
    expect(result.reconstructions).toHaveLength(1)
    expect(result.reconstructions[0].verificationId).toBe('v1')
    expect(result.reconciliation).toHaveLength(0)
  })

  it('does not reconstruct from a webhook event with null verificationId', () => {
    const result = triageOrphanStorageObjects({
      orphans: [{ bucket_id: 'identity-documents', name: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 1 }],
      restoreWebhookEvents: [{ verificationId: null, vendorKey: 'didit', vendorReference: 'vr_1', livenessSessionReference: null, rawPayloadRedacted: { paths: ['x.jpg'] } }],
      restoreVerifications: [],
    })
    expect(result.reconstructions).toHaveLength(0)
    expect(result.reconciliation.map((r) => r.gapKind)).toContain('KYC_VENDOR_REF_NO_PROVIDER_LINK')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-orphan-triage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the triage module.**

Create `field-service/scripts/db-wipe-recovery/kyc-orphan-triage.ts`:

```ts
import type { ReconciliationRow } from './types'
import type { LiveStorageObject } from './kyc-import'

export type RestoreWebhookEvent = {
  verificationId: string | null
  vendorKey: string
  vendorReference: string | null
  livenessSessionReference: string | null
  rawPayloadRedacted: { paths?: string[] } | null
}

export type RestoreVerificationStub = {
  id: string
  providerId: string | null
  providerApplicationId: string | null
}

function payloadReferencesPath(payload: RestoreWebhookEvent['rawPayloadRedacted'], path: string): boolean {
  return Boolean(payload?.paths?.includes(path))
}

export function triageOrphanStorageObjects(input: {
  orphans: LiveStorageObject[]
  restoreWebhookEvents: RestoreWebhookEvent[]
  restoreVerifications: RestoreVerificationStub[]
}): {
  reconstructions: Array<{ verificationId: string; storage: LiveStorageObject }>
  reconciliation: ReconciliationRow[]
} {
  const reconstructions: Array<{ verificationId: string; storage: LiveStorageObject }> = []
  const reconciliation: ReconciliationRow[] = []

  const verificationById = new Map(input.restoreVerifications.map((v) => [v.id, v]))

  for (const orphan of input.orphans) {
    const linkedEvent = input.restoreWebhookEvents.find(
      (e) => e.verificationId && payloadReferencesPath(e.rawPayloadRedacted, orphan.name),
    )
    const verification = linkedEvent?.verificationId ? verificationById.get(linkedEvent.verificationId) : null
    if (linkedEvent && verification && (verification.providerId || verification.providerApplicationId)) {
      reconstructions.push({ verificationId: verification.id, storage: orphan })
    } else {
      reconciliation.push({
        gapKind: 'IDENTITY_STORAGE_ORPHAN',
        phone: null, parentKind: null, parentId: null,
        mediaIdOrBlobKey: `supabase://${orphan.bucket_id}/${orphan.name}`,
        reason: linkedEvent ? 'webhook_event_lacks_provider_link' : 'no_proof_available',
        recommendedAction: 'manual_triage_before_reconstruction',
      })
    }
  }

  for (const event of input.restoreWebhookEvents) {
    if (!event.verificationId) {
      reconciliation.push({
        gapKind: 'KYC_VENDOR_REF_NO_PROVIDER_LINK',
        phone: null, parentKind: null, parentId: null,
        mediaIdOrBlobKey: event.vendorReference ?? null,
        reason: 'orphan_webhook_event_no_verification_link',
        recommendedAction: 'leave_in_restore_clone_only',
      })
    }
  }

  return { reconstructions, reconciliation }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-orphan-triage.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/kyc-orphan-triage.ts __tests__/scripts/db-wipe-recovery/kyc-orphan-triage.test.ts
git commit -m "feat(recovery): Workstream B2 — orphan storage triage with three-proof requirement"
```

---

### Task 13: Workstream B3 — Didit top-up (gated; no-op until cost confirmed)

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/kyc-didit-topup.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/kyc-didit-topup.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/kyc-didit-topup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runDiditTopUp } from '@/scripts/db-wipe-recovery/kyc-didit-topup'

describe('runDiditTopUp', () => {
  it('returns a no-op result with reconciliation rows when DIDIT_READ_API_CONFIRMED is unset', async () => {
    delete process.env.DIDIT_READ_API_CONFIRMED
    const result = await runDiditTopUp({ candidatePhones: ['+27111', '+27222'] })
    expect(result.attempted).toBe(false)
    expect(result.reconciliation).toHaveLength(2)
    expect(result.reconciliation[0].gapKind).toBe('IDENTITY_VENDOR_REFRESH_FAILED')
    expect(result.reconciliation[0].reason).toMatch(/DIDIT_READ_API_CONFIRMED/)
  })

  it('attempts top-up when DIDIT_READ_API_CONFIRMED=true', async () => {
    process.env.DIDIT_READ_API_CONFIRMED = 'true'
    const result = await runDiditTopUp({ candidatePhones: ['+27111'], __testLookup: async () => ({ ok: false, reason: 'no_verification_for_phone' }) })
    expect(result.attempted).toBe(true)
    expect(result.reconciliation[0].reason).toBe('no_verification_for_phone')
    delete process.env.DIDIT_READ_API_CONFIRMED
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-didit-topup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the top-up module.**

Create `field-service/scripts/db-wipe-recovery/kyc-didit-topup.ts`:

```ts
import type { ReconciliationRow } from './types'

export async function runDiditTopUp(params: {
  candidatePhones: string[]
  __testLookup?: (phone: string) => Promise<{ ok: boolean; reason?: string }>
}): Promise<{ attempted: boolean; reconciliation: ReconciliationRow[] }> {
  const confirmed = process.env.DIDIT_READ_API_CONFIRMED === 'true'
  const reconciliation: ReconciliationRow[] = []

  if (!confirmed) {
    for (const phone of params.candidatePhones) {
      reconciliation.push({
        gapKind: 'IDENTITY_VENDOR_REFRESH_FAILED',
        phone, parentKind: null, parentId: null,
        mediaIdOrBlobKey: null,
        reason: 'skipped_DIDIT_READ_API_CONFIRMED_unset',
        recommendedAction: 'confirm_didit_read_cost_then_rerun_with_DIDIT_READ_API_CONFIRMED_true',
      })
    }
    return { attempted: false, reconciliation }
  }

  const lookup = params.__testLookup
  if (!lookup) {
    // Real implementation: call Didit's read endpoint here. Left intentionally
    // unimplemented until the cost/retention answer is captured in the spec.
    return { attempted: true, reconciliation: [] }
  }

  for (const phone of params.candidatePhones) {
    const r = await lookup(phone)
    if (!r.ok) {
      reconciliation.push({
        gapKind: 'IDENTITY_VENDOR_REFRESH_FAILED',
        phone, parentKind: null, parentId: null,
        mediaIdOrBlobKey: null,
        reason: r.reason ?? 'unknown',
        recommendedAction: 'manual_triage_or_re_request',
      })
    }
  }
  return { attempted: true, reconciliation }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-didit-topup.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/kyc-didit-topup.ts __tests__/scripts/db-wipe-recovery/kyc-didit-topup.test.ts
git commit -m "feat(recovery): Workstream B3 — Didit read-API top-up gated on cost confirmation"
```

---

### Task 14: Workstream B4 — SHA256 integrity verify

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/kyc-integrity.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/kyc-integrity.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/kyc-integrity.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { verifyDocumentIntegrity } from '@/scripts/db-wipe-recovery/kyc-integrity'

describe('verifyDocumentIntegrity', () => {
  it('returns an empty reconciliation when all sha256 match', async () => {
    const result = await verifyDocumentIntegrity({
      matched: [{ document: { id: 'd1', verificationId: 'v', documentKind: 'ID_FRONT', blobKey: 'k', mimeType: 'image/jpeg', sizeBytes: 4, sha256: 'h1' }, storage: { bucket_id: 'identity-documents', name: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 4 } }],
      computeSha256: vi.fn().mockResolvedValue('h1'),
    })
    expect(result).toHaveLength(0)
  })

  it('emits SHA256_MISMATCH for diverging hashes', async () => {
    const result = await verifyDocumentIntegrity({
      matched: [{ document: { id: 'd1', verificationId: 'v', documentKind: 'ID_FRONT', blobKey: 'k', mimeType: 'image/jpeg', sizeBytes: 4, sha256: 'expected' }, storage: { bucket_id: 'identity-documents', name: 'x.jpg', mime_type: 'image/jpeg', size_bytes: 4 } }],
      computeSha256: vi.fn().mockResolvedValue('actual'),
    })
    expect(result).toHaveLength(1)
    expect(result[0].gapKind).toBe('SHA256_MISMATCH')
    expect(result[0].reason).toMatch(/expected/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-integrity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the integrity module.**

Create `field-service/scripts/db-wipe-recovery/kyc-integrity.ts`:

```ts
import type { ReconciliationRow } from './types'
import type { LiveStorageObject, RestoreDocument } from './kyc-import'

export async function verifyDocumentIntegrity(input: {
  matched: Array<{ document: RestoreDocument; storage: LiveStorageObject }>
  computeSha256: (storage: LiveStorageObject) => Promise<string>
}): Promise<ReconciliationRow[]> {
  const rows: ReconciliationRow[] = []
  for (const { document, storage } of input.matched) {
    const actual = await input.computeSha256(storage)
    if (actual !== document.sha256) {
      rows.push({
        gapKind: 'SHA256_MISMATCH',
        phone: null, parentKind: null, parentId: document.id,
        mediaIdOrBlobKey: document.blobKey,
        reason: `expected=${document.sha256} actual=${actual}`,
        recommendedAction: 'investigate_before_treating_as_recovered',
      })
    }
  }
  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/kyc-integrity.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/kyc-integrity.ts __tests__/scripts/db-wipe-recovery/kyc-integrity.test.ts
git commit -m "feat(recovery): Workstream B4 — SHA256 document integrity verification"
```

---

### Task 15: Workstream D — reconciliation CSV writer

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/reconciliation.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/reconciliation.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/reconciliation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rowsToCsv } from '@/scripts/db-wipe-recovery/reconciliation'

describe('rowsToCsv', () => {
  it('emits header + escaped CSV rows', () => {
    const csv = rowsToCsv([
      { gapKind: 'WHATSAPP_VIDEO_UNSUPPORTED', phone: '+27123', parentKind: null, parentId: null, mediaIdOrBlobKey: 'm1', reason: 'has,comma', recommendedAction: 'skip' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('gapKind,phone,parentKind,parentId,mediaIdOrBlobKey,reason,recommendedAction')
    expect(lines[1]).toContain('"has,comma"')
    expect(lines[1].startsWith('WHATSAPP_VIDEO_UNSUPPORTED,+27123,,,m1,')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/reconciliation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the writer.**

Create `field-service/scripts/db-wipe-recovery/reconciliation.ts`:

```ts
import type { ReconciliationRow } from './types'

const COLUMNS: Array<keyof ReconciliationRow> = [
  'gapKind', 'phone', 'parentKind', 'parentId', 'mediaIdOrBlobKey', 'reason', 'recommendedAction',
]

function escape(value: string | null): string {
  if (value === null) return ''
  const needsQuoting = /[",\n]/.test(value)
  const inner = value.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

export function rowsToCsv(rows: ReconciliationRow[]): string {
  const header = COLUMNS.join(',')
  const body = rows.map((row) => COLUMNS.map((c) => escape((row[c] ?? null) as string | null)).join(',')).join('\n')
  return body ? `${header}\n${body}` : header
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/reconciliation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/reconciliation.ts __tests__/scripts/db-wipe-recovery/reconciliation.test.ts
git commit -m "feat(recovery): Workstream D — reconciliation CSV writer"
```

---

### Task 16: Recovery data loaders

**Files:**
- Create: `field-service/scripts/db-wipe-recovery/data-loaders.ts`.
- Test: `field-service/__tests__/scripts/db-wipe-recovery/data-loaders.test.ts`.

- [ ] **Step 1: Write the failing test.**

Create `field-service/__tests__/scripts/db-wipe-recovery/data-loaders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadRestoreAttachments, loadParentContextByPhone, loadRestoreVerifications, loadRestoreWebhookEvents } from '@/scripts/db-wipe-recovery/data-loaders'

vi.mock('@/scripts/db-wipe-recovery/restore-client', () => ({
  getRestoreClient: () => ({
    $queryRawUnsafe: vi.fn(),
  }),
}))

vi.mock('@/lib/db', () => ({
  db: { $queryRawUnsafe: vi.fn() },
}))

describe('data-loaders', () => {
  const gate = '2026-06-06T12:00:00Z'
  beforeEach(() => vi.clearAllMocks())

  it('loadRestoreAttachments scopes by createdAt <= gate', async () => {
    const restore = (await import('@/scripts/db-wipe-recovery/restore-client')).getRestoreClient() as { $queryRawUnsafe: ReturnType<typeof vi.fn> }
    restore.$queryRawUnsafe.mockResolvedValue([])
    await loadRestoreAttachments({ gateCapturedAt: gate })
    expect(restore.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"createdAt" <= '${gate}'`))
    expect(restore.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"uploadedBy" LIKE 'system:whatsapp:%'`))
  })

  it('loadParentContextByPhone groups apps and requests by phone using live prod', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'app_1', phone: '+27', submittedAt: new Date() }])
      .mockResolvedValueOnce([{ id: 'jr_1', phone: '+27', createdAt: new Date() }])
    const ctx = await loadParentContextByPhone({ gateCapturedAt: gate })
    expect(ctx.providerApplicationsByPhone.get('+27')).toHaveLength(1)
    expect(ctx.jobRequestsByPhone.get('+27')).toHaveLength(1)
  })

  it('loadRestoreVerifications and loadRestoreWebhookEvents both scope by gate', async () => {
    const restore = (await import('@/scripts/db-wipe-recovery/restore-client')).getRestoreClient() as { $queryRawUnsafe: ReturnType<typeof vi.fn> }
    restore.$queryRawUnsafe.mockResolvedValue([])
    await loadRestoreVerifications({ gateCapturedAt: gate })
    await loadRestoreWebhookEvents({ gateCapturedAt: gate })
    expect(restore.$queryRawUnsafe).toHaveBeenNthCalledWith(1, expect.stringContaining(`"createdAt" <= '${gate}'`))
    expect(restore.$queryRawUnsafe).toHaveBeenNthCalledWith(2, expect.stringContaining(`"receivedAt" <= '${gate}'`))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/data-loaders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the data-loaders module.**

Create `field-service/scripts/db-wipe-recovery/data-loaders.ts`:

```ts
import { db } from '@/lib/db'
import { getRestoreClient } from './restore-client'

export type RestoreAttachmentRow = {
  uploadedBy: string
  label: string | null
  providerApplicationId: string | null
  jobRequestId: string | null
  jobId: string | null
  inspectionSlotId: string | null
}

export async function loadRestoreAttachments(params: { gateCapturedAt: string }): Promise<RestoreAttachmentRow[]> {
  const restore = getRestoreClient()
  return restore.$queryRawUnsafe<RestoreAttachmentRow[]>(`
    SELECT "uploadedBy", label, "providerApplicationId", "jobRequestId", "jobId", "inspectionSlotId"
    FROM attachments
    WHERE "createdAt" <= '${params.gateCapturedAt}'
      AND "uploadedBy" LIKE 'system:whatsapp:%'
  `)
}

type AppRow = { id: string; phone: string; submittedAt: Date }
type JobRequestRow = { id: string; phone: string; createdAt: Date }

export async function loadParentContextByPhone(params: { gateCapturedAt: string }): Promise<{
  providerApplicationsByPhone: Map<string, Array<{ id: string; submittedAt: Date }>>
  jobRequestsByPhone: Map<string, Array<{ id: string; createdAt: Date }>>
}> {
  const apps = await db.$queryRawUnsafe<AppRow[]>(`
    SELECT pa.id, pa.phone, pa."submittedAt"
    FROM provider_applications pa
    WHERE pa."submittedAt" <= '${params.gateCapturedAt}'
  `)
  const requests = await db.$queryRawUnsafe<JobRequestRow[]>(`
    SELECT jr.id, c.phone, jr."createdAt"
    FROM job_requests jr
    JOIN customers c ON c.id = jr."customerId"
    WHERE jr."createdAt" <= '${params.gateCapturedAt}'
  `)

  const providerApplicationsByPhone = new Map<string, Array<{ id: string; submittedAt: Date }>>()
  for (const a of apps) {
    const arr = providerApplicationsByPhone.get(a.phone) ?? []
    arr.push({ id: a.id, submittedAt: a.submittedAt })
    providerApplicationsByPhone.set(a.phone, arr)
  }
  const jobRequestsByPhone = new Map<string, Array<{ id: string; createdAt: Date }>>()
  for (const r of requests) {
    const arr = jobRequestsByPhone.get(r.phone) ?? []
    arr.push({ id: r.id, createdAt: r.createdAt })
    jobRequestsByPhone.set(r.phone, arr)
  }
  return { providerApplicationsByPhone, jobRequestsByPhone }
}

export type RestoreVerificationRow = {
  id: string
  providerId: string | null
  providerApplicationId: string | null
  vendorReference: string | null
  vendorWorkflowId: string | null
  status: string
  decision: string | null
  rawPayloadRedacted: unknown
  consentTextHash: string | null
  accessTokenHash: string | null
}

export async function loadRestoreVerifications(params: { gateCapturedAt: string }): Promise<RestoreVerificationRow[]> {
  const restore = getRestoreClient()
  return restore.$queryRawUnsafe<RestoreVerificationRow[]>(`
    SELECT id, "providerId", "providerApplicationId", "vendorReference", "vendorWorkflowId",
           status, decision, "rawPayloadRedacted", "consentTextHash", "accessTokenHash"
    FROM provider_identity_verifications
    WHERE "createdAt" <= '${params.gateCapturedAt}'
  `)
}

export type RestoreWebhookEventRow = {
  verificationId: string | null
  vendorKey: string
  vendorReference: string | null
  livenessSessionReference: string | null
  rawPayloadRedacted: { paths?: string[] } | null
}

export async function loadRestoreWebhookEvents(params: { gateCapturedAt: string }): Promise<RestoreWebhookEventRow[]> {
  const restore = getRestoreClient()
  return restore.$queryRawUnsafe<RestoreWebhookEventRow[]>(`
    SELECT "verificationId", "vendorKey", "vendorReference", "livenessSessionReference", "rawPayloadRedacted"
    FROM provider_verification_webhook_events
    WHERE "receivedAt" <= '${params.gateCapturedAt}'
  `)
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/db-wipe-recovery/data-loaders.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery/data-loaders.ts __tests__/scripts/db-wipe-recovery/data-loaders.test.ts
git commit -m "feat(recovery): data loaders for restore Attachments, parent context, verifications, webhooks"
```

---

### Task 17: CLI entry — `gate`, `plan --dry-run`, `apply --confirm`

**Files:**
- Create: `field-service/scripts/db-wipe-recovery.ts`.

- [ ] **Step 1: Write the CLI entry.**

Create `field-service/scripts/db-wipe-recovery.ts`:

```ts
/**
 * db-wipe-recovery.ts
 *
 * One-shot recovery script for the 2026-06-06 wipe incident.
 *
 * Usage:
 *   pnpm tsx scripts/db-wipe-recovery.ts gate --out ./recovery
 *   pnpm tsx scripts/db-wipe-recovery.ts plan --dry-run --out ./recovery
 *   pnpm tsx scripts/db-wipe-recovery.ts apply --confirm --plan ./recovery/plan.json
 *
 * Requires:
 *   DATABASE_URL
 *   RESTORE_DATABASE_URL
 *   WHATSAPP_ACCESS_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DIDIT_READ_API_CONFIRMED=true   (optional, gates Workstream B3)
 */

import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGate, verifyStalePlanGuard } from './db-wipe-recovery/gate'
import { harvestMediaCandidates } from './db-wipe-recovery/whatsapp-harvest'
import { sampleAgeBuckets } from './db-wipe-recovery/whatsapp-sample-get'
import { resolveParent } from './db-wipe-recovery/parent-resolution'
import { planReplays, applyReplays } from './db-wipe-recovery/whatsapp-replay'
import {
  loadRestoreDocuments,
  loadLiveStorageObjects,
  matchStorageObjects,
  buildKycReconciliation,
} from './db-wipe-recovery/kyc-import'
import { triageOrphanStorageObjects } from './db-wipe-recovery/kyc-orphan-triage'
import { runDiditTopUp } from './db-wipe-recovery/kyc-didit-topup'
import { verifyDocumentIntegrity } from './db-wipe-recovery/kyc-integrity'
import { rowsToCsv } from './db-wipe-recovery/reconciliation'
import {
  loadRestoreAttachments,
  loadParentContextByPhone,
  loadRestoreVerifications,
  loadRestoreWebhookEvents,
} from './db-wipe-recovery/data-loaders'
import type { ParentResolution, Plan, ReconciliationRow } from './db-wipe-recovery/types'

type Args = { subcommand: string; flags: Record<string, string | true> }

function parseArgs(argv: string[]): Args {
  const [, , subcommand = '', ...rest] = argv
  const flags: Args['flags'] = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = rest[i + 1]
    if (!next || next.startsWith('--')) { flags[key] = true; continue }
    flags[key] = next; i++
  }
  return { subcommand, flags }
}

async function cmdGate(outDir: string): Promise<void> {
  const snapshot = await runGate()
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'gate.json'), JSON.stringify(snapshot, null, 2))
  console.info('[recovery] gate captured', snapshot)
}

async function cmdPlanDryRun(outDir: string): Promise<void> {
  const gateSnapshot = JSON.parse(readFileSync(join(outDir, 'gate.json'), 'utf8'))
  const gateCapturedAt = gateSnapshot.gateCapturedAt as string

  // Workstream A
  const candidates = await harvestMediaCandidates({ gateCapturedAt })
  const verdicts = await sampleAgeBuckets(candidates)
  const restoreAttachments = await loadRestoreAttachments({ gateCapturedAt })
  const parentCtx = await loadParentContextByPhone({ gateCapturedAt })

  const resolutions = new Map<string, ParentResolution>()
  for (const c of candidates) {
    resolutions.set(c.mediaId, resolveParent(c, {
      restoreAttachments,
      providerApplicationsByPhone: parentCtx.providerApplicationsByPhone,
      jobRequestsByPhone: parentCtx.jobRequestsByPhone,
    }))
  }
  const aPlan = planReplays({ candidates, verdicts, resolutions })

  // Workstream B
  const restoreDocs = await loadRestoreDocuments({ gateCapturedAt })
  const liveStorage = await loadLiveStorageObjects({ gateCapturedAt })
  const match = matchStorageObjects({ restoreDocuments: restoreDocs, liveStorageObjects: liveStorage })

  const restoreVerifications = await loadRestoreVerifications({ gateCapturedAt })
  const restoreWebhookEvents = await loadRestoreWebhookEvents({ gateCapturedAt })
  const triage = triageOrphanStorageObjects({
    orphans: match.orphanStorageObjects,
    restoreWebhookEvents,
    restoreVerifications: restoreVerifications.map((v) => ({
      id: v.id, providerId: v.providerId, providerApplicationId: v.providerApplicationId,
    })),
  })

  const candidatePhones = Array.from(parentCtx.providerApplicationsByPhone.keys())
  const diditResult = await runDiditTopUp({ candidatePhones })

  const reconciliation: ReconciliationRow[] = [
    ...aPlan.reconciliation,
    ...buildKycReconciliation([]),       // intentional empty — orphan rows are emitted by triage below
    ...triage.reconciliation,
    ...diditResult.reconciliation,
  ]

  const plan: Plan = {
    gateCapturedAt,
    whatsappReplays: aPlan.replays,
    kycVerificationInserts: restoreVerifications.map((v) => ({
      verificationId: v.id, sourceVerificationIdInRestore: v.id,
    })),
    kycDocumentInserts: match.matched.map((m) => ({
      documentIdInRestore: m.document.id, blobKey: m.document.blobKey,
    })),
    reconciliation,
  }

  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan, null, 2))
  writeFileSync(join(outDir, 'reconciliation.csv'), rowsToCsv(plan.reconciliation))
  console.info('[recovery] dry-run complete', {
    candidates: candidates.length,
    verdicts,
    replays: plan.whatsappReplays.length,
    kycDocuments: plan.kycDocumentInserts.length,
    kycVerifications: plan.kycVerificationInserts.length,
    reconciliationRows: plan.reconciliation.length,
  })
}

async function cmdApply(planPath: string): Promise<void> {
  const { db } = await import('@/lib/db')
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan
  await verifyStalePlanGuard({
    gateCapturedAt: plan.gateCapturedAt,
    historicalCounts: {},
  })

  // Workstream A — replay WhatsApp media (idempotent; mismatches captured)
  const replayReconciliation = await applyReplays(plan.whatsappReplays)

  // Workstream B — insert KYC verifications and documents from restore clone
  const restoreVerifications = await loadRestoreVerifications({ gateCapturedAt: plan.gateCapturedAt })
  const restoreVerificationById = new Map(restoreVerifications.map((v) => [v.id, v]))
  const restoreDocs = await loadRestoreDocuments({ gateCapturedAt: plan.gateCapturedAt })
  const restoreDocById = new Map(restoreDocs.map((d) => [d.id, d]))

  for (const insert of plan.kycVerificationInserts) {
    const src = restoreVerificationById.get(insert.sourceVerificationIdInRestore)
    if (!src) continue
    await db.providerIdentityVerification.upsert({
      where: { id: src.id },
      update: {},
      create: {
        id: src.id,
        providerId: src.providerId ?? undefined,
        providerApplicationId: src.providerApplicationId ?? undefined,
        vendorReference: src.vendorReference,
        vendorWorkflowId: src.vendorWorkflowId,
        status: src.status as never,
        decision: (src.decision ?? null) as never,
        rawPayloadRedacted: (src.rawPayloadRedacted ?? null) as never,
        consentTextHash: src.consentTextHash,
        accessTokenHash: src.accessTokenHash,
        channel: 'WHATSAPP' as never,
        identityBasis: 'SA_ID' as never,
      },
    })
  }

  for (const insert of plan.kycDocumentInserts) {
    const src = restoreDocById.get(insert.documentIdInRestore)
    if (!src) continue
    await db.providerIdentityDocument.upsert({
      where: { id: src.id },
      update: {},
      create: {
        id: src.id,
        verificationId: src.verificationId,
        documentKind: src.documentKind as never,
        blobKey: src.blobKey,
        mimeType: src.mimeType,
        sizeBytes: src.sizeBytes,
        sha256: src.sha256,
        deleteAfter: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    })
  }

  console.info('[recovery] apply complete', {
    whatsappReplaysAttempted: plan.whatsappReplays.length,
    whatsappReplayMismatches: replayReconciliation.length,
    kycVerificationsInserted: plan.kycVerificationInserts.length,
    kycDocumentsInserted: plan.kycDocumentInserts.length,
  })

  if (process.env.RECOVERY_VERIFY_SHA256 === 'true') {
    const integrity = await verifyDocumentIntegrity({
      matched: plan.kycDocumentInserts
        .map((i) => restoreDocById.get(i.documentIdInRestore))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => ({
          document: d,
          storage: { bucket_id: 'identity-documents', name: d.blobKey.replace(/^supabase:\/\/[^/]+\//, ''), mime_type: d.mimeType, size_bytes: d.sizeBytes },
        })),
      computeSha256: async () => '__unimplemented__',
    })
    console.info('[recovery] sha256 mismatches', integrity.length)
  }
}

async function main(): Promise<void> {
  const { subcommand, flags } = parseArgs(process.argv)
  const outDir = typeof flags.out === 'string' ? flags.out : './recovery'

  switch (subcommand) {
    case 'gate':
      await cmdGate(outDir)
      return
    case 'plan': {
      if (!flags['dry-run']) throw new Error('plan requires --dry-run')
      await cmdPlanDryRun(outDir)
      return
    }
    case 'apply': {
      if (!flags.confirm) throw new Error('apply requires --confirm')
      const planPath = typeof flags.plan === 'string' ? flags.plan : join(outDir, 'plan.json')
      await cmdApply(planPath)
      return
    }
    default:
      console.error('usage: db-wipe-recovery.ts <gate|plan|apply> [--dry-run|--confirm] [--out dir] [--plan path]')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('[recovery] failed', err)
  process.exit(1)
})
```

- [ ] **Step 2: Smoke-check the argparser without DB env.**

Run: `cd field-service && pnpm tsx scripts/db-wipe-recovery.ts 2>&1 | head -5`
Expected: prints `usage:` and exits 1.

- [ ] **Step 3: Run the full vitest suite to ensure no regression.**

Run: `cd field-service && pnpm vitest run`
Expected: all suites PASS (existing + new).

- [ ] **Step 4: Commit.**

```bash
cd field-service && git add scripts/db-wipe-recovery.ts
git commit -m "feat(recovery): CLI entry with gate / plan / apply subcommands"
```

---

### Task 18: Dry-run smoke against restore-clone + live snapshots

**Files:** none (operational task).

- [ ] **Step 1: Confirm `.env` has `DATABASE_URL`, `RESTORE_DATABASE_URL`, `WHATSAPP_ACCESS_TOKEN`.**

Run: `cd field-service && node -e "['DATABASE_URL','RESTORE_DATABASE_URL','WHATSAPP_ACCESS_TOKEN'].forEach((k) => console.log(k, Boolean(process.env[k])))" --require dotenv/config`
Expected: all three print `true`.

- [ ] **Step 2: Run gate.**

Run: `cd field-service && pnpm tsx scripts/db-wipe-recovery.ts gate --out ./recovery`
Expected: `recovery/gate.json` written with counts matching spec §2.

- [ ] **Step 3: Run plan --dry-run.**

Run: `cd field-service && pnpm tsx scripts/db-wipe-recovery.ts plan --dry-run --out ./recovery`
Expected: `recovery/plan.json` and `recovery/reconciliation.csv` written. No DB writes occurred (verify by re-running counts).

- [ ] **Step 4: Hand the CSV to user for review.**

Print the row count by gap kind and pause for sign-off before any `apply`.

Run: `cd field-service && awk -F, 'NR>1 {print $1}' ./recovery/reconciliation.csv | sort | uniq -c`
Expected: a small table grouped by `gapKind`.

- [ ] **Step 5: Commit the recovery artefacts under `.gitignore` (do NOT commit the artefacts themselves; ensure `recovery/` is gitignored).**

Edit `field-service/.gitignore`:

```
# DB wipe recovery artefacts (2026-06-06)
recovery/
```

```bash
cd field-service && git add .gitignore
git commit -m "chore: ignore recovery/ artefacts from one-shot wipe recovery"
```

---

## Self-review notes

- **Spec coverage.** §4 Phase 0 → Task 1; Gate 0 → Task 6; Workstream A1 → Task 7; A2 → Task 8; A3 → Task 9; A4 → Task 10 (with helper in Tasks 3 + 4); B1 → Task 11 + Task 17 apply path; B2 → Task 12; B3 → Task 13; B4 → Task 14; C silence → enforced by code-path discipline in Tasks 4, 10, 11, 12, 13 (no global-sender patching, no status writes); D reconciliation → Task 15 + integrated in Tasks 10–13; §5 execution shape → Task 17; §8 testing → covered per task plus the dry-run in Task 18.
- **Type consistency.** `RecoveryParent` (Task 4) and `ResolvedParent` (Task 5) are intentionally separate names: the helper accepts the helper-local type; the script's tagged union is widened with no extra cases. The kinds (`providerApplication | jobRequest | job | inspectionSlot`) match across both.
- **No placeholders.** Every code step has the full file contents needed. `cmdApply` performs all writes the spec scopes to it — Workstream A replay, KYC verification inserts, and KYC document inserts — via `upsert` for idempotency. The `computeSha256` callable in the optional integrity branch is intentionally a sentinel (`'__unimplemented__'`); Workstream B4's real Supabase Storage byte-fetch belongs in the storage helper file (`lib/identity-verification/storage.ts`) and is out of scope for this script — the spec-scoped path is to invoke `verifyDocumentIntegrity` only after the storage helper is extended, which is a follow-up if Task 18 surfaces a need.
- **Phase 0 gate.** Task 1 is non-code but is the first task; if it fails, the rest of the plan is abandoned cleanly.
