# WhatsApp Blob Gap Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a **read-only** verification script that finds `Attachment` rows whose Vercel Blob URLs no longer resolve, classifies the dead URLs by Meta media-retention age bucket, and emits a CSV gap report. No live DB writes, no blob writes, no notifications. Complements the user's separately-running end-to-end WABA recovery script.

**Scope note (2026-06-06):** Phase 0 (spec §4) closed with: Postgres restored from backup; only Vercel Blob + Supabase Storage objects were lost; user is running their own end-to-end WhatsApp media recovery script. This plan was rewritten from a recovery-with-writes plan to a verification-only audit after that confirmation.

**Architecture:** Single CLI script `pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery` that:
1. SELECTs all `Attachment` rows whose `uploadedBy LIKE 'system:whatsapp:%'`.
2. For each row, derives the Meta media ID from `uploadedBy` and looks up the matching `InboundWhatsAppMessage.firstSeenAt` for age-bucketing.
3. Issues a concurrent-bounded HTTP HEAD against each `Attachment.url` to determine whether the blob is alive.
4. Emits `recovery/whatsapp-blob-gaps.csv` listing every dead URL with its age bucket and replayability verdict.

**Tech Stack:** Node 24 (tsx), Prisma (read-only paths only), Node `fetch`, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-06-db-wipe-recovery-design.md` (commit `b813c5619`). This plan implements only the gap-discovery slice of Workstream A; Workstream B (KYC) and any DB/blob writes are out of scope.

**Branch:** `recovery/whatsapp-blob-audit` (not main).

**Production-safety contract:**

- The script reads from Postgres via `db.$queryRawUnsafe` with `SELECT` statements only; no `create`/`update`/`upsert`/`delete` calls anywhere in the diff.
- The script never writes to Vercel Blob or Supabase Storage.
- The script never sends WhatsApp / email / SMS.
- HEAD requests are concurrent-bounded (default 8 in-flight) and have a hard per-request timeout (default 5 s) to avoid hammering Vercel's CDN.
- Output CSV stays under `recovery/` which is gitignored at the end of the plan.
- A fresh `vitest` run with the existing suite must pass before merging.

---

## File structure

**Created (new):**

- `field-service/scripts/audit-whatsapp-blob-gaps.ts` — CLI entry; arg parsing, end-to-end orchestration.
- `field-service/scripts/whatsapp-blob-audit/types.ts` — shared types (`AttachmentRow`, `MediaIdIndex`, `HeadResult`, `GapRow`).
- `field-service/scripts/whatsapp-blob-audit/loader.ts` — read-only SELECT of `Attachment` + `InboundWhatsAppMessage`.
- `field-service/scripts/whatsapp-blob-audit/age-bucket.ts` — `(firstSeenAt, now) → 'lt_24h' | '1_to_3d' | '3_to_7d' | 'gt_7d'`.
- `field-service/scripts/whatsapp-blob-audit/head-checker.ts` — concurrent-bounded HEAD with timeout.
- `field-service/scripts/whatsapp-blob-audit/csv.ts` — gap CSV writer.

**Test files (new):**

- `field-service/__tests__/scripts/whatsapp-blob-audit/loader.test.ts`
- `field-service/__tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts`
- `field-service/__tests__/scripts/whatsapp-blob-audit/head-checker.test.ts`
- `field-service/__tests__/scripts/whatsapp-blob-audit/csv.test.ts`

**Modified:** none. The script does not touch any `lib/` file or any other existing application code.

---

### Task 1: Shared types

**Files:**
- Create: `field-service/scripts/whatsapp-blob-audit/types.ts`.

- [ ] **Step 1: Write the types module.**

Create `field-service/scripts/whatsapp-blob-audit/types.ts`:

```ts
export type AgeBucket = 'lt_24h' | '1_to_3d' | '3_to_7d' | 'gt_7d' | 'unknown'

export type AttachmentRow = {
  id: string
  mediaId: string
  url: string
  label: string | null
  parentKind: 'providerApplication' | 'jobRequest' | 'job' | 'inspectionSlot' | null
  parentId: string | null
}

export type MediaIdIndex = Map<string, Date>   // mediaId -> firstSeenAt

export type HeadResult = {
  attachmentId: string
  status: 'alive' | 'dead' | 'error'
  httpStatus: number | null
  errorMessage: string | null
  durationMs: number
}

export type GapRow = {
  attachmentId: string
  mediaIdSuffix: string
  ageBucket: AgeBucket
  parentKind: string | null
  parentId: string | null
  label: string | null
  httpStatus: number | null
  firstSeenAt: string | null
  replayable: boolean
  reason: string
}
```

- [ ] **Step 2: Commit.**

```bash
cd field-service && git add scripts/whatsapp-blob-audit/types.ts
git commit -m "feat(audit): shared types for whatsapp blob gap audit"
```

---

### Task 2: Read-only loader for Attachment + InboundWhatsAppMessage

**Files:**
- Create: `field-service/scripts/whatsapp-blob-audit/loader.ts`.
- Test: `field-service/__tests__/scripts/whatsapp-blob-audit/loader.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Create `field-service/__tests__/scripts/whatsapp-blob-audit/loader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAttachments, loadMediaIdIndex } from '@/scripts/whatsapp-blob-audit/loader'

vi.mock('@/lib/db', () => ({
  db: { $queryRawUnsafe: vi.fn() },
}))

describe('loadAttachments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SELECTs Attachment rows whose uploadedBy starts with system:whatsapp:', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', uploadedBy: 'system:whatsapp:abc12345', url: 'https://blob/x', label: 'evidence', providerApplicationId: 'app_1', jobRequestId: null, jobId: null, inspectionSlotId: null },
    ])
    const rows = await loadAttachments()
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringMatching(/SELECT/i))
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"uploadedBy" LIKE 'system:whatsapp:%'`))
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))
    expect(rows[0]).toEqual({
      id: 'a1', mediaId: 'abc12345', url: 'https://blob/x', label: 'evidence',
      parentKind: 'providerApplication', parentId: 'app_1',
    })
  })

  it('derives the correct parentKind from whichever FK is populated', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a2', uploadedBy: 'system:whatsapp:m2', url: 'u', label: null, providerApplicationId: null, jobRequestId: 'jr_1', jobId: null, inspectionSlotId: null },
      { id: 'a3', uploadedBy: 'system:whatsapp:m3', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: 'job_1', inspectionSlotId: null },
      { id: 'a4', uploadedBy: 'system:whatsapp:m4', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: null, inspectionSlotId: 'is_1' },
      { id: 'a5', uploadedBy: 'system:whatsapp:m5', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: null, inspectionSlotId: null },
    ])
    const rows = await loadAttachments()
    expect(rows.map((r) => r.parentKind)).toEqual(['jobRequest', 'job', 'inspectionSlot', null])
  })
})

describe('loadMediaIdIndex', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds a mediaId → firstSeenAt map from inbound_whatsapp_messages', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { media_id: 'm1', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { media_id: 'm2', firstSeenAt: new Date('2026-06-02T11:00:00Z') },
    ])
    const index = await loadMediaIdIndex()
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"messageType" IN ('image','document','video')`))
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))
    expect(index.get('m1')?.toISOString()).toBe('2026-06-06T11:00:00.000Z')
    expect(index.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loader.**

Create `field-service/scripts/whatsapp-blob-audit/loader.ts`:

```ts
import { db } from '@/lib/db'
import type { AttachmentRow, MediaIdIndex } from './types'

type RawRow = {
  id: string
  uploadedBy: string
  url: string
  label: string | null
  providerApplicationId: string | null
  jobRequestId: string | null
  jobId: string | null
  inspectionSlotId: string | null
}

function parentFromRow(r: RawRow): { parentKind: AttachmentRow['parentKind']; parentId: string | null } {
  if (r.providerApplicationId) return { parentKind: 'providerApplication', parentId: r.providerApplicationId }
  if (r.jobRequestId) return { parentKind: 'jobRequest', parentId: r.jobRequestId }
  if (r.jobId) return { parentKind: 'job', parentId: r.jobId }
  if (r.inspectionSlotId) return { parentKind: 'inspectionSlot', parentId: r.inspectionSlotId }
  return { parentKind: null, parentId: null }
}

export async function loadAttachments(): Promise<AttachmentRow[]> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT id, "uploadedBy", url, label,
            "providerApplicationId", "jobRequestId", "jobId", "inspectionSlotId"
     FROM attachments
     WHERE "uploadedBy" LIKE 'system:whatsapp:%'`,
  )
  return rows.map((r) => {
    const { parentKind, parentId } = parentFromRow(r)
    return {
      id: r.id,
      mediaId: r.uploadedBy.slice('system:whatsapp:'.length),
      url: r.url,
      label: r.label,
      parentKind,
      parentId,
    }
  })
}

export async function loadMediaIdIndex(): Promise<MediaIdIndex> {
  const rows = await db.$queryRawUnsafe<Array<{ media_id: string; firstSeenAt: Date }>>(
    `SELECT
       payload -> "messageType" ->> 'id' AS media_id,
       "firstSeenAt"
     FROM inbound_whatsapp_messages
     WHERE "messageType" IN ('image','document','video')`,
  )
  const index: MediaIdIndex = new Map()
  for (const r of rows) {
    if (r.media_id) index.set(r.media_id, r.firstSeenAt)
  }
  return index
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/loader.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/whatsapp-blob-audit/loader.ts __tests__/scripts/whatsapp-blob-audit/loader.test.ts
git commit -m "feat(audit): read-only loader for whatsapp Attachment + inbound media IDs"
```

---

### Task 3: Age-bucket classifier

**Files:**
- Create: `field-service/scripts/whatsapp-blob-audit/age-bucket.ts`.
- Test: `field-service/__tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Create `field-service/__tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyAge } from '@/scripts/whatsapp-blob-audit/age-bucket'

const now = new Date('2026-06-06T12:00:00Z')

describe('classifyAge', () => {
  it('lt_24h for < 24h old', () => {
    expect(classifyAge(new Date('2026-06-06T08:00:00Z'), now)).toBe('lt_24h')
  })

  it('1_to_3d for >= 24h and < 72h', () => {
    expect(classifyAge(new Date('2026-06-04T13:00:00Z'), now)).toBe('1_to_3d')
  })

  it('3_to_7d for >= 72h and < 168h', () => {
    expect(classifyAge(new Date('2026-06-01T13:00:00Z'), now)).toBe('3_to_7d')
  })

  it('gt_7d for >= 168h', () => {
    expect(classifyAge(new Date('2026-05-29T11:00:00Z'), now)).toBe('gt_7d')
  })

  it('unknown when firstSeenAt is null', () => {
    expect(classifyAge(null, now)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier.**

Create `field-service/scripts/whatsapp-blob-audit/age-bucket.ts`:

```ts
import type { AgeBucket } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function classifyAge(firstSeenAt: Date | null, now: Date): AgeBucket {
  if (!firstSeenAt) return 'unknown'
  const ageMs = now.getTime() - firstSeenAt.getTime()
  if (ageMs < DAY_MS) return 'lt_24h'
  if (ageMs < 3 * DAY_MS) return '1_to_3d'
  if (ageMs < 7 * DAY_MS) return '3_to_7d'
  return 'gt_7d'
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/whatsapp-blob-audit/age-bucket.ts __tests__/scripts/whatsapp-blob-audit/age-bucket.test.ts
git commit -m "feat(audit): age-bucket classifier for Meta 7-day retention window"
```

---

### Task 4: Concurrent-bounded HEAD checker

**Files:**
- Create: `field-service/scripts/whatsapp-blob-audit/head-checker.ts`.
- Test: `field-service/__tests__/scripts/whatsapp-blob-audit/head-checker.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Create `field-service/__tests__/scripts/whatsapp-blob-audit/head-checker.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { headCheckAll } from '@/scripts/whatsapp-blob-audit/head-checker'
import type { AttachmentRow } from '@/scripts/whatsapp-blob-audit/types'

const mk = (id: string, url: string): AttachmentRow => ({ id, mediaId: id, url, label: null, parentKind: null, parentId: null })

describe('headCheckAll', () => {
  it('returns alive for 200, dead for 404, error for thrown', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('ok')) return { ok: true, status: 200 } as Response
      if (url.includes('miss')) return { ok: false, status: 404 } as Response
      throw new Error('network')
    }) as unknown as typeof fetch
    const results = await headCheckAll(
      [mk('a', 'https://blob/ok'), mk('b', 'https://blob/miss'), mk('c', 'https://blob/err')],
      { fetcher, concurrency: 3, timeoutMs: 1000 },
    )
    const byId = Object.fromEntries(results.map((r) => [r.attachmentId, r]))
    expect(byId.a.status).toBe('alive')
    expect(byId.a.httpStatus).toBe(200)
    expect(byId.b.status).toBe('dead')
    expect(byId.b.httpStatus).toBe(404)
    expect(byId.c.status).toBe('error')
    expect(byId.c.errorMessage).toBe('network')
  })

  it('respects the concurrency limit', async () => {
    let inFlight = 0
    let maxSeen = 0
    const fetcher = vi.fn(async () => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return { ok: true, status: 200 } as Response
    }) as unknown as typeof fetch
    const rows = Array.from({ length: 10 }).map((_, i) => mk(`a${i}`, `https://blob/${i}`))
    await headCheckAll(rows, { fetcher, concurrency: 3, timeoutMs: 1000 })
    expect(maxSeen).toBeLessThanOrEqual(3)
  })

  it('marks requests that exceed timeoutMs as error', async () => {
    const fetcher = vi.fn(async (_url: string, opts?: RequestInit) => {
      const signal = opts?.signal as AbortSignal | undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch
    const results = await headCheckAll([mk('a', 'https://slow')], { fetcher, concurrency: 1, timeoutMs: 20 })
    expect(results[0].status).toBe('error')
    expect(results[0].errorMessage).toContain('abort')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/head-checker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the HEAD checker.**

Create `field-service/scripts/whatsapp-blob-audit/head-checker.ts`:

```ts
import type { AttachmentRow, HeadResult } from './types'

export async function headCheckAll(
  rows: AttachmentRow[],
  opts: { fetcher?: typeof fetch; concurrency?: number; timeoutMs?: number } = {},
): Promise<HeadResult[]> {
  const fetcher = opts.fetcher ?? fetch
  const concurrency = opts.concurrency ?? 8
  const timeoutMs = opts.timeoutMs ?? 5000

  const results: HeadResult[] = new Array(rows.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++
      const row = rows[i]
      const start = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetcher(row.url, { method: 'HEAD', signal: controller.signal })
        const httpStatus = res.status
        results[i] = {
          attachmentId: row.id,
          status: res.ok ? 'alive' : 'dead',
          httpStatus,
          errorMessage: null,
          durationMs: Date.now() - start,
        }
      } catch (err: unknown) {
        results[i] = {
          attachmentId: row.id,
          status: 'error',
          httpStatus: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        }
      } finally {
        clearTimeout(timer)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, () => worker())
  await Promise.all(workers)
  return results
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/head-checker.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/whatsapp-blob-audit/head-checker.ts __tests__/scripts/whatsapp-blob-audit/head-checker.test.ts
git commit -m "feat(audit): concurrent-bounded HEAD checker with per-request timeout"
```

---

### Task 5: Gap CSV writer

**Files:**
- Create: `field-service/scripts/whatsapp-blob-audit/csv.ts`.
- Test: `field-service/__tests__/scripts/whatsapp-blob-audit/csv.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Create `field-service/__tests__/scripts/whatsapp-blob-audit/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildGapRows, gapRowsToCsv } from '@/scripts/whatsapp-blob-audit/csv'
import type { AttachmentRow, HeadResult, MediaIdIndex } from '@/scripts/whatsapp-blob-audit/types'

const now = new Date('2026-06-06T12:00:00Z')

describe('buildGapRows', () => {
  it('emits one row per dead/error HeadResult and skips alive ones', () => {
    const attachments: AttachmentRow[] = [
      { id: 'a_alive', mediaId: 'm_alive', url: 'u', label: 'evidence', parentKind: 'providerApplication', parentId: 'app_1' },
      { id: 'a_dead', mediaId: 'm_dead', url: 'u', label: 'evidence', parentKind: 'jobRequest', parentId: 'jr_1' },
      { id: 'a_err', mediaId: 'm_err', url: 'u', label: null, parentKind: null, parentId: null },
    ]
    const head: HeadResult[] = [
      { attachmentId: 'a_alive', status: 'alive', httpStatus: 200, errorMessage: null, durationMs: 5 },
      { attachmentId: 'a_dead', status: 'dead', httpStatus: 404, errorMessage: null, durationMs: 5 },
      { attachmentId: 'a_err', status: 'error', httpStatus: null, errorMessage: 'net', durationMs: 5 },
    ]
    const index: MediaIdIndex = new Map([
      ['m_dead', new Date('2026-06-06T08:00:00Z')],
      ['m_err', new Date('2026-05-28T08:00:00Z')],
    ])
    const rows = buildGapRows(attachments, head, index, now)
    expect(rows.map((r) => r.attachmentId).sort()).toEqual(['a_dead', 'a_err'])
    const dead = rows.find((r) => r.attachmentId === 'a_dead')!
    expect(dead.ageBucket).toBe('lt_24h')
    expect(dead.replayable).toBe(true)
    expect(dead.mediaIdSuffix).toBe('m_dead'.slice(-8))
    const err = rows.find((r) => r.attachmentId === 'a_err')!
    expect(err.ageBucket).toBe('gt_7d')
    expect(err.replayable).toBe(false)
  })

  it('marks replayable=false for unknown age (no inbound row found)', () => {
    const rows = buildGapRows(
      [{ id: 'a1', mediaId: 'm1', url: 'u', label: null, parentKind: null, parentId: null }],
      [{ attachmentId: 'a1', status: 'dead', httpStatus: 404, errorMessage: null, durationMs: 5 }],
      new Map(),
      now,
    )
    expect(rows[0].ageBucket).toBe('unknown')
    expect(rows[0].replayable).toBe(false)
  })
})

describe('gapRowsToCsv', () => {
  it('emits header + CSV rows with proper escaping', () => {
    const csv = gapRowsToCsv([
      { attachmentId: 'a1', mediaIdSuffix: 'abc12345', ageBucket: 'lt_24h', parentKind: 'jobRequest', parentId: 'jr_1', label: 'evidence,with,commas', httpStatus: 404, firstSeenAt: '2026-06-06T08:00:00Z', replayable: true, reason: 'dead_blob_within_meta_window' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('attachmentId,mediaIdSuffix,ageBucket,parentKind,parentId,label,httpStatus,firstSeenAt,replayable,reason')
    expect(lines[1]).toContain('"evidence,with,commas"')
    expect(lines[1].startsWith('a1,abc12345,lt_24h,jobRequest,jr_1,')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CSV module.**

Create `field-service/scripts/whatsapp-blob-audit/csv.ts`:

```ts
import { classifyAge } from './age-bucket'
import type { AttachmentRow, GapRow, HeadResult, MediaIdIndex } from './types'

const COLUMNS: Array<keyof GapRow> = [
  'attachmentId', 'mediaIdSuffix', 'ageBucket', 'parentKind', 'parentId',
  'label', 'httpStatus', 'firstSeenAt', 'replayable', 'reason',
]

function escape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const s = String(value)
  const needsQuoting = /[",\n]/.test(s)
  const inner = s.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

export function buildGapRows(
  attachments: AttachmentRow[],
  headResults: HeadResult[],
  mediaIndex: MediaIdIndex,
  now: Date,
): GapRow[] {
  const attachmentById = new Map(attachments.map((a) => [a.id, a]))
  const out: GapRow[] = []
  for (const head of headResults) {
    if (head.status === 'alive') continue
    const att = attachmentById.get(head.attachmentId)
    if (!att) continue
    const firstSeen = mediaIndex.get(att.mediaId) ?? null
    const bucket = classifyAge(firstSeen, now)
    const replayable = bucket === 'lt_24h' || bucket === '1_to_3d' || bucket === '3_to_7d'
    out.push({
      attachmentId: att.id,
      mediaIdSuffix: att.mediaId.slice(-8),
      ageBucket: bucket,
      parentKind: att.parentKind,
      parentId: att.parentId,
      label: att.label,
      httpStatus: head.httpStatus,
      firstSeenAt: firstSeen ? firstSeen.toISOString() : null,
      replayable,
      reason: replayable ? 'dead_blob_within_meta_window' : bucket === 'unknown' ? 'no_inbound_record_found' : 'dead_blob_beyond_meta_window',
    })
  }
  return out
}

export function gapRowsToCsv(rows: GapRow[]): string {
  const header = COLUMNS.join(',')
  const body = rows
    .map((row) => COLUMNS.map((c) => escape((row[c] ?? null) as string | number | boolean | null)).join(','))
    .join('\n')
  return body ? `${header}\n${body}` : header
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd field-service && pnpm vitest run __tests__/scripts/whatsapp-blob-audit/csv.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/whatsapp-blob-audit/csv.ts __tests__/scripts/whatsapp-blob-audit/csv.test.ts
git commit -m "feat(audit): gap row builder + CSV writer"
```

---

### Task 6: CLI entry + .gitignore

**Files:**
- Create: `field-service/scripts/audit-whatsapp-blob-gaps.ts`.
- Modify: `field-service/.gitignore` (append a `recovery/` line if not already present).

- [ ] **Step 1: Write the CLI entry.**

Create `field-service/scripts/audit-whatsapp-blob-gaps.ts`:

```ts
/**
 * audit-whatsapp-blob-gaps.ts
 *
 * READ-ONLY audit of Attachment rows whose Vercel Blob URLs no longer resolve.
 * Emits a CSV of dead/error rows with their Meta media-retention age bucket
 * so the operator knows what is still replayable.
 *
 * Usage:
 *   pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery [--concurrency 8] [--timeout-ms 5000]
 *
 * Requires:
 *   DATABASE_URL
 *
 * Production-safety: this script never writes to Postgres, Vercel Blob, or
 * Supabase Storage. It issues SELECT queries and HTTP HEAD requests only.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAttachments, loadMediaIdIndex } from './whatsapp-blob-audit/loader'
import { headCheckAll } from './whatsapp-blob-audit/head-checker'
import { buildGapRows, gapRowsToCsv } from './whatsapp-blob-audit/csv'

type Args = { out: string; concurrency: number; timeoutMs: number }

function parseArgs(argv: string[]): Args {
  let out = './recovery'
  let concurrency = 8
  let timeoutMs = 5000
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    if (flag === '--out' && next) { out = next; i++ }
    else if (flag === '--concurrency' && next) { concurrency = Number(next); i++ }
    else if (flag === '--timeout-ms' && next) { timeoutMs = Number(next); i++ }
  }
  return { out, concurrency, timeoutMs }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  console.info('[audit] loading attachments and media index...')
  const [attachments, mediaIndex] = await Promise.all([loadAttachments(), loadMediaIdIndex()])
  console.info('[audit] loaded', { attachments: attachments.length, mediaIndex: mediaIndex.size })

  console.info('[audit] head-checking blob URLs', { concurrency: args.concurrency, timeoutMs: args.timeoutMs })
  const headResults = await headCheckAll(attachments, {
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
  })

  const summary = headResults.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] head-check summary', summary)

  const gaps = buildGapRows(attachments, headResults, mediaIndex, new Date())
  mkdirSync(args.out, { recursive: true })
  writeFileSync(join(args.out, 'whatsapp-blob-gaps.csv'), gapRowsToCsv(gaps))
  console.info('[audit] wrote', join(args.out, 'whatsapp-blob-gaps.csv'), { rows: gaps.length })

  const byBucket = gaps.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.ageBucket}/${r.replayable ? 'replayable' : 'expired'}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] gap distribution', byBucket)
}

main().catch((err) => {
  console.error('[audit] failed', err)
  process.exit(1)
})
```

- [ ] **Step 2: Append `recovery/` to `.gitignore` if not already present.**

Run: `cd field-service && grep -qxF 'recovery/' .gitignore || printf '\n# whatsapp-blob-audit artefacts (2026-06-06)\nrecovery/\n' >> .gitignore`
Expected: no error; verify with `tail -3 field-service/.gitignore`.

- [ ] **Step 3: Smoke-check the arg parser (no DB needed).**

Run: `cd field-service && pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out /tmp/audit-smoke 2>&1 | head -3 || true`
Expected: prints `[audit] loading attachments and media index...` then errors on missing `DATABASE_URL`. The arg parser ran successfully.

- [ ] **Step 4: Run the full vitest suite to verify no regression.**

Run: `cd field-service && pnpm vitest run`
Expected: all suites PASS (existing + new).

- [ ] **Step 5: Commit.**

```bash
cd field-service && git add scripts/audit-whatsapp-blob-gaps.ts .gitignore
git commit -m "feat(audit): CLI entry for whatsapp blob gap audit"
```

---

### Task 7: Live smoke run + read-only verification

**Files:** none.

- [ ] **Step 1: Confirm `.env` has `DATABASE_URL` pointing at live prod.**

Run: `cd field-service && node --require dotenv/config -e "console.log('db?', Boolean(process.env.DATABASE_URL))"`
Expected: prints `db? true`.

- [ ] **Step 2: Run the audit.**

Run: `cd field-service && pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery --concurrency 8 --timeout-ms 5000`
Expected: emits `recovery/whatsapp-blob-gaps.csv` and logs `head-check summary`, `gap distribution`.

- [ ] **Step 3: Independently confirm zero writes occurred during the audit.**

Capture `attachments` count immediately before and immediately after the audit run via `psql` (or any read-only client):

```sql
SELECT COUNT(*) FROM attachments;
SELECT MAX("createdAt") FROM attachments;
```

Expected: both numbers identical before and after; `MAX("createdAt")` unchanged.

- [ ] **Step 4: Hand the CSV to the operator.**

Print the row count by bucket for at-a-glance triage:

Run: `cd field-service && awk -F, 'NR>1 {print $3"/"$9}' ./recovery/whatsapp-blob-gaps.csv | sort | uniq -c`
Expected: counts grouped by `(ageBucket, replayable)`.

- [ ] **Step 5: Push the branch and open a PR.**

Run: `cd field-service/.. && git push -u origin recovery/whatsapp-blob-audit && gh pr create --base main --title "Audit: WhatsApp blob gap finder (read-only)" --body "$(cat <<'EOF'
## Summary
Read-only audit script that lists Attachment rows whose Vercel Blob URLs no longer resolve, with Meta retention age bucketing.

- No live writes (Postgres, Vercel Blob, Supabase Storage).
- Concurrent-bounded HEAD checks (default 8, 5 s timeout).
- Complements the operator's separate end-to-end WABA recovery script.

## Test plan
- [x] Unit tests across loader, age-bucket, head-checker, csv (vitest)
- [x] Smoke run against live prod produced `whatsapp-blob-gaps.csv`
- [x] `SELECT COUNT(*)/MAX(createdAt) FROM attachments` unchanged across run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"`
Expected: PR URL printed.

---

## Self-review notes

- **Spec coverage.** Only the gap-discovery slice of Workstream A is in scope (read-only audit). KYC (Workstream B), DB writes, blob writes, and notifications are all out of scope and not implemented.
- **No placeholders.** Every code step contains full file contents; every command has expected output.
- **Production safety.** The diff contains no `create`/`update`/`upsert`/`delete` Prisma calls. The only Prisma surface is `db.$queryRawUnsafe` with `SELECT` statements bounded by `LIKE 'system:whatsapp:%'`. HEAD requests are concurrency-bounded with per-request timeouts. CSV artefacts are gitignored.
- **Idempotency.** The script is naturally idempotent — it reads, classifies, and writes a local CSV. Re-running it overwrites the CSV; nothing else changes.
- **Branch discipline.** All work happens on `recovery/whatsapp-blob-audit`, not on main.
